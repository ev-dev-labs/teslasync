// The native Jetpack Compose + Material 3 SleepEfficiencyPage surface — a parity port of
// web/src/features/battery/pages/SleepEfficiencyPage.tsx, the vehicle sleep / vampire-drain / sentry-cost dashboard. It
// reproduces the page's eight panels (the four key-metric cards — sleep efficiency, avg-time-to-sleep, sentry drain
// rate, sentry monthly cost; the state-distribution donut; the sentry-vs-no-sentry comparison bars; the monthly sentry
// impact callout; and the recent-drain-events table), every data state (loading / empty / error / success, plus the
// cache-then-network stale/offline tier), and every visible string (resolved from the generated res/values catalog
// `sleep.*` / `common.*`, ADR-014).
//
// Composition: [SleepEfficiencyPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the feed + the live display preferences);
// [SleepEfficiencyPageContent] is the stateless render layer (the page chrome — title / subtitle / freshness chip /
// vehicle scope picker — then the loading / error / empty / loaded body gated on the sleep feed). The loaded body draws
// every panel from the decoded model; all decode + derivation lives in the framework-free model
// (SleepEfficiencyPageModel.kt), so this file only resolves i18n + draws. SI event temperatures are converted to the
// user's unit only here at the display boundary via the model's `prefs.fromCelsius` (Phase-48 SI-canonical); sentry
// energy (kWh) and costs render verbatim.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// stateless content + sub-components; `LongMethod`/`TooManyFunctions` for the parity-complete panel set.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "TooManyFunctions", "LongMethod", "LargeClass")

package io.teslasync.android.battery.sleepefficiency

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.BarChartWrapper
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.LiveStaleDataBanner
import io.teslasync.android.components.feedback.PageLoader
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.sharedsurfaces.vehicleselect.VehicleSelect
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Stagger between the body panels' entrance fades (web `FadeIn delay` cascade), in ms per panel ordinal. */
private const val FADE_STEP_MS = 50

/** Unit suffixes the web reads as literals (never i18n). */
private const val PERCENT_UNIT = "%"
private const val PER_HOUR_UNIT = "%/hr"
private const val HOURS_UNIT = "h"
private const val ENERGY_UNIT = "kWh"
private const val MINUTES_UNIT = "min"

/** The em dash shown for a missing value (web `'—'`). */
private const val EM_DASH = "\u2014"

/** A drain rate above this (web `event.drain_rate > 1.5`) is flagged in the danger color, else the success color. */
private const val DRAIN_RATE_DANGER = 1.5

/** Per-metric-card accent palette indices (web per-card `color`). */
private const val ACCENT_EFFICIENCY = 4
private const val ACCENT_TIME = 0
private const val ACCENT_SENTRY = 2
private const val ACCENT_COST = 3

/** Sentry comparison series palette indices (web amber `Sentry On` / purple `Sentry Off`). */
private const val ACCENT_SENTRY_ON = 2
private const val ACCENT_SENTRY_OFF = 4

private val PIE_SIZE = 168.dp
private val PIE_RING = 28.dp
private val LEGEND_DOT = 10.dp
private const val PIE_START_ANGLE = -90f
private const val PIE_FULL_SWEEP = 360f
private const val MIN_DENOMINATOR = 1.0

// ── Stateful entry ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [SleepEfficiencyPageViewModel] over the supplied [source] (the host wires the
 * page-local sleep repository + the shared Settings holder + the active-vehicle selection via
 * [sleepEfficiencyPageSourceOf]). [logger] defaults to the app's redacting logger. Records the one-shot `view.opened`
 * diagnostic and binds the live state to the content.
 */
@Composable
fun SleepEfficiencyPage(
    source: SleepEfficiencyPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: SleepEfficiencyPageViewModel =
        viewModel(
            key = SleepEfficiencyPageRegistration.SLUG,
            factory = viewModelFactory { initializer { SleepEfficiencyPageViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val sleep by viewModel.sleep.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()

    SleepEfficiencyPageContent(
        sleep = sleep,
        prefs = prefs,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the chrome (title + subtitle + freshness chip + vehicle-scope picker + the stale/offline
 * banner), then the sleep-gated body — a centered loader on a first load, a retryable error panel on a hard failure,
 * an empty-state when no sleep data exists, or the loaded panels otherwise.
 */
@Composable
fun SleepEfficiencyPageContent(
    sleep: UiState<SleepEfficiency>,
    prefs: SleepDisplayPrefs,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        SleepChrome(sleep = sleep)

        when {
            sleep.isLoading -> SleepLoading()
            sleep.isError -> SleepError(onRetry = onRetry)
            sleep.isEmpty -> SleepNoData()
            else -> SleepBody(sleep = sleep.data ?: SleepEfficiency.EMPTY, prefs = prefs)
        }
    }
}

/** The page chrome — title + subtitle (web `PageContainer`), the freshness chip, the scope picker, and the stale banner. */
@Composable
private fun SleepChrome(sleep: UiState<SleepEfficiency>) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                PageTitle(stringResource(R.string.translation_sleep_title))
                BodyText(
                    stringResource(R.string.translation_sleep_subtitle),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            // web `DataFreshnessAuto` — the sleep-efficiency freshness chip.
            DataFreshness(
                updatedAtMillis = sleep.fetchedAt,
                isFetching = sleep.refreshing,
                isStale = sleep.stale,
                isError = sleep.hasError,
                fetchingLabel = stringResource(R.string.translation_freshness_updating),
                errorLabel = stringResource(R.string.translation_freshness_error),
            )
        }
        // web `<VehicleSelect ariaLabel={t('sleep.selectVehicle')} />` — the global active-vehicle scope picker.
        val selectVehicleLabel = stringResource(R.string.translation_sleep_selectVehicle)
        Box(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .semantics { contentDescription = selectVehicleLabel },
        ) {
            VehicleSelect(withIcon = true)
        }
        // web `<LiveStaleDataBanner />` — surfaced only while cached data is shown because the network is unreachable.
        if (sleep.isOffline) LiveStaleDataBanner()
    }
}

/** The first-load surface — a centered brand loader (web `PageContainer loading`). */
@Composable
private fun SleepLoading() {
    PageLoader(
        modifier = Modifier.fillMaxWidth(),
        label = stringResource(R.string.translation_common_loading),
    )
}

/** The hard-failure surface — a localized error panel with retry (web `PageContainer error`). */
@Composable
private fun SleepError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_loadFailed),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
    )
}

/** The no-data surface — the web `<EmptyState … noData />` shown when no sleep data exists for the scope. */
@Composable
private fun SleepNoData() {
    EmptyState(
        message = stringResource(R.string.translation_sleep_noData),
        icon = SleepGlyphs.Moon,
    )
}

/** The loaded body — every panel in its web order, each entering with a staggered fade. */
@Composable
private fun SleepBody(
    sleep: SleepEfficiency,
    prefs: SleepDisplayPrefs,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        FadeIn { KeyMetricsGrid(sleep, prefs) }
        FadeIn(delayMs = FADE_STEP_MS) { StateDistributionPanel(sleep.stateShares, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 2) { SentryComparisonPanel(sleep.comparison) }
        FadeIn(delayMs = FADE_STEP_MS * 3) { MonthlySentryImpactPanel(sleep, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 4) { RecentDrainEventsPanel(sleep.recentEvents, prefs) }
    }
}

// ── Panels 1-4 — Key metric cards ───────────────────────────────────────────────────────────────────────────────

/** Sleep-Efficiency / Avg-Time-to-Sleep / Sentry-Drain-Rate / Sentry-Monthly-Cost — the web 4-up `<MetricCard>` grid. */
@Composable
private fun KeyMetricsGrid(
    sleep: SleepEfficiency,
    prefs: SleepDisplayPrefs,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        MetricRow {
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_sleep_efficiency),
                value = prefs.percent(sleep.sleepEfficiencyPct),
                icon = SleepGlyphs.Moon,
                accent = paletteColor(ACCENT_EFFICIENCY),
            )
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_sleep_avgTimeToSleep),
                value = "${prefs.integer(sleep.timeToSleepAvgMin)} $MINUTES_UNIT",
                icon = SleepGlyphs.Clock,
                accent = paletteColor(ACCENT_TIME),
            )
        }
        MetricRow {
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_sleep_sentryDrainRate),
                value = "${prefs.number(sleep.sentryOnDrainRate)}$PER_HOUR_UNIT",
                icon = SleepGlyphs.Eye,
                accent = paletteColor(ACCENT_SENTRY),
            )
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_sleep_sentryMonthlyCost),
                value = prefs.currency(sleep.sentryMonthlyCost),
                icon = SleepGlyphs.DollarSign,
                accent = paletteColor(ACCENT_COST),
            )
        }
    }
}

// ── Panel 5 — State distribution (ChartContainer + donut) ───────────────────────────────────────────────────────

/** State-Distribution — the web pie `<ChartContainer>`: the donut + legend, or the `noStateData` empty-state. */
@Composable
private fun StateDistributionPanel(
    shares: List<SleepStateShare>,
    prefs: SleepDisplayPrefs,
) {
    ChartContainer(
        modifier = Modifier.fillMaxWidth(),
        title = stringResource(R.string.translation_sleep_stateDistribution),
        accessibleDescription = stringResource(R.string.translation_sleep_stateDistribution_aria),
        status = if (shares.isNotEmpty()) ChartStatus.Ready else ChartStatus.Empty,
        emptyMessage = stringResource(R.string.translation_sleep_noStateData),
    ) {
        StateDistributionChart(shares = shares, prefs = prefs)
    }
}

/** The page-local Compose-canvas donut + legend (the A3 chart library carries no pie wrapper; web `chart-a11y:no-table`). */
@Composable
private fun StateDistributionChart(
    shares: List<SleepStateShare>,
    prefs: SleepDisplayPrefs,
) {
    val colors = remember(shares) { shares.map { paletteColor(it.colorIndex) } }
    val totalMinutes = remember(shares) { shares.sumOf { it.minutes }.coerceAtLeast(MIN_DENOMINATOR) }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            Canvas(modifier = Modifier.size(PIE_SIZE)) {
                val strokePx = PIE_RING.toPx()
                val diameter = size.minDimension - strokePx
                val topLeft = Offset((size.width - diameter) / 2f, (size.height - diameter) / 2f)
                val arcSize = Size(diameter, diameter)
                var startAngle = PIE_START_ANGLE
                shares.forEachIndexed { index, share ->
                    val sweep = (share.minutes / totalMinutes).toFloat() * PIE_FULL_SWEEP
                    drawArc(
                        color = colors.getOrElse(index) { Color.Gray },
                        startAngle = startAngle,
                        sweepAngle = sweep,
                        useCenter = false,
                        topLeft = topLeft,
                        size = arcSize,
                        style = Stroke(width = strokePx),
                    )
                    startAngle += sweep
                }
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            shares.forEachIndexed { index, share ->
                LegendRow(
                    color = colors.getOrElse(index) { Color.Gray },
                    label = share.label,
                    hours = "${share.hoursLabel(prefs)}$HOURS_UNIT",
                )
            }
        }
    }
}

/** One legend row — a color swatch + the state label and its accrued hours (web per-state legend entry). */
@Composable
private fun LegendRow(
    color: Color,
    label: String,
    hours: String,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Box(modifier = Modifier.size(LEGEND_DOT).clip(CircleShape).background(color))
        BodyText(label, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Caption(hours)
    }
}

// ── Panel 6 — Sentry vs no-sentry comparison (ChartContainer + bars) ────────────────────────────────────────────

/** Sentry-vs-No-Sentry — the web comparison bar `<ChartContainer>`: drain-rate + battery-lost bars, or the empty-state. */
@Composable
private fun SentryComparisonPanel(comparison: SleepSentryComparison) {
    val drainLabel = stringResource(R.string.translation_sleep_drainRate)
    val lostLabel = stringResource(R.string.translation_sleep_avgBatteryLost)
    val onLabel = stringResource(R.string.translation_sleep_sentryOn)
    val offLabel = stringResource(R.string.translation_sleep_sentryOff)
    ChartContainer(
        modifier = Modifier.fillMaxWidth(),
        title = stringResource(R.string.translation_sleep_sentryComparison),
        accessibleDescription = stringResource(R.string.translation_sleep_sentryComparison_aria),
        status = if (comparison.hasData) ChartStatus.Ready else ChartStatus.Empty,
        emptyMessage = stringResource(R.string.translation_sleep_noSentryData),
    ) {
        BarChartWrapper(
            series =
                listOf(
                    ChartSeries(
                        key = "sentry_on",
                        label = onLabel,
                        values = listOf(comparison.drainOn, comparison.lostOn),
                        kind = ChartSeriesKind.Bar,
                        color = paletteColor(ACCENT_SENTRY_ON),
                    ),
                    ChartSeries(
                        key = "sentry_off",
                        label = offLabel,
                        values = listOf(comparison.drainOff, comparison.lostOff),
                        kind = ChartSeriesKind.Bar,
                        color = paletteColor(ACCENT_SENTRY_OFF),
                    ),
                ),
            xLabels = listOf(drainLabel, lostLabel),
        )
    }
}

// ── Panel 7 — Monthly sentry impact callout ─────────────────────────────────────────────────────────────────────

/** GlassPanel7 — the monthly sentry impact callout: extra drain/hr, extra monthly kWh, and extra cost/mo. */
@Composable
private fun MonthlySentryImpactPanel(
    sleep: SleepEfficiency,
    prefs: SleepDisplayPrefs,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg, accent = PanelAccent.Warning) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Icon(SleepGlyphs.Eye, contentDescription = null, tint = TeslaTokens.status.warning, size = IconSize.Sm)
            SectionTitle(stringResource(R.string.translation_sleep_monthlySentryImpact))
        }
        Spacer(Modifier.height(Spacing.md))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            ImpactStat(
                modifier = Modifier.weight(1f),
                value = "${prefs.number(sleep.sentryExtraDrainRate)}$PERCENT_UNIT",
                label = stringResource(R.string.translation_sleep_extraDrainHr),
                color = TeslaTokens.status.warning,
            )
            ImpactStat(
                modifier = Modifier.weight(1f),
                value = "${prefs.number(sleep.sentryExtraMonthlyKwh)} $ENERGY_UNIT",
                label = stringResource(R.string.translation_sleep_extraMonthly),
                color = TeslaTokens.status.warning,
            )
            ImpactStat(
                modifier = Modifier.weight(1f),
                value = prefs.currency(sleep.sentryExtraMonthlyCost),
                label = stringResource(R.string.translation_sleep_extraCostMo),
                color = TeslaTokens.status.danger,
            )
        }
    }
}

/** One centered impact figure — a colored bold value over a muted caption label. */
@Composable
private fun ImpactStat(
    value: String,
    label: String,
    color: Color,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Text(
            text = value,
            style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
            color = color,
        )
        Caption(label)
    }
}

// ── Panel 8 — Recent drain events table ─────────────────────────────────────────────────────────────────────────

/** GlassPanel8 — the recent-drain-events table: per-event date / duration / loss / rate / sentry / temp, or the empty. */
@Composable
private fun RecentDrainEventsPanel(
    events: List<SleepDrainEventRow>,
    prefs: SleepDisplayPrefs,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Icon(SleepGlyphs.Bolt, contentDescription = null, tint = TeslaTokens.chart.energy, size = IconSize.Sm)
            SectionTitle(stringResource(R.string.translation_sleep_recentDrainEvents))
        }
        Spacer(Modifier.height(Spacing.md))
        if (events.isNotEmpty()) {
            DataTable(
                columns = drainColumns(prefs),
                rows = events,
                keyOf = { it.id },
                emptyText = stringResource(R.string.translation_sleep_noDrainEvents),
            )
        } else {
            EmptyState(message = stringResource(R.string.translation_sleep_noDrainEvents))
        }
    }
}

/** The recent-drain-events table columns (web `drainColumns`): date / duration / battery-lost / drain-rate / sentry / temp. */
@Composable
private fun drainColumns(prefs: SleepDisplayPrefs): List<TableColumn<SleepDrainEventRow>> {
    val dangerColor = TeslaTokens.status.danger
    val successColor = TeslaTokens.status.success
    return listOf(
        TableColumn(
            key = "date",
            header = stringResource(R.string.translation_sleep_date),
            weight = 1.4f,
            cell = { event ->
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
                    Caption(eventDateLabel(event.startDate))
                    val time = eventTimeLabel(event.startDate)
                    if (time.isNotEmpty()) {
                        Text(
                            text = time,
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            },
        ),
        TableColumn(
            key = "duration",
            header = stringResource(R.string.translation_sleep_duration),
            cell = { event -> Caption("${prefs.number(event.durationHours)}$HOURS_UNIT") },
        ),
        TableColumn(
            key = "batteryLost",
            header = stringResource(R.string.translation_sleep_batteryLost),
            cell = { event -> CellText("${prefs.number(event.batteryLost)}$PERCENT_UNIT", dangerColor) },
        ),
        TableColumn(
            key = "drainRate",
            header = stringResource(R.string.translation_sleep_drainRateCol),
            cell = { event ->
                CellText(
                    text = "${prefs.number(event.drainRate)}$PER_HOUR_UNIT",
                    color = if (event.drainRate > DRAIN_RATE_DANGER) dangerColor else successColor,
                )
            },
        ),
        TableColumn(
            key = "sentry",
            header = stringResource(R.string.translation_sleep_sentry),
            cell = { event -> SentryBadge(event.sentryMode) },
        ),
        TableColumn(
            key = "temp",
            header = stringResource(R.string.translation_sleep_temp),
            cell = { event -> TempCell(event.outsideTempC, prefs) },
        ),
    )
}

/** The sentry-mode cell — a warning Eye badge for On (web `common.on`), an info Moon badge for Off (web `common.off`). */
@Composable
private fun SentryBadge(sentryMode: Boolean) {
    if (sentryMode) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Icon(SleepGlyphs.Eye, contentDescription = null, tint = TeslaTokens.status.warning, size = IconSize.Xs)
            Badge(text = stringResource(R.string.translation_common_on), variant = BadgeVariant.Warning)
        }
    } else {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Icon(SleepGlyphs.Moon, contentDescription = null, tint = TeslaTokens.status.info, size = IconSize.Xs)
            Badge(text = stringResource(R.string.translation_common_off), variant = BadgeVariant.Info)
        }
    }
}

/** The outside-temperature cell — a thermometer + the SI-Celsius value converted to the user's unit, or an em dash. */
@Composable
private fun TempCell(
    outsideTempC: Double?,
    prefs: SleepDisplayPrefs,
) {
    if (outsideTempC != null) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Icon(
                SleepGlyphs.Thermometer,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                size = IconSize.Xs,
            )
            Caption("${prefs.number(prefs.fromCelsius(outsideTempC))}${prefs.temperatureLabel}")
        }
    } else {
        Caption(EM_DASH)
    }
}

/** A small colored table cell text (web semantic-colored span). */
@Composable
private fun CellText(
    text: String,
    color: Color,
) {
    Text(text = text, style = MaterialTheme.typography.bodySmall, color = color)
}

/** A two-up metric row (the phone-width grid cell the web `grid-cols-2 lg:grid-cols-4` collapses to). */
@Composable
private fun MetricRow(content: @Composable RowScope.() -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        content = content,
    )
}
