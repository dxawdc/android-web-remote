package com.remotecontrol.agent

import org.junit.Assert.*
import org.junit.Test

class DiagnosticBufferTest {
    @Test fun keepsOnlyRecentBoundedLines() {
        val log = DiagnosticBuffer(2)
        log.append("old"); log.append("second"); log.append("latest")
        assertEquals("second\nlatest", log.snapshot())
        log.clear(); assertEquals("", log.snapshot())
    }
    @Test fun masksIdentifiersAndCredentialsBeforeStorage() {
        val log = DiagnosticBuffer()
        log.protect("test-device-id", "test-access-key", "ws://test.invalid/?token=example")
        log.append("test-device-id test-access-key ws://test.invalid/?token=example")
        assertEquals("[已隐藏] [已隐藏] [已隐藏]", log.snapshot())
    }
    @Test fun preventsMultilineAndOversizedEntries() {
        val log = DiagnosticBuffer()
        log.append("a\nb\r" + "x".repeat(1000))
        assertFalse(log.snapshot().contains('\n'))
        assertEquals(600, log.snapshot().length)
    }
}
