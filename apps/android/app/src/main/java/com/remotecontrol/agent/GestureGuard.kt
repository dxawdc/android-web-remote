package com.remotecontrol.agent

/** No queued input: an old tap must never execute after the screen has changed. */
class GestureGuard {
    private var sequence = 0L
    private var active: Long? = null
    private var deadline = 0L
    fun begin(now: Long): Long? {
        if (active != null && now < deadline) return null
        deadline = now + 2_000
        return (++sequence).also { active = it }
    }
    fun complete(ticket: Long) { if (active == ticket) active = null }
    fun reset() { active = null }
    companion object {
        fun pixel(value: Double, size: Int): Float {
            require(value.isFinite() && size > 0) { "Invalid coordinate" }
            return (value.coerceIn(0.0, 1.0) * (size - 1)).toFloat()
        }
    }
}
