// Off-device unit coverage for the pure [ShareDriveDialogProjection] + the [recordShareDriveDialogOpened] diagnostic —
// the derivations the web component performs before it returns JSX (web/src/features/driving/components/
// ShareDriveDialog.tsx). Covers the public-URL assembly (web `${origin}/s/${token}`, plus the blank-origin relative
// fallback + trailing-slash trim), the create-payload assembly (web object literal — blank title dropped + trimmed, the
// two include flags carried, the "Never" expiry → no `expires_in_days`), the expiry parse, and the is-expired guard
// (web `new Date(expires_at) < new Date()`, incl. the null + unparseable fall-throughs). No Compose / Android / HTTP —
// runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.sharedrivedialog

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ShareDriveDialogModelTest {
    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }

    // ── shareUrl ────────────────────────────────────────────────────────────────────────────────

    @Test
    fun shareUrl_joinsBaseAndTokenLikeWebOrigin() {
        assertEquals(
            "https://teslasync.example/s/abc123",
            ShareDriveDialogProjection.shareUrl("https://teslasync.example", "abc123"),
        )
    }

    @Test
    fun shareUrl_trimsTrailingSlashSoTheJoinNeverDoublesUp() {
        assertEquals(
            "https://teslasync.example/s/abc123",
            ShareDriveDialogProjection.shareUrl("https://teslasync.example/", "abc123"),
        )
    }

    @Test
    fun shareUrl_blankBaseYieldsSameOriginRelativePath() {
        assertEquals("/s/abc123", ShareDriveDialogProjection.shareUrl("", "abc123"))
        assertEquals("/s/abc123", ShareDriveDialogProjection.shareUrl("   ", "abc123"))
    }

    // ── buildCreateRequest ──────────────────────────────────────────────────────────────────────

    @Test
    fun buildCreateRequest_defaultDraftCarriesFlagsAndThirtyDayExpiryWithNoTitle() {
        val request = ShareDriveDialogProjection.buildCreateRequest(ShareDraft())

        assertNull(request.title)
        assertEquals(true, request.includeSpeed)
        assertEquals(false, request.includeTelemetry)
        assertEquals(30, request.expiresInDays)
        assertNull(request.description)
    }

    @Test
    fun buildCreateRequest_trimsTitleAndDropsItWhenBlank() {
        assertEquals(
            "SF to LA",
            ShareDriveDialogProjection.buildCreateRequest(ShareDraft(title = "  SF to LA  ")).title,
        )
        assertNull(ShareDriveDialogProjection.buildCreateRequest(ShareDraft(title = "   ")).title)
    }

    @Test
    fun buildCreateRequest_neverExpiryMapsToNoExpiresInDays() {
        assertNull(ShareDriveDialogProjection.buildCreateRequest(ShareDraft(expiry = ExpiryOption.Never)).expiresInDays)
        assertEquals(
            7,
            ShareDriveDialogProjection.buildCreateRequest(ShareDraft(expiry = ExpiryOption.Days7)).expiresInDays,
        )
        assertEquals(
            90,
            ShareDriveDialogProjection.buildCreateRequest(ShareDraft(expiry = ExpiryOption.Days90)).expiresInDays,
        )
    }

    @Test
    fun buildCreateRequest_carriesEachIncludeFlagThrough() {
        val request =
            ShareDriveDialogProjection.buildCreateRequest(
                ShareDraft(includeSpeed = false, includeTelemetry = true),
            )
        assertEquals(false, request.includeSpeed)
        assertEquals(true, request.includeTelemetry)
    }

    // ── ExpiryOption ────────────────────────────────────────────────────────────────────────────

    @Test
    fun expiryOption_defaultIsThirtyDays() {
        assertEquals(ExpiryOption.Days30, ExpiryOption.Default)
        assertEquals("30", ExpiryOption.Default.wire)
    }

    @Test
    fun expiryOption_fromWireResolvesEachOptionAndFallsBackToDefault() {
        assertEquals(ExpiryOption.Days7, ExpiryOption.fromWire("7"))
        assertEquals(ExpiryOption.Never, ExpiryOption.fromWire("0"))
        assertEquals(ExpiryOption.Default, ExpiryOption.fromWire("nonsense"))
    }

    // ── parseInstantMillis / isExpired ──────────────────────────────────────────────────────────

    @Test
    fun parseInstantMillis_parsesIsoAndReturnsNullForGarbage() {
        assertEquals(0L, ShareDriveDialogProjection.parseInstantMillis("1970-01-01T00:00:00Z"))
        assertNull(ShareDriveDialogProjection.parseInstantMillis(null))
        assertNull(ShareDriveDialogProjection.parseInstantMillis(""))
        assertNull(ShareDriveDialogProjection.parseInstantMillis("not-a-date"))
    }

    @Test
    fun isExpired_nullExpiryIsNeverExpired() {
        assertFalse(ShareDriveDialogProjection.isExpired(null, nowMillis = 1_000L))
    }

    @Test
    fun isExpired_pastExpiryIsExpiredAndFutureIsNot() {
        val now = 1_700_000_000_000L
        assertTrue(ShareDriveDialogProjection.isExpired("2000-01-01T00:00:00Z", now))
        assertFalse(ShareDriveDialogProjection.isExpired("2999-01-01T00:00:00Z", now))
    }

    @Test
    fun isExpired_unparseableExpiryIsTreatedAsNotExpired() {
        assertFalse(ShareDriveDialogProjection.isExpired("garbage", nowMillis = 1_700_000_000_000L))
    }

    // ── diagnostics ─────────────────────────────────────────────────────────────────────────────

    @Test
    fun recordShareDriveDialogOpened_emitsPiiSafeSlugOnly() {
        val logger = RecordingLogger()

        recordShareDriveDialogOpened(logger)

        val opened = logger.events.single { it.first == "view.opened" }
        assertEquals(mapOf("surface" to "ShareDriveDialog"), opened.second)
    }
}
