package com.remotecontrol.agent

import android.content.Context
import java.security.SecureRandom

class AgentConfig(context: Context) {
    private val prefs = context.getSharedPreferences("agent", Context.MODE_PRIVATE)
    val deviceId: String get() = prefs.getString("device_id", null) ?: random(12).also { prefs.edit().putString("device_id", it).apply() }
    val accessKey: String get() = prefs.getString("access_key", null) ?: random(16).also { prefs.edit().putString("access_key", it).apply() }
    var serverUrl: String
        get() = prefs.getString("server_url", BuildConfig.DEFAULT_SERVER_URL)!!
        set(value) { prefs.edit().putString("server_url", value).apply() }
    private fun random(length: Int): String { val chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; val secure=SecureRandom(); return (1..length).map { chars[secure.nextInt(chars.length)] }.joinToString("") }
}
