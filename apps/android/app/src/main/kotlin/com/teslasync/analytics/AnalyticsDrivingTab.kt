// The Driving tab for the AnalyticsPage surface — the native parity port of
// web/src/features/analytics/components/analytics/DrivingTab.tsx plus DrivingPerformanceCards and
// DrivingTemperatureStats. Reproduces every region in web order: the six performance cards, Speed / Trip-
// Distance / Drive-Duration distributions (bars), the Hourly pattern (combo), Temperature-vs-Efficiency, the
// Daily trend (combo) + Efficiency trend (area), and the temperature stat cards. Speeds/distances/temperatures
// are converted at this boundary via [AnalyticsFormat]; power + regen stay kW as the backend reports them.
//
// Chart substitution: the web Temperature-vs-Efficiency `ScatterChart` has no scatter primitive in the A3
// library, so it is rendered as efficiency plotted against ascending temperature (the same {temp, efficiency}
// relationship, ordered) using the line wrapper — a faithful representation within the fixed component set.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.analytics

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import io.teslasync.android.R
import io.teslasync.android.components.charts.AreaChartWrapper
import io.teslasync.android.components.charts.BarChartWrapper
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ComboChart
import io.teslasync.android.components.charts.LineChartWrapper
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.ui.theme.generated.Spacing

/** Unit symbol rendered verbatim (matching the web), not translatable prose. */
private const val UNIT_KW = "kW"

/** The Driving tab body (web `DrivingTab`). */
@Composable
internal fun AnalyticsDrivingTab(
    data: FleetAnalytics,
    format: AnalyticsFormat,
    modifier: Modifier = Modifier,
) {
    val da = data.drive
    val speedDist = da?.speedDistribution.orEmpty()
    val distDist = da?.distanceDistribution.orEmpty()
    val hourly = da?.hourlyPattern.orEmpty()
    val tempEff = da?.tempVsEfficiency.orEmpty().sortedBy { it.temp }
    val dailyTrend = da?.dailyTrend.orEmpty()
    val durationDist = da?.durationDistribution.orEmpty()
    val effTrend = dailyTrend.filter { safe(it.efficiency) > 0.0 }

    FadeIn(modifier = modifier) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.lg),
        ) {
            DrivingPerformanceCards(data = data, format = format)

            // Speed Distribution (web BarChart).
            ChartSectionPanel(
                title = stringResource(R.string.translation_analytics_driving_speedDist),
                isEmpty = speedDist.isEmpty(),
                emptyMessage = stringResource(R.string.translation_analytics_driving_noSpeed),
            ) {
                BarChartWrapper(
                    series =
                        listOf(
                            analyticsSeries(
                                "count",
                                stringResource(R.string.translation_analytics_driving_trips),
                                speedDist.map { it.count },
                                ChartSeriesKind.Bar,
                                0,
                            ),
                        ),
                    xLabels = speedDist.map { it.range },
                )
            }

            // Trip Distance Distribution (web BarChart).
            ChartSectionPanel(
                title = stringResource(R.string.translation_analytics_driving_distDist),
                isEmpty = distDist.isEmpty(),
                emptyMessage = stringResource(R.string.translation_analytics_driving_noDistDist),
            ) {
                BarChartWrapper(
                    series =
                        listOf(
                            analyticsSeries(
                                "count",
                                stringResource(R.string.translation_analytics_driving_trips),
                                distDist.map { it.count },
                                ChartSeriesKind.Bar,
                                2,
                            ),
                        ),
                    xLabels = distDist.map { it.range },
                )
            }

            // Hourly Driving Pattern (web ComposedChart: drives bar + distance line).
            ChartSectionPanel(
                title = stringResource(R.string.translation_analytics_driving_hourlyPattern),
                isEmpty = hourly.isEmpty(),
                emptyMessage = stringResource(R.string.translation_analytics_driving_noHourly),
            ) {
                ComboChart(
                    series =
                        listOf(
                            analyticsSeries(
                                "drives",
                                stringResource(R.string.translation_analytics_driving_drives),
                                hourly.map { it.drives },
                                ChartSeriesKind.Bar,
                                0,
                            ),
                            analyticsSeries(
                                "distance",
                                stringResource(R.string.translation_analytics_driving_distance),
                                hourly.map { format.distanceFromKm(it.distance) },
                                ChartSeriesKind.Line,
                                3,
                            ),
                        ),
                    xLabels = hourly.map { "${it.hour}:00" },
                )
            }

            // Temperature vs Efficiency (web ScatterChart → efficiency over ascending temperature line).
            ChartSectionPanel(
                title = stringResource(R.string.translation_analytics_driving_tempVsEff),
                isEmpty = tempEff.isEmpty(),
                emptyMessage = stringResource(R.string.translation_analytics_driving_noTempEff),
            ) {
                LineChartWrapper(
                    series =
                        listOf(
                            analyticsSeries(
                                "efficiency",
                                format.efficiencyLabel,
                                tempEff.map { format.efficiencyDisplay(it.efficiency) },
                                ChartSeriesKind.Line,
                                1,
                            ),
                        ),
                    xLabels = tempEff.map { "${format.number(format.tempFromC(it.temp), 0)}${format.temperatureLabel}" },
                )
            }

            // Daily Driving Trend (web ComposedChart: distance area + drives line).
            ChartSectionPanel(
                title = stringResource(R.string.translation_analytics_driving_dailyTrend),
                isEmpty = dailyTrend.isEmpty(),
                emptyMessage = stringResource(R.string.translation_analytics_driving_noDailyTrend),
            ) {
                ComboChart(
                    series =
                        listOf(
                            analyticsSeries(
                                "distance",
                                format.distanceLabel,
                                dailyTrend.map { format.distanceFromKm(it.distance) },
                                ChartSeriesKind.Area,
                                0,
                            ),
                            analyticsSeries(
                                "drives",
                                stringResource(R.string.translation_analytics_driving_drives),
                                dailyTrend.map { it.drives },
                                ChartSeriesKind.Line,
                                3,
                            ),
                        ),
                    xLabels = dailyTrend.map { it.date.shortDate() },
                )
            }

            // Drive Duration Distribution (web BarChart).
            ChartSectionPanel(
                title = stringResource(R.string.translation_analytics_driving_durationDist),
                isEmpty = durationDist.isEmpty(),
                emptyMessage = stringResource(R.string.translation_analytics_driving_noDurationData),
            ) {
                BarChartWrapper(
                    series =
                        listOf(
                            analyticsSeries(
                                "count",
                                stringResource(R.string.translation_analytics_driving_drives),
                                durationDist.map { it.count },
                                ChartSeriesKind.Bar,
                                4,
                            ),
                        ),
                    xLabels = durationDist.map { it.range },
                )
            }

            // Efficiency Trend (web AreaChart; only days with positive efficiency).
            ChartSectionPanel(
                title = stringResource(R.string.translation_analytics_driving_effTrend),
                isEmpty = effTrend.isEmpty(),
                emptyMessage = stringResource(R.string.translation_analytics_driving_noEffTrend),
            ) {
                AreaChartWrapper(
                    series =
                        listOf(
                            analyticsSeries(
                                "efficiency",
                                format.efficiencyLabel,
                                effTrend.map { format.efficiencyDisplay(safe(it.efficiency)) },
                                ChartSeriesKind.Area,
                                1,
                            ),
                        ),
                    xLabels = effTrend.map { it.date.shortDate() },
                )
            }

            DrivingTemperatureStats(data = data, format = format)
        }
    }
}

/** The six driving performance cards (web `DrivingPerformanceCards`). */
@Composable
private fun DrivingPerformanceCards(
    data: FleetAnalytics,
    format: AnalyticsFormat,
) {
    val ss = data.drive?.speedStats
    val ps = data.drive?.powerStats
    val rs = data.drive?.regenStats
    val ds = data.drive?.distanceStats

    MetricGrid(
        columns = 2,
        cells =
            listOf(
                {
                    AnalyticsMetricCard(
                        label = stringResource(R.string.translation_analytics_driving_topSpeed),
                        value = ss?.let { format.number(format.speedFromKmh(safe(it.max)), 0) } ?: EM_DASH,
                        subtitle = format.speedLabel,
                        icon = AnalyticsGlyphs.Gauge,
                        accent = MetricAccent.Cyan,
                    )
                },
                {
                    AnalyticsMetricCard(
                        label = stringResource(R.string.translation_analytics_driving_avgSpeed),
                        value = ss?.let { format.number(format.speedFromKmh(safe(it.avg)), 0) } ?: EM_DASH,
                        subtitle = format.speedLabel,
                        icon = AnalyticsGlyphs.TrendingUp,
                        accent = MetricAccent.Purple,
                    )
                },
                {
                    AnalyticsMetricCard(
                        label = stringResource(R.string.translation_analytics_driving_peakPower),
                        value = ps?.let { format.number(safe(it.max), 0) } ?: EM_DASH,
                        subtitle = UNIT_KW,
                        icon = AnalyticsGlyphs.Zap,
                        accent = MetricAccent.Amber,
                    )
                },
                {
                    AnalyticsMetricCard(
                        label = stringResource(R.string.translation_analytics_driving_peakRegen),
                        value = rs?.let { format.number(safe(it.max), 0) } ?: EM_DASH,
                        subtitle = UNIT_KW,
                        icon = AnalyticsGlyphs.BatteryCharging,
                        accent = MetricAccent.Green,
                    )
                },
                {
                    AnalyticsMetricCard(
                        label = stringResource(R.string.translation_analytics_driving_avgDriveDist),
                        value = ds?.let { format.number(format.distanceFromKm(safe(it.avg)), 1) } ?: EM_DASH,
                        subtitle = format.distanceLabel,
                        icon = AnalyticsGlyphs.MapPin,
                        accent = MetricAccent.Cyan,
                    )
                },
                {
                    AnalyticsMetricCard(
                        label = stringResource(R.string.translation_analytics_driving_longestDrive),
                        value = ds?.let { format.number(format.distanceFromKm(safe(it.max)), 1) } ?: EM_DASH,
                        subtitle = format.distanceLabel,
                        icon = AnalyticsGlyphs.Car,
                        accent = MetricAccent.Purple,
                    )
                },
            ),
    )
}

/** The inside/outside temperature stat cards (web `DrivingTemperatureStats`). */
@Composable
private fun DrivingTemperatureStats(
    data: FleetAnalytics,
    format: AnalyticsFormat,
) {
    val inside = data.drive?.temperatureInside
    val outside = data.drive?.temperatureOutside

    SectionPanel(title = stringResource(R.string.translation_analytics_driving_tempStats)) {
        if (inside == null && outside == null) {
            EmptyRegion(stringResource(R.string.translation_analytics_driving_noTempStats))
        } else {
            MetricGrid(
                columns = 2,
                cells =
                    listOf(
                        tempCell(R.string.translation_analytics_driving_insideMin, inside?.min, MetricAccent.Cyan, format),
                        tempCell(R.string.translation_analytics_driving_insideAvg, inside?.avg, MetricAccent.Green, format),
                        tempCell(R.string.translation_analytics_driving_insideMax, inside?.max, MetricAccent.Amber, format),
                        tempCell(R.string.translation_analytics_driving_outsideMin, outside?.min, MetricAccent.Cyan, format),
                        tempCell(R.string.translation_analytics_driving_outsideAvg, outside?.avg, MetricAccent.Green, format),
                        tempCell(R.string.translation_analytics_driving_outsideMax, outside?.max, MetricAccent.Amber, format),
                    ),
            )
        }
    }
}

/** One temperature stat card cell — `null` celsius renders the em-dash (web `temp ? … : '—'`). */
private fun tempCell(
    labelRes: Int,
    celsius: Double?,
    accent: MetricAccent,
    format: AnalyticsFormat,
): @Composable () -> Unit =
    {
        AnalyticsMetricCard(
            label = stringResource(labelRes),
            value = if (celsius != null) format.number(format.tempFromC(safe(celsius)), 1) else EM_DASH,
            subtitle = format.temperatureLabel,
            icon = AnalyticsGlyphs.Thermometer,
            accent = accent,
        )
    }
