package io.teslasync.android.featureviews.fleetstatsbar

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.units.DistanceUnitPref
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the FleetStatsBar pure logic — the native mirror of every derivation the web
 * component performs (web/src/features/dashboard/components/FleetStatsBar.tsx): the `analytics?.x ?? 0`
 * fall-throughs, the `toDistanceDisplay` / `toEfficiencyDisplay` SI→display conversions, the energy
 * passthrough, the reversed trend series with the `?? [0]` fallback, and the `unreadAlerts > 0` colour gate.
 * Because the surface is purely presentational, each [FleetStatsBarDisplay] is exactly what the thin
 * composable renders, so these assertions double as the per-state "snapshot": the resolved (populated) grid,
 * the empty (no-data → zeros) grid, and the alerts-active branch.
 */
class FleetStatsBarProjectionTest {
    // The metric (km) preferences the owning Dashboard page would resolve from `useUnits` before settings
    // load, and an imperial (mi) variant to exercise both conversion legs.
    private val metric = FleetStatsBarDisplayPrefs(DistanceUnitPref.KM, Locale.US)
    private val imperial = FleetStatsBarDisplayPrefs(DistanceUnitPref.MI, Locale.US)

    // The sample the owning page would thread in: 4 vehicles (3 online), 4,820 km + 812.4 kWh over 30 days,
    // 168 Wh/km fleet average, no unread alerts, plus recent drive/charge series (newest-first on the wire).
    private val sample =
        FleetStatsBarInput(
            analytics =
                FleetAnalyticsSnapshot(
                    totalDistanceSI = 4_820_000.0,
                    totalEnergyKwh = 812.4,
                    avgEfficiencyWhKm = 168.0,
                ),
            vehicleCount = 4,
            onlineCount = 3,
            unreadAlerts = 0,
            recentDriveDistancesM = listOf(12_000.0, 32_500.0, 8_900.0, 41_000.0, 15_750.0),
            recentChargeEnergyWh = listOf(18_000.0, 42_000.0, 9_500.0, 51_000.0),
        )

    // ── project(): populated (metric) ─────────────────────────────────────────────

    @Test
    fun populatedMetricProjectsEveryFigure() {
        val display = FleetStatsBarProjection.project(sample, metric)

        assertEquals(4, display.fleetSize)
        assertEquals(3, display.onlineCount)
        // 4,820,000 SI metres → 4,820 km (web `convertDistanceFromSI`).
        assertEquals(4_820.0, display.distanceValue, 1e-6)
        assertEquals("km", display.distanceUnit)
        assertEquals(812.4, display.energyKwh, 1e-9)
        // Metric efficiency is the identity (web `whPerKm`).
        assertEquals(168.0, display.efficiencyValue, 1e-9)
        assertEquals("Wh/km", display.efficiencyUnit)
        assertEquals(0, display.unreadAlerts)
        assertFalse(display.alertsActive)
    }

    @Test
    fun populatedMetricRendersTheWebFiguresThroughTheSharedFormatter() {
        // Pin what the user actually sees (the composable formats the count-up targets via ChartFormat).
        val display = FleetStatsBarProjection.project(sample, metric)
        assertEquals("4", ChartFormat.number(display.fleetSize.toDouble(), COUNT_DECIMALS, Locale.US))
        assertEquals("4,820", ChartFormat.number(display.distanceValue, DISTANCE_DECIMALS, Locale.US))
        assertEquals("812.4", ChartFormat.number(display.energyKwh, ENERGY_DECIMALS, Locale.US))
        assertEquals("168", ChartFormat.number(display.efficiencyValue, EFFICIENCY_DECIMALS, Locale.US))
    }

    // ── project(): populated (imperial) ───────────────────────────────────────────

    @Test
    fun populatedImperialConvertsDistanceAndEfficiency() {
        val display = FleetStatsBarProjection.project(sample, imperial)

        // 4,820,000 m / 1609.344 = 2,995.0092 mi.
        assertEquals(2_995.0092, display.distanceValue, 1e-3)
        assertEquals("mi", display.distanceUnit)
        // 168 Wh/km × 1.609344 = 270.369792 Wh/mi.
        assertEquals(270.369792, display.efficiencyValue, 1e-6)
        assertEquals("Wh/mi", display.efficiencyUnit)
    }

    // ── project(): trend series (web `.map(...).reverse() ?? [0]`) ─────────────────

    @Test
    fun trendSeriesAreReversedForLeftToRightChronology() {
        val display = FleetStatsBarProjection.project(sample, metric)
        assertEquals(listOf(15_750.0, 41_000.0, 8_900.0, 32_500.0, 12_000.0), display.distanceTrend)
        assertEquals(listOf(51_000.0, 9_500.0, 42_000.0, 18_000.0), display.energyTrend)
    }

    @Test
    fun absentTrendSeriesFallBackToTheFlatSinglePoint() {
        // Web `recent…?.map(...) ?? [0]`: no recent activity → the flat single-point trend (draws no line).
        assertEquals(EMPTY_TREND, FleetStatsBarProjection.trend(emptyList()))
        val noTrends = sample.copy(recentDriveDistancesM = emptyList(), recentChargeEnergyWh = emptyList())
        val display = FleetStatsBarProjection.project(noTrends, metric)
        assertEquals(listOf(0.0), display.distanceTrend)
        assertEquals(listOf(0.0), display.energyTrend)
    }

    // ── project(): empty / no data (web `analytics ?? 0`) ──────────────────────────

    @Test
    fun absentAnalyticsCollapsesEveryAnalyticFigureToZero() {
        val empty =
            FleetStatsBarInput(analytics = null, vehicleCount = 0, onlineCount = 0, unreadAlerts = 0)

        val display = FleetStatsBarProjection.project(empty, metric)

        // Every card is still present with a zero value — the friendly empty surface, never a blank box.
        assertEquals(0, display.fleetSize)
        assertEquals(0, display.onlineCount)
        assertEquals(0.0, display.distanceValue, 1e-9)
        assertEquals(0.0, display.energyKwh, 1e-9)
        assertEquals(0.0, display.efficiencyValue, 1e-9)
        assertEquals(0, display.unreadAlerts)
        assertFalse(display.alertsActive)
        assertEquals(listOf(0.0), display.distanceTrend)
        assertEquals(listOf(0.0), display.energyTrend)
    }

    // ── project(): alerts colour gate (web `unreadAlerts > 0`) ─────────────────────

    @Test
    fun alertsActiveTracksWhetherAnyAlertIsUnread() {
        assertFalse(FleetStatsBarProjection.project(sample.copy(unreadAlerts = 0), metric).alertsActive)
        assertTrue(FleetStatsBarProjection.project(sample.copy(unreadAlerts = 1), metric).alertsActive)
        assertTrue(FleetStatsBarProjection.project(sample.copy(unreadAlerts = 12), metric).alertsActive)
    }

    // ── toEfficiencyDisplay() / efficiencyUnitLabel() ──────────────────────────────

    @Test
    fun toEfficiencyDisplayMatchesTheCanonicalWebConverter() {
        // Metric is the identity; imperial scales Wh/km by km-per-mile (web `whPerKm * 1.609344`).
        assertEquals(150.0, FleetStatsBarProjection.toEfficiencyDisplay(150.0, DistanceUnitPref.KM), 1e-9)
        assertEquals(150.0 * 1.609344, FleetStatsBarProjection.toEfficiencyDisplay(150.0, DistanceUnitPref.MI), 1e-9)
    }

    @Test
    fun efficiencyUnitLabelMatchesTheDistancePreference() {
        assertEquals("Wh/km", FleetStatsBarProjection.efficiencyUnitLabel(DistanceUnitPref.KM))
        assertEquals("Wh/mi", FleetStatsBarProjection.efficiencyUnitLabel(DistanceUnitPref.MI))
    }

    // ── FleetStatsBarDisplayPrefs.fromUnitPref(): the useUnits boundary ────────────

    @Test
    fun fromUnitPrefCarriesTheDistanceUnitAndResolvesTheLocale() {
        val base = UnitPreferences.fromSettings(null) // metric defaults, locale "en-US"

        val metricPrefs = FleetStatsBarDisplayPrefs.fromUnitPref(base)
        assertEquals(DistanceUnitPref.KM, metricPrefs.distanceUnit)
        assertEquals("en", metricPrefs.locale.language)
        assertEquals("US", metricPrefs.locale.country)

        val imperialPrefs = FleetStatsBarDisplayPrefs.fromUnitPref(base.copy(distance = DistanceUnitPref.MI, locale = "de-DE"))
        assertEquals(DistanceUnitPref.MI, imperialPrefs.distanceUnit)
        assertEquals("de", imperialPrefs.locale.language)
        assertEquals("DE", imperialPrefs.locale.country)
    }

    @Test
    fun fromUnitPrefFallsBackToEnUsWhenTheLocaleTagIsBlankOrNull() {
        val base = UnitPreferences.fromSettings(null)
        assertEquals(Locale.US, FleetStatsBarDisplayPrefs.fromUnitPref(base.copy(locale = "")).locale)
        assertEquals(Locale.US, FleetStatsBarDisplayPrefs.fromUnitPref(base.copy(locale = null)).locale)
    }
}
