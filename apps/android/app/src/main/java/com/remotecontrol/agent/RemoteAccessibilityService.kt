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
        const val ACTION_CAPTURE_TEST="com.remotecontrol.agent.CAPTURE_TEST"
        @Volatile var serviceActive=false
        const val ACTION_RECONNECT="com.remotecontrol.agent.RECONNECT"
        private const val CAPTURE_TIMEOUT_MS=5_000L
        private const val CAPTURE_RETRY_DELAY_MS=1_000L
        private const val QUEUE_LIMIT_BYTES=512L*1024L
        private const val QUEUE_RECOVERY_MS=8_000L
        @Volatile var connected=false
        @Volatile var statusMessage:String?=null
    }
    private var destroyed=false
    private var framesSent=0L
    private val reconnectTask=Runnable { if(!destroyed)connect() }
    private val main=Handler(Looper.getMainLooper()); private val screenshotExecutor=Executors.newSingleThreadExecutor(); @Volatile private var reconnectPending=false; @Volatile private var connectionAttempt=0L
    private val http=OkHttpClient.Builder().pingInterval(20,TimeUnit.SECONDS).build(); private var socket:WebSocket?=null; private var streaming=false; @Volatile private var captureInFlight=false; @Volatile private var captureGeneration=0L; @Volatile private var captureStartedAt=0L; @Volatile private var captureRetryAfter=0L; private var congestedSince=0L; private var reconnectDelay=1_000L
    private val reconnectReceiver=object:android.content.BroadcastReceiver(){override fun onReceive(context:android.content.Context?,intent:Intent?){
        if(intent?.action==ACTION_CAPTURE_TEST){
            DiagnosticLog.record("截图自检","收到手机本地自检请求；不保存截图")
            if(captureInFlight) DiagnosticLog.record("截图自检","已有截图任务运行，请等待结果") else captureFrame()
        }else connect()
    }}
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

    override fun onServiceConnected(){
        super.onServiceConnected(); destroyed=false; serviceActive=true; DiagnosticLog.initialize(this)
        DiagnosticLog.record("无障碍服务","已启动；截图能力=${serviceInfo.capabilities and 128 != 0}；手势能力=${serviceInfo.capabilities and 32 != 0}")
        ContextCompat.registerReceiver(this,reconnectReceiver,IntentFilter(ACTION_RECONNECT).apply{addAction(ACTION_CAPTURE_TEST)},ContextCompat.RECEIVER_NOT_EXPORTED)
        connect()
    }
    override fun onAccessibilityEvent(event:AccessibilityEvent?)=Unit
    override fun onInterrupt(){DiagnosticLog.record("无障碍服务","系统中断服务")}
    override fun onDestroy(){
        destroyed=true;serviceActive=false;connectionAttempt++;stopStreaming();main.removeCallbacksAndMessages(null)
        socket?.cancel();socket=null;connected=false;statusMessage=getString(R.string.status_permission)
        DiagnosticLog.record("无障碍服务","已停止；请重新开启权限")
        runCatching{unregisterReceiver(reconnectReceiver)};screenshotExecutor.shutdownNow();super.onDestroy()
    }

    private fun connect(){
        if(destroyed)return
        main.removeCallbacks(reconnectTask);reconnectPending=false;stopStreaming()
        val attempt=++connectionAttempt;connected=false;statusMessage=getString(R.string.status_connecting);socket?.cancel()
        DiagnosticLog.record("连接","开始连接；尝试 $attempt")
        val cfg=AgentConfig(this)
        val request=runCatching{Request.Builder().url(cfg.serverUrl).build()}.getOrElse{
            statusMessage=getString(R.string.invalid_server_url);DiagnosticLog.record("连接失败","服务地址格式无效");return
        }
        socket=http.newWebSocket(request,object:WebSocketListener(){
            override fun onOpen(webSocket:WebSocket,response:Response){main.post{
                if(destroyed||attempt!=connectionAttempt)return@post
                reconnectDelay=1_000;statusMessage=getString(R.string.status_authenticating)
                DiagnosticLog.record("连接","WebSocket 已建立；开始设备认证")
                webSocket.send(JSONObject().put("type","registerDevice").put("deviceId",cfg.deviceId).put("accessKey",cfg.accessKey).toString())
            }}
            override fun onMessage(webSocket:WebSocket,text:String){main.post{
                if(destroyed||attempt!=connectionAttempt)return@post
                runCatching{
                    val message=JSONObject(text)
                    when(message.optString("type")){
                        "registered"->{connected=true;statusMessage=getString(R.string.status_connected);DiagnosticLog.record("认证","成功，等待网页命令")}
                        "authFailed"->{connected=false;statusMessage=getString(R.string.status_auth_failed);DiagnosticLog.record("认证失败","请核对账号状态、设备 ID 和访问密钥");webSocket.close(4003,"auth failed")}
                        else->if(connected)handle(message)
                    }
                }.onFailure{DiagnosticLog.record("命令异常","解析或执行失败：${it.javaClass.simpleName}");send(JSONObject().put("type","commandResult").put("success",false).put("detail","手机执行命令异常，请查看 App 诊断日志"))}
            }}
            override fun onClosing(webSocket:WebSocket,code:Int,reason:String){
                webSocket.close(code,null)
                main.post{if(!destroyed&&attempt==connectionAttempt){DiagnosticLog.record("连接关闭","服务端关闭连接，代码 $code");scheduleReconnect(code==4003)}}
            }
            override fun onClosed(webSocket:WebSocket,code:Int,reason:String){main.post{
                if(!destroyed&&attempt==connectionAttempt){DiagnosticLog.record("连接关闭","关闭完成，代码 $code");scheduleReconnect(code==4003)}
            }}
            override fun onFailure(webSocket:WebSocket,t:Throwable,response:Response?){main.post{
                if(!destroyed&&attempt==connectionAttempt){DiagnosticLog.record("连接失败","${t.javaClass.simpleName}；HTTP ${response?.code?:0}");scheduleReconnect()}
            }}
        })
    }
    private fun scheduleReconnect(authFailed:Boolean=false){
        if(destroyed||reconnectPending)return
        reconnectPending=true;connected=false;stopStreaming()
        val delay=if(authFailed)30_000L else reconnectDelay
        statusMessage=if(authFailed)getString(R.string.status_auth_failed) else getString(R.string.status_retrying,(delay/1000).coerceAtLeast(1))
        DiagnosticLog.record("重连","${delay/1000} 秒后重试")
        main.postDelayed(reconnectTask,delay);reconnectDelay=(reconnectDelay*2).coerceAtMost(30_000)
    }
    private fun send(json:JSONObject){
        val active=socket?:return
        if(!connected)return
        if(json.optString("type")=="screenFrame"){
            val queued=active.queueSize()
            if(queued>QUEUE_LIMIT_BYTES){
                DiagnosticLog.record("发送积压","屏幕帧丢弃；队列 $queued 字节",10_000)
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
        if(!active.send(json.toString())){DiagnosticLog.record("发送失败","WebSocket 拒绝发送，准备重连");scheduleReconnect()}
        else if(json.optString("type")=="screenFrame"){
            framesSent++;DiagnosticLog.record("画面发送","已加入发送队列；本轮累计 $framesSent 帧；队列 ${active.queueSize()} 字节",10_000)
        }
    }
    private fun sendCaptureError(code:Int,reason:String){
        val explanation=when(code){1->"系统内部错误";2->"无截图权限，请重启无障碍服务";3->"请求过于频繁";4->"显示屏不可用";5->"窗口不可用";6->"安全页面禁止截图";-1->"截图回调超过 5 秒未返回";-2->"无法读取截图缓冲区";-3->"图像处理失败";else->"截图调用异常"}
        DiagnosticLog.record("截图失败","代码 $code：$explanation；阶段 $reason；亮屏=${getSystemService(PowerManager::class.java).isInteractive}",2_000)
        send(JSONObject().put("type","captureError").put("code",code).put("reason",reason))}
    private fun stopStreaming(){if(streaming)DiagnosticLog.record("屏幕流","停止截图");streaming=false;captureGeneration++;captureInFlight=false;captureStartedAt=0;captureRetryAfter=0;congestedSince=0;main.removeCallbacks(screenshotLoop)}
    private fun restartStreaming(){stopStreaming();framesSent=0;streaming=true;DiagnosticLog.record("屏幕流","启动截图循环");main.post(screenshotLoop)}

    private fun commandResult(command:String,success:Boolean,detail:String){
        DiagnosticLog.record("命令结果","$command：$detail")
        send(JSONObject().put("type","commandResult").put("command",command).put("success",success).put("detail",detail))
    }
    private fun globalAction(command:String,action:Int){val accepted=performGlobalAction(action);commandResult(command,accepted,if(accepted)"手机已接受 $command 操作" else "系统拒绝 $command 操作，请检查无障碍权限")}
    private fun handle(message:JSONObject){
        val type=message.optString("type")
        val known=type in setOf("getDeviceInfo","startStream","restartStream","stopStream","launchApp","back","home","recents","wakeScreen","gesture","rotate")
        DiagnosticLog.record("收到命令",if(known)type else "未知命令",if(type=="getDeviceInfo"||type=="startStream")2_000 else 0)
        when(type){
        "getDeviceInfo"->sendDeviceInfo()
        "startStream"->{if(!streaming)restartStreaming()}
        "restartStream"->{restartStreaming();commandResult("restartStream",true,"手机已收到重试命令，正在截图；若仍无画面，请复制 App 诊断日志")}
        "stopStream"->stopStreaming()
        "launchApp"->launchApp(message.optString("packageName"))
        "back"->globalAction("back",GLOBAL_ACTION_BACK)
        "home"->globalAction("home",GLOBAL_ACTION_HOME)
        "recents"->globalAction("recents",GLOBAL_ACTION_RECENTS)
        "wakeScreen"->wakeScreen()
        "gesture"->performGesture(message)
        else->commandResult("unsupported",false,"手机尚不支持此操作")
    }}
    /** 点亮息屏幕；不会绕过 PIN、图案或密码锁屏。 */
    private fun wakeScreen(){
        val powerManager=getSystemService(POWER_SERVICE) as PowerManager
        if(powerManager.isInteractive){commandResult("wakeScreen",true,"手机屏幕已经点亮");return}
        @Suppress("DEPRECATION")
        val wakeLock=powerManager.newWakeLock(
            PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP,
            "remotecontrol:screenWake"
        )
        wakeLock.acquire(1_500L)
        commandResult("wakeScreen",true,"已请求点亮屏幕，锁屏仍需在手机上解锁")
        main.postDelayed({runCatching{if(wakeLock.isHeld)wakeLock.release()}},1_600L)
    }
    private fun launchApp(packageName:String){
        val intent=packageManager.getLaunchIntentForPackage(packageName)
        if(intent==null){commandResult("launchApp",false,"找不到应用启动入口");return}
        startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));commandResult("launchApp",true,"已请求打开应用")
    }
    private fun performGesture(message:JSONObject){val metrics=resources.displayMetrics;val action=message.optString("action");val path=Path();val duration:Long
        if(action=="tap"){path.moveTo((message.optDouble("x")*metrics.widthPixels).toFloat(),(message.optDouble("y")*metrics.heightPixels).toFloat());duration=60}
        else{path.moveTo((message.optDouble("startX")*metrics.widthPixels).toFloat(),(message.optDouble("startY")*metrics.heightPixels).toFloat());path.lineTo((message.optDouble("endX")*metrics.widthPixels).toFloat(),(message.optDouble("endY")*metrics.heightPixels).toFloat());duration=350}
        val accepted=dispatchGesture(GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path,0,duration)).build(),object:GestureResultCallback(){
            override fun onCompleted(gestureDescription:GestureDescription?){DiagnosticLog.record("手势","系统报告执行完成")}
            override fun onCancelled(gestureDescription:GestureDescription?){commandResult("gesture",false,"手势被系统取消")}
        },main)
        DiagnosticLog.record("手势","系统是否接受：$accepted")
        if(!accepted)commandResult("gesture",false,"系统拒绝手势，请检查无障碍权限")
    }
    private fun sendDeviceInfo(){val launchIntent=Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);val apps=packageManager.queryIntentActivities(launchIntent,0).map{JSONObject().put("label",it.loadLabel(packageManager).toString()).put("packageName",it.activityInfo.packageName)}.distinctBy{it.getString("packageName")}.sortedBy{it.getString("label")}
        val battery=getSystemService(BatteryManager::class.java).getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);val data=JSONObject().put("name","我的 Android 手机").put("model",Build.MODEL).put("androidVersion",Build.VERSION.RELEASE).put("battery",battery).put("apps",JSONArray(apps));send(JSONObject().put("type","deviceInfo").put("data",data))
    }
    private fun captureFrame(){
        val generation=++captureGeneration
        captureInFlight=true;captureStartedAt=SystemClock.elapsedRealtime()
        DiagnosticLog.record("截图请求","调用系统截图；亮屏=${getSystemService(PowerManager::class.java).isInteractive}",10_000)
        main.postDelayed({
            if(!destroyed&&generation==captureGeneration&&captureInFlight){
                captureGeneration++;captureInFlight=false;captureStartedAt=0
                captureRetryAfter=SystemClock.elapsedRealtime()+CAPTURE_RETRY_DELAY_MS
                sendCaptureError(-1,"timeout")
            }
        },CAPTURE_TIMEOUT_MS)
        runCatching{
            takeScreenshot(Display.DEFAULT_DISPLAY,screenshotExecutor,object:TakeScreenshotCallback{
                override fun onSuccess(result:ScreenshotResult){
                    val buffer=result.hardwareBuffer
                    if(generation!=captureGeneration){buffer.close();return}
                    var hardware:Bitmap?=null;var source:Bitmap?=null;var scaled:Bitmap?=null
                    try{
                        hardware=Bitmap.wrapHardwareBuffer(buffer,result.colorSpace?:ColorSpace.get(ColorSpace.Named.SRGB)) ?: throw IllegalStateException("buffer")
                        source=hardware.copy(Bitmap.Config.ARGB_8888,false) ?: throw IllegalStateException("copy")
                        val scale=(720f/source.width).coerceAtMost(1f)
                        scaled=if(scale<1f)Bitmap.createScaledBitmap(source,(source.width*scale).toInt(),(source.height*scale).toInt(),true)else source
                        val out=ByteArrayOutputStream();check(scaled.compress(Bitmap.CompressFormat.JPEG,45,out))
                        val bytes=out.toByteArray();val encoded=Base64.encodeToString(bytes,Base64.NO_WRAP)
                        main.post{
                            if(destroyed||generation!=captureGeneration)return@post
                            captureInFlight=false;captureStartedAt=0;captureRetryAfter=0
                            DiagnosticLog.record("截图成功","JPEG ${bytes.size} 字节；连接=$connected；推流=$streaming",10_000)
                            // Local self-tests report success without uploading or retaining the image.
                            if(streaming)send(JSONObject().put("type","screenFrame").put("data",encoded))
                        }
                    }catch(error:Exception){main.post{
                        if(destroyed||generation!=captureGeneration)return@post
                        captureInFlight=false;captureStartedAt=0;captureRetryAfter=SystemClock.elapsedRealtime()+CAPTURE_RETRY_DELAY_MS
                        sendCaptureError(-3,error.javaClass.simpleName)
                    }}finally{
                        if(scaled!==source)scaled?.recycle();source?.recycle();hardware?.recycle();buffer.close()
                    }
                }
                override fun onFailure(errorCode:Int){main.post{
                    if(destroyed||generation!=captureGeneration)return@post
                    captureInFlight=false;captureStartedAt=0;captureRetryAfter=SystemClock.elapsedRealtime()+CAPTURE_RETRY_DELAY_MS
                    sendCaptureError(errorCode,"system")
                }}
            })
        }.onFailure{
            if(generation==captureGeneration){
                captureInFlight=false;captureStartedAt=0;captureRetryAfter=SystemClock.elapsedRealtime()+CAPTURE_RETRY_DELAY_MS
                sendCaptureError(-4,it.javaClass.simpleName)
            }
        }
    }
}
