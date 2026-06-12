package io.teslasync.android.featureviews.drivingtips

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the DrivingTips pure logic — the native mirror of the web component's `useMemo`
 * body (web/src/features/driving/components/driving-dynamics/DrivingTips.tsx): the `motorStats`-driven branch
 * order, the strict `>` power-band boundaries, the thermal-tip append, and the `throttleStyle` helpers from
 * helpers.ts. Because the surface is purely presentational, each projected list is exactly what the thin
 * composable renders, so these assertions double as the per-state "snapshot". Runs in the
 * :android:testReleaseUnitTest gate.
 */
class DrivingTipsProjectionTest {
    // ── tipsFor — exact lists per branch (web useMemo) ──────────────────────────────────────────────

    @Test
    fun absentMotorStatsShowsOnlyTheNoDataTip() {
        assertEquals(listOf(DrivingTip.NoData), DrivingTipsProjection.tipsFor(null))
    }

    @Test
    fun highPowerShowsEaseAccelThenBrakeEarly() {
        assertEquals(
            listOf(DrivingTip.EaseAccel, DrivingTip.BrakeEarly),
            DrivingTipsProjection.tipsFor(MotorStats(avgPower = 95.0, maxMotorTemp = 60.0)),
        )
    }

    @Test
    fun moderatePowerShowsSmoothThrottleThenCoast() {
        assertEquals(
            listOf(DrivingTip.SmoothThrottle, DrivingTip.Coast),
            DrivingTipsProjection.tipsFor(MotorStats(avgPower = 50.0, maxMotorTemp = 60.0)),
        )
    }

    @Test
    fun lowPowerShowsGreatThenKeep() {
        assertEquals(
            listOf(DrivingTip.Great, DrivingTip.Keep),
            DrivingTipsProjection.tipsFor(MotorStats(avgPower = 10.0, maxMotorTemp = 60.0)),
        )
    }

    @Test
    fun highMotorTempAppendsTheThermalTipAfterThePowerPair() {
        assertEquals(
            listOf(DrivingTip.EaseAccel, DrivingTip.BrakeEarly, DrivingTip.Thermal),
            DrivingTipsProjection.tipsFor(MotorStats(avgPower = 95.0, maxMotorTemp = 125.0)),
        )
    }

    @Test
    fun thermalTipAppendsAcrossEveryPowerBand() {
        assertEquals(
            listOf(DrivingTip.SmoothThrottle, DrivingTip.Coast, DrivingTip.Thermal),
            DrivingTipsProjection.tipsFor(MotorStats(avgPower = 50.0, maxMotorTemp = 130.0)),
        )
        assertEquals(
            listOf(DrivingTip.Great, DrivingTip.Keep, DrivingTip.Thermal),
            DrivingTipsProjection.tipsFor(MotorStats(avgPower = 5.0, maxMotorTemp = 130.0)),
        )
    }

    // ── Boundary conditions (web uses strict greater-than) ──────────────────────────────────────────

    @Test
    fun powerBandBoundariesUseStrictGreaterThan() {
        // Exactly 80 is NOT high → falls to the moderate band (web `avgPower > 80`).
        assertEquals(
            listOf(DrivingTip.SmoothThrottle, DrivingTip.Coast),
            DrivingTipsProjection.tipsFor(MotorStats(avgPower = 80.0, maxMotorTemp = 0.0)),
        )
        // Exactly 20 is NOT moderate → falls to the efficient band (web `avgPower > 20`).
        assertEquals(
            listOf(DrivingTip.Great, DrivingTip.Keep),
            DrivingTipsProjection.tipsFor(MotorStats(avgPower = 20.0, maxMotorTemp = 0.0)),
        )
    }

    @Test
    fun thermalBoundaryUsesStrictGreaterThan() {
        // Exactly 120 does NOT append the thermal tip (web `maxMotorTemp > 120`).
        assertFalse(
            DrivingTipsProjection.tipsFor(MotorStats(avgPower = 5.0, maxMotorTemp = 120.0)).contains(DrivingTip.Thermal),
        )
        assertTrue(
            DrivingTipsProjection.tipsFor(MotorStats(avgPower = 5.0, maxMotorTemp = 120.1)).contains(DrivingTip.Thermal),
        )
    }

    // ── Branch invariants ───────────────────────────────────────────────────────────────────────────

    @Test
    fun listIsNeverEmptyForAnyInput() {
        val inputs =
            listOf(
                null,
                MotorStats(avgPower = 0.0, maxMotorTemp = 0.0),
                MotorStats(avgPower = 50.0, maxMotorTemp = 200.0),
                MotorStats(avgPower = 300.0, maxMotorTemp = 200.0),
            )
        inputs.forEach { assertTrue(DrivingTipsProjection.tipsFor(it).isNotEmpty()) }
    }

    @Test
    fun noDataTipAppearsOnlyWhenMotorStatsAbsent() {
        assertTrue(DrivingTipsProjection.tipsFor(null).contains(DrivingTip.NoData))
        assertFalse(
            DrivingTipsProjection.tipsFor(MotorStats(avgPower = 10.0, maxMotorTemp = 10.0)).contains(DrivingTip.NoData),
        )
    }

    @Test
    fun presentMotorStatsAlwaysYieldsTwoOrThreeTips() {
        val withoutThermal = DrivingTipsProjection.tipsFor(MotorStats(avgPower = 50.0, maxMotorTemp = 60.0))
        val withThermal = DrivingTipsProjection.tipsFor(MotorStats(avgPower = 50.0, maxMotorTemp = 130.0))
        assertEquals(2, withoutThermal.size)
        assertEquals(3, withThermal.size)
    }

    // ── ThrottleStyle.fromRaw (web union string → enum) ─────────────────────────────────────────────

    @Test
    fun fromRawMapsEveryKnownUnionString() {
        assertEquals(ThrottleStyle.Conservative, ThrottleStyle.fromRaw("conservative"))
        assertEquals(ThrottleStyle.Moderate, ThrottleStyle.fromRaw("moderate"))
        assertEquals(ThrottleStyle.Aggressive, ThrottleStyle.fromRaw("aggressive"))
    }

    @Test
    fun fromRawFoldsAbsentOrUnknownToNull() {
        assertNull(ThrottleStyle.fromRaw(null))
        assertNull(ThrottleStyle.fromRaw(""))
        assertNull(ThrottleStyle.fromRaw("Conservative"))
        assertNull(ThrottleStyle.fromRaw("sport"))
    }

    // ── ThrottleStyle.fromAvgPower (web getThrottleStyle thresholds) ────────────────────────────────

    @Test
    fun fromAvgPowerMatchesTheWebThresholds() {
        assertEquals(ThrottleStyle.Conservative, ThrottleStyle.fromAvgPower(0.0))
        assertEquals(ThrottleStyle.Conservative, ThrottleStyle.fromAvgPower(19.9))
        assertEquals(ThrottleStyle.Moderate, ThrottleStyle.fromAvgPower(20.0))
        assertEquals(ThrottleStyle.Moderate, ThrottleStyle.fromAvgPower(79.9))
        assertEquals(ThrottleStyle.Aggressive, ThrottleStyle.fromAvgPower(80.0))
        assertEquals(ThrottleStyle.Aggressive, ThrottleStyle.fromAvgPower(150.0))
    }

    // ── Metadata integrity ──────────────────────────────────────────────────────────────────────────

    @Test
    fun everyTipHasAStableListKeyAndDynamicsCatalogKey() {
        DrivingTip.entries.forEach { tip ->
            assertTrue("listKey blank for $tip", tip.listKey.isNotBlank())
            assertTrue("i18nKey for $tip", tip.i18nKey.startsWith("dynamics.tip"))
        }
    }

    @Test
    fun listKeysAndI18nKeysAreUnique() {
        val listKeys = DrivingTip.entries.map { it.listKey }
        val i18nKeys = DrivingTip.entries.map { it.i18nKey }
        assertEquals(listKeys.size, listKeys.toSet().size)
        assertEquals(i18nKeys.size, i18nKeys.toSet().size)
    }
}
