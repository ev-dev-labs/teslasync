package io.teslasync.android.featureviews.privacy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device unit tests for the pure Privacy model + projection (the `:android:testReleaseUnitTest`
 * gate's "adapter" coverage): the cookie-consent wire decoder (a port of the web `getConsent()`), the
 * recent-pages count decoder (a port of the web `load()` validation), and the four control enabled-state
 * predicates (the web `disabled={...}` expressions). No Android, no Compose, no coroutines.
 */
class PrivacyProjectionTest {
    @Test
    fun consentFromWireMapsExplicitDecisions() {
        assertEquals(ConsentState.Accepted, ConsentState.fromWire("accepted"))
        assertEquals(ConsentState.Declined, ConsentState.fromWire("declined"))
    }

    @Test
    fun consentFromWireCollapsesEverythingElseToUnknown() {
        // Null/blank/corrupt/unrecognized all collapse to Unknown — never throws (web getConsent()).
        assertEquals(ConsentState.Unknown, ConsentState.fromWire(null))
        assertEquals(ConsentState.Unknown, ConsentState.fromWire(""))
        assertEquals(ConsentState.Unknown, ConsentState.fromWire("ACCEPTED"))
        assertEquals(ConsentState.Unknown, ConsentState.fromWire("maybe"))
    }

    @Test
    fun recentCountIsZeroForMalformedOrEmptyInput() {
        assertEquals(0, RecentPagesCounter.count(null))
        assertEquals(0, RecentPagesCounter.count("   "))
        assertEquals(0, RecentPagesCounter.count("not json"))
        // A well-formed JSON object (not an array) is not a recent-pages list.
        assertEquals(0, RecentPagesCounter.count("{}"))
    }

    @Test
    fun recentCountCountsOnlyWellFormedEntries() {
        val mixed =
            """
            [
              {"path":"/a","title":"A","kind":"page","visited_at":1},
              {"title":"no path","kind":"page","visited_at":2},
              {"path":"/c","title":"C","kind":"page"},
              {"path":"/d","title":"D","kind":"drive","visited_at":4}
            ]
            """.trimIndent()
        // Two valid entries; the missing-path and missing-visited_at rows are skipped (web isValidEntry).
        assertEquals(2, RecentPagesCounter.count(mixed))
    }

    @Test
    fun recentCountCapsAtTheMaximum() {
        val entries =
            (1..(PrivacyRegistration.MAX_RECENT_ENTRIES + 5))
                .joinToString(prefix = "[", postfix = "]") { i ->
                    """{"path":"/p$i","title":"T$i","kind":"page","visited_at":$i}"""
                }
        assertEquals(PrivacyRegistration.MAX_RECENT_ENTRIES, RecentPagesCounter.count(entries))
    }

    @Test
    fun clearEnabledOnlyWhenThereAreEntries() {
        assertFalse(PrivacyProjection.clearEnabled(0))
        assertTrue(PrivacyProjection.clearEnabled(1))
        assertTrue(PrivacyProjection.clearEnabled(42))
    }

    @Test
    fun consentActionsDisableTheCurrentState() {
        // Accepted: accept disabled, decline + reset enabled (web disabled={consent === 'accepted'} etc.).
        assertFalse(PrivacyProjection.acceptEnabled(ConsentState.Accepted))
        assertTrue(PrivacyProjection.declineEnabled(ConsentState.Accepted))
        assertTrue(PrivacyProjection.resetEnabled(ConsentState.Accepted))

        // Declined: decline disabled, the rest enabled.
        assertTrue(PrivacyProjection.acceptEnabled(ConsentState.Declined))
        assertFalse(PrivacyProjection.declineEnabled(ConsentState.Declined))
        assertTrue(PrivacyProjection.resetEnabled(ConsentState.Declined))

        // Unknown: reset disabled, the rest enabled.
        assertTrue(PrivacyProjection.acceptEnabled(ConsentState.Unknown))
        assertTrue(PrivacyProjection.declineEnabled(ConsentState.Unknown))
        assertFalse(PrivacyProjection.resetEnabled(ConsentState.Unknown))
    }
}
