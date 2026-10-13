package com.remotecontrol.agent

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.AtomicFile
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

object DiagnosticLog {
    private val buffer = DiagnosticBuffer()
    private val writer = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private var file: AtomicFile? = null
    private var pending = false
    private val lastEvents = mutableMapOf<String, Long>()
    @Volatile var revision = 0L
        private set

    @Synchronized fun initialize(context: Context) {
        if (file != null) return
        val config = AgentConfig(context)
        buffer.protect(config.deviceId, config.accessKey, config.serverUrl)
        file = AtomicFile(File(context.filesDir, "diagnostic-log.txt"))
        runCatching { file!!.openRead().bufferedReader().use { reader ->
            reader.lineSequence().take(300).forEach(buffer::append)
        } }
        record("应用", "版本 ${BuildConfig.VERSION_NAME}；Android ${Build.VERSION.RELEASE} / API ${Build.VERSION.SDK_INT}；型号 ${Build.MODEL}")
    }

    @Synchronized fun record(event: String, detail: String, intervalMs: Long = 0) {
        val elapsed = android.os.SystemClock.elapsedRealtime()
        val previous = lastEvents[event]
        if (intervalMs > 0 && previous != null && elapsed - previous < intervalMs) return
        lastEvents[event] = elapsed
        val stamp = SimpleDateFormat("MM-dd HH:mm:ss.SSS", Locale.ROOT).format(Date())
        buffer.append("$stamp [$event] $detail")
        revision++
        if (!pending) {
            pending = true
            main.postDelayed({
                synchronized(this) { pending = false }
                writer.execute {
                    synchronized(this) {
                        val target = file ?: return@execute
                        var stream: java.io.FileOutputStream? = null
                        try {
                            stream = target.startWrite()
                            stream.write(buffer.snapshot().toByteArray(Charsets.UTF_8))
                            target.finishWrite(stream)
                        } catch (_: Exception) { if (stream != null) target.failWrite(stream) }
                    }
                }
            }, 500)
        }
    }
    @Synchronized fun clear() { buffer.clear(); lastEvents.clear(); record("日志", "日志已清空") }
    fun snapshot(): String = buffer.snapshot()
}
