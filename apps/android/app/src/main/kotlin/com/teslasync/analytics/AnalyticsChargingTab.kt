// The Charging tab for the AnalyticsPage surface — the native parity port of
// web/src/features/analytics/components/analytics/ChargingTab.tsx plus its ChargingDetailSection. Reproduces
// every region in web order: the six summary cards, Charger Types (pie→bar), Start-Battery distribution (bar),
// the Hourly pattern (combo), the Charger-Brands leaderboard, the Monthly trend (combo), the Cost-Analysis
// cards, and the Cost-by-Type bars. Currency + energy are formatted at this boundary via [AnalyticsFormat];
// power stays kW and durations stay minutes as the backend reports them.
//
// Chart substitution: the web Charger-Types `PieChart` donut has no pie primitive in the A3 library, so it is
// rendered as a categorical session-count bar over the same charger types — the identical distribution data.
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
import io.teslasync.android.components.charts.BarChartWrapper
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ComboChart
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.ui.theme.generated.Spacing

/** Unit symbols rendered verbatim (matching the web), not translatable prose. */
private const val UNIT_KW = "kW"
private const val UNIT_KWH = "kWh"
private const val UNIT_PERCENT = "%"

/** The Charging tab body (web `ChargingTab`). */
@Composable
internal fun AnalyticsChargingTab(
    data: FleetAnalytics,
    format: AnalyticsFormat,
    modifier: Modifier = Modifier,
) {
    val ca = data.charging
    val chargerTypes = ca?.chargerTypes.orEmpty()
    val batteryDist = ca?.startBatteryDist.orEmpty()
    val hourly = ca?.hourlyPattern.orEmpty()

    FadeIn(modifier = modifier) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.lg),
        ) {
            ChargingSummaryCards(data = data, format = format)

            // Charger Types (web PieChart → categorical session-count bar).
            ChartSectionPanel(
                title = stringResource(R.string.translation_analytics_charging_chargerTypes),
                isEmpty = chargerTypes.isEmpty(),
                emptyMessage = stringResource(R.string.translation_analytics_charging_noTypes),
            ) {
                BarChartWrapper(
                    series =
                        listOf(
                            analyticsSeries(
                                "count",
                                stringResource(R.string.translation_analytics_charging_sessions),
                                chargerTypes.map { it.count },
                                ChartSeriesKind.Bar,
                                0,
                            ),
                        ),
                    xLabels = chargerTypes.map { it.label },
                )
            }

            // Start Battery Distribution (web BarChart).
            ChartSectionPanel(
                title = stringResource(R.string.translation_analytics_charging_startBattery),
                isEmpty = batteryDist.isEmpty(),
                emptyMessage = stringResource(R.string.translation_analytics_charging_noBatDist),
            ) {
                BarChartWrapper(
                    series =
                        listOf(
                            analyticsSeries(
                                "count",
                                stringResource(R.string.translation_analytics_charging_sessions),
                                batteryDist.map { it.count },
                                ChartSeriesKind.Bar,
                                1,
                            ),
                        ),
                    xLabels = batteryDist.map { it.range },
                )
            }

            // Hourly Charging Pattern (web ComposedChart: charges bar + energy line).
            ChartSectionPanel(
                title = stringResource(R.string.translation_analytics_charging_hourlyPattern),
                isEmpty = hourly.isEmpty(),
                emptyMessage = stringResource(R.string.translation_analytics_charging_noHourly),
            ) {
                ComboChart(
                    series =
                        listOf(
                            analyticsSeries(
                                "charges",
                                stringResource(R.string.translation_analytics_charging_charges),
                                hourly.map { it.charges },
                                ChartSeriesKind.Bar,
                                0,
                            ),
                            analyticsSeries(
                                "energy",
                                stringResource(R.string.translation_analytics_charging_energykWh),
                                hourly.map { it.energy },
                                ChartSeriesKind.Line,
                                3,
                            ),
                        ),
                    xLabels = hourly.map { "${it.hour}:00" },
                )
            }

            ChargingDetailSection(data = data, format = format)
        }
    }
}

/** The six charging summary cards (web `ChargingTab` summary row). */
@Composable
private fun ChargingSummaryCards(
    data: FleetAnalytics,
    format: AnalyticsFormat,
) {
    val ca = data.charging
    MetricGrid(
        columns = 2,
        cells =
            listOf(
                {
                    AnalyticsMetricCard(
                        label = stringResource(R.string.translation_analytics_charging_sessions),
                        value = format.int(data.totalChargingSessions),
                        icon = AnalyticsGlyphs.Plug,
                        accent = MetricAccent.Cyan,
                    )
                },
                {
                    AnalyticsMetricCard(
                        label = stringResource(R.string.translation_analytics_charging_totalEnergy),
                        value = format.number(data.totalEnergyKwh, 1),
                        subtitle = UNIT_KWH,
                        icon = AnalyticsGlyphs.Zap,
                        accent = MetricAccent.Green,
                    )
                },
                {
                    AnalyticsMetricCard(
                        label = stringResource(R.string.translation_analytics_charging_totalCost),
                        value = format.currency(data.totalCost, 2),
                        icon = AnalyticsGlyphs.DollarSign,
                        accent = MetricAccent.Amber,
                    )
                },
                {
                    AnalyticsMetricCard(
                        label = stringResource(R.string.translation_analytics_charging_avgPower),
                        value = ca?.powerStats?.let { format.number(safe(it.avg), 1) } ?: EM_DASH,
                        subtitle = UNIT_KW,
                        icon = AnalyticsGlyphs.Gauge,
                        accent = MetricAccent.Purple,
                    )
                },
                {
                    AnalyticsMetricCard(
                        label = stringResource(R.string.translation_analytics_charging_avgDuration),
                        value = ca?.durationStats?.let { format.number(safe(it.avg), 0) } ?: EM_DASH,
                        subtitle = stringResource(R.string.translation_analytics_charging_min),
                        icon = AnalyticsGlyphs.Timer,
                        accent = MetricAccent.Cyan,
                    )
                },
                {
                    AnalyticsMetricCard(
                        label = stringResource(R.string.translation_analytics_charging_chargeEff),
                        value = ca?.efficiencyStats?.let { format.number(safe(it.avg), 1) } ?: EM_DASH,
                        subtitle = UNIT_PERCENT,
                        icon = AnalyticsGlyphs.TrendingUp,
                        accent = MetricAccent.Green,
                    )
                },
            ),
    )
}

/** The charging detail block (web `ChargingDetailSection`): brands, monthly trend, cost analysis, cost-by-type. */
@Composable
private fun ChargingDetailSection(
    data: FleetAnalytics,
    format: AnalyticsFormat,
) {
    val ca = data.charging
    val brands = brandLeaderboard(ca?.chargerBrands.orEmpty())
    val monthly = ca?.monthlyTrend.orEmpty()
    val costStats = ca?.costStats
    val costRows = costByType(ca?.chargerTypes.orEmpty())
    val sessionsLabel = stringResource(R.string.translation_analytics_charging_sessions)

    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        // Charger Brands (web progress bars).
        SectionPanel(title = stringResource(R.string.translation_analytics_charging_chargerBrands)) {
            if (brands.isEmpty()) {
                EmptyRegion(stringResource(R.string.translation_analytics_charging_noBrands))
            } else {
                LeaderboardBars(
                    rows =
                        brands.mapIndexed { index, row ->
                            BarRow(
                                label = "#${index + 1} ${row.brand}",
                                valueText = "${format.int(row.count)} $sessionsLabel",
                                percent = row.percent,
                                color = paletteColor(1),
                            )
                        },
                )
            }
        }

        // Monthly Charging Trend (web ComposedChart: energy area + avg-power line + sessions bar).
        ChartSectionPanel(
            title = stringResource(R.string.translation_analytics_charging_monthlyTrend),
            isEmpty = monthly.isEmpty(),
            emptyMessage = stringResource(R.string.translation_analytics_charging_noMonthly),
        ) {
            ComboChart(
                series =
                    listOf(
                        analyticsSeries(
                            "energy",
                            stringResource(R.string.translation_analytics_charging_energykWh),
                            monthly.map { it.energy },
                            ChartSeriesKind.Area,
                            1,
                        ),
                        analyticsSeries(
                            "avg_power",
                            stringResource(R.string.translation_analytics_charging_avgPowerkW),
                            monthly.map { it.avgPower },
                            ChartSeriesKind.Line,
                            3,
                        ),
                        analyticsSeries(
                            "sessions",
                            stringResource(R.string.translation_analytics_charging_sessions),
                            monthly.map { it.sessions },
                            ChartSeriesKind.Bar,
                            2,
                        ),
                    ),
                xLabels = monthly.map { it.month },
            )
        }

        // Cost Analysis cards (web MetricCard grid).
        SectionPanel(title = stringResource(R.string.translation_analytics_charging_costAnalysis)) {
            if (costStats == null) {
                EmptyRegion(stringResource(R.string.translation_analytics_charging_noCostStats))
            } else {
                MetricGrid(
                    columns = 2,
                    cells =
                        listOf(
                            costCell(R.string.translation_analytics_charging_minCost, costStats.min, MetricAccent.Green, format),
                            costCell(R.string.translation_analytics_charging_avgCost, costStats.avg, MetricAccent.Cyan, format),
                            costCell(R.string.translation_analytics_charging_medianCost, costStats.median, MetricAccent.Purple, format),
                            costCell(R.string.translation_analytics_charging_maxCost, costStats.max, MetricAccent.Amber, format),
                        ),
                )
            }
        }

        // Cost by Charger Type (web share bars).
        SectionPanel(title = stringResource(R.string.translation_analytics_charging_costByType)) {
            if (costRows.isEmpty()) {
                EmptyRegion(stringResource(R.string.translation_analytics_charging_noCostByType))
            } else {
                LeaderboardBars(
                    rows =
                        costRows.mapIndexed { index, row ->
                            BarRow(
                                label = row.type,
                                valueText = "${format.int(row.count)} (${format.int(row.percent)}$UNIT_PERCENT)",
                                percent = row.percent,
                                color = paletteColor(index),
                            )
                        },
                )
            }
        }
    }
}

/** One cost-analysis card cell (web `formatCurrency(safe(costStats.x), 2)`). */
private fun costCell(
    labelRes: Int,
    amount: Double?,
    accent: MetricAccent,
    format: AnalyticsFormat,
): @Composable () -> Unit =
    {
        AnalyticsMetricCard(
            label = stringResource(labelRes),
            value = format.currency(safe(amount), 2),
            icon = AnalyticsGlyphs.DollarSign,
            accent = accent,
        )
    }
