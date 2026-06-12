package io.teslasync.android.featureviews.statetimeline

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneId
import java.util.Locale

/**
 * Off-device verification of the StateTimeline's pure logic — the native mirror of every derivation the web
 * component performs (web/src/features/system/components/state-machine/StateTimeline.tsx + `@/types/fsm`
 * `getStateColor`, `@/lib/dateFormat` `formatTime`/`formatRelative`, and the local `presetLabel`): the
 * `(fsmType, state)` → accent resolution with the vehicle-default + neutral-unknown fallbacks, the window
 * placement (`leftPct`), the ascending sort, the `presetLabel` minute/hour/day buckets, the `formatRelative`
 * relative-age buckets, and the tolerant ISO-8601 clock/date rendering. Because the surface is purely
 * presentational, each projected value is exactly what the thin composable renders, so these assertions double
 * as the per-branch "snapshot" of the data layer. Runs in the :android:testReleaseUnitTest gate.
 */
class StateTimelineProjectionTest {
    private val lenientJson = Json { ignoreUnknownKeys = true }

    private val utc = ZoneId.of("UTC")

    private fun isoAt(millis: Long): String = Instant.ofEpochMilli(millis).toString()

    // ── getStateColor parity: vehicle table, machine fallback, neutral-unknown, case-insensitivity ──

    @Test
    fun vehicleStatesResolveToTheWebDotAccents() {
        assertEquals(FsmAccent.Success, FsmStateAccents.accentFor("vehicle", "online"))
        assertEquals(FsmAccent.Success, FsmStateAccents.accentFor("vehicle", "driving"))
        assertEquals(FsmAccent.Cyan, FsmStateAccents.accentFor("vehicle", "charging"))
        assertEquals(FsmAccent.Purple, FsmStateAccents.accentFor("vehicle", "parked"))
        assertEquals(FsmAccent.Info, FsmStateAccents.accentFor("vehicle", "updating"))
        assertEquals(FsmAccent.Neutral, FsmStateAccents.accentFor("vehicle", "asleep"))
        // Web vehicle `offline` is a danger variant whose `dot` is overridden to a muted gray, not red.
        assertEquals(FsmAccent.Neutral, FsmStateAccents.accentFor("vehicle", "offline"))
    }

    @Test
    fun telemetryConnectionStatesResolveToTheirVariants() {
        assertEquals(FsmAccent.Neutral, FsmStateAccents.accentFor("telemetry_connection", "unknown"))
        assertEquals(FsmAccent.Warning, FsmStateAccents.accentFor("telemetry_connection", "connecting"))
        assertEquals(FsmAccent.Success, FsmStateAccents.accentFor("telemetry_connection", "streaming"))
        assertEquals(FsmAccent.Warning, FsmStateAccents.accentFor("telemetry_connection", "stale"))
        assertEquals(FsmAccent.Danger, FsmStateAccents.accentFor("telemetry_connection", "disconnected"))
        assertEquals(FsmAccent.Info, FsmStateAccents.accentFor("telemetry_connection", "polling_only"))
    }

    @Test
    fun overrideDotAccentsAcrossOtherMachinesMatchTheRegistry() {
        assertEquals(FsmAccent.Cyan, FsmStateAccents.accentFor("charge_session", "active"))
        assertEquals(FsmAccent.Purple, FsmStateAccents.accentFor("charge_session", "recovered"))
        assertEquals(FsmAccent.Cyan, FsmStateAccents.accentFor("automation", "evaluating"))
        assertEquals(FsmAccent.Neutral, FsmStateAccents.accentFor("automation", "skipped"))
        assertEquals(FsmAccent.Danger, FsmStateAccents.accentFor("command", "gave_up"))
        assertEquals(FsmAccent.Purple, FsmStateAccents.accentFor("notification", "retrying"))
    }

    @Test
    fun unknownMachineFallsBackToTheVehicleTable() {
        // Web `FSM_REGISTRY[fsmType] ?? FSM_REGISTRY.vehicle` — the debugger's "all" filter resolves here.
        assertEquals(FsmAccent.Success, FsmStateAccents.accentFor("all", "driving"))
        assertEquals(FsmAccent.Cyan, FsmStateAccents.accentFor("all", "charging"))
    }

    @Test
    fun unknownStateFallsBackToNeutral() {
        // Web `DEFAULT_STATE` (neutral) for a state absent from the machine's table.
        assertEquals(FsmAccent.Neutral, FsmStateAccents.accentFor("vehicle", "teleporting"))
        assertEquals(FsmAccent.Neutral, FsmStateAccents.accentFor("vehicle", ""))
    }

    @Test
    fun stateResolutionIsCaseAndWhitespaceInsensitive() {
        // Web lower-cases the state before lookup (`states[state.toLowerCase()]`).
        assertEquals(FsmAccent.Success, FsmStateAccents.accentFor("vehicle", "  DRIVING "))
        assertEquals(FsmAccent.Cyan, FsmStateAccents.accentFor("vehicle", "Charging"))
    }

    // ── Window projection: end = anchor, start = anchor - window, leftFraction = (ts - start) / span ──

    @Test
    fun projectAnchorsTheWindowAndPlacesTicksByTimeFraction() {
        val anchor = 1_000_000_000_000L
        val windowMinutes = 10
        val span = windowMinutes * 60_000L
        val start = anchor - span

        val transitions =
            listOf(
                tick(id = 1, ts = isoAt(anchor)),
                tick(id = 2, ts = isoAt(start)),
                tick(id = 3, ts = isoAt(start + span / 2)),
            )

        val window = StateTimelineProjection.project(transitions, anchor, windowMinutes)

        assertEquals(start, window.startMillis)
        assertEquals(anchor, window.endMillis)
        // Sorted ascending: start (0.0), midpoint (0.5), anchor (1.0).
        assertEquals(listOf(2L, 3L, 1L), window.ticks.map { it.transition.id })
        assertEquals(0.0f, window.ticks[0].leftFraction, FRACTION_DELTA)
        assertEquals(0.5f, window.ticks[1].leftFraction, FRACTION_DELTA)
        assertEquals(1.0f, window.ticks[2].leftFraction, FRACTION_DELTA)
    }

    @Test
    fun projectReturnsNoTicksForAnEmptyList() {
        val window = StateTimelineProjection.project(emptyList(), 1_000_000_000_000L, 10)
        assertTrue(window.ticks.isEmpty())
    }

    @Test
    fun projectPlacesAnUnparseableTimestampAtTheWindowStart() {
        val anchor = 1_000_000_000_000L
        val window = StateTimelineProjection.project(listOf(tick(id = 9, ts = "not-a-timestamp")), anchor, 10)
        assertEquals(1, window.ticks.size)
        assertEquals(0.0f, window.ticks.single().leftFraction, FRACTION_DELTA)
    }

    // ── presetLabel buckets: <60 minutes, <1440 hours (Math.round), else day ──

    @Test
    fun windowPresetBucketsLikePresetLabel() {
        assertEquals(StateTimelineWindowPreset.Minutes(10), stateTimelineWindowPreset(10))
        assertEquals(StateTimelineWindowPreset.Minutes(59), stateTimelineWindowPreset(59))
        assertEquals(StateTimelineWindowPreset.Hours(1), stateTimelineWindowPreset(60))
        // Web `Math.round(90 / 60)` = 2 (ties toward +∞).
        assertEquals(StateTimelineWindowPreset.Hours(2), stateTimelineWindowPreset(90))
        assertEquals(StateTimelineWindowPreset.Hours(1), stateTimelineWindowPreset(89))
        assertEquals(StateTimelineWindowPreset.Hours(10), stateTimelineWindowPreset(600))
        assertEquals(StateTimelineWindowPreset.Day, stateTimelineWindowPreset(1_440))
        assertEquals(StateTimelineWindowPreset.Day, stateTimelineWindowPreset(2_160))
    }

    // ── formatRelative buckets: just now / minutes / hours / days / absolute date ──

    @Test
    fun lastSeenBucketsLikeFormatRelative() {
        val now = 2_000_000_000_000L
        assertEquals(StateTimelineLastSeen.JustNow, stateTimelineLastSeen(now - 30_000L, now))
        assertEquals(StateTimelineLastSeen.JustNow, stateTimelineLastSeen(now - 59_000L, now))
        assertEquals(StateTimelineLastSeen.Minutes(1), stateTimelineLastSeen(now - 60_000L, now))
        assertEquals(StateTimelineLastSeen.Minutes(5), stateTimelineLastSeen(now - 5 * 60_000L, now))
        assertEquals(StateTimelineLastSeen.Hours(3), stateTimelineLastSeen(now - 3 * 3_600_000L, now))
        assertEquals(StateTimelineLastSeen.Days(2), stateTimelineLastSeen(now - 2 * 86_400_000L, now))
    }

    @Test
    fun lastSeenFallsBackToAnAbsoluteDateAtAWeekOrOlder() {
        val now = 2_000_000_000_000L
        val tenDaysAgo = now - 10 * 86_400_000L
        val result = stateTimelineLastSeen(tenDaysAgo, now)
        assertTrue(result is StateTimelineLastSeen.AbsoluteDate)
        assertEquals(tenDaysAgo, (result as StateTimelineLastSeen.AbsoluteDate).millis)
    }

    @Test
    fun lastSeenIsUnknownForNullAndTreatsFutureAsJustNow() {
        val now = 2_000_000_000_000L
        assertEquals(StateTimelineLastSeen.Unknown, stateTimelineLastSeen(null, now))
        assertEquals(StateTimelineLastSeen.JustNow, stateTimelineLastSeen(now + 5 * 60_000L, now))
    }

    // ── Clock/date formatting: tolerant parse, '—' on blank/unparseable ──

    @Test
    fun parseMillisAcceptsTolerantIsoFormsAndRejectsGarbage() {
        assertEquals(0L, StateTimelineTime.parseMillis("1970-01-01T00:00:00Z"))
        assertEquals(0L, StateTimelineTime.parseMillis("1970-01-01T00:00:00"))
        assertNull(StateTimelineTime.parseMillis(""))
        assertNull(StateTimelineTime.parseMillis("   "))
        assertNull(StateTimelineTime.parseMillis("not-a-timestamp"))
    }

    @Test
    fun formatClockRendersTheWallClockInTheGivenZone() {
        val rendered = StateTimelineTime.formatClock("2026-03-14T09:15:00Z", utc, Locale.US)
        assertTrue("expected 9:15 in '$rendered'", rendered.contains("9:15"))
    }

    @Test
    fun formatClockConvertsToTheRequestedZone() {
        val rendered = StateTimelineTime.formatClock("2026-03-14T09:15:00Z", ZoneId.of("+05:30"), Locale.US)
        assertTrue("expected 2:45 in '$rendered'", rendered.contains("2:45"))
    }

    @Test
    fun formatClockFallsBackToAnEmDashForBlankOrUnparseableInput() {
        assertEquals(STATE_TIMELINE_EM_DASH, StateTimelineTime.formatClock("", utc, Locale.US))
        assertEquals(STATE_TIMELINE_EM_DASH, StateTimelineTime.formatClock("nope", utc, Locale.US))
    }

    // ── Data adapter: decode the cached snake_case API row (extra columns ignored) and project ──

    @Test
    fun decodesTheWireRowAndProjectsStraightOffIt() {
        val json =
            """
            {
              "id": 42,
              "vehicle_id": 7,
              "ts": "2026-07-04T13:00:00Z",
              "fsm_name": "vehicle",
              "from_state": "parked",
              "to_state": "driving",
              "trigger": "shift_to_drive",
              "details": { "speed": 5 }
            }
            """.trimIndent()

        val decoded = lenientJson.decodeFromString<FsmTransition>(json)

        assertEquals(42L, decoded.id)
        assertEquals(7L, decoded.vehicleId)
        assertEquals("parked", decoded.fromState)
        assertEquals("driving", decoded.toState)
        assertEquals(FsmAccent.Success, FsmStateAccents.accentFor(decoded.fsmName, decoded.toState))

        val anchor = StateTimelineTime.parseMillis(decoded.ts)!! + 60_000L
        val window = StateTimelineProjection.project(listOf(decoded), anchor, 10)
        assertEquals(1, window.ticks.size)
        assertTrue(window.ticks.single().leftFraction in 0.0f..1.0f)
    }

    // ── Lifecycle classifier: loading precedence over error ──

    @Test
    fun surfaceClassifierMatchesTheLifecycleContract() {
        assertEquals(StateTimelineSurface.Loading, stateTimelineSurfaceFor(isLoading = true, isError = false))
        assertEquals(StateTimelineSurface.Loading, stateTimelineSurfaceFor(isLoading = true, isError = true))
        assertEquals(StateTimelineSurface.Error, stateTimelineSurfaceFor(isLoading = false, isError = true))
        assertEquals(StateTimelineSurface.Ready, stateTimelineSurfaceFor(isLoading = false, isError = false))
    }

    private fun tick(
        id: Long,
        ts: String,
        fromState: String = "parked",
        toState: String = "driving",
    ): FsmTransition =
        FsmTransition(
            id = id,
            vehicleId = 1,
            ts = ts,
            fsmName = "vehicle",
            fromState = fromState,
            toState = toState,
            trigger = "t",
        )

    private companion object {
        const val FRACTION_DELTA = 0.0001f
    }
}
