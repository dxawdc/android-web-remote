package com.remotecontrol.agent

/** Bounded, redacted text only. Never pass screen data or raw protocol messages here. */
class DiagnosticBuffer(private val capacity: Int = 300) {
    private val lines = ArrayDeque<String>()
    private val secrets = mutableSetOf<String>()
    @Synchronized fun protect(vararg values: String) { secrets.addAll(values.filter { it.isNotEmpty() }) }
    @Synchronized fun append(line: String) {
        var safe = line.replace('\n', ' ').replace('\r', ' ')
        for (secret in secrets.sortedByDescending { it.length }) safe = safe.replace(secret, "[已隐藏]")
        lines.addLast(safe.take(600))
        while (lines.size > capacity) lines.removeFirst()
    }
    @Synchronized fun snapshot(): String = lines.joinToString("\n")
    @Synchronized fun clear() { lines.clear() }
}
