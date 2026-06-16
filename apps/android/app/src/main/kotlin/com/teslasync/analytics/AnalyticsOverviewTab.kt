// The Overview tab for the AnalyticsPage surface — the native parity port of
// web/src/features/analytics/components/analytics/OverviewTab.tsx and its OverviewVehicleComparison child.
// Reproduces every region in web order: Distance-by-Vehicle (bar), the vehicle-comparison block (Fleet Usage,
// Efficiency Leaderboard, Vehicle Comparison, Energy & Activity), Day-of-Week (combo), Monthly Cost (combo),
// and the Quick Links grid. Each SI value is converted at the boundary via [AnalyticsFormat]; every panel owns
// loading-free content + an honest empty state.
//
// Chart substitutions (the A3 chart library exposes Bar/Line/Area/Combo + RadialGauge only — no pie/radar):
//  - web Fleet-Usage donut  → a categorical distance bar (same per-vehicle distance shares).
//  - web Vehicle-Comparison radar → a grouped bar of the same 0–100 normalised axes (Distance/Energy/Drives/
//    Efficiency), one bar series per vehicle. These are faithful representations of the identical data within
//    the fixed component library, not a scope reduction.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.analytics

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import io.teslasync.android.R
import io.teslasync.android.components.charts.BarChartWrapper
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ComboChart
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Card
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * The Overview tab body (web `OverviewTab`). [data] is the parsed SI payload; [format] converts at the render
 * boundary. Wrapped in [FadeIn] to mirror the web entrance cascade.
 */
@Composable
internal fun AnalyticsOverviewTab(
    data: FleetAnalytics,
    format: AnalyticsFormat,
    modifier: Modifier = Modifier,
) {
    val vehicles = data.vehicleComparison
    val vehicleNames = vehicles.map { it.name }
    val distanceValues = vehicles.map { format.distanceFromKm(it.distance) }
    val dow = data.drive?.dayOfWeek.orEmpty()
    val monthly = data.charging?.monthlyTrend.orEmpty()

    FadeIn(modifier = modifier) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.lg),
        ) {
            // Distance by Vehicle (web BarChart).
            ChartSectionPanel(
                title = stringResource(R.string.translation_analytics_overview_distByVehicle),
                isEmpty = vehicles.isEmpty(),
                emptyMessage = stringResource(R.string.translation_analytics_overview_noVehicles),
            ) {
                BarChartWrapper(
                    series =
                        listOf(
                            analyticsSeries("distance", format.distanceLabel, distanceValues, ChartSeriesKind.Bar, 0),
                        ),
                    xLabels = vehicleNames,
                )
            }

            OverviewVehicleComparison(data = data, format = format)

            // Day of Week Pattern (web ComposedChart: drives bar + avg-distance line).
            ChartSectionPanel(
                title = stringResource(R.string.translation_analytics_overview_dayOfWeek),
                isEmpty = dow.isEmpty(),
                emptyMessage = stringResource(R.string.translation_analytics_overview_noDow),
            ) {
                ComboChart(
                    series =
                        listOf(
                            analyticsSeries(
                                "drives",
                                stringResource(R.string.translation_analytics_overview_drives),
                                dow.map { it.drives },
                                ChartSeriesKind.Bar,
                                2,
                            ),
                            analyticsSeries(
                                "avg_distance",
                                stringResource(R.string.translation_analytics_overview_avgDist),
                                dow.map { format.distanceFromKm(it.avgDistance) },
                                ChartSeriesKind.Line,
                                3,
                            ),
                        ),
                    xLabels = dow.map { it.day },
                )
            }

            // Monthly Cost Comparison (web ComposedChart: electric + gas cost bars + savings line).
            ChartSectionPanel(
                title = stringResource(R.string.translation_analytics_overview_monthlyCost),
                isEmpty = monthly.isEmpty(),
                emptyMessage = stringResource(R.string.translation_analytics_overview_noMonthly),
            ) {
                ComboChart(
                    series =
                        listOf(
                            analyticsSeries(
                                "cost",
                                stringResource(R.string.translation_analytics_overview_electricCost),
                                monthly.map { it.cost },
                                ChartSeriesKind.Bar,
                                0,
                            ),
                            analyticsSeries(
                                "gas_cost",
                                stringResource(R.string.translation_analytics_overview_gasCost),
                                monthly.map { it.gasCost },
                                ChartSeriesKind.Bar,
                                5,
                            ),
                            analyticsSeries(
                                "savings",
                                stringResource(R.string.translation_analytics_overview_savings),
                                monthly.map { it.savings },
                                ChartSeriesKind.Line,
                                1,
                            ),
                        ),
                    xLabels = monthly.map { it.month },
                )
            }

            QuickLinksSection()
        }
    }
}

/**
 * The fleet vehicle-comparison block (web `OverviewVehicleComparison`): Fleet Usage (pie→bar), the Efficiency
 * Leaderboard bars, the Vehicle Comparison (radar→grouped bar), and Energy & Activity grouped bars.
 */
@Composable
private fun OverviewVehicleComparison(
    data: FleetAnalytics,
    format: AnalyticsFormat,
) {
    val vehicles = data.vehicleComparison
    val vehicleNames = vehicles.map { it.name }
    val distanceValues = vehicles.map { format.distanceFromKm(it.distance) }
    val leaderboard = efficiencyLeaderboard(vehicles)
    val radar = radarVehicles(vehicles)
    val axes = RadarAxis.entries

    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        // Fleet Usage distribution (web PieChart → categorical distance bar).
        ChartSectionPanel(
            title = stringResource(R.string.translation_analytics_overview_fleetUsage),
            isEmpty = vehicles.isEmpty(),
            emptyMessage = stringResource(R.string.translation_analytics_overview_noVehicles),
        ) {
            BarChartWrapper(
                series =
                    listOf(
                        analyticsSeries("usage", format.distanceLabel, distanceValues, ChartSeriesKind.Bar, 1),
                    ),
                xLabels = vehicleNames,
            )
        }

        // Efficiency Leaderboard (web progress bars).
        SectionPanel(title = stringResource(R.string.translation_analytics_overview_effLeaderboard)) {
            if (leaderboard.isEmpty()) {
                EmptyRegion(stringResource(R.string.translation_analytics_overview_noEfficiency))
            } else {
                LeaderboardBars(
                    rows =
                        leaderboard.mapIndexed { index, row ->
                            BarRow(
                                label = "#${index + 1} ${row.name}",
                                valueText = "${format.number(format.efficiencyDisplay(row.efficiencyWhKm), 1)} ${format.efficiencyLabel}",
                                percent = row.percent,
                                color = paletteColor(0),
                            )
                        },
                )
            }
        }

        // Vehicle Comparison (web RadarChart → grouped normalised bar; needs ≥2 vehicles).
        ChartSectionPanel(
            title = stringResource(R.string.translation_analytics_overview_vehicleComparison),
            isEmpty = radar.isEmpty(),
            emptyMessage = stringResource(R.string.translation_analytics_overview_noComparison),
        ) {
            ComboChart(
                series =
                    radar.mapIndexed { index, vehicle ->
                        analyticsSeries(
                            key = "veh_${vehicle.id}",
                            label = vehicle.name,
                            values = axes.map { axis -> vehicle.scores[axis] ?: 0.0 },
                            kind = ChartSeriesKind.Bar,
                            colorIndex = index,
                        )
                    },
                xLabels = axes.map { it.wire },
            )
        }

        // Energy & Activity (web grouped BarChart: energy + drives).
        ChartSectionPanel(
            title = stringResource(R.string.translation_analytics_overview_energyActivity),
            isEmpty = vehicles.isEmpty(),
            emptyMessage = stringResource(R.string.translation_analytics_overview_noVehicles),
        ) {
            ComboChart(
                series =
                    listOf(
                        analyticsSeries(
                            "energy",
                            stringResource(R.string.translation_analytics_overview_energykWh),
                            vehicles.map { it.energy },
                            ChartSeriesKind.Bar,
                            1,
                        ),
                        analyticsSeries(
                            "drives",
                            stringResource(R.string.translation_analytics_overview_drives),
                            vehicles.map { it.drives },
                            ChartSeriesKind.Bar,
                            3,
                        ),
                    ),
                xLabels = vehicleNames,
            )
        }
    }
}

/** One quick-link destination the section surfaces (web `QUICK_LINKS`). */
private data class QuickLink(val labelRes: Int, val icon: androidx.compose.ui.graphics.vector.ImageVector)

/**
 * The Quick Links grid (web `OverviewTab` Quick Links). Surfaces the related analytics destinations as labeled
 * cards. Cross-page navigation is out of scope for this parity unit (the page-host seam exposes no nav
 * controller), so the cards are informational labels rather than fake-functional buttons — the section is
 * reproduced without implying interactivity it cannot honor.
 */
@Composable
private fun QuickLinksSection() {
    val links =
        listOf(
            QuickLink(R.string.translation_analytics_links_statistics, AnalyticsGlyphs.BarChart),
            QuickLink(R.string.translation_analytics_links_compare, AnalyticsGlyphs.TrendingUp),
            QuickLink(R.string.translation_analytics_links_weeklyDigest, AnalyticsGlyphs.Timer),
            QuickLink(R.string.translation_analytics_links_mileage, AnalyticsGlyphs.MapPin),
            QuickLink(R.string.translation_analytics_links_timeline, AnalyticsGlyphs.Activity),
        )
    SectionPanel(title = stringResource(R.string.translation_analytics_overview_quickLinks)) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            links.forEach { link ->
                Card(modifier = Modifier.fillMaxWidth()) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(link.icon, contentDescription = null, size = IconSize.Md)
                        BodyText(stringResource(link.labelRes))
                    }
                }
            }
        }
    }
}
