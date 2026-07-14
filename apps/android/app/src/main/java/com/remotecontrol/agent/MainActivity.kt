package com.remotecontrol.agent

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.appcompat.app.AppCompatActivity
import com.remotecontrol.agent.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding
    private val statusHandler=Handler(Looper.getMainLooper())
    private val statusRefresh=object:Runnable{override fun run(){RemoteAccessibilityService.statusMessage?.let{binding.status.text=it};statusHandler.postDelayed(this,500)}}
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState); binding=ActivityMainBinding.inflate(layoutInflater); setContentView(binding.root)
        val config=AgentConfig(this); binding.serverUrl.setText(config.serverUrl); binding.deviceId.text=getString(R.string.device_id_value,config.deviceId); binding.accessKey.text=getString(R.string.access_key_value,config.accessKey)
        binding.save.setOnClickListener { val url=binding.serverUrl.text.toString().trim(); if(url.startsWith("ws://")||url.startsWith("wss://")){config.serverUrl=url;RemoteAccessibilityService.statusMessage=getString(R.string.status_reconnecting);sendBroadcast(Intent(RemoteAccessibilityService.ACTION_RECONNECT).setPackage(packageName));binding.status.setText(R.string.status_reconnecting)} else binding.serverUrl.error=getString(R.string.invalid_server_url) }
        binding.accessibility.setOnClickListener { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
    }
    override fun onResume() { super.onResume();if(RemoteAccessibilityService.statusMessage==null)binding.status.setText(if(RemoteAccessibilityService.connected) R.string.status_connected else R.string.status_permission);statusHandler.post(statusRefresh) }
    override fun onPause(){statusHandler.removeCallbacks(statusRefresh);super.onPause()}
}
