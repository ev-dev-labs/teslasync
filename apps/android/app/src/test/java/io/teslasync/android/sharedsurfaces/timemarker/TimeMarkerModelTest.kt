package io.teslasync.android.sharedsurfaces.timemarker

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.OffsetDateTime

/**
 * Off-device verification of the TimeMarker's pure logic — the native mirror of every decision the web
 * component makes (web/src/components/charts/TimeMarker.tsx) plus its consuming hook
 * (web/src/hooks/useAlertContext.ts): the `normalizeSeverity(severity ?? 'warn')` fold, the
 * `useAlertContext` param projection + ±30-min window, the `if (x == null || x === '') return null` empty
 * branch, the nearest-index placement with `ifOverflow` clamping, the consumer's signal→critical severity,
 * and the accessible-label fallback. Because the composable is a thin render layer over these reducers, the
 * per-branch assertions here double as the surface's per-state snapshot. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class TimeMarkerModelTest {
    // A fixed five-point ascending axis spaced 60s apart, plus the matching epoch base.
    private val base = OffsetDateTime.parse("2026-04-30T13:00:00Z").toInstant().toEpochMilli()
    private val axis = (0 until POINTS).map { base + it * STEP_MS }

    // ── normalizeSeverity fold (web/src/lib/tokens.ts normalizeSeverity) ─────────────────────────────

    @Test
    fun normalizeFoldsAliasesOntoTheCanonicalSet() {
        assertEquals(TimeMarkerSeverity.Info, normalizeTimeMarkerSeverity("info"))
        assertEquals(TimeMarkerSeverity.Warn, normalizeTimeMarkerSeverity("warn"))
        assertEquals(TimeMarkerSeverity.Warn, normalizeTimeMarkerSeverity("warning"))
        assertEquals(TimeMarkerSeverity.Critical, normalizeTimeMarkerSeverity("critical"))
        assertEquals(TimeMarkerSeverity.Critical, normalizeTimeMarkerSeverity("error"))
        assertEquals(TimeMarkerSeverity.Critical, normalizeTimeMarkerSeverity("fatal"))
        assertEquals(TimeMarkerSeverity.Success, normalizeTimeMarkerSeverity("success"))
        assertEquals(TimeMarkerSeverity.Success, normalizeTimeMarkerSeverity("ok"))
    }

    @Test
    fun normalizeIsCaseInsensitive() {
        assertEquals(TimeMarkerSeverity.Critical, normalizeTimeMarkerSeverity("ERROR"))
        assertEquals(TimeMarkerSeverity.Warn, normalizeTimeMarkerSeverity("Warning"))
    }

    @Test
    fun normalizeDefaultsUnknownNullAndEmptyToInfo() {
        // Web `if (!s) return 'info'` + the trailing `return 'info'` for an unrecognised value.
        assertEquals(TimeMarkerSeverity.Info, normalizeTimeMarkerSeverity(null))
        assertEquals(TimeMarkerSeverity.Info, normalizeTimeMarkerSeverity(""))
        assertEquals(TimeMarkerSeverity.Info, normalizeTimeMarkerSeverity("nonsense"))
    }

    @Test
    fun effectiveSeverityDefaultsToWarnWhenUnspecified() {
        // Web component: `normalizeSeverity(severity ?? 'warn')` — a null severity becomes warn, not info.
        assertEquals(TimeMarkerSeverity.Warn, timeMarkerSeverity(null))
        assertEquals(TimeMarkerSeverity.Critical, timeMarkerSeverity("critical"))
        // An explicit empty string is NOT nullish, so it passes through to normalize → info (web parity).
        assertEquals(TimeMarkerSeverity.Info, timeMarkerSeverity(""))
    }

    // ── useAlertContext projection (web/src/hooks/useAlertContext.ts) ────────────────────────────────

    @Test
    fun resolveParsesVehicleIdTimestampAndWindow() {
        val ctx = resolveAlertMarkerContext("12", "2026-04-30T13:00:00Z", "BatteryLevel")
        assertEquals(12L, ctx.vehicleId)
        assertEquals("BatteryLevel", ctx.signal)
        assertEquals(base, ctx.timestampMillis)
        assertEquals(AlertTimeWindow(base - ALERT_WINDOW_MS, base + ALERT_WINDOW_MS), ctx.timeWindow)
        assertTrue(ctx.hasContext)
    }

    @Test
    fun resolveTreatsBlankOrNonNumericVehicleIdAsAbsent() {
        assertNull(resolveAlertMarkerContext("", null, null).vehicleId)
        assertNull(resolveAlertMarkerContext("abc", null, null).vehicleId)
        // Web keeps a 0 vehicle id here (only the drill-through link treats 0 as none).
        assertEquals(0L, resolveAlertMarkerContext("0", null, null).vehicleId)
    }

    @Test
    fun resolveLeavesWindowNullForAnUnparseableOrAbsentTimestamp() {
        assertNull(resolveAlertMarkerContext(null, null, null).timeWindow)
        assertNull(resolveAlertMarkerContext(null, "not-a-date", null).timestampMillis)
        assertNull(resolveAlertMarkerContext(null, "not-a-date", null).timeWindow)
    }

    @Test
    fun resolveHasContextMirrorsWebTruthiness() {
        assertFalse(resolveAlertMarkerContext(null, null, null).hasContext)
        assertTrue(resolveAlertMarkerContext(null, null, "Gear").hasContext)
        assertTrue(resolveAlertMarkerContext("7", null, null).hasContext)
    }

    // ── severityForContext (web BatteryHealthPage `alertCtx.signal ? 'critical' : undefined`) ────────

    @Test
    fun severityForContextEscalatesToCriticalWhenSignalPresent() {
        assertEquals(TimeMarkerSeverity.Critical, severityForContext(contextAt(base, signal = "BatteryLevel")))
        assertEquals(TimeMarkerSeverity.Warn, severityForContext(contextAt(base, signal = null)))
    }

    // ── placement: empty branch (web `if (x == null || x === '') return null`) ───────────────────────

    @Test
    fun placementIsHiddenWithoutATimestamp() {
        val placement = timeMarkerPlacement(contextAt(timestampMillis = null), axis)
        assertFalse(placement.visible)
        assertNull(placement.index)
        assertEquals(POINTS, placement.pointCount)
    }

    @Test
    fun placementIsHiddenForAnEmptyAxis() {
        val placement = timeMarkerPlacement(contextAt(base), emptyList())
        assertFalse(placement.visible)
        assertNull(placement.index)
        assertEquals(0, placement.pointCount)
    }

    // ── placement: in-domain nearest index ───────────────────────────────────────────────────────────

    @Test
    fun placementPinsToTheNearestSampleIndex() {
        // base + 130s is closest to index 2 (base + 120s) of the 60s-spaced axis.
        val placement = timeMarkerPlacement(contextAt(base + 130 * SECOND_MS), axis)
        assertTrue(placement.visible)
        assertEquals(2, placement.index)
    }

    // ── placement: ifOverflow when the moment is outside the domain ──────────────────────────────────

    @Test
    fun placementClampsToTheNearestEdgeUnderExtendDomain() {
        val before = timeMarkerPlacement(contextAt(base - 10 * SECOND_MS), axis, overflow = TimeMarkerOverflow.ExtendDomain)
        assertTrue(before.visible)
        assertEquals(0, before.index)

        val after = timeMarkerPlacement(contextAt(base + 10_000 * SECOND_MS), axis, overflow = TimeMarkerOverflow.Visible)
        assertTrue(after.visible)
        assertEquals(POINTS - 1, after.index)
    }

    @Test
    fun placementHidesAnOutOfDomainMomentUnderDiscardOrHidden() {
        val discard = timeMarkerPlacement(contextAt(base - 10 * SECOND_MS), axis, overflow = TimeMarkerOverflow.Discard)
        assertFalse(discard.visible)
        assertNull(discard.index)

        val hidden = timeMarkerPlacement(contextAt(base - 10 * SECOND_MS), axis, overflow = TimeMarkerOverflow.Hidden)
        assertFalse(hidden.visible)
        assertNull(hidden.index)
    }

    @Test
    fun placementCarriesTheRequestedSeverity() {
        val placement = timeMarkerPlacement(contextAt(base), axis, severity = TimeMarkerSeverity.Info)
        assertEquals(TimeMarkerSeverity.Info, placement.severity)
    }

    // ── markerLabel a11y fallback (web default label `'Alert'`) ──────────────────────────────────────

    @Test
    fun markerLabelPrefersACustomLabelAndFallsBackToTheLocalizedDefault() {
        assertEquals("Charge fault", markerLabel("Charge fault", DEFAULT_LABEL))
        assertEquals("Trim", markerLabel("  Trim ", DEFAULT_LABEL))
        assertEquals(DEFAULT_LABEL, markerLabel(null, DEFAULT_LABEL))
        assertEquals(DEFAULT_LABEL, markerLabel("   ", DEFAULT_LABEL))
    }

    private fun contextAt(
        timestampMillis: Long?,
        signal: String? = null,
    ): AlertMarkerContext =
        AlertMarkerContext(
            vehicleId = null,
            timestamp = timestampMillis?.toString(),
            timestampMillis = timestampMillis,
            signal = signal,
            timeWindow = null,
            hasContext = true,
        )

    private companion object {
        const val POINTS = 5
        const val SECOND_MS = 1_000L
        const val STEP_MS = 60_000L
        const val DEFAULT_LABEL = "Alert"
    }
}
