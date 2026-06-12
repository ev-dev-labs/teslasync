package io.teslasync.android.featureviews.scheduledmaintenancecard

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/**
 * Off-device coverage of the [ScheduledMaintenanceCard] data adapter (the prompt's "adapter unit test: cached
 * → projection") — the pure derivations the composable renders: the `/admin/maintenance` JSON parse
 * ([MaintenanceSnapshot.fromJson]), the active / within-24h / ended / ending-now branches and the
 * minutes-remaining + until parse ([ScheduledMaintenanceView]), the shared `Resource → UiState` projection
 * ([toMaintenanceUiState]), and the toast mapping. Pinned to a fixed clock for determinism. Mirrors the web
 * component (web/src/features/system/components/status/ScheduledMaintenanceCard.tsx).
 */
class ScheduledMaintenanceCardModelTest {
    private val now: Long = Instant.parse("2026-06-01T00:00:00Z").toEpochMilli()

    private fun isoInMinutes(minutes: Long): String = Instant.ofEpochMilli(now + minutes * 60_000L).toString()

    private fun obj(vararg pairs: Pair<String, Any?>): JsonObject =
        JsonObject(
            pairs.associate { (key, value) ->
                key to
                    when (value) {
                        null -> JsonNull
                        is String -> JsonPrimitive(value)
                        else -> JsonPrimitive(value.toString())
                    }
            },
        )

    // ── MaintenanceSnapshot.fromJson — the cached payload → typed adapter ─────────────

    @Test
    fun fromJsonReadsSnakeCaseFields() {
        val snapshot =
            MaintenanceSnapshot.fromJson(
                obj(
                    "mode" to "maintenance",
                    "maintenance_message" to "DB upgrade",
                    "maintenance_until" to "2026-06-01T01:00:00Z",
                ),
            )
        assertEquals("maintenance", snapshot?.mode)
        assertEquals("DB upgrade", snapshot?.message)
        assertEquals("2026-06-01T01:00:00Z", snapshot?.untilIso)
        assertTrue(snapshot?.isActive == true)
    }

    @Test
    fun fromJsonDefaultsMissingModeToOkAndIsNotActive() {
        val snapshot = MaintenanceSnapshot.fromJson(obj("maintenance_message" to "x"))
        assertEquals(OK_MODE, snapshot?.mode)
        assertFalse(snapshot?.isActive == true)
    }

    @Test
    fun fromJsonTreatsExplicitNullUntilAndMessageAsNull() {
        val snapshot = MaintenanceSnapshot.fromJson(obj("mode" to "ok", "maintenance_until" to null, "maintenance_message" to null))
        assertNull(snapshot?.untilIso)
        assertNull(snapshot?.message)
    }

    @Test
    fun fromJsonReturnsNullForNonObjectPayload() {
        assertNull(MaintenanceSnapshot.fromJson(null))
        assertNull(MaintenanceSnapshot.fromJson(JsonPrimitive("nope")))
    }

    @Test
    fun degradedModeIsNotActive() {
        assertFalse(MaintenanceSnapshot(mode = "degraded", message = null, untilIso = null).isActive)
    }

    // ── ScheduledMaintenanceView.from — branch decisions ─────────────────────────────

    @Test
    fun notActiveSnapshotProjectsToInactiveViewWithNoCountdown() {
        val view = ScheduledMaintenanceView.from(MaintenanceSnapshot.DEFAULT, now)
        assertFalse(view.active)
        assertFalse(view.within24h)
        assertFalse(view.ended)
        assertFalse(view.endingNow)
        assertNull(view.minutesRemaining)
        assertNull(view.untilMillis)
    }

    @Test
    fun activeWindowWithin24hReportsWholeMinutesRemaining() {
        val view = ScheduledMaintenanceView.from(MaintenanceSnapshot(MAINTENANCE_MODE, "m", isoInMinutes(45)), now)
        assertTrue(view.active)
        assertTrue(view.within24h)
        assertFalse(view.ended)
        assertFalse(view.endingNow)
        assertEquals(45L, view.minutesRemaining)
    }

    @Test
    fun activeWindowBeyond24hIsNotWithin24h() {
        // 48h out → active, but outside the amber heads-up window (web `untilTs - now <= ONE_DAY_MS`).
        val view = ScheduledMaintenanceView.from(MaintenanceSnapshot(MAINTENANCE_MODE, null, isoInMinutes(48 * 60)), now)
        assertTrue(view.active)
        assertFalse(view.within24h)
        assertEquals(48L * 60L, view.minutesRemaining)
    }

    @Test
    fun within24hIncludesTheExact24hBoundaryButExcludesZero() {
        val boundary = ScheduledMaintenanceView.from(MaintenanceSnapshot(MAINTENANCE_MODE, null, isoInMinutes(24 * 60)), now)
        assertTrue(boundary.within24h)
        val atEnd = ScheduledMaintenanceView.from(MaintenanceSnapshot(MAINTENANCE_MODE, null, isoInMinutes(0)), now)
        assertFalse(atEnd.within24h)
    }

    @Test
    fun pastEndIsEndedNotWithin24h() {
        val view = ScheduledMaintenanceView.from(MaintenanceSnapshot(MAINTENANCE_MODE, null, isoInMinutes(-5)), now)
        assertTrue(view.ended)
        assertFalse(view.within24h)
        assertFalse(view.endingNow)
    }

    @Test
    fun subMinuteRemainderIsEndingNow() {
        // 30s remaining floors to 0 whole minutes → the imminent "Ending now" edge, not a counted duration.
        val until = Instant.ofEpochMilli(now + 30_000L).toString()
        val view = ScheduledMaintenanceView.from(MaintenanceSnapshot(MAINTENANCE_MODE, null, until), now)
        assertTrue(view.endingNow)
        assertFalse(view.ended)
        assertEquals(0L, view.minutesRemaining)
    }

    @Test
    fun unparseableUntilLeavesNoCountdown() {
        val view = ScheduledMaintenanceView.from(MaintenanceSnapshot(MAINTENANCE_MODE, "m", "not-a-date"), now)
        assertTrue(view.active)
        assertNull(view.untilMillis)
        assertNull(view.minutesRemaining)
        assertFalse(view.within24h)
        assertFalse(view.ended)
    }

    // ── minutesRemaining / parseUntil units ──────────────────────────────────────────

    @Test
    fun minutesRemainingFloorsTowardNegativeInfinity() {
        assertEquals(1L, ScheduledMaintenanceView.minutesRemaining(true, now + 90_000L, now))
        assertEquals(0L, ScheduledMaintenanceView.minutesRemaining(true, now + 59_000L, now))
        assertEquals(-2L, ScheduledMaintenanceView.minutesRemaining(true, now - 90_000L, now))
    }

    @Test
    fun minutesRemainingNullWhenInactiveOrNoEnd() {
        assertNull(ScheduledMaintenanceView.minutesRemaining(false, now + 60_000L, now))
        assertNull(ScheduledMaintenanceView.minutesRemaining(true, null, now))
    }

    @Test
    fun parseUntilReturnsMillisForValidIsoAndNullOtherwise() {
        assertEquals(Instant.parse("2027-01-01T00:00:00Z").toEpochMilli(), ScheduledMaintenanceView.parseUntil("2027-01-01T00:00:00Z"))
        assertNull(ScheduledMaintenanceView.parseUntil(null))
        assertNull(ScheduledMaintenanceView.parseUntil(""))
        assertNull(ScheduledMaintenanceView.parseUntil("   "))
        assertNull(ScheduledMaintenanceView.parseUntil("nope"))
    }

    // ── Resource → UiState projection ────────────────────────────────────────────────

    @Test
    fun loadingWithNoCacheIsLoadingPhase() {
        val state = (Resource.Loading<kotlinx.serialization.json.JsonElement>(null, null, false)).toMaintenanceUiState()
        assertEquals(UiPhase.Loading, state.phase)
        assertNull(state.data)
    }

    @Test
    fun successAlwaysResolvesToContentNeverEmpty() {
        val state = Resource.Success(obj("mode" to "ok"), 100L, false).toMaintenanceUiState()
        assertEquals(UiPhase.Content, state.phase)
        assertEquals(OK_MODE, state.data?.mode)
        assertEquals(100L, state.fetchedAt)
    }

    @Test
    fun unparseableSuccessFallsBackToFriendlyDefault() {
        val state = Resource.Success(JsonPrimitive("garbage"), 1L, false).toMaintenanceUiState()
        assertEquals(UiPhase.Content, state.phase)
        assertEquals(MaintenanceSnapshot.DEFAULT, state.data)
    }

    @Test
    fun hardErrorWithNoCacheIsErrorWithRetry() {
        val state = Resource.Error<kotlinx.serialization.json.JsonElement>(null, null, false, ApiError.Network()).toMaintenanceUiState()
        assertEquals(UiPhase.Error, state.phase)
        assertTrue(state.canRetry)
        assertFalse(state.hasData)
    }

    @Test
    fun errorWithCacheKeepsContentStaleAndOffline() {
        val state = Resource.Error(obj("mode" to "maintenance"), 100L, true, ApiError.Timeout()).toMaintenanceUiState()
        assertEquals(UiPhase.Content, state.phase)
        assertEquals(MAINTENANCE_MODE, state.data?.mode)
        assertTrue(state.stale)
        assertTrue(state.isOffline)
        assertTrue(state.canRetry)
    }

    // ── Toast mapping + diagnostics slug ─────────────────────────────────────────────

    @Test
    fun toastTypesAreDistinct() {
        assertNotEquals(MaintenanceToast.Saved, MaintenanceToast.Failed)
    }

    @Test
    fun diagnosticsSlugMatchesTheContract() {
        assertEquals("ScheduledMaintenanceCard", SCHEDULED_MAINTENANCE_SLUG)
        assertEquals("ScheduledMaintenanceCard", ScheduledMaintenanceCardDiagnostics.SLUG)
    }
}
