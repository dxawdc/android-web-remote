package com.remotecontrol.agent

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.graphics.ColorSpace
import android.graphics.Path
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.util.Base64
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import androidx.core.content.ContextCompat
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class RemoteAccessibilityService : AccessibilityService() {
    companion object {
        const val ACTION_RECONNECT="com.remotecontrol.agent.RECONNECT"
        private const val CAPTURE_TIMEOUT_MS=5_000L
        private const val CAPTURE_RETRY_DELAY_MS=1_000L
        private const val QUEUE_LIMIT_BYTES=512L*1024L
        private const val QUEUE_RECOVERY_MS=8_000L
        @Volatile var connected=false
        @Volatile var statusMessage:String?=null
    }
    private val main=Handler(Looper.getMainLooper()); private val screenshotExecutor=Executors.newSingleThreadExecutor(); @Volatile private var reconnectPending=false; @Volatile private var connectionAttempt=0L
    private val http=OkHttpClient.Builder().pingInterval(20,TimeUnit.SECONDS).build(); private var socket:WebSocket?=null; private var streaming=false; @Volatile private var captureInFlight=false; @Volatile private var captureGeneration=0L; @Volatile private var captureStartedAt=0L; @Volatile private var captureRetryAfter=0L; private var congestedSince=0L; private var reconnectDelay=1_000L
    private val reconnectReceiver=object:android.content.BroadcastReceiver(){override fun onReceive(context:android.content.Context?,intent:Intent?){connect()}}
    private val screenshotLoop=object:Runnable{
        override fun run(){
            if(streaming&&connected){
                val now=SystemClock.elapsedRealtime()
                if(captureInFlight&&now-captureStartedAt>=CAPTURE_TIMEOUT_MS){
                    captureGeneration++
                    captureInFlight=false
                    captureStartedAt=0
                    captureRetryAfter=now+CAPTURE_RETRY_DELAY_MS
                    sendCaptureError(-1,"timeout")
                }
                if(!captureInFlight&&now>=captureRetryAfter)captureFrame()
            }
            if(streaming)main.postDelayed(this,350)
        }
    }

    override fun onServiceConnected(){super.onServiceConnected(); ContextCompat.registerReceiver(this,reconnectReceiver,IntentFilter(ACTION_RECONNECT),ContextCompat.RECEIVER_NOT_EXPORTED);statusMessage=getString(R.string.status_connecting);connect()}
    override fun onAccessibilityEvent(event:AccessibilityEvent?)=Unit
    override fun onInterrupt()=Unit
    override fun onDestroy(){stopStreaming();main.removeCallbacksAndMessages(null);socket?.close(1000,"service stopped");connected=false;runCatching{unregisterReceiver(reconnectReceiver)};screenshotExecutor.shutdownNow();super.onDestroy()}

    private fun connect(){reconnectPending=false;val attempt=++connectionAttempt;connected=false;statusMessage=getString(R.string.status_connecting);socket?.cancel();val cfg=AgentConfig(this);val request=runCatching{Request.Builder().url(cfg.serverUrl).build()}.getOrElse{statusMessage=getString(R.string.invalid_server_url);return};socket=http.newWebSocket(request,object:WebSocketListener(){
        override fun onOpen(webSocket:WebSocket,response:Response){if(attempt!=connectionAttempt)return;reconnectDelay=1_000;statusMessage=getString(R.string.status_authenticating);webSocket.send(JSONObject().put("type","registerDevice").put("deviceId",cfg.deviceId).put("accessKey",cfg.accessKey).toString())}
        override fun onMessage(webSocket:WebSocket,text:String){if(attempt!=connectionAttempt)return;runCatching{val message=JSONObject(text);when(message.optString("type")){"registered"->{connected=true;statusMessage=getString(R.string.status_connected)};"authFailed"->{connected=false;statusMessage=getString(R.string.status_auth_failed);webSocket.close(4003,"auth failed")};else->handle(message)}}}
        override fun onClosed(webSocket:WebSocket,code:Int,reason:String){if(attempt!=connectionAttempt)return;if(code==4003)scheduleAuthRetry() else scheduleReconnect()}
        override fun onFailure(webSocket:WebSocket,t:Throwable,response:Response?){if(attempt==connectionAttempt)scheduleReconnect()}
    })}
    private fun scheduleReconnect(){if(reconnectPending)return;reconnectPending=true;connected=false;stopStreaming();statusMessage=getString(R.string.status_retrying,(reconnectDelay/1000).coerceAtLeast(1));main.postDelayed({reconnectPending=false;connect()},reconnectDelay);reconnectDelay=(reconnectDelay*2).coerceAtMost(30_000)}
    private fun scheduleAuthRetry(){if(reconnectPending)return;reconnectPending=true;connected=false;stopStreaming();statusMessage=getString(R.string.status_auth_failed);main.postDelayed({reconnectPending=false;connect()},30_000)}
    private fun send(json:JSONObject){
        val active=socket?:return
        if(!connected)return
        if(json.optString("type")=="screenFrame"){
            val queued=active.queueSize()
            if(queued>QUEUE_LIMIT_BYTES){
                val now=SystemClock.elapsedRealtime()
                if(congestedSince==0L)congestedSince=now
                if(now-congestedSince>=QUEUE_RECOVERY_MS){
                    congestedSince=0
                    active.cancel()
                    scheduleReconnect()
                }
                return
            }
            congestedSince=0
        }
        if(!active.send(json.toString()))scheduleReconnect()
    }
    private fun sendCaptureError(code:Int,reason:String){send(JSONObject().put("type","captureError").put("code",code).put("reason",reason))}
    private fun stopStreaming(){streaming=false;captureGeneration++;captureInFlight=false;captureStartedAt=0;captureRetryAfter=0;congestedSince=0;main.removeCallbacks(screenshotLoop)}
    private fun restartStreaming(){stopStreaming();streaming=true;main.post(screenshotLoop)}

    private fun handle(message:JSONObject){when(message.optString("type")){
        "getDeviceInfo"->sendDeviceInfo()
        "startStream"->{if(!streaming)restartStreaming()}
        "restartStream"->restartStreaming()
        "stopStream"->stopStreaming()
        "launchApp"->launchApp(message.optString("packageName"))
        "back"->performGlobalAction(GLOBAL_ACTION_BACK)
        "home"->performGlobalAction(GLOBAL_ACTION_HOME)
        "recents"->performGlobalAction(GLOBAL_ACTION_RECENTS)
        "wakeScreen"->wakeScreen()
        "gesture"->performGesture(message)
    }}
    /** 点亮息屏幕；不会绕过 PIN、图案或密码锁屏。 */
    private fun wakeScreen(){
        val powerManager=getSystemService(POWER_SERVICE) as PowerManager
        if(powerManager.isInteractive)return
        @Suppress("DEPRECATION")
        val wakeLock=powerManager.newWakeLock(
            PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP,
            "remotecontrol:screenWake"
        )
        wakeLock.acquire(1_500L)
        main.postDelayed({runCatching{if(wakeLock.isHeld)wakeLock.release()}},1_600L)
    }
    private fun launchApp(packageName:String){packageManager.getLaunchIntentForPackage(packageName)?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)?.let(::startActivity)}
    private fun performGesture(message:JSONObject){val metrics=resources.displayMetrics;val action=message.optString("action");val path=Path();val duration:Long
        if(action=="tap"){path.moveTo((message.optDouble("x")*metrics.widthPixels).toFloat(),(message.optDouble("y")*metrics.heightPixels).toFloat());duration=60}
        else{path.moveTo((message.optDouble("startX")*metrics.widthPixels).toFloat(),(message.optDouble("startY")*metrics.heightPixels).toFloat());path.lineTo((message.optDouble("endX")*metrics.widthPixels).toFloat(),(message.optDouble("endY")*metrics.heightPixels).toFloat());duration=350}
        dispatchGesture(GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path,0,duration)).build(),null,null)
    }
    private fun sendDeviceInfo(){val launchIntent=Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);val apps=packageManager.queryIntentActivities(launchIntent,0).map{JSONObject().put("label",it.loadLabel(packageManager).toString()).put("packageName",it.activityInfo.packageName)}.distinctBy{it.getString("packageName")}.sortedBy{it.getString("label")}
        val battery=getSystemService(BatteryManager::class.java).getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);val data=JSONObject().put("name","我的 Android 手机").put("model",Build.MODEL).put("androidVersion",Build.VERSION.RELEASE).put("battery",battery).put("apps",JSONArray(apps));send(JSONObject().put("type","deviceInfo").put("data",data))
    }
    private fun captureFrame(){
        val generation=++captureGeneration
        captureInFlight=true
        captureStartedAt=SystemClock.elapsedRealtime()
        runCatching{
            takeScreenshot(Display.DEFAULT_DISPLAY,screenshotExecutor,object:TakeScreenshotCallback{
                override fun onSuccess(result:ScreenshotResult){
                    val buffer=result.hardwareBuffer
                    if(generation!=captureGeneration){buffer.close();return}
                    try{
                        val hardware=Bitmap.wrapHardwareBuffer(buffer,result.colorSpace?:ColorSpace.get(ColorSpace.Named.SRGB))
                        if(hardware==null){sendCaptureError(-2,"buffer");return}
                        val source=hardware.copy(Bitmap.Config.ARGB_8888,false)
                        val scale=(720f/source.width).coerceAtMost(1f)
                        val bitmap=if(scale<1f)Bitmap.createScaledBitmap(source,(source.width*scale).toInt(),(source.height*scale).toInt(),true)else source
                        if(bitmap!==source)source.recycle()
                        val out=ByteArrayOutputStream()
                        bitmap.compress(Bitmap.CompressFormat.JPEG,45,out)
                        bitmap.recycle()
                        send(JSONObject().put("type","screenFrame").put("data",Base64.encodeToString(out.toByteArray(),Base64.NO_WRAP)))
                        captureRetryAfter=0
                    }catch(_:Throwable){
                        captureRetryAfter=SystemClock.elapsedRealtime()+CAPTURE_RETRY_DELAY_MS
                        sendCaptureError(-3,"processing")
                    }finally{
                        buffer.close()
                        if(generation==captureGeneration){captureInFlight=false;captureStartedAt=0}
                    }
                }
                override fun onFailure(errorCode:Int){
                    if(generation!=captureGeneration)return
                    captureInFlight=false
                    captureStartedAt=0
                    captureRetryAfter=SystemClock.elapsedRealtime()+CAPTURE_RETRY_DELAY_MS
                    sendCaptureError(errorCode,"system")
                }
            })
        }.onFailure{
            if(generation==captureGeneration){
                captureInFlight=false
                captureStartedAt=0
                captureRetryAfter=SystemClock.elapsedRealtime()+CAPTURE_RETRY_DELAY_MS
                sendCaptureError(-4,"exception")
            }
        }
    }
}
