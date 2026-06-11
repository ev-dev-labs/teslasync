// Hosts the ChargingSessionDetail Compose surface (stateful entry + stateless renderer + per-state
// previews) — a parity port of web/src/features/dashboard/widgets/ChargingSessionDetailWidget.tsx. It
// mirrors the web `WidgetShell` (skeleton while loading, a retry surface on hard error, otherwise a
// title + lightning icon + freshness header) wrapping either the compact big-kWh hero (1×N) or — when
// wider — the `WidgetChartSummary` (a 2-column summary-stat grid above the power/SoC charge curve) or a
// friendly empty state. All data flows through the shared [ChargingSessionDetailWidgetViewModel]; the
// view never performs HTTP. Every string resolves through the i18n catalog (P1/S10) and every
// interactive element carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/ChargingSessionDetailWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.chargingsessiondetail

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ComboChart
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Card
import io.teslasync.android.components.ui.CardPadding
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.ChargeTelemetryReading
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.diagnostics.Logger
import java.time.ZoneId
import kotlin.time.Instant

private const val LOADING_BAR_COUNT = 3
private val CHART_HEIGHT = 140.dp
private val BODY_MIN_HEIGHT = 148.dp

/**
 * Stateful entry point. Binds the shared session-detail feed via [source] into a
 * [ChargingSessionDetailWidgetViewModel], records the one-shot `view.opened` diagnostic, and renders the
 * surface for the given [size]. A dashboard host supplies [source] (the [chargingSessionDetailSource]
 * adapter over the shared S8 Vehicles + Charging holders) and a unique [instanceKey] per placement.
 *
 * @param source the cache-then-network session-detail seam.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ChargingSessionDetailWidget(
    source: ChargingSessionDetailSource,
    modifier: Modifier = Modifier,
    size: ChargingSessionDetailSize = ChargingSessionDetailRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = ChargingSessionDetailRegistration.ID,
) {
    val viewModel: ChargingSessionDetailWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { ChargingSessionDetailWidgetViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    ChargingSessionDetailWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the title +
 * freshness header over the compact hero / standard summary+chart body. [zone] is injectable for
 * deterministic `HH:mm` rendering in tests.
 */
@Composable
fun ChargingSessionDetailWidgetContent(
    state: UiState<ChargingSessionDetailSnapshot>,
    size: ChargingSessionDetailSize,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit = {},
    onRetry: () -> Unit = {},
    zone: ZoneId = ZoneId.systemDefault(),
) {
    val strings = rememberChargingSessionDetailStrings()
    Card(modifier = modifier.fillMaxWidth(), padding = CardPadding.None) {
        WidgetHeader(state = state, onRefresh = onRefresh)
        Box(modifier = Modifier.fillMaxWidth().heightIn(min = BODY_MIN_HEIGHT)) {
            when {
                state.isLoading -> LoadingChrome()
                state.isError -> ErrorChrome(state = state, onRetry = onRetry)
                else -> {
                    val display =
                        remember(state.data, size, strings, zone) {
                            ChargingSessionDetailProjection.project(
                                snapshot = state.data ?: ChargingSessionDetailSnapshot(detail = null),
                                size = size,
                                strings = strings,
                                zone = zone,
                            )
                        }
                    LoadedBody(display = display)
                }
            }
        }
    }
}

@Composable
private fun WidgetHeader(
    state: UiState<ChargingSessionDetailSnapshot>,
    onRefresh: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(start = Spacing.md, end = Spacing.xs, top = Spacing.sm, bottom = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            imageVector = FeedbackGlyphs.Bolt,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.primary,
        )
        PanelTitle(
            text = stringResource(R.string.translation_widget_chargingSessionDetail_title),
            modifier = Modifier.weight(1f).semantics { heading() },
        )
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRefresh,
            enabled = !state.refreshing,
            size = IconSize.Sm,
        )
    }
}

@Composable
private fun LoadedBody(display: ChargingSessionDetailDisplay) {
    Column(
        modifier = Modifier.fillMaxSize().padding(horizontal = Spacing.md, vertical = Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        when {
            !display.hasData -> ChargingEmpty()
            display.isCompact -> CompactHero(display = display)
            else -> StandardBody(display = display)
        }
    }
}

@Composable
private fun CompactHero(display: ChargingSessionDetailDisplay) {
    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .clearAndSetSemantics { contentDescription = display.compactContentDescription },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs, Alignment.CenterVertically),
    ) {
        MetricValue(display.compactEnergyText)
        MetricLabel(display.compactUnitLabel)
        Badge(text = display.chargerLabel, variant = chargerBadgeVariant(display.charger))
    }
}

@Composable
private fun StandardBody(display: ChargingSessionDetailDisplay) {
    StatsGrid(stats = display.stats)
    ChargeCurve(chart = display.chart, contentDescription = display.chartContentDescription)
}

@Composable
private fun StatsGrid(stats: List<ChargingSessionDetailStat>) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        stats.chunked(STATS_PER_ROW).forEach { rowStats ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            ) {
                rowStats.forEach { stat -> StatCell(stat = stat, modifier = Modifier.weight(1f)) }
                if (rowStats.size < STATS_PER_ROW) {
                    Spacer(modifier = Modifier.weight((STATS_PER_ROW - rowStats.size).toFloat()))
                }
            }
        }
    }
}

@Composable
private fun StatCell(
    stat: ChargingSessionDetailStat,
    modifier: Modifier = Modifier,
) {
    val description = stat.unit?.let { "${stat.label}: ${stat.value} $it" } ?: "${stat.label}: ${stat.value}"
    Column(modifier = modifier.semantics(mergeDescendants = true) { contentDescription = description }) {
        Caption(stat.label)
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            BodyText(stat.value, maxLines = 1)
            stat.unit?.let { Caption(it) }
        }
    }
}

@Composable
private fun ChargeCurve(
    chart: ChargeCurveChart,
    contentDescription: String,
) {
    if (!chart.hasPoints) {
        Box(
            modifier = Modifier.fillMaxWidth().heightIn(min = CHART_HEIGHT),
            contentAlignment = Alignment.Center,
        ) {
            Caption(stringResource(R.string.translation_common_noData))
        }
        return
    }
    val powerColor = TeslaTokens.status.success
    val socColor = TeslaTokens.status.info
    val series =
        remember(chart, powerColor, socColor) {
            listOf(
                ChartSeries(
                    key = "power",
                    label = chart.powerSeriesName,
                    values = chart.points.map { it.powerKw },
                    kind = ChartSeriesKind.Area,
                    color = powerColor,
                ),
                ChartSeries(
                    key = "soc",
                    label = chart.socSeriesName,
                    values = chart.points.map { it.socPlotted },
                    kind = ChartSeriesKind.Line,
                    color = socColor,
                ),
            )
        }
    val labels = remember(chart) { chart.points.map { it.timeLabel } }
    Box(modifier = Modifier.fillMaxWidth().semantics { this.contentDescription = contentDescription }) {
        ComboChart(
            series = series,
            xLabels = labels,
            height = CHART_HEIGHT,
            yValueFormatter = { ChartFormat.number(it, decimals = 0) },
        )
    }
}

@Composable
private fun ChargingEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_widget_chargingSessionDetail_empty),
        icon = FeedbackGlyphs.Bolt,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun LoadingChrome() {
    val label = stringResource(R.string.translation_common_loading)
    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .padding(horizontal = Spacing.md, vertical = Spacing.sm)
                .semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        repeat(LOADING_BAR_COUNT) { Skeleton(height = Spacing.lg, rounded = true) }
    }
}

@Composable
private fun ErrorChrome(
    state: UiState<ChargingSessionDetailSnapshot>,
    onRetry: () -> Unit,
) {
    Box(
        modifier = Modifier.fillMaxSize().padding(Spacing.md),
        contentAlignment = Alignment.Center,
    ) {
        QueryError(kind = queryErrorKindOf(state), onRetry = onRetry)
    }
}

private fun chargerBadgeVariant(charger: ChargerKind): BadgeVariant =
    when (charger) {
        ChargerKind.AcHome -> BadgeVariant.Neutral
        ChargerKind.Supercharger, ChargerKind.DcFast -> BadgeVariant.Warning
    }

/**
 * Folds an [UiState] hard failure onto a [QueryErrorKind] for the [QueryError] surface: an
 * [ErrorKind.Network]/[ErrorKind.Timeout] is treated as offline, [ErrorKind.CircuitOpen] as transient
 * back-pressure, and an HTTP status selects the not-found / unauthorized / server bucket.
 */
private fun queryErrorKindOf(state: UiState<ChargingSessionDetailSnapshot>): QueryErrorKind =
    classifyQueryError(
        status = state.httpStatus,
        online = state.errorKind != ErrorKind.Network && state.errorKind != ErrorKind.Timeout,
        transientWaiting = state.errorKind == ErrorKind.CircuitOpen,
    )

/**
 * Builds the localized [ChargingSessionDetailStrings] from the i18n catalog (P1/S10). The charger labels
 * reuse existing catalog keys so the web's hardcoded `classifyCharger` labels are localized natively.
 */
@Composable
private fun rememberChargingSessionDetailStrings(): ChargingSessionDetailStrings {
    val energy = stringResource(R.string.translation_widget_chargingSessionDetail_energy)
    val duration = stringResource(R.string.translation_widget_chargingSessionDetail_duration)
    val peakPower = stringResource(R.string.translation_widget_chargingSessionDetail_peakPower)
    val charger = stringResource(R.string.translation_widget_chargingSessionDetail_charger)
    val powerSeries = stringResource(R.string.translation_widget_chargingSessionDetail_powerKw)
    val socSeries = stringResource(R.string.translation_widget_chargingSessionDetail_soc)
    val unitKwh = stringResource(R.string.translation_widget_chargingSessionDetail_unitKwh)
    val acHome = stringResource(R.string.translation_charging_curve_acHome)
    val supercharger = stringResource(R.string.translation_Supercharger)
    val dcFast = stringResource(R.string.translation_charging_curve_dcFast)
    return remember(energy, duration, peakPower, charger, powerSeries, socSeries, unitKwh, acHome, supercharger, dcFast) {
        ChargingSessionDetailStrings(
            energy = energy,
            duration = duration,
            peakPower = peakPower,
            charger = charger,
            powerSeries = powerSeries,
            socSeries = socSeries,
            unitKwh = unitKwh,
            chargerAcHome = acHome,
            chargerSupercharger = supercharger,
            chargerDcFast = dcFast,
        )
    }
}

private const val STATS_PER_ROW = 2

// ── Previews — one per rendered state (loading / empty / content / compact / error / offline) ──────────

private const val SAMPLE_ENERGY_WH = 32_500.0
private const val SAMPLE_PEAK_W = 120_000.0
private const val SAMPLE_START_SOC = 20.0
private const val SAMPLE_END_SOC = 80.0

private fun sampleSession(): ChargingSession =
    ChargingSession(
        id = 1,
        startedAt = Instant.parse("2024-01-01T10:00:00Z"),
        vehicleId = 1,
        chargerType = "Supercharger",
        endedAt = Instant.parse("2024-01-01T10:45:00Z"),
        totalEnergyAddedWh = SAMPLE_ENERGY_WH,
        peakPowerW = SAMPLE_PEAK_W,
        startSocPct = SAMPLE_START_SOC,
        endSocPct = SAMPLE_END_SOC,
    )

private fun sampleTelemetry(): List<ChargeTelemetryReading> =
    listOf(
        "2024-01-01T10:00:00Z" to 110_000.0,
        "2024-01-01T10:15:00Z" to 120_000.0,
        "2024-01-01T10:30:00Z" to 70_000.0,
        "2024-01-01T10:45:00Z" to 20_000.0,
    ).map { (ts, watts) ->
        ChargeTelemetryReading(ts = Instant.parse(ts), vehicleId = 1, dcChargingPowerW = watts)
    }

private fun sampleSnapshot(): ChargingSessionDetailSnapshot =
    ChargingSessionDetailSnapshot(detail = sampleSession(), telemetry = sampleTelemetry())

@Preview(name = "ChargingSessionDetail · content", showBackground = true)
@Composable
private fun ChargingSessionDetailContentPreview() {
    TeslaSyncTheme {
        ChargingSessionDetailWidgetContent(
            state = UiState(phase = UiPhase.Content, data = sampleSnapshot(), fetchedAt = System.currentTimeMillis()),
            size = ChargingSessionDetailRegistration.defaultSize,
            zone = ZoneId.of("UTC"),
        )
    }
}

@Preview(name = "ChargingSessionDetail · compact", showBackground = true)
@Composable
private fun ChargingSessionDetailCompactPreview() {
    TeslaSyncTheme {
        ChargingSessionDetailWidgetContent(
            state = UiState(phase = UiPhase.Content, data = sampleSnapshot(), fetchedAt = System.currentTimeMillis()),
            size = ChargingSessionDetailSize(cols = 1, rows = 2),
            zone = ZoneId.of("UTC"),
        )
    }
}

@Preview(name = "ChargingSessionDetail · empty", showBackground = true)
@Composable
private fun ChargingSessionDetailEmptyPreview() {
    TeslaSyncTheme {
        ChargingSessionDetailWidgetContent(
            state = UiState(phase = UiPhase.Empty, data = ChargingSessionDetailSnapshot(detail = null), fetchedAt = 0L),
            size = ChargingSessionDetailRegistration.defaultSize,
            zone = ZoneId.of("UTC"),
        )
    }
}

@Preview(name = "ChargingSessionDetail · loading", showBackground = true)
@Composable
private fun ChargingSessionDetailLoadingPreview() {
    TeslaSyncTheme {
        ChargingSessionDetailWidgetContent(
            state = UiState.loading(),
            size = ChargingSessionDetailRegistration.defaultSize,
        )
    }
}

@Preview(name = "ChargingSessionDetail · error", showBackground = true)
@Composable
private fun ChargingSessionDetailErrorPreview() {
    TeslaSyncTheme {
        ChargingSessionDetailWidgetContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            size = ChargingSessionDetailRegistration.defaultSize,
        )
    }
}

@Preview(name = "ChargingSessionDetail · offline", showBackground = true)
@Composable
private fun ChargingSessionDetailOfflinePreview() {
    TeslaSyncTheme {
        ChargingSessionDetailWidgetContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = sampleSnapshot(),
                    fetchedAt = System.currentTimeMillis(),
                    stale = true,
                    errorKind = ErrorKind.Network,
                ),
            size = ChargingSessionDetailRegistration.defaultSize,
            zone = ZoneId.of("UTC"),
        )
    }
}
