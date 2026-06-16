// The hero gauge row for the AnalyticsPage surface — the native parity port of
// web/src/features/analytics/components/analytics/HeroGauges.tsx. Renders the six headline fleet metrics
// (distance, drives, energy, efficiency, gas savings, CO₂ saved) as a responsive `MetricCard` grid. Every SI
// total is converted at this boundary via the supplied [AnalyticsFormat] (S5); the gas-savings + CO₂ heuristics
// are tied to SI kilometers regardless of the display unit, exactly as the web does, so the dollar / kg outputs
// stay stable for the same fleet.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.analytics

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import io.teslasync.android.R
import kotlin.math.max

/** Web HeroGauges gas-savings heuristic: `km * 0.085 (kWh/km) * 1.5 ($/kWh) - actualCost`. */
private const val GAS_KWH_PER_KM = 0.085
private const val GAS_DOLLARS_PER_KWH = 1.5

/** Web HeroGauges CO₂ heuristic: `km * 0.12` kg saved. */
private const val CO2_KG_PER_KM = 0.12

/** Unit symbols rendered verbatim (matching the web), not translatable prose. */
private const val UNIT_KWH = "kWh"
private const val UNIT_KG = "kg"

/**
 * The six headline gauges (web `HeroGauges`). [data] is the parsed SI payload; [format] converts each total to
 * the user's display unit at render time.
 */
@Composable
internal fun AnalyticsHeroGauges(
    data: FleetAnalytics,
    format: AnalyticsFormat,
    modifier: Modifier = Modifier,
) {
    val totalDistKm = data.totalDistanceKm
    val totalDist = format.distanceFromKm(totalDistKm)
    val gasSavings = totalDistKm * GAS_KWH_PER_KM * GAS_DOLLARS_PER_KWH - safe(data.totalCost)
    val co2Saved = totalDistKm * CO2_KG_PER_KM
    val avgEffDisplay = format.efficiencyDisplay(data.avgEfficiencyWhKm)

    MetricGrid(
        modifier = modifier,
        columns = 2,
        cells =
            listOf(
                {
                    AnalyticsMetricCard(
                        label = stringResource(R.string.translation_analytics_hero_distance),
                        value = format.number(totalDist, 1),
                        subtitle = format.distanceLabel,
                        icon = AnalyticsGlyphs.MapPin,
                        accent = MetricAccent.Cyan,
                    )
                },
                {
                    AnalyticsMetricCard(
                        label = stringResource(R.string.translation_analytics_hero_drives),
                        value = format.int(data.totalDrives),
                        icon = AnalyticsGlyphs.Car,
                        accent = MetricAccent.Purple,
                    )
                },
                {
                    AnalyticsMetricCard(
                        label = stringResource(R.string.translation_analytics_hero_energy),
                        value = format.number(data.totalEnergyKwh, 1),
                        subtitle = UNIT_KWH,
                        icon = AnalyticsGlyphs.Zap,
                        accent = MetricAccent.Green,
                    )
                },
                {
                    AnalyticsMetricCard(
                        label = stringResource(R.string.translation_analytics_hero_efficiency),
                        value = format.number(avgEffDisplay, 1),
                        subtitle = format.efficiencyLabel,
                        icon = AnalyticsGlyphs.Gauge,
                        accent = MetricAccent.Amber,
                    )
                },
                {
                    AnalyticsMetricCard(
                        label = stringResource(R.string.translation_analytics_hero_gasSavings),
                        value = format.currency(max(gasSavings, 0.0), 0),
                        icon = AnalyticsGlyphs.DollarSign,
                        accent = MetricAccent.Green,
                    )
                },
                {
                    AnalyticsMetricCard(
                        label = stringResource(R.string.translation_analytics_hero_co2Saved),
                        value = format.number(co2Saved, 0),
                        subtitle = UNIT_KG,
                        icon = AnalyticsGlyphs.Leaf,
                        accent = MetricAccent.Green,
                    )
                },
            ),
    )
}
