// Off-device verification of the MaintenanceBanner pure adapter — the native mirror of every decision the web
// component makes before rendering (web/src/components/feedback/MaintenanceBanner.tsx): the visibility gate
// (`!data || mode === 'ok'` + the per-snapshot dismissal), the maintenance/degraded variant split, the
// message → per-mode default fallback, the `Date.parse` + countdown ternary, the dismissal fingerprint, and
// the freshness "Stale" disclosure. Because the composable is a thin render layer over
// [MaintenanceBannerProjection], the per-branch assertions here double as the surface's state "snapshot".
// Runs in the :android:testReleaseUnitTest gate.
package io.teslasync.android.sharedsurfaces.maintenancebanner

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class MaintenanceBannerProjectionTest {
    private val now = Instant.parse("2025-01-01T12:00:00Z").toEpochMilli()
    private val untilFuture = "2025-01-01T12:30:00Z"

    private fun snap(
        mode: String,
        message: String = "",
        until: String = "",
        updatedAt: String = "2025-01-01T11:00:00Z",
        present: Boolean = true,
    ): MaintenanceBannerSnapshot = MaintenanceBannerSnapshot(mode, message, until, updatedAt, present)

    private fun render(
        snapshot: MaintenanceBannerSnapshot,
        nowMs: Long = now,
        dismissedKey: String? = null,
        stale: Boolean = false,
    ): MaintenanceBannerRender = MaintenanceBannerProjection.render(snapshot, nowMs, dismissedKey, stale)

    // ── visibility + variant ─────────────────────────────────────────────────────────────────────────────

    @Test
    fun maintenanceModeIsVisibleAmberVariant() {
        val r = render(snap(ServiceMode.RAW_MAINTENANCE))
        assertTrue("maintenance is visible", r.visible)
        assertTrue("maintenance variant", r.maintenance)
        assertFalse("not the degraded variant", r.degraded)
    }

    @Test
    fun degradedModeIsVisibleSkyVariant() {
        val r = render(snap(ServiceMode.RAW_DEGRADED))
        assertTrue("degraded is visible", r.visible)
        assertFalse("not the maintenance variant", r.maintenance)
        assertTrue("degraded variant", r.degraded)
    }

    @Test
    fun okModeIsHidden() {
        assertFalse("mode ok hides the banner (web mode === 'ok')", render(snap(ServiceMode.RAW_OK)).visible)
    }

    @Test
    fun unknownModeCollapsesToHidden() {
        assertFalse("an unknown mode collapses to ok → hidden", render(snap("bogus")).visible)
    }

    @Test
    fun absentSnapshotIsHidden() {
        assertFalse("no resolved read hides the banner (web !data)", render(MaintenanceBannerSnapshot.ABSENT).visible)
    }

    // ── dismissal ────────────────────────────────────────────────────────────────────────────────────────

    @Test
    fun dismissingTheCurrentSnapshotHidesTheBanner() {
        val s = snap(ServiceMode.RAW_MAINTENANCE)
        val key = MaintenanceBannerProjection.fingerprint(s)
        assertFalse("a matching dismissal hides the banner", render(s, dismissedKey = key).visible)
    }

    @Test
    fun aDismissalForADifferentSnapshotStillShows() {
        val s = snap(ServiceMode.RAW_MAINTENANCE, updatedAt = "2025-01-01T13:00:00Z")
        assertTrue("a stale dismissal from another snapshot re-surfaces", render(s, dismissedKey = "u:old").visible)
    }

    // ── message fallback ─────────────────────────────────────────────────────────────────────────────────

    @Test
    fun blankMessageFallsBackToNull() {
        assertNull("a blank message defers to the per-mode default", render(snap(ServiceMode.RAW_MAINTENANCE, message = "   ")).message)
    }

    @Test
    fun nonBlankMessageIsTrimmedAndKept() {
        assertEquals("DB upgrade", render(snap(ServiceMode.RAW_DEGRADED, message = "  DB upgrade  ")).message)
    }

    // ── countdown ────────────────────────────────────────────────────────────────────────────────────────

    @Test
    fun futureEndIsEndsInWithShortDuration() {
        val r = render(snap(ServiceMode.RAW_MAINTENANCE, until = untilFuture))
        assertEquals(Countdown.EndsIn("30m 00s"), r.countdown)
    }

    @Test
    fun endInstantAtNowIsEndingNow() {
        val r = render(snap(ServiceMode.RAW_MAINTENANCE, until = "2025-01-01T12:00:00Z"))
        assertEquals(Countdown.EndingNow, r.countdown)
    }

    @Test
    fun endInstantWellPastIsEnded() {
        val r = render(snap(ServiceMode.RAW_MAINTENANCE, until = "2025-01-01T11:59:00Z"))
        assertEquals(Countdown.Ended, r.countdown)
    }

    @Test
    fun noUntilHasNoCountdown() {
        assertNull("no maintenance_until → no countdown", render(snap(ServiceMode.RAW_MAINTENANCE)).countdown)
    }

    // ── freshness chip ───────────────────────────────────────────────────────────────────────────────────

    @Test
    fun staleVisibleBannerShowsTheChip() {
        assertTrue(render(snap(ServiceMode.RAW_MAINTENANCE), stale = true).showStaleChip)
    }

    @Test
    fun staleHiddenBannerHasNoChip() {
        assertFalse("a hidden banner never shows the stale chip", render(snap(ServiceMode.RAW_OK), stale = true).showStaleChip)
    }

    // ── fingerprint (web parity) ─────────────────────────────────────────────────────────────────────────

    @Test
    fun fingerprintPrefersUpdatedAt() {
        val key = MaintenanceBannerProjection.fingerprint(snap(ServiceMode.RAW_MAINTENANCE, updatedAt = "2025-01-01T11:00:00Z"))
        assertEquals("u:2025-01-01T11:00:00Z", key)
    }

    @Test
    fun fingerprintFallsBackToContentWhenUpdatedAtAbsent() {
        val key =
            MaintenanceBannerProjection.fingerprint(
                snap(ServiceMode.RAW_DEGRADED, message = "slow", until = untilFuture, updatedAt = ""),
            )
        assertEquals("s:degraded|slow|$untilFuture", key)
    }

    // ── formatRemaining (web short form) ─────────────────────────────────────────────────────────────────

    @Test
    fun formatRemainingRendersHoursMinutesSecondsAndFloor() {
        assertEquals("1h 01m", MaintenanceBannerProjection.formatRemaining(3_661_000L))
        assertEquals("1m 30s", MaintenanceBannerProjection.formatRemaining(90_000L))
        assertEquals("45s", MaintenanceBannerProjection.formatRemaining(45_000L))
        assertEquals("0s", MaintenanceBannerProjection.formatRemaining(0L))
        assertEquals("a negative remainder floors at zero", "0s", MaintenanceBannerProjection.formatRemaining(-5_000L))
    }

    // ── parseUntil (web Date.parse + isFinite) ───────────────────────────────────────────────────────────

    @Test
    fun parseUntilHandlesBlankInvalidAndValid() {
        assertNull(MaintenanceBannerProjection.parseUntil(""))
        assertNull(MaintenanceBannerProjection.parseUntil("not-a-date"))
        assertEquals(now, MaintenanceBannerProjection.parseUntil("2025-01-01T12:00:00Z"))
    }

    // ── fromJson data adapter ────────────────────────────────────────────────────────────────────────────

    @Test
    fun fromJsonParsesAllFieldsOfAnObject() {
        val json =
            buildJsonObject {
                put("mode", "maintenance")
                put("maintenance_message", "DB upgrade in progress")
                put("maintenance_until", untilFuture)
                put("maintenance_updated_at", "2025-01-01T11:00:00Z")
            }
        val parsed = MaintenanceBannerSnapshot.fromJson(json)
        assertEquals(ServiceMode.Maintenance, parsed?.mode)
        assertEquals("DB upgrade in progress", parsed?.message)
        assertEquals(untilFuture, parsed?.untilIso)
        assertEquals("2025-01-01T11:00:00Z", parsed?.updatedAtIso)
        assertTrue("a parsed object is present", parsed?.present == true)
    }

    @Test
    fun fromJsonMissingModeDefaultsToOkAndAbsentFieldsToBlank() {
        val parsed = MaintenanceBannerSnapshot.fromJson(buildJsonObject { put("maintenance_message", "x") })
        assertEquals(ServiceMode.Ok, parsed?.mode)
        assertEquals("", parsed?.untilIso)
        assertEquals("", parsed?.updatedAtIso)
    }

    @Test
    fun fromJsonNullForNonObjectPayloads() {
        assertNull("a primitive is not a snapshot", MaintenanceBannerSnapshot.fromJson(JsonPrimitive("oops")))
        assertNull("a JSON null is not a snapshot", MaintenanceBannerSnapshot.fromJson(JsonNull))
        assertNull("a Kotlin null is not a snapshot", MaintenanceBannerSnapshot.fromJson(null))
    }
}
