package io.teslasync.android.featureviews.snapshotinspector

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.telemetry.SignalSnapshotEntry
import io.teslasync.shared.core.presentation.telemetry.SignalSnapshotResponse
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.util.Locale

/**
 * Off-device verification of the SnapshotInspector pure projection — the native port of the web component's
 * data derivations (web/src/features/system/components/state-machine/SnapshotInspector.tsx): the `formatValue`
 * renderer, the sorted signal rows + the `changed`/`previous` diff derivation, the `getStateColor` state →
 * variant registry, the duration cell, the clipboard payload, the `formatRelative` last-seen age, and the
 * surface classification for every render branch. Because the composable is a thin render layer, each value
 * here is exactly what it draws, so these assertions double as the per-branch "snapshot". Runs in the
 * :android:testReleaseUnitTest gate.
 */
class SnapshotInspectorProjectionTest {
    private val locale = Locale.US

    private fun millis(iso: String): Long = Instant.parse(iso).toEpochMilli()

    private fun snapshot(
        at: String,
        signals: Map<String, SignalSnapshotEntry>,
    ): SignalSnapshotResponse = SignalSnapshotResponse(vehicleId = 7, at = at, count = signals.size.toLong(), signals = signals)

    // ── formatValue (web `formatValue`) ───────────────────────────────────────────────

    @Test
    fun formatValueRendersEachKindLikeTheWeb() {
        assertEquals(EM_DASH, SnapshotInspectorProjection.formatValue(null))
        assertEquals(EM_DASH, SnapshotInspectorProjection.formatValue(JsonNull))
        assertEquals("true", SnapshotInspectorProjection.formatValue(JsonPrimitive(true)))
        assertEquals("false", SnapshotInspectorProjection.formatValue(JsonPrimitive(false)))
        assertEquals("82", SnapshotInspectorProjection.formatValue(JsonPrimitive(82)))
        assertEquals("82.5", SnapshotInspectorProjection.formatValue(JsonPrimitive(82.5)))
        assertEquals("Charging", SnapshotInspectorProjection.formatValue(JsonPrimitive("Charging")))
    }

    @Test
    fun formatValueSerializesObjectsAndArraysCompactly() {
        val obj = buildJsonObject { put("gear", "P") }
        val arr =
            buildJsonArray {
                add(1)
                add(2)
            }
        assertEquals("""{"gear":"P"}""", SnapshotInspectorProjection.formatValue(obj))
        assertEquals("[1,2]", SnapshotInspectorProjection.formatValue(arr))
    }

    // ── variantFor (web `getStateColor`) ──────────────────────────────────────────────

    @Test
    fun variantForResolvesVehicleStates() {
        assertEquals(FsmBadgeVariant.Success, SnapshotInspectorProjection.variantFor("vehicle", "driving"))
        assertEquals(FsmBadgeVariant.Warning, SnapshotInspectorProjection.variantFor("vehicle", "charging"))
        assertEquals(FsmBadgeVariant.Info, SnapshotInspectorProjection.variantFor("vehicle", "parked"))
        assertEquals(FsmBadgeVariant.Neutral, SnapshotInspectorProjection.variantFor("vehicle", "asleep"))
        assertEquals(FsmBadgeVariant.Danger, SnapshotInspectorProjection.variantFor("vehicle", "offline"))
    }

    @Test
    fun variantForIsCaseInsensitiveAndCoversOtherFsms() {
        assertEquals(FsmBadgeVariant.Success, SnapshotInspectorProjection.variantFor("vehicle", "DRIVING"))
        assertEquals(FsmBadgeVariant.Success, SnapshotInspectorProjection.variantFor("telemetry_connection", "streaming"))
        assertEquals(FsmBadgeVariant.Danger, SnapshotInspectorProjection.variantFor("telemetry_connection", "disconnected"))
        assertEquals(FsmBadgeVariant.Danger, SnapshotInspectorProjection.variantFor("command", "gave_up"))
        assertEquals(FsmBadgeVariant.Success, SnapshotInspectorProjection.variantFor("charge_session", "active"))
    }

    @Test
    fun variantForFallsBackToVehicleFsmAndNeutralForUnknowns() {
        // Unknown fsmType → vehicle FSM (web `FSM_REGISTRY[fsmType] ?? FSM_REGISTRY.vehicle`).
        assertEquals(FsmBadgeVariant.Success, SnapshotInspectorProjection.variantFor("mystery", "driving"))
        // Unknown state → DEFAULT_STATE (neutral).
        assertEquals(FsmBadgeVariant.Neutral, SnapshotInspectorProjection.variantFor("vehicle", "teleporting"))
    }

    // ── rows + diff (web `rows` memo) ──────────────────────────────────────────────────

    @Test
    fun rowsAreSortedByNameAndFlagChangesAgainstThePreviousSnapshot() {
        val current =
            snapshot(
                at = "2026-03-14T11:45:00Z",
                signals =
                    mapOf(
                        "shift_state" to SignalSnapshotEntry(value = JsonPrimitive("P"), source = "log"),
                        "battery_level" to SignalSnapshotEntry(value = JsonPrimitive(82), source = "l1", ageMs = 1_200),
                        "charging_state" to SignalSnapshotEntry(value = JsonPrimitive("Charging"), source = "l2"),
                    ),
            )
        val previous =
            snapshot(
                at = "2026-03-14T11:44:50Z",
                signals =
                    mapOf(
                        "battery_level" to SignalSnapshotEntry(value = JsonPrimitive(80)),
                        "charging_state" to SignalSnapshotEntry(value = JsonPrimitive("Charging")),
                        "shift_state" to SignalSnapshotEntry(value = JsonPrimitive("D")),
                    ),
            )

        val rows = SnapshotInspectorProjection.rows(current, previous)

        assertEquals(listOf("battery_level", "charging_state", "shift_state"), rows.map { it.name })
        val battery = rows.first { it.name == "battery_level" }
        assertTrue(battery.changed)
        assertEquals("82", battery.value)
        assertEquals("80", battery.previous)
        assertEquals("l1", battery.source)
        assertEquals(1_200L, battery.ageMs)
        assertFalse(rows.first { it.name == "charging_state" }.changed)
        assertTrue(rows.first { it.name == "shift_state" }.changed)
    }

    @Test
    fun rowsHaveNoDiffWhenNoPreviousSnapshotIsSupplied() {
        val current =
            snapshot(
                at = "2026-03-14T11:45:00Z",
                signals = mapOf("battery_level" to SignalSnapshotEntry(value = JsonPrimitive(82))),
            )
        val rows = SnapshotInspectorProjection.rows(current, previousSnapshot = null)
        assertEquals(1, rows.size)
        assertFalse(rows.first().changed)
        assertNull(rows.first().previous)
    }

    @Test
    fun rowsAreEmptyForANullSnapshot() {
        assertTrue(SnapshotInspectorProjection.rows(snapshot = null, previousSnapshot = null).isEmpty())
    }

    // ── copyPayload (web `copyPayload` memo) ───────────────────────────────────────────

    @Test
    fun copyPayloadIsEmptyUnlessBothTransitionAndSnapshotArePresent() {
        val tr = SnapshotTransition(fromState = "driving", toState = "parked")
        val snap = snapshot("2026-03-14T11:45:00Z", mapOf("battery_level" to SignalSnapshotEntry(value = JsonPrimitive(82))))
        assertEquals("", SnapshotInspectorProjection.copyPayload(transition = null, snapshot = snap))
        assertEquals("", SnapshotInspectorProjection.copyPayload(transition = tr, snapshot = null))
        val payload = SnapshotInspectorProjection.copyPayload(tr, snap)
        assertTrue(payload.contains("driving"))
        assertTrue(payload.contains("parked"))
        assertTrue(payload.contains("battery_level"))
    }

    // ── duration cell (web `duration_in_state_ms`) ─────────────────────────────────────

    @Test
    fun durationLabelGroupsTheNumberOrShowsTheEmDash() {
        val withDuration =
            SnapshotTransition(details = buildJsonObject { put(DURATION_KEY, 1_834_567) })
        assertEquals(1_834_567.0, SnapshotInspectorProjection.durationInStateMs(withDuration))
        assertEquals("1,834,567$MS_SUFFIX", SnapshotInspectorProjection.durationLabel(withDuration, locale))

        val noDuration = SnapshotTransition()
        assertNull(SnapshotInspectorProjection.durationInStateMs(noDuration))
        assertEquals("$EM_DASH$MS_SUFFIX", SnapshotInspectorProjection.durationLabel(noDuration, locale))

        // A string-typed duration is not a number (web `typeof === 'number'`), so it reads as the em dash.
        val stringDuration = SnapshotTransition(details = buildJsonObject { put(DURATION_KEY, "soon") })
        assertNull(SnapshotInspectorProjection.durationInStateMs(stringDuration))
    }

    @Test
    fun transitionViewAppliesTheTriggerFallbackAndStateVariants() {
        val tr = SnapshotTransition(fromState = "driving", toState = "offline", trigger = "")
        val view = SnapshotInspectorProjection.transitionView(tr, "vehicle", locale)
        assertEquals(FsmBadgeVariant.Success, view.fromVariant)
        assertEquals(FsmBadgeVariant.Danger, view.toVariant)
        assertEquals(EM_DASH, view.trigger)
    }

    // ── relativeAge (web `formatRelative`) ─────────────────────────────────────────────

    @Test
    fun relativeAgeBucketsMatchFormatRelative() {
        val now = millis("2026-03-14T12:00:00Z")
        assertEquals(SnapshotRelativeAge.Unknown, SnapshotInspectorProjection.relativeAge("", now))
        assertEquals(SnapshotRelativeAge.JustNow, SnapshotInspectorProjection.relativeAge("2026-03-14T11:59:30Z", now))
        assertEquals(SnapshotRelativeAge.Minutes(5), SnapshotInspectorProjection.relativeAge("2026-03-14T11:55:00Z", now))
        assertEquals(SnapshotRelativeAge.Hours(2), SnapshotInspectorProjection.relativeAge("2026-03-14T10:00:00Z", now))
        assertEquals(SnapshotRelativeAge.Days(3), SnapshotInspectorProjection.relativeAge("2026-03-11T12:00:00Z", now))
        assertTrue(SnapshotInspectorProjection.relativeAge("2026-03-01T12:00:00Z", now) is SnapshotRelativeAge.Absolute)
    }

    // ── surfaceFor (web render branches + lifecycle chrome) ─────────────────────────────

    @Test
    fun surfaceForClassifiesEveryBranch() {
        fun surface(
            hasTransition: Boolean = false,
            noSelectionLoading: Boolean = false,
            inWindowCount: Int = 0,
            canJumpToLast: Boolean = false,
            snapshotLoading: Boolean = false,
            snapshotError: Boolean = false,
        ) = SnapshotInspectorProjection.surfaceFor(
            hasTransition,
            noSelectionLoading,
            inWindowCount,
            canJumpToLast,
            snapshotLoading,
            snapshotError,
        )

        assertEquals(SnapshotSurface.NoSelectionLoading, surface(noSelectionLoading = true))
        assertEquals(SnapshotSurface.NoSelectionOutsideWindow, surface(inWindowCount = 0, canJumpToLast = true))
        assertEquals(SnapshotSurface.NoSelectionPrompt, surface(inWindowCount = 4))
        assertEquals(SnapshotSurface.NoSelectionPrompt, surface(canJumpToLast = false))
        assertEquals(SnapshotSurface.SelectedLoading, surface(hasTransition = true, snapshotLoading = true))
        assertEquals(SnapshotSurface.SelectedError, surface(hasTransition = true, snapshotError = true))
        assertEquals(SnapshotSurface.SelectedReady, surface(hasTransition = true))
        // Loading wins over error so a refresh never flashes the error surface.
        assertEquals(
            SnapshotSurface.SelectedLoading,
            surface(hasTransition = true, snapshotLoading = true, snapshotError = true),
        )
    }

    // ── diagnostics (P1/S11) ────────────────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsThePiiSafeSurfaceSlug() {
        val recorder = RecordingLogger()
        SnapshotInspectorDiagnostics.recordViewOpened(recorder)
        assertEquals(1, recorder.records.size)
        val record = recorder.records.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals("view.opened", record.event)
        assertEquals("SnapshotInspector", record.fields["surface"])
    }

    private class RecordingLogger : Logger {
        data class Record(
            val level: LogLevel,
            val event: String,
            val fields: Map<String, String>,
        )

        val records = mutableListOf<Record>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records.add(Record(level, event, fields))
        }
    }
}
