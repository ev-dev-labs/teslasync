// The Battery tab for the AnalyticsPage surface — the native parity port of
// web/src/features/analytics/components/analytics/BatteryTab.tsx. When the backend has no battery trend it shows
// the single no-data panel (web early return); otherwise it reproduces every region in web order: the five
// battery-health cards (from the latest trend point), the Health-Score timeline (area), the Capacity + Range
// trends (lines), and the Degradation & Cycles combo. Capacity/range are converted at this boundary via
// [AnalyticsFormat] (Wh→kWh, km→display); health/degradation are percentages and cycles are counts.
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
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ComboChart
import io.teslasync.android.components.charts.LineChartWrapper
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.ui.theme.generated.Spacing

/** Unit symbol rendered verbatim (matching the web), not translatable prose. */
private const val UNIT_PERCENT = "%"

/** The Battery tab body (web `BatteryTab`). */
@Composable
internal fun AnalyticsBatteryTab(
    data: FleetAnalytics,
    format: AnalyticsFormat,
    modifier: Modifier = Modifier,
) {
    val trend = data.batteryTrend

    if (trend.isEmpty()) {
        FadeIn(modifier = modifier) {
            GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
                EmptyRegion(
                    message = stringResource(R.string.translation_analytics_battery_noData),
                    icon = AnalyticsGlyphs.Battery,
                )
            }
        }
        return
    }

    val latest = trend.last()
    val xLabels = trend.map { it.date.shortDate() }
    val rangeLabel = "${stringResource(R.string.translation_analytics_battery_range)} (${format.distanceLabel})"

    FadeIn(modifier = modifier) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.lg),
        ) {
            // Battery Health cards (web MetricCard row, from the latest trend point).
            MetricGrid(
                columns = 2,
                cells =
                    listOf(
                        {
                            AnalyticsMetricCard(
                                label = stringResource(R.string.translation_analytics_battery_healthScore),
                                value = format.number(safe(latest.healthScore), 1),
                                subtitle = UNIT_PERCENT,
                                icon = AnalyticsGlyphs.Heart,
                                accent = MetricAccent.Green,
                            )
                        },
                        {
                            AnalyticsMetricCard(
                                label = stringResource(R.string.translation_analytics_battery_capacity),
                                value = format.energy(safe(latest.capacityWh), 1),
                                icon = AnalyticsGlyphs.Battery,
                                accent = MetricAccent.Cyan,
                            )
                        },
                        {
                            AnalyticsMetricCard(
                                label = stringResource(R.string.translation_analytics_battery_degradation),
                                value = format.number(safe(latest.degradationPct), 2),
                                subtitle = UNIT_PERCENT,
                                icon = AnalyticsGlyphs.TrendingUp,
                                accent = MetricAccent.Amber,
                            )
                        },
                        {
                            AnalyticsMetricCard(
                                label = stringResource(R.string.translation_analytics_battery_estRange),
                                value = format.number(format.distanceFromKm(safe(latest.rangeKm)), 0),
                                subtitle = format.distanceLabel,
                                icon = AnalyticsGlyphs.MapPin,
                                accent = MetricAccent.Purple,
                            )
                        },
                        {
                            AnalyticsMetricCard(
                                label = stringResource(R.string.translation_analytics_battery_cycles),
                                value = format.int(safe(latest.cycleCount)),
                                icon = AnalyticsGlyphs.Activity,
                                accent = MetricAccent.Cyan,
                            )
                        },
                    ),
            )

            // Health Score Timeline (web AreaChart, y-domain 80–100).
            SectionPanel(title = stringResource(R.string.translation_analytics_battery_healthTimeline)) {
                AreaChartWrapper(
                    series =
                        listOf(
                            analyticsSeries(
                                "health_score",
                                stringResource(R.string.translation_analytics_battery_health),
                                trend.map { safe(it.healthScore) },
                                ChartSeriesKind.Area,
                                1,
                            ),
                        ),
                    xLabels = xLabels,
                )
            }

            // Capacity Trend (web LineChart; SI Wh → display energy unit).
            SectionPanel(title = stringResource(R.string.translation_analytics_battery_capacityTrend)) {
                LineChartWrapper(
                    series =
                        listOf(
                            analyticsSeries(
                                "capacity",
                                stringResource(R.string.translation_analytics_battery_capacity),
                                trend.map { format.energyNumberFromWh(safe(it.capacityWh)) },
                                ChartSeriesKind.Line,
                                0,
                            ),
                        ),
                    xLabels = xLabels,
                )
            }

            // Range Trend (web LineChart; SI km → display distance unit).
            SectionPanel(title = stringResource(R.string.translation_analytics_battery_rangeTrend)) {
                LineChartWrapper(
                    series =
                        listOf(
                            analyticsSeries(
                                "range",
                                rangeLabel,
                                trend.map { format.distanceFromKm(safe(it.rangeKm)) },
                                ChartSeriesKind.Line,
                                2,
                            ),
                        ),
                    xLabels = xLabels,
                )
            }

            // Degradation & Cycles (web ComposedChart: degradation area + cycle-count line).
            SectionPanel(title = stringResource(R.string.translation_analytics_battery_degradationCycles)) {
                ComboChart(
                    series =
                        listOf(
                            analyticsSeries(
                                "degradation_pct",
                                stringResource(R.string.translation_analytics_battery_degradPct),
                                trend.map { safe(it.degradationPct) },
                                ChartSeriesKind.Area,
                                5,
                            ),
                            analyticsSeries(
                                "cycle_count",
                                stringResource(R.string.translation_analytics_battery_cycleCount),
                                trend.map { safe(it.cycleCount) },
                                ChartSeriesKind.Line,
                                4,
                            ),
                        ),
                    xLabels = xLabels,
                )
            }
        }
    }
}
