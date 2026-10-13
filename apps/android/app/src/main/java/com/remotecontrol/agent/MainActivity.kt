package com.remotecontrol.agent

import android.content.ClipData
import android.content.ClipboardManager
import android.widget.Toast
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.appcompat.app.AppCompatActivity
import com.remotecontrol.agent.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding
    private var logRevision=-1L
    private val statusHandler=Handler(Looper.getMainLooper())
    private val statusRefresh=object:Runnable{override fun run(){RemoteAccessibilityService.statusMessage?.let{binding.status.text=it};binding.captureTest.isEnabled=RemoteAccessibilityService.serviceActive
        binding.logSyncStatus.text=DiagnosticLog.syncStatus
        if(logRevision!=DiagnosticLog.revision){logRevision=DiagnosticLog.revision;binding.diagnosticLogs.text=DiagnosticLog.snapshot().lineSequence().toList().takeLast(80).joinToString("\n")}
        statusHandler.postDelayed(this,500)}}
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState); binding=ActivityMainBinding.inflate(layoutInflater); setContentView(binding.root)
        DiagnosticLog.initialize(this)
        binding.diagnosticTitle.text="诊断日志 · v${BuildConfig.VERSION_NAME}"
        binding.copyLogs.setOnClickListener{
            val text="Agent v${BuildConfig.VERSION_NAME}\n"+DiagnosticLog.snapshot()
            getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("诊断日志",text))
            Toast.makeText(this,"日志已复制，请粘贴给协助排查的人",Toast.LENGTH_SHORT).show()
        }
        binding.clearLogs.setOnClickListener{DiagnosticLog.clear()}
        binding.captureTest.setOnClickListener{
            if(RemoteAccessibilityService.serviceActive){
                DiagnosticLog.record("截图自检","用户点击自检")
                sendBroadcast(Intent(RemoteAccessibilityService.ACTION_CAPTURE_TEST).setPackage(packageName))
            }else DiagnosticLog.record("截图自检","无障碍服务未启动，请先开启权限")
        }
        val config=AgentConfig(this); binding.serverUrl.setText(config.serverUrl); binding.deviceId.text=getString(R.string.device_id_value,config.deviceId); binding.accessKey.text=getString(R.string.access_key_value,config.accessKey)
        binding.save.setOnClickListener { val url=binding.serverUrl.text.toString().trim(); if(url.startsWith("ws://")||url.startsWith("wss://")){config.serverUrl=url;DiagnosticLog.record("配置","用户保存服务地址，准备重新连接");RemoteAccessibilityService.statusMessage=getString(R.string.status_reconnecting);sendBroadcast(Intent(RemoteAccessibilityService.ACTION_RECONNECT).setPackage(packageName));binding.status.setText(R.string.status_reconnecting)} else binding.serverUrl.error=getString(R.string.invalid_server_url) }
        binding.accessibility.setOnClickListener { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
    }
    override fun onResume() { super.onResume();if(RemoteAccessibilityService.statusMessage==null)binding.status.setText(if(RemoteAccessibilityService.connected) R.string.status_connected else R.string.status_permission);statusHandler.post(statusRefresh) }
    override fun onPause(){statusHandler.removeCallbacks(statusRefresh);super.onPause()}
}
