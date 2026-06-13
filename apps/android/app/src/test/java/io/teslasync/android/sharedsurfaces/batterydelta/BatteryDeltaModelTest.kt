package io.teslasync.android.sharedsurfaces.batterydelta

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the BatteryDelta's pure logic — the native mirror of every decision the web
 * component makes (web/src/components/data-display/BatteryDelta.tsx): the `hasData` guard, the signed delta,
 * the emerald / amber / muted tone ternary, the compact vs pair visible label, and the
 * `battery.delta.unknown` / `battery.delta.aria` accessible-label selection. Because the composable is a thin
 * render layer over [projectBatteryDelta], the per-branch assertions here double as the surface's per-state
 * snapshot. Runs in the :app:testReleaseUnitTest gate.
 */
class BatteryDeltaModelTest {
    // ── hasData guard (web `startPct != null && endPct != null && isFinite(...)`) ─────────────────────────

    @Test
    fun hasBatteryDeltaDataRequiresBothEndpointsPresentAndFinite() {
        assertTrue(hasBatteryDeltaData(20.0, 80.0))
        assertFalse("missing start is unknown", hasBatteryDeltaData(null, 80.0))
        assertFalse("missing end is unknown", hasBatteryDeltaData(20.0, null))
        assertFalse(hasBatteryDeltaData(null, null))
        assertFalse("NaN is treated as missing", hasBatteryDeltaData(Double.NaN, 80.0))
        assertFalse("infinity is treated as missing", hasBatteryDeltaData(20.0, Double.POSITIVE_INFINITY))
    }

    // ── signed delta (web `endPct - startPct`) ────────────────────────────────────────────────────────────

    @Test
    fun batteryDeltaValueIsEndMinusStartOrNull() {
        assertEquals(60.0, batteryDeltaValue(20.0, 80.0)!!, 0.0)
        assertEquals(-1.0, batteryDeltaValue(79.0, 78.0)!!, 0.0)
        assertNull(batteryDeltaValue(null, 80.0))
        assertNull(batteryDeltaValue(20.0, Double.NaN))
    }

    // ── tone ternary (web emerald / amber / muted) ────────────────────────────────────────────────────────

    @Test
    fun batteryDeltaToneFollowsTheSignOrUnknown() {
        assertEquals(BatteryDeltaTone.Positive, batteryDeltaTone(20.0, 80.0))
        assertEquals(BatteryDeltaTone.Negative, batteryDeltaTone(80.0, 20.0))
        assertEquals(BatteryDeltaTone.Neutral, batteryDeltaTone(50.0, 50.0))
        assertEquals(BatteryDeltaTone.Unknown, batteryDeltaTone(null, 50.0))
        assertEquals(BatteryDeltaTone.Unknown, batteryDeltaTone(50.0, null))
        assertEquals(BatteryDeltaTone.Unknown, batteryDeltaTone(Double.NaN, 50.0))
    }

    // ── compact label (web `delta === 0 ? dash : ${sign}${magnitude}%`) ───────────────────────────────────

    @Test
    fun compactLabelMatchesTheWebSignedDelta() {
        assertEquals("+60%", batteryDeltaCompactLabel(20.0, 80.0))
        assertEquals("${MINUS}1%", batteryDeltaCompactLabel(79.0, 78.0))
        assertEquals("an equal pair renders the dash", BATTERY_DELTA_DASH, batteryDeltaCompactLabel(80.0, 80.0))
        assertEquals("missing data renders the dash", BATTERY_DELTA_DASH, batteryDeltaCompactLabel(null, 80.0))
    }

    @Test
    fun compactLabelRoundsTheMagnitudeToWholePercent() {
        assertEquals("${MINUS}1%", batteryDeltaCompactLabel(50.0, 49.4))
        assertEquals("+60%", batteryDeltaCompactLabel(20.2, 80.6))
    }

    // ── pair label (web `${startPct}% → ${endPct}%`) ──────────────────────────────────────────────────────

    @Test
    fun pairLabelAlwaysShowsTheEndpointsOrTheDashWhenMissing() {
        assertEquals("79% $ARROW 78%", batteryDeltaPairLabel(79.0, 78.0))
        assertEquals("an equal pair still shows the pair", "80% $ARROW 80%", batteryDeltaPairLabel(80.0, 80.0))
        assertEquals(BATTERY_DELTA_DASH, batteryDeltaPairLabel(20.0, null))
        assertEquals("the endpoints round to whole percent", "80% $ARROW 78%", batteryDeltaPairLabel(79.6, 78.4))
    }

    // ── visible label selection (web `variant === 'pair' ? pairLabel : compactLabel`) ─────────────────────

    @Test
    fun visibleLabelSelectsByVariant() {
        assertEquals("+60%", batteryDeltaVisibleLabel(20.0, 80.0, BatteryDeltaVariant.Compact))
        assertEquals("20% $ARROW 80%", batteryDeltaVisibleLabel(20.0, 80.0, BatteryDeltaVariant.Pair))
    }

    // ── accessible-label descriptor (web `aria-label` selection) ──────────────────────────────────────────

    @Test
    fun a11yDescriptorSelectsUnknownOrTheRoundedKnownEndpoints() {
        assertEquals(BatteryDeltaA11y.Unknown, batteryDeltaA11y(null, 80.0))
        assertEquals(BatteryDeltaA11y.Unknown, batteryDeltaA11y(Double.NaN, 80.0))
        assertEquals(BatteryDeltaA11y.Known(79, 78), batteryDeltaA11y(79.0, 78.0))
        assertEquals(BatteryDeltaA11y.Known(80, 78), batteryDeltaA11y(79.6, 78.4))
    }

    // ── full projection: the per-state snapshot ───────────────────────────────────────────────────────────

    @Test
    fun projectBatteryDeltaReducesTheChargeDrainFlatAndUnknownBranches() {
        assertEquals(
            "charge (compact): emerald, +60%, known endpoints",
            BatteryDeltaProjection(
                hasData = true,
                tone = BatteryDeltaTone.Positive,
                visibleLabel = "+60%",
                a11y = BatteryDeltaA11y.Known(20, 80),
            ),
            projectBatteryDelta(20.0, 80.0, BatteryDeltaVariant.Compact),
        )
        assertEquals(
            "drain (pair): amber, 79% → 78%, known endpoints",
            BatteryDeltaProjection(
                hasData = true,
                tone = BatteryDeltaTone.Negative,
                visibleLabel = "79% $ARROW 78%",
                a11y = BatteryDeltaA11y.Known(79, 78),
            ),
            projectBatteryDelta(79.0, 78.0, BatteryDeltaVariant.Pair),
        )
        assertEquals(
            "flat (compact): muted, dash, known equal endpoints",
            BatteryDeltaProjection(
                hasData = true,
                tone = BatteryDeltaTone.Neutral,
                visibleLabel = BATTERY_DELTA_DASH,
                a11y = BatteryDeltaA11y.Known(80, 80),
            ),
            projectBatteryDelta(80.0, 80.0, BatteryDeltaVariant.Compact),
        )
        assertEquals(
            "unknown: muted, dash, unknown a11y",
            BatteryDeltaProjection(
                hasData = false,
                tone = BatteryDeltaTone.Unknown,
                visibleLabel = BATTERY_DELTA_DASH,
                a11y = BatteryDeltaA11y.Unknown,
            ),
            projectBatteryDelta(null, 80.0, BatteryDeltaVariant.Compact),
        )
    }

    private companion object {
        /** The unicode minus sign the negative compact label uses (web `'−'`). */
        const val MINUS: String = "\u2212"

        /** The rightwards arrow the pair label uses (web `'→'`). */
        const val ARROW: String = "\u2192"
    }
}
