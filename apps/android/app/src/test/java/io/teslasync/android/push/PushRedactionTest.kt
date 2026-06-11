package io.teslasync.android.push

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** JVM unit tests for [PushRedaction] — the non-reversible token fingerprint (P3/A6, ADR-016). */
class PushRedactionTest {
    @Test
    fun fingerprintIsStableForTheSameToken() {
        assertEquals(PushRedaction.fingerprint("token-a"), PushRedaction.fingerprint("token-a"))
    }

    @Test
    fun fingerprintDiffersForDifferentTokens() {
        assertNotEquals(PushRedaction.fingerprint("token-a"), PushRedaction.fingerprint("token-b"))
    }

    @Test
    fun fingerprintIsPrefixedAndNeverContainsTheToken() {
        val token = "a-very-secret-fcm-token-value"
        val fingerprint = PushRedaction.fingerprint(token)
        assertTrue(fingerprint.startsWith("fcm:"))
        assertTrue(token !in fingerprint)
    }

    @Test
    fun emptyOrNullTokenYieldsTheSentinel() {
        assertEquals("fcm:none", PushRedaction.fingerprint(null))
        assertEquals("fcm:none", PushRedaction.fingerprint(""))
    }
}
