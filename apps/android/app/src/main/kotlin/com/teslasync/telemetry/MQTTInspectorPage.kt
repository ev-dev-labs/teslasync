// The native Jetpack Compose + Material 3 MQTTInspectorPage telemetry surface — a parity port of
// web/src/features/telemetry/pages/MQTTInspectorPage.tsx, the MQTT connection-status + streaming-telemetry monitor.
// It reproduces the page chrome (title + subtitle + the refresh cadence note + the connected/disconnected status
// badge), the optional fetch-error banner (web GlassPanel1), the four KPI StatCards (Streaming Vehicles / Total
// Signals / Total Batches / Signals-per-second), the connection-info panel (web GlassPanel6 — broker / uptime /
// topic patterns), the client-accumulated throughput chart (web GlassPanel7), and the per-vehicle breakdown table
// (web GlassPanel8) — every data state (loading skeleton / empty / error-retry / content, plus the cache-then-network
// stale/offline tier the bound state holder carries) and every visible string (resolved from the generated
// res/values catalog, ADR-014).
//
// Composition: [MQTTInspectorPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the status feed + the throughput series);
// [MQTTInspectorPageContent] is the stateless render layer. The single bound [MQTTInspectorPageViewModel.state] —
// `UiState<TelemetryStatus>`, the projection of the web `useMQTTStatus` read — drives the chrome + the panels, and
// [MQTTInspectorPageViewModel.throughput] (the native `throughputHistory`) drives the chart, exactly as the web page
// threads its one query + its accumulated history through its panels.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/telemetry) diverges from
// the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.telemetry.mqttinspector

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.AreaChartWrapper
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.SkeletonLines
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.telemetry.TelemetryStatus

/** Stagger between body panels' entrance fades (web `FadeIn delay` increments). */
private const val FADE_STEP_MS = 50

/** The throughput chart height — the web `ResponsiveContainer height={200}`. */
private val THROUGHPUT_CHART_HEIGHT = 200.dp

/** Number of loading-skeleton rows in the vehicle breakdown — the web `Array.from({ length: 3 })`. */
private const val VEHICLE_SKELETON_ROWS = 3

private val VEHICLE_SKELETON_HEIGHT = 48.dp

/** The page's interaction callbacks, wired to the [MQTTInspectorPageViewModel] (web query `refetch` retry). */
data class MqttInspectorActions(
    val onRetry: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [MQTTInspectorPageViewModel] over the supplied [source] (the host wires the shared
 * telemetry repository via [mqttInspectorPageSourceOf]). [logger] defaults to the app's redacting logger.
 */
@Composable
fun MQTTInspectorPage(
    source: MQTTInspectorPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: MQTTInspectorPageViewModel =
        viewModel(
            key = MqttInspectorPageRegistration.SLUG,
            factory = viewModelFactory { initializer { MQTTInspectorPageViewModel(source, logger) } },
        )
    MQTTInspectorPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] status feed + throughput series + interaction callbacks to the content. */
@Composable
fun MQTTInspectorPage(
    viewModel: MQTTInspectorPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val throughput by viewModel.throughput.collectAsStateWithLifecycle()
    val actions = remember(viewModel) { MqttInspectorActions(onRetry = viewModel::retry) }

    MQTTInspectorPageContent(state = state, throughput = throughput, actions = actions, modifier = modifier)
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body — the chrome (title + subtitle + refresh note + connectivity badge), the optional
 * fetch-error banner, the four KPI tiles, and the three always-visible panels (connection info / throughput chart /
 * vehicle breakdown). Each panel renders the full state matrix internally (loading / hard-error retry / content /
 * friendly empty state) so no region ever collapses to a blank box (ADR-011).
 */
@Composable
fun MQTTInspectorPageContent(
    state: UiState<TelemetryStatus>,
    throughput: List<ThroughputPoint>,
    actions: MqttInspectorActions,
    modifier: Modifier = Modifier,
) {
    val status = state.data
    val totals = mqttTotals(status)
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        MqttHeader(connected = status?.connected == true)

        if (state.hasError && !state.hasData) {
            FadeIn { MqttErrorBanner() }
        }

        FadeIn(delayMs = FADE_STEP_MS) { MqttSummaryCards(state = state, totals = totals) }
        FadeIn(delayMs = FADE_STEP_MS * 2) { MqttConnectionPanel(state = state, status = status, onRetry = actions.onRetry) }
        FadeIn(delayMs = FADE_STEP_MS * 3) { MqttThroughputPanel(points = throughput) }
        FadeIn(delayMs = FADE_STEP_MS * 4) { MqttVehicleBreakdownPanel(state = state, status = status, onRetry = actions.onRetry) }
    }
}

/** The page chrome — title + muted subtitle (web `PageContainer`), the refresh-cadence note + connectivity badge. */
@Composable
private fun MqttHeader(connected: Boolean) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PageTitle(stringResource(R.string.translation_mqtt_title))
            BodyText(
                stringResource(R.string.translation_mqtt_subtitle),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md, Alignment.Start),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(
                modifier = Modifier.weight(1f),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Icon(
                    MqttInspectorGlyphs.RefreshCw,
                    contentDescription = null,
                    size = IconSize.Sm,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                HelperText(stringResource(R.string.translation_mqtt_refreshInterval))
            }
            MqttConnectivityBadge(connected = connected)
        }
    }
}

/** The connectivity chip — web `Badge variant={connected ? 'success' : 'danger'}` with a Wifi/WifiOff glyph. */
@Composable
private fun MqttConnectivityBadge(connected: Boolean) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            if (connected) MqttInspectorGlyphs.Wifi else MqttInspectorGlyphs.WifiOff,
            contentDescription = null,
            size = IconSize.Sm,
            tint = if (connected) TeslaTokens.status.success else TeslaTokens.status.danger,
        )
        Badge(
            text =
                if (connected) {
                    stringResource(R.string.translation_mqtt_connected)
                } else {
                    stringResource(R.string.translation_mqtt_disconnected)
                },
            variant = if (connected) BadgeVariant.Success else BadgeVariant.Danger,
            dot = true,
        )
    }
}

/** GlassPanel1 — the fetch-error banner (web `error && !status`): an alert glyph + the localized failure copy. */
@Composable
private fun MqttErrorBanner() {
    GlassPanel(
        accent = PanelAccent.Danger,
        padding = PanelPadding.Md,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Icon(
                MqttInspectorGlyphs.AlertTriangle,
                contentDescription = null,
                size = IconSize.Md,
                tint = TeslaTokens.status.danger,
            )
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                BodyText(
                    stringResource(R.string.translation_mqtt_fetchError),
                    color = TeslaTokens.status.danger,
                )
                HelperText(stringResource(R.string.translation_error_serverError_message))
            }
        }
    }
}

/**
 * The four summary KPIs (web `<Grid cols={{ default: 2, sm: 4 }}>`), laid out 2×2 for a phone. Each tile shows its
 * figure (`'—'` while the first load is in flight, matching the web `isLoading ? '—' : value`): streaming vehicles
 * (raw count), total signals + batches (`fmtInt`), and the aggregate signals-per-second (`fmtNumber`).
 */
@Composable
private fun MqttSummaryCards(
    state: UiState<TelemetryStatus>,
    totals: MqttTotals,
) {
    val loading = state.isLoading
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), modifier = Modifier.fillMaxWidth()) {
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_mqtt_streamingVehicles),
                value = if (loading) EM_DASH else totals.streamingVehicles.toString(),
                icon = MqttInspectorGlyphs.Radio,
            )
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_mqtt_totalSignals),
                value = if (loading) EM_DASH else MqttFormat.int(totals.totalSignals),
                icon = MqttInspectorGlyphs.Radio,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), modifier = Modifier.fillMaxWidth()) {
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_mqtt_totalBatches),
                value = if (loading) EM_DASH else MqttFormat.int(totals.totalBatches),
                icon = MqttInspectorGlyphs.Radio,
            )
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_mqtt_signalsPerSec),
                value = if (loading) EM_DASH else MqttFormat.number(totals.totalRate),
                icon = MqttInspectorGlyphs.Radio,
            )
        }
    }
}

/**
 * GlassPanel6 — the connection-info panel (web `status ? broker/uptime/topics : <EmptyState noStatus/>`). Shows a
 * loading skeleton on the first fetch, a retry surface on a hard error, the broker / uptime / topic-pattern fields
 * when a meaningful status is present (with a nested `noTopics` empty state), or the friendly `noStatus` empty state.
 */
@Composable
private fun MqttConnectionPanel(
    state: UiState<TelemetryStatus>,
    status: TelemetryStatus?,
    onRetry: () -> Unit,
) {
    val sectionTitle = stringResource(R.string.translation_mqtt_status)
    GlassPanel(
        modifier = Modifier.semantics { contentDescription = sectionTitle },
        padding = PanelPadding.Lg,
    ) {
        SectionTitle(sectionTitle, modifier = Modifier.padding(bottom = Spacing.md))
        when {
            state.isLoading -> SkeletonLines(lines = 2)
            state.isError && !state.hasData -> MqttRetryBody(onRetry = onRetry)
            status != null && !isEmptyStatus(status) -> MqttConnectionDetails(status = status)
            else ->
                EmptyState(
                    icon = MqttInspectorGlyphs.WifiOff,
                    message = stringResource(R.string.translation_mqtt_noStatus),
                )
        }
    }
}

/** The broker / uptime / topic-pattern fields — the web GlassPanel6 flex row, stacked for a phone. */
@Composable
private fun MqttConnectionDetails(status: TelemetryStatus) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        val broker = status.broker
        if (!broker.isNullOrBlank()) {
            MqttField(label = stringResource(R.string.translation_mqtt_broker), value = broker)
        }
        val uptime = status.uptimeSeconds
        if (uptime != null) {
            MqttField(label = stringResource(R.string.translation_mqtt_uptime), value = formatUptime(uptime))
        }
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Caption(stringResource(R.string.translation_mqtt_topicPatterns))
            if (status.topics.isNotEmpty()) {
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                    verticalArrangement = Arrangement.spacedBy(Spacing.xs),
                ) {
                    status.topics.forEach { topic ->
                        Badge(text = topic, variant = BadgeVariant.Neutral)
                    }
                }
            } else {
                EmptyState(message = stringResource(R.string.translation_mqtt_noTopics))
            }
        }
    }
}

/** A label + monospace value field (web `<span class="text-xs">label</span><p class="font-mono">value</p>`). */
@Composable
private fun MqttField(
    label: String,
    value: String,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(label)
        CodeText(value)
    }
}

/**
 * GlassPanel7 — the signal-throughput chart (web `throughputHistory.length > 2 ? <AreaChart> : <Collecting…>`).
 * Framed by [ChartContainer] (itself a GlassPanel + title); renders the area series once more than two points have
 * accumulated, otherwise the "collecting data" empty state. The area series uses the brand chart palette (no raw hex).
 */
@Composable
private fun MqttThroughputPanel(points: List<ThroughputPoint>) {
    ChartContainer(
        title = stringResource(R.string.translation_mqtt_signalThroughput),
        status = if (hasThroughputChart(points)) ChartStatus.Ready else ChartStatus.Empty,
        height = THROUGHPUT_CHART_HEIGHT,
        emptyMessage = stringResource(R.string.translation_mqtt_collectingData),
        accessibleDescription = stringResource(R.string.translation_mqtt_signalThroughput),
    ) {
        AreaChartWrapper(
            series =
                listOf(
                    ChartSeries(
                        key = "signals",
                        label = stringResource(R.string.translation_mqtt_signals),
                        values = points.map { it.signals.toDouble() }, // parity:allow numeric widening, not a TODO stub
                        kind = ChartSeriesKind.Area,
                    ),
                ),
            xLabels = points.map { formatClockLabel(it.timeMillis) },
            height = THROUGHPUT_CHART_HEIGHT,
        )
    }
}

/**
 * GlassPanel8 — the per-vehicle breakdown (web final `FadeIn` panel). A header (title + vehicle count + stale-count
 * warning) over a [DataTable] of the projected rows; a loading skeleton on the first fetch, a retry surface on a
 * hard error, or the table itself (which renders the `noVehicles` empty text when nothing is streaming).
 */
@Composable
private fun MqttVehicleBreakdownPanel(
    state: UiState<TelemetryStatus>,
    status: TelemetryStatus?,
    onRetry: () -> Unit,
) {
    val sectionTitle = stringResource(R.string.translation_mqtt_vehicleBreakdown)
    val vehicles = status?.vehicles ?: emptyList()
    val nowMillis = System.currentTimeMillis()
    val staleCount = staleVehicleCount(vehicles, nowMillis)
    GlassPanel(
        modifier = Modifier.semantics { contentDescription = sectionTitle },
        padding = PanelPadding.Lg,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.md),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                SectionTitle(sectionTitle)
                if (vehicles.isNotEmpty()) {
                    Caption("${vehicles.size} ${stringResource(R.string.translation_mqtt_vehicles)}")
                }
            }
            if (staleCount > 0) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    Icon(
                        MqttInspectorGlyphs.AlertTriangle,
                        contentDescription = null,
                        size = IconSize.Sm,
                        tint = TeslaTokens.status.warning,
                    )
                    Caption("$staleCount ${stringResource(R.string.translation_mqtt_stale)}")
                }
            }
        }

        when {
            state.isLoading ->
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    repeat(VEHICLE_SKELETON_ROWS) { Skeleton(height = VEHICLE_SKELETON_HEIGHT) }
                }
            state.isError && !state.hasData -> MqttRetryBody(onRetry = onRetry)
            else -> MqttVehicleTable(rows = mqttVehicleRows(vehicles, nowMillis))
        }
    }
}

/** The vehicle breakdown [DataTable] (web `buildVehicleColumns`) — seven columns of the projected rows. */
@Composable
private fun MqttVehicleTable(rows: List<MqttVehicleRow>) {
    DataTable(
        columns =
            listOf(
                TableColumn(
                    key = "vin",
                    header = stringResource(R.string.translation_mqtt_vin),
                    weight = 2.2f,
                    cell = { CodeText(it.vin) },
                ),
                TableColumn(
                    key = "state",
                    header = stringResource(R.string.translation_mqtt_state),
                    weight = 1.4f,
                    cell = { row ->
                        val label = row.state
                        if (label != null) {
                            Badge(text = label, variant = stateVariant(row.stateOnline))
                        } else {
                            BodyText(EM_DASH, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    },
                ),
                TableColumn(
                    key = "signals",
                    header = stringResource(R.string.translation_mqtt_signals),
                    weight = 1.2f,
                    alignEnd = true,
                    cell = { CodeText(it.signals) },
                ),
                TableColumn(
                    key = "batches",
                    header = stringResource(R.string.translation_mqtt_batches),
                    weight = 1.2f,
                    alignEnd = true,
                    cell = { CodeText(it.batches) },
                ),
                TableColumn(
                    key = "sigPerSec",
                    header = stringResource(R.string.translation_mqtt_sigPerSec),
                    weight = 1.2f,
                    alignEnd = true,
                    cell = { CodeText(it.signalsPerSecond) },
                ),
                TableColumn(
                    key = "lastReceived",
                    header = stringResource(R.string.translation_mqtt_lastReceived),
                    weight = 1.6f,
                    alignEnd = true,
                    cell = { Caption(it.lastReceived) },
                ),
                TableColumn(
                    key = "status",
                    header = stringResource(R.string.translation_mqtt_status),
                    weight = 1.2f,
                    cell = { row ->
                        Badge(
                            text =
                                if (row.stale) {
                                    stringResource(R.string.translation_mqtt_stale)
                                } else {
                                    stringResource(R.string.translation_mqtt_live)
                                },
                            variant = if (row.stale) BadgeVariant.Warning else BadgeVariant.Success,
                            dot = true,
                        )
                    },
                ),
            ),
        rows = rows,
        keyOf = { it.vin },
        emptyText = stringResource(R.string.translation_mqtt_noVehicles),
    )
}

/** The hard-error retry surface shared by the data panels (web query `refetch`; ADR-011 — never a blank region). */
@Composable
private fun MqttRetryBody(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
    )
}
