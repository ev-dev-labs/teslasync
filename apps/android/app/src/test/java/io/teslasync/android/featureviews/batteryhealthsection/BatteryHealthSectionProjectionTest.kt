package io.teslasync.android.featureviews.batteryhealthsection

import io.teslasync.android.data.UiPhase
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the BatteryHealthSection pure projection — the native port of the web
 * component's `({ metrics })` render contract
 * (web/src/features/analytics/components/weekly-digest/BatteryHealthSection.tsx): the (snapshot, isLoading)
 * lifecycle adapter, the two battery pills (rounded level, `getColor` band, `fmtInt(level)%`, proportional
 * bar fraction), and the three mini-stat values (the raw charge-gain percent at one decimal, the grouped
 * session count, and the `chargeEnergyAdded * 5.5` km estimate). Locale is pinned to en-US so the grouped
 * formatting (web `fmtNumber` default locale) is deterministic. Runs in the :android:testReleaseUnitTest
 * gate; no Compose, no device.
 */
class BatteryHealthSectionProjectionTest {
    private val locale: Locale = Locale.US

    private val snapshot =
        BatteryHealthSnapshot(
            batteryStart = 22.4,
            batteryEnd = 78.6,
            chargingSessionCount = 12,
            chargeEnergyAdded = 240.0,
        )

    private fun statsByMetric(snapshot: BatteryHealthSnapshot): Map<BatteryHealthMetric, String> =
        BatteryHealthSectionProjection.display(snapshot, locale).stats.associate { it.metric to it.value }

    // ── (snapshot, isLoading) → lifecycle UiState adapter ───────────────────────────────────────────────

    @Test
    fun loadingTakesPrecedenceEvenWithSnapshot() {
        val state = BatteryHealthSectionProjection.projectUiState(snapshot, isLoading = true)
        assertEquals(UiPhase.Loading, state.phase)
        assertTrue(state.isLoading)
    }

    @Test
    fun contentWhenSnapshotPresentAndNotLoading() {
        val state = BatteryHealthSectionProjection.projectUiState(snapshot, isLoading = false)
        assertEquals(UiPhase.Content, state.phase)
        assertEquals(snapshot, state.data)
    }

    @Test
    fun emptyWhenNoSnapshotAndNotLoading() {
        val state = BatteryHealthSectionProjection.projectUiState(snapshot = null, isLoading = false)
        assertEquals(UiPhase.Empty, state.phase)
        assertTrue(state.isEmpty)
    }

    @Test
    fun loadingWhenNoSnapshotAndLoading() {
        val state = BatteryHealthSectionProjection.projectUiState(snapshot = null, isLoading = true)
        assertEquals(UiPhase.Loading, state.phase)
    }

    // ── display: pills in source order, rounded levels, band, percent text, bar fraction ────────────────

    @Test
    fun pillsAreStartThenEndInSourceOrder() {
        val pills = BatteryHealthSectionProjection.display(snapshot, locale).pills
        assertEquals(listOf(BatteryPillKind.AvgStart, BatteryPillKind.AvgEnd), pills.map { it.kind })
    }

    @Test
    fun pillRoundsLevelAndFormatsPercentAndBand() {
        // Start 22.4 → 22 (critical, < 30); End 78.6 → 79 (good, >= 60).
        val display = BatteryHealthSectionProjection.display(snapshot, locale)
        val start = display.pills[0]
        val end = display.pills[1]
        assertEquals(22L, start.levelRounded)
        assertEquals("22%", start.percentText)
        assertEquals(BatteryHealthColorBand.Critical, start.band)
        assertEquals(0.22f, start.barFraction, FRACTION_DELTA)
        assertEquals(79L, end.levelRounded)
        assertEquals("79%", end.percentText)
        assertEquals(BatteryHealthColorBand.Good, end.band)
        assertEquals(0.79f, end.barFraction, FRACTION_DELTA)
    }

    @Test
    fun pillRoundsHalfUpLikeWebMathRound() {
        // Web `Math.round` rounds a .5 tie toward +∞: 59.5 → 60 (so the band crosses into "good").
        val pill = BatteryHealthSectionProjection.pill(BatteryPillKind.AvgStart, levelValue = 59.5, locale = locale)
        assertEquals(60L, pill.levelRounded)
        assertEquals("60%", pill.percentText)
        assertEquals(BatteryHealthColorBand.Good, pill.band)
    }

    @Test
    fun pillBarFractionClampsAboveFull() {
        val pill = BatteryHealthSectionProjection.pill(BatteryPillKind.AvgEnd, levelValue = 120.0, locale = locale)
        assertEquals(1f, pill.barFraction, FRACTION_DELTA)
        assertEquals(BatteryHealthColorBand.Good, pill.band)
    }

    @Test
    fun pillGuardsNonFiniteLevelToZero() {
        val pill = BatteryHealthSectionProjection.pill(BatteryPillKind.AvgStart, levelValue = Double.NaN, locale = locale)
        assertEquals(0L, pill.levelRounded)
        assertEquals("0%", pill.percentText)
        assertEquals(0f, pill.barFraction, FRACTION_DELTA)
        assertEquals(BatteryHealthColorBand.Critical, pill.band)
    }

    // ── color band thresholds (web getColor >= 60 / >= 30) ──────────────────────────────────────────────

    @Test
    fun colorBandThresholdsMatchWeb() {
        assertEquals(BatteryHealthColorBand.Good, BatteryHealthColorBand.forLevel(100L))
        assertEquals(BatteryHealthColorBand.Good, BatteryHealthColorBand.forLevel(60L))
        assertEquals(BatteryHealthColorBand.Warning, BatteryHealthColorBand.forLevel(59L))
        assertEquals(BatteryHealthColorBand.Warning, BatteryHealthColorBand.forLevel(30L))
        assertEquals(BatteryHealthColorBand.Critical, BatteryHealthColorBand.forLevel(29L))
        assertEquals(BatteryHealthColorBand.Critical, BatteryHealthColorBand.forLevel(0L))
    }

    // ── display: the three mini-stat values (web fmtNumber / fmtInt + the * 5.5 km estimate) ────────────

    @Test
    fun statsAreInWebSourceOrder() {
        val order = BatteryHealthSectionProjection.display(snapshot, locale).stats.map { it.metric }
        assertEquals(
            listOf(
                BatteryHealthMetric.AvgChargeGain,
                BatteryHealthMetric.ChargeSessions,
                BatteryHealthMetric.EstRangeAdded,
            ),
            order,
        )
    }

    @Test
    fun statValuesFormatLikeWeb() {
        val byMetric = statsByMetric(snapshot)
        // Avg charge gain = batteryEnd - batteryStart = 56.2, one decimal + '%'.
        assertEquals("56.2%", byMetric[BatteryHealthMetric.AvgChargeGain])
        // Charge sessions = fmtInt(12).
        assertEquals("12", byMetric[BatteryHealthMetric.ChargeSessions])
        // Est. range added = fmtNumber(240 * 5.5 = 1320, 0) + ' km' (grouped at en-US).
        assertEquals("1,320 km", byMetric[BatteryHealthMetric.EstRangeAdded])
    }

    @Test
    fun chargeGainUsesRawUnroundedDifference() {
        // Web uses the raw metrics (NOT the rounded pill levels): 80.4 - 20.6 = 59.8 → "59.8%".
        val raw = snapshot.copy(batteryStart = 20.6, batteryEnd = 80.4)
        assertEquals("59.8%", statsByMetric(raw)[BatteryHealthMetric.AvgChargeGain])
    }

    @Test
    fun statValuesGuardNonFiniteToZero() {
        val nonFinite =
            BatteryHealthSnapshot(
                batteryStart = Double.NaN,
                batteryEnd = Double.NaN,
                chargingSessionCount = 0,
                chargeEnergyAdded = Double.POSITIVE_INFINITY,
            )
        val byMetric = statsByMetric(nonFinite)
        assertEquals("0.0%", byMetric[BatteryHealthMetric.AvgChargeGain])
        assertEquals("0", byMetric[BatteryHealthMetric.ChargeSessions])
        assertEquals("0 km", byMetric[BatteryHealthMetric.EstRangeAdded])
    }

    private companion object {
        const val FRACTION_DELTA: Float = 0.0001f
    }
}
