// The native Jetpack Compose + Material 3 analytics MileagePage surface — a parity port of
// web/src/features/analytics/pages/MileagePage.tsx, the daily/monthly distance tracker. It reproduces the
// page's panels (the four summary metric cards, the Odometer-Over-Time area chart, the Daily-Distance bar
// chart, and the Monthly-Summary table), every data state (loading / empty / error / content), and every
// visible string (resolved from the generated res/values catalog, ADR-014). Distances stay SI on the wire
// and are converted to the user's unit only at this render boundary (Phase-48 SI-canonical rule; the live
// `UnitFormatter` from `LocalDataContainer`).
//
// Composition: [MileagePage] is the stateful entry (constructs the view-model over the host-wired source +
// the app-scoped vehicle selection, records the one-shot `view.opened` diagnostic, collects the feed +
// the live unit preference); [MileagePageContent] is the stateless render layer driven entirely by
// [UiState] + the resolved [MileageDisplay]. All derivation lives in the framework-free model
// (MileagePageModel.kt); this file only resolves i18n + draws.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics)
// diverges from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions", "LongMethod", "MatchingDeclarationName")

package io.teslasync.android.analytics.mileage

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.core.os.ConfigurationCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.AreaChartWrapper
import io.teslasync.android.components.charts.BarChartWrapper
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.BannerAction
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.UnitPref
import java.util.Locale

/** The page's interaction callbacks, wired to the [MileagePageViewModel] (web query refetch / retry). */
data class MileageActions(
    val onRetry: () -> Unit,
    val onRefresh: () -> Unit,
)

private const val FADE_STEP_MS = 100
private val CHART_HEIGHT = 280.dp
private val LOADING_MIN_HEIGHT = 240.dp
private const val Y_AXIS_DECIMALS = 0
private const val SERIES_ODOMETER = "odometer"
private const val SERIES_DAILY = "distance"
private const val COL_DISTANCE_WEIGHT = 1.4f
private const val COL_DRIVES_WEIGHT = 0.8f

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [MileagePageViewModel] over the supplied [source] (the host wires the
 * shared Vehicles + Analytics holders via [mileageSource]) and the app-scoped [selection]. [logger] defaults
 * to the app's redacting logger.
 */
@Composable
fun MileagePage(
    source: MileageSource,
    modifier: Modifier = Modifier,
    selection: SelectedVehicleStore = LocalDataContainer.current.selectedVehicleStore,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: MileagePageViewModel =
        viewModel(
            key = MileagePageRegistration.SLUG,
            factory = viewModelFactory { initializer { MileagePageViewModel(source, selection, logger) } },
        )
    MileagePage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] feed + the live unit preference to the stateless content. */
@Composable
fun MileagePage(
    viewModel: MileagePageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()

    val actions =
        remember(viewModel) {
            MileageActions(onRetry = viewModel::retry, onRefresh = viewModel::refresh)
        }

    MileagePageContent(state = state, prefs = formatter.prefs, actions = actions, modifier = modifier)
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/** The stateless page body: the header, the optional error banner, the metric cards, the charts, the table. */
@Composable
fun MileagePageContent(
    state: UiState<MileageData>,
    prefs: UnitPref,
    actions: MileageActions,
    modifier: Modifier = Modifier,
    locale: Locale = currentLocale(),
) {
    val strings = rememberMileageStrings()

    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        MileageHeader(state = state, strings = strings)

        if (state.hasError) {
            AlertBanner(
                message = strings.loadFailed,
                tone = Tone.Danger,
                icon = MileageGlyphs.AlertCircle,
                action = BannerAction(strings.retry, actions.onRetry),
            )
        }

        when {
            state.isLoading -> MileageLoading()
            state.data == null || state.isEmpty ->
                EmptyState(message = strings.noEntries, icon = MileageGlyphs.BarChart3, modifier = Modifier.fillMaxWidth())

            else -> {
                val data = state.data
                val display =
                    remember(data, prefs, strings, locale) {
                        MileageProjection.project(data, prefs, strings, locale)
                    }
                FadeIn { MileageMetrics(display) }
                FadeIn(delayMs = FADE_STEP_MS) { OdometerPanel(display = display, strings = strings, locale = locale) }
                FadeIn(delayMs = FADE_STEP_MS * 2) { DailyDistancePanel(display = display, strings = strings, locale = locale) }
                FadeIn(delayMs = FADE_STEP_MS * 3) { MonthlySummaryPanel(display = display, strings = strings) }
            }
        }
    }
}

@Composable
private fun MileageHeader(
    state: UiState<MileageData>,
    strings: MileageStrings,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Top,
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            PageTitle(strings.title)
            BodyText(strings.subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
        )
    }
}

@Composable
private fun MileageLoading() {
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = LOADING_MIN_HEIGHT)
                .semantics { contentDescription = loadingLabel },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Spinner(size = SpinnerSize.Lg, accessibleLabel = loadingLabel)
    }
}

// ── Summary metric cards (Total-Distance / Total-Drives / Daily-Avg-30d / Annual-Projection) ────────────────

@Composable
private fun MileageMetrics(display: MileageDisplay) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        display.metrics.chunked(2).forEach { rowMetrics ->
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), modifier = Modifier.fillMaxWidth()) {
                rowMetrics.forEach { metric ->
                    MetricCard(
                        label = metric.label,
                        value = metric.value,
                        modifier = Modifier.weight(1f),
                        icon = metricIcon(metric.icon),
                        accent = accentColor(metric.accent),
                    )
                }
                if (rowMetrics.size == 1) {
                    Spacer(modifier = Modifier.weight(1f))
                }
            }
        }
    }
}

// ── Odometer Over Time (GlassPanel5, AreaChart) ─────────────────────────────────────────────────────────────

@Composable
private fun OdometerPanel(
    display: MileageDisplay,
    strings: MileageStrings,
    locale: Locale,
) {
    GlassPanel(padding = PanelPadding.Md) {
        PanelTitle(strings.odometerOverTime)
        if (!display.hasOdometer) {
            EmptyState(message = strings.noEntries, modifier = Modifier.fillMaxWidth())
        } else {
            val labels = remember(display.odometer) { display.odometer.map { it.label } }
            val series =
                remember(display.odometer, display.odometerSeriesLabel) {
                    listOf(
                        ChartSeries(
                            key = SERIES_ODOMETER,
                            label = display.odometerSeriesLabel,
                            values = display.odometer.map { it.value },
                            kind = ChartSeriesKind.Area,
                            unit = display.distanceUnit,
                        ),
                    )
                }
            AreaChartWrapper(
                series = series,
                xLabels = labels,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(top = Spacing.sm)
                        .semantics { contentDescription = display.odometerSeriesLabel },
                height = CHART_HEIGHT,
                yValueFormatter = { ChartFormat.number(it, Y_AXIS_DECIMALS, locale) },
                emptyMessage = strings.noEntries,
            )
        }
    }
}

// ── Daily Distance (GlassPanel6, BarChart) ──────────────────────────────────────────────────────────────────

@Composable
private fun DailyDistancePanel(
    display: MileageDisplay,
    strings: MileageStrings,
    locale: Locale,
) {
    GlassPanel(padding = PanelPadding.Md) {
        PanelTitle(strings.dailyDistance)
        if (!display.hasDaily) {
            EmptyState(message = strings.noEntries, modifier = Modifier.fillMaxWidth())
        } else {
            val labels = remember(display.daily) { display.daily.map { it.label } }
            val series =
                remember(display.daily, display.dailySeriesLabel) {
                    listOf(
                        ChartSeries(
                            key = SERIES_DAILY,
                            label = display.dailySeriesLabel,
                            values = display.daily.map { it.value },
                            kind = ChartSeriesKind.Bar,
                            unit = display.distanceUnit,
                        ),
                    )
                }
            BarChartWrapper(
                series = series,
                xLabels = labels,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(top = Spacing.sm)
                        .semantics { contentDescription = display.dailySeriesLabel },
                height = CHART_HEIGHT,
                yValueFormatter = { ChartFormat.number(it, Y_AXIS_DECIMALS, locale) },
                emptyMessage = strings.noEntries,
            )
        }
    }
}

// ── Monthly Summary (GlassPanel7, table) ────────────────────────────────────────────────────────────────────

@Composable
private fun MonthlySummaryPanel(
    display: MileageDisplay,
    strings: MileageStrings,
) {
    val unit = display.distanceUnit
    val columns =
        remember(strings, unit) {
            listOf(
                TableColumn<MonthlySummaryRow>(
                    key = "month",
                    header = strings.month,
                    cell = { row -> BodyText(row.month) },
                ),
                TableColumn(
                    key = "distance",
                    header = "${strings.distance} ($unit)",
                    weight = COL_DISTANCE_WEIGHT,
                    alignEnd = true,
                    cell = { row -> BodyText(row.distance) },
                ),
                TableColumn(
                    key = "drives",
                    header = strings.drives,
                    weight = COL_DRIVES_WEIGHT,
                    alignEnd = true,
                    cell = { row -> BodyText(row.drives) },
                ),
                TableColumn(
                    key = "distancePerDrive",
                    header = "${strings.distancePerDrive} ($unit)",
                    weight = COL_DISTANCE_WEIGHT,
                    alignEnd = true,
                    cell = { row -> BodyText(row.distancePerDrive) },
                ),
            )
        }
    GlassPanel(padding = PanelPadding.Md) {
        PanelTitle(strings.monthlySummary)
        DataTable(
            columns = columns,
            rows = display.monthly,
            keyOf = { it.month },
            modifier = Modifier.padding(top = Spacing.sm),
            emptyText = strings.noEntries,
        )
    }
}

// ── i18n + theme resolution ─────────────────────────────────────────────────────────────────────────────────

/** Resolves every visible literal through the generated catalog (P1/S10) — the web `t(...)` keys (ADR-014). */
@Composable
private fun rememberMileageStrings(): MileageStrings {
    val title = stringResource(R.string.translation_mileage_title)
    val subtitle = stringResource(R.string.translation_mileage_subtitle)
    val totalDistance = stringResource(R.string.translation_mileage_totalDistance)
    val totalDrives = stringResource(R.string.translation_mileage_totalDrives)
    val dailyAvg = stringResource(R.string.translation_mileage_dailyAvg)
    val annualProjection = stringResource(R.string.translation_mileage_annualProjection)
    val odometerOverTime = stringResource(R.string.translation_Odometer_Over_Time)
    val odometer = stringResource(R.string.translation_Odometer)
    val dailyDistance = stringResource(R.string.translation_Daily_Distance)
    val distance = stringResource(R.string.translation_Distance)
    val monthlySummary = stringResource(R.string.translation_Monthly_Summary)
    val month = stringResource(R.string.translation_Month)
    val drives = stringResource(R.string.translation_Drives)
    val distancePerDrive = stringResource(R.string.translation_Distance_per_Drive)
    val noEntries = stringResource(R.string.translation_No_Entries)
    val loadFailed = stringResource(R.string.translation_error_loadFailed)
    val retry = stringResource(R.string.translation_error_retry)
    return remember(
        title,
        subtitle,
        totalDistance,
        totalDrives,
        dailyAvg,
        annualProjection,
        odometerOverTime,
        odometer,
        dailyDistance,
        distance,
        monthlySummary,
        month,
        drives,
        distancePerDrive,
        noEntries,
        loadFailed,
        retry,
    ) {
        MileageStrings(
            title = title,
            subtitle = subtitle,
            totalDistance = totalDistance,
            totalDrives = totalDrives,
            dailyAvg = dailyAvg,
            annualProjection = annualProjection,
            odometerOverTime = odometerOverTime,
            odometer = odometer,
            dailyDistance = dailyDistance,
            distance = distance,
            monthlySummary = monthlySummary,
            month = month,
            drives = drives,
            distancePerDrive = distancePerDrive,
            noEntries = noEntries,
            loadFailed = loadFailed,
            retry = retry,
        )
    }
}

/** Maps a model [MileageMetricIcon] to its authored vector glyph. */
private fun metricIcon(icon: MileageMetricIcon): ImageVector =
    when (icon) {
        MileageMetricIcon.Gauge -> MileageGlyphs.Gauge
        MileageMetricIcon.TrendingUp -> MileageGlyphs.TrendingUp
        MileageMetricIcon.Calendar -> MileageGlyphs.Calendar
        MileageMetricIcon.BarChart -> MileageGlyphs.BarChart3
    }

/** Maps a model [MileageMetricAccent] to a theme color so light/dark + dynamic color stay honored (ADR-005). */
@Composable
private fun accentColor(accent: MileageMetricAccent): Color =
    when (accent) {
        MileageMetricAccent.Cyan -> MaterialTheme.colorScheme.primary
        MileageMetricAccent.Green -> TeslaTokens.status.success
        MileageMetricAccent.Purple -> MaterialTheme.colorScheme.tertiary
    }

/** The active configuration locale, used for number/date grouping (web `Intl` locale). */
@Composable
private fun currentLocale(): Locale = ConfigurationCompat.getLocales(LocalConfiguration.current).get(0) ?: Locale.US
