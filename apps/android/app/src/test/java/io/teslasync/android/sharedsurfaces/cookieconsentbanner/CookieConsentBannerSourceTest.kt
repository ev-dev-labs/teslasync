// Off-device verification of the CookieConsentBanner data adapter — the consent persistence store (the web
// localStorage layer in web/src/lib/cookieConsent.ts) and the requirement mapping (web `useVersionInfo`'s
// `require_cookie_consent`). The store's read/decode/write logic is exercised against an in-memory
// [ConsentPersistence] fake (the JVM gate cannot drive real SharedPreferences), and the `VersionInfo → Boolean`
// adapter is checked to preserve every cache-then-network freshness flag (ADR-013). Runs in the
// :app:testReleaseUnitTest gate.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.cookieconsentbanner

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.settings.VersionInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CookieConsentBannerSourceTest {
    /** In-memory [ConsentPersistence] standing in for SharedPreferences (the web localStorage analogue). */
    private class FakeConsentPersistence(
        initial: String? = null,
    ) : ConsentPersistence {
        var value: String? = initial

        override fun read(): String? = value

        override fun write(value: String?) {
            this.value = value
        }
    }

    private val stamp = 1_700_000_000_000L

    // ── consent store: read / decode (web getConsent) ───────────────────────────────────────────────────────

    @Test
    fun emptyStoreReadsAsUnknown() {
        val store = CookieConsentStore(FakeConsentPersistence(initial = null))
        assertEquals(ConsentDecision.Unknown, store.consent().value)
    }

    @Test
    fun storedAcceptedAndDeclinedDecodeToTheirDecisions() {
        assertEquals(
            ConsentDecision.Accepted,
            CookieConsentStore(FakeConsentPersistence(initial = "accepted")).consent().value,
        )
        assertEquals(
            ConsentDecision.Declined,
            CookieConsentStore(FakeConsentPersistence(initial = "declined")).consent().value,
        )
    }

    @Test
    fun anUnrecognisedStoredValueCollapsesToUnknown() {
        val store = CookieConsentStore(FakeConsentPersistence(initial = "garbage"))
        assertEquals(ConsentDecision.Unknown, store.consent().value)
    }

    // ── consent store: write (web setConsent / clearConsent) ────────────────────────────────────────────────

    @Test
    fun setConsentPersistsAndReEmits() {
        val persistence = FakeConsentPersistence()
        val store = CookieConsentStore(persistence)

        store.setConsent(ConsentDecision.Accepted)

        assertEquals("the decision is persisted in the web stored form", "accepted", persistence.value)
        assertEquals("the live flow re-emits the new decision", ConsentDecision.Accepted, store.consent().value)
    }

    @Test
    fun setConsentToUnknownRemovesTheEntry() {
        val persistence = FakeConsentPersistence(initial = "accepted")
        val store = CookieConsentStore(persistence)

        store.setConsent(ConsentDecision.Unknown)

        assertNull("the unknown state is the absence of the key, never a sentinel", persistence.value)
        assertEquals(ConsentDecision.Unknown, store.consent().value)
    }

    @Test
    fun refreshRereadsAnExternalWrite() {
        val persistence = FakeConsentPersistence(initial = null)
        val store = CookieConsentStore(persistence)
        assertEquals(ConsentDecision.Unknown, store.consent().value)

        // A decision written elsewhere (e.g. another surface / a privacy reset) before the surface re-opens.
        persistence.value = "declined"
        store.refresh()

        assertEquals(ConsentDecision.Declined, store.consent().value)
    }

    // ── ConsentDecision round-trip (web getConsent ↔ setConsent storage values) ─────────────────────────────

    @Test
    fun consentDecisionStoredFormRoundTrips() {
        assertEquals("accepted", ConsentDecision.Accepted.stored)
        assertEquals("declined", ConsentDecision.Declined.stored)
        assertNull(ConsentDecision.Unknown.stored)
        assertEquals(ConsentDecision.Accepted, ConsentDecision.fromStored("accepted"))
        assertEquals(ConsentDecision.Declined, ConsentDecision.fromStored("declined"))
        assertEquals(ConsentDecision.Unknown, ConsentDecision.fromStored(null))
    }

    // ── requirement adapter: VersionInfo → Boolean preserving freshness (web useVersionInfo) ────────────────

    @Test
    fun requireConsentFlagDefaultsToFalseWhenAbsent() {
        assertTrue(VersionInfo(requireCookieConsent = true).requireConsentFlag())
        assertFalse(VersionInfo(requireCookieConsent = false).requireConsentFlag())
        assertFalse("a missing flag is the self-hosted no-banner default", VersionInfo().requireConsentFlag())
    }

    @Test
    fun mapRequireConsentPreservesSuccessFreshness() {
        val mapped = Resource.Success(VersionInfo(requireCookieConsent = true), fetchedAt = stamp, stale = false).mapRequireConsent()
        assertTrue(mapped is Resource.Success)
        val success = mapped as Resource.Success
        assertTrue(success.data)
        assertEquals(stamp, success.fetchedAt)
        assertFalse(success.stale)
    }

    @Test
    fun mapRequireConsentPreservesCachedLoading() {
        val mapped =
            Resource.Loading(cached = VersionInfo(requireCookieConsent = true), fetchedAt = stamp, stale = true).mapRequireConsent()
        assertTrue(mapped is Resource.Loading)
        assertEquals(true, mapped.cached)
        assertTrue(mapped.stale)
    }

    @Test
    fun mapRequireConsentPreservesErrorAndCache() {
        val boom = RuntimeException("boom")
        val mapped =
            Resource
                .Error(cached = VersionInfo(requireCookieConsent = false), fetchedAt = stamp, stale = true, error = boom)
                .mapRequireConsent()
        assertTrue(mapped is Resource.Error)
        val error = mapped as Resource.Error
        assertEquals(false, error.cached)
        assertTrue(error.stale)
        assertEquals(boom, error.error)
    }

    @Test
    fun mapRequireConsentOnErrorWithNoCacheStaysNull() {
        val mapped =
            Resource.Error<VersionInfo>(cached = null, fetchedAt = null, stale = false, error = RuntimeException("x")).mapRequireConsent()
        assertTrue(mapped is Resource.Error)
        assertNull(mapped.cached)
    }
}
