package com.remotecontrol.agent

import org.junit.Assert.*
import org.junit.Test

class GestureGuardTest {
    @Test fun clipsOutsideScreenWithoutGeneratingInvalidPath() {
        assertEquals(0f, GestureGuard.pixel(-0.2,1080),0f)
        assertEquals(1079f, GestureGuard.pixel(1.2,1080),0f)
        for(value in listOf(Double.NaN,Double.POSITIVE_INFINITY)) {
            try { GestureGuard.pixel(value,1080); fail("Invalid coordinate accepted") }
            catch(_:IllegalArgumentException) {}
        }
    }
    @Test fun overlappingGesturesCannotCancelEachOther() {
        val guard=GestureGuard();val first=guard.begin(100)!!
        assertNull(guard.begin(101))
        guard.complete(first)
        assertNotNull(guard.begin(500))
    }
    @Test fun missingOrStaleCallbacksCannotBlockNewInputForever() {
        val guard=GestureGuard();val first=guard.begin(0)!!
        val second=guard.begin(2001)!!
        guard.complete(first)
        assertNull(guard.begin(2002))
        guard.complete(second)
        assertNotNull(guard.begin(2003))
    }
}
