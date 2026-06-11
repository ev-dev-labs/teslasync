// The native Jetpack Compose + Material 3 MQTT Status dashboard surface — a parity port of
// web/src/features/dashboard/widgets/MQTTStatusWidget.tsx. It mirrors the web `WidgetShell` (skeleton while
// loading, a QueryError retry surface on hard error, otherwise a title + radio icon + freshness header)
// wrapping one of: the compact hero (cols<=1 — a centered online/offline StatusBadge above the big
// messages-per-second figure with a "msg/s" caption), the standard layout (a Status row + a two-up
// Messages/sec + Total Messages StatCard grid + a Last Message / Broker footer), or the friendly
// "No MQTT status data" empty surface when no status object resolved. All data flows through the shared
// [MQTTStatusWidgetViewModel]; the view never performs HTTP. Every string resolves through the i18n catalog
// (P1/S10) and the refresh control + compact hero carry TalkBack labels.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/MQTTStatusWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.mqttstatus

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
import io.teslasync.android.components.datadisplay.ChipSize
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.datadisplay.StatusBadge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.Caption
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
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.telemetry.TelemetryStatus
import io.teslasync.shared.core.presentation.telemetry.VehicleTelemetry
import kotlinx.coroutines.delay
import java.util.Locale

private const val NOW_TICK_MS = 30_000L
private const val LOADING_ROWS = 3
private val SKELETON_HEIGHT = 16.dp

/**
 * Stateful entry point. Binds the shared Telemetry feed via [source] into a [MQTTStatusWidgetViewModel],
 * records the one-shot `view.opened` diagnostic, and renders the surface for the given [size]. A dashboard
 * host supplies [source] (a [TelemetryStore]/[TelemetryRepository] adapter over the shared S7/S8 data layer)
 * and a unique [instanceKey] per placement.
 *
 * @param source the cache-then-network MQTT-status seam (a shared-data-layer adapter).
 * @param size the grid footprint; selects the compact hero vs the standard layout (web `size.cols <= 1`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun MQTTStatusWidget(
    source: MqttStatusSource,
    modifier: Modifier = Modifier,
    size: MqttStatusSize = MqttStatusRegistration.DEFAULT_SIZE,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = MqttStatusRegistration.ID,
) {
    val viewModel: MQTTStatusWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { MQTTStatusWidgetViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    MQTTStatusWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (first load → skeleton, hard error with no cache → QueryError + retry) and
 * otherwise the title + freshness header above the compact hero / standard layout, or the "No MQTT status
 * data" empty surface when no status object resolved (web `data ? body : <EmptyState>`). Stale (non-error)
 * data auto-refreshes, mirroring the web `refetchInterval`; offline/stale keeps the cached body visible
 * (never blanked). [nowMillis] is injectable for deterministic relative-time and [locale] drives number
 * grouping (tests pin deterministic values).
 */
@Composable
fun MQTTStatusWidgetContent(
    state: UiState<TelemetryStatus>,
    size: MqttStatusSize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    nowMillis: Long = rememberMqttNowMillis(),
    locale: Locale = Locale.getDefault(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val strings = rememberMqttStatusStrings()
    Column(modifier = modifier.fillMaxSize()) {
        MqttStatusHeader(size = size, state = state, onRefresh = onRefresh, strings = strings)
        Box(modifier = Modifier.fillMaxWidth().weight(1f)) {
            val status = state.data
            when {
                state.isLoading -> MqttStatusLoading(label = stringResource(R.string.translation_common_loading))
                state.isError -> MqttStatusError(state = state, onRetry = onRefresh)
                status == null -> MqttStatusEmpty(strings = strings)
                else -> {
                    val display =
                        remember(status, strings, nowMillis, locale) {
                            MqttStatusProjection.project(status, strings, nowMillis, locale)
                        }
                    if (size.isCompact) {
                        MqttStatusCompact(display = display, strings = strings)
                    } else {
                        MqttStatusStandard(display = display, strings = strings)
                    }
                }
            }
        }
    }
}

@Composable
private fun MqttStatusHeader(
    size: MqttStatusSize,
    state: UiState<TelemetryStatus>,
    onRefresh: () -> Unit,
    strings: MqttStatusStrings,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(start = Spacing.md, end = Spacing.sm, top = Spacing.sm, bottom = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (size.isCompact) {
            // Compact (1×N) hides the title exactly as the web shell does (`title={isCompact ? undefined …`).
            Spacer(modifier = Modifier.weight(1f))
        } else {
            // Web uses the lucide `Radio` glyph; Android's shared set has no Radio, so the Wifi (radio-waves)
            // glyph is the closest broadcast/connection analogue — tinted success-green like the web icon.
            Icon(
                imageVector = DataDisplayGlyphs.Wifi,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.status.success,
            )
            PanelTitle(strings.title, modifier = Modifier.weight(1f).semantics { heading() })
        }
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = strings.formatRelative,
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

// -- Compact hero (1×N): centered online/offline badge + the big messages-per-second figure --
@Composable
private fun MqttStatusCompact(
    display: MqttStatusDisplay,
    strings: MqttStatusStrings,
) {
    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .padding(horizontal = Spacing.md)
                .clearAndSetSemantics { contentDescription = display.compactContentDescription },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs, Alignment.CenterVertically),
    ) {
        StatusBadge(status = display.statusToken, size = ChipSize.Sm, label = display.statusLabel)
        Row(
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            MetricValue(display.messagesPerSecText)
            Caption(strings.msgSec)
        }
    }
}

// -- Standard layout (2×N+): status row + two-up StatCard grid + Last Message / Broker footer --
@Composable
private fun MqttStatusStandard(
    display: MqttStatusDisplay,
    strings: MqttStatusStrings,
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(start = Spacing.md, end = Spacing.md, bottom = Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            MetricLabel(strings.statusLabel)
            StatusBadge(status = display.statusToken, size = ChipSize.Sm, label = display.statusLabel)
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            StatCard(label = strings.msgRate, value = display.messagesPerSecText, modifier = Modifier.weight(1f))
            StatCard(label = strings.totalToday, value = display.totalMessagesText, modifier = Modifier.weight(1f))
        }
        Spacer(modifier = Modifier.weight(1f))
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        MqttStatusFooterRow(label = strings.lastMessage, value = display.lastMessageText)
        MqttStatusFooterRow(label = strings.broker, value = display.broker)
    }
}

@Composable
private fun MqttStatusFooterRow(
    label: String,
    value: String,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Caption(label)
        Caption(value, modifier = Modifier.padding(start = Spacing.sm))
    }
}

@Composable
private fun MqttStatusLoading(label: String) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(horizontal = Spacing.md, vertical = Spacing.sm)
                .semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(LOADING_ROWS) { Skeleton(height = SKELETON_HEIGHT, rounded = true) }
    }
}

@Composable
private fun MqttStatusError(
    state: UiState<TelemetryStatus>,
    onRetry: () -> Unit,
) {
    Box(
        modifier = Modifier.fillMaxSize().padding(Spacing.md),
        contentAlignment = Alignment.Center,
    ) {
        QueryError(kind = queryErrorKindOf(state), onRetry = onRetry)
    }
}

@Composable
private fun MqttStatusEmpty(strings: MqttStatusStrings) {
    Box(
        modifier = Modifier.fillMaxSize().padding(Spacing.md),
        contentAlignment = Alignment.Center,
    ) {
        EmptyState(message = strings.noData, icon = DataDisplayGlyphs.Wifi)
    }
}

/**
 * Folds an [UiState] hard failure onto a [QueryErrorKind] for the [QueryError] surface (identical to the
 * sibling AlertFeed mapping): a [ErrorKind.Network]/[ErrorKind.Timeout] is treated as offline,
 * [ErrorKind.CircuitOpen] as transient back-pressure, and an HTTP status selects the not-found /
 * unauthorized / server bucket.
 */
private fun queryErrorKindOf(state: UiState<TelemetryStatus>): QueryErrorKind =
    classifyQueryError(
        status = state.httpStatus,
        online = state.errorKind != ErrorKind.Network && state.errorKind != ErrorKind.Timeout,
        transientWaiting = state.errorKind == ErrorKind.CircuitOpen,
    )

/** Ticks the wall clock every 30s so the "Last Message" relative label (e.g. "5m ago") stays current. */
@Composable
private fun rememberMqttNowMillis(): Long {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(NOW_TICK_MS)
            now = System.currentTimeMillis()
        }
    }
    return now
}

/**
 * Builds the localized [MqttStatusStrings] from the i18n catalog (P1/S10): the eight `widget.mqtt.*` keys
 * the web component reads, the online/offline status words the shared `StatusBadge` shows, and the
 * `translation_freshness_*`-backed relative-time formatter shared with the freshness chip. Remembered
 * against the resolved strings so a locale change re-projects the surface.
 */
@Composable
private fun rememberMqttStatusStrings(): MqttStatusStrings {
    val title = stringResource(R.string.translation_widget_mqtt_title)
    val msgSec = stringResource(R.string.translation_widget_mqtt_msgSec)
    val statusLabel = stringResource(R.string.translation_widget_mqtt_status)
    val msgRate = stringResource(R.string.translation_widget_mqtt_msgRate)
    val totalToday = stringResource(R.string.translation_widget_mqtt_totalToday)
    val lastMessage = stringResource(R.string.translation_widget_mqtt_lastMessage)
    val broker = stringResource(R.string.translation_widget_mqtt_broker)
    val noData = stringResource(R.string.translation_widget_mqtt_noData)
    val online = stringResource(R.string.translation_common_online)
    val offline = stringResource(R.string.translation_common_offline)
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(
        title,
        msgSec,
        statusLabel,
        msgRate,
        totalToday,
        lastMessage,
        broker,
        noData,
        online,
        offline,
        justNow,
        seconds,
        minutes,
        hours,
        days,
        weeks,
    ) {
        MqttStatusStrings(
            title = title,
            msgSec = msgSec,
            statusLabel = statusLabel,
            msgRate = msgRate,
            totalToday = totalToday,
            lastMessage = lastMessage,
            broker = broker,
            noData = noData,
            online = online,
            offline = offline,
            formatRelative = { age ->
                when (age) {
                    FreshnessAge.Unknown -> MQTT_EM_DASH
                    FreshnessAge.JustNow -> justNow
                    is FreshnessAge.Seconds -> seconds.format(age.value)
                    is FreshnessAge.Minutes -> minutes.format(age.value)
                    is FreshnessAge.Hours -> hours.format(age.value)
                    is FreshnessAge.Days -> days.format(age.value)
                    is FreshnessAge.Weeks -> weeks.format(age.value)
                }
            },
        )
    }
}

// ── Previews — one per rendered state (standard / compact / loading / error / empty / offline) ──────────

private fun sampleVehicle(
    vin: String,
    signalCount: Long,
    signalsPerSecond: Double,
    lastReceived: String?,
): VehicleTelemetry =
    VehicleTelemetry(
        vin = vin,
        vehicleId = 1L,
        state = "streaming",
        signalCount = signalCount,
        batchCount = signalCount / 4,
        signalsPerSecond = signalsPerSecond,
        lastReceived = lastReceived,
        isStreaming = true,
        dataSource = "fleet_telemetry",
        latencyMs = 42.0,
    )

private fun sampleStatus(connected: Boolean): TelemetryStatus =
    TelemetryStatus(
        connected = connected,
        broker = "tcp://mosquitto:1883",
        uptimeSeconds = 86_400.0,
        vehicles =
            listOf(
                sampleVehicle("5YJ3E1EA1KF000001", signalCount = 18_452, signalsPerSecond = 7.4, lastReceived = "2026-01-01T00:00:00Z"),
                sampleVehicle("5YJ3E1EA1KF000002", signalCount = 6_133, signalsPerSecond = 5.1, lastReceived = "2026-01-01T00:00:30Z"),
            ),
        topics = listOf("telemetry/+/v/+"),
    )

private fun contentState(connected: Boolean = true): UiState<TelemetryStatus> =
    UiState(phase = UiPhase.Content, data = sampleStatus(connected), fetchedAt = System.currentTimeMillis())

@Preview(name = "MQTTStatus · standard", showBackground = true)
@Composable
private fun MqttStatusStandardPreview() {
    TeslaSyncTheme {
        MQTTStatusWidgetContent(
            state = contentState(connected = true),
            size = MqttStatusRegistration.DEFAULT_SIZE,
            onRefresh = {},
            nowMillis = 0L,
            locale = Locale.US,
        )
    }
}

@Preview(name = "MQTTStatus · compact", showBackground = true)
@Composable
private fun MqttStatusCompactPreview() {
    TeslaSyncTheme {
        MQTTStatusWidgetContent(
            state = contentState(connected = true),
            size = MqttStatusSize(cols = 1, rows = 2),
            onRefresh = {},
            nowMillis = 0L,
            locale = Locale.US,
        )
    }
}

@Preview(name = "MQTTStatus · offline (stale cache)", showBackground = true)
@Composable
private fun MqttStatusOfflinePreview() {
    TeslaSyncTheme {
        MQTTStatusWidgetContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = sampleStatus(connected = false),
                    fetchedAt = System.currentTimeMillis(),
                    stale = true,
                    errorKind = ErrorKind.Network,
                ),
            size = MqttStatusRegistration.DEFAULT_SIZE,
            onRefresh = {},
            nowMillis = 0L,
            locale = Locale.US,
        )
    }
}

@Preview(name = "MQTTStatus · loading", showBackground = true)
@Composable
private fun MqttStatusLoadingPreview() {
    TeslaSyncTheme {
        MQTTStatusWidgetContent(
            state = UiState.loading(),
            size = MqttStatusRegistration.DEFAULT_SIZE,
            onRefresh = {},
            nowMillis = 0L,
            locale = Locale.US,
        )
    }
}

@Preview(name = "MQTTStatus · empty", showBackground = true)
@Composable
private fun MqttStatusEmptyPreview() {
    TeslaSyncTheme {
        MQTTStatusWidgetContent(
            state = UiState(phase = UiPhase.Empty, data = null, fetchedAt = System.currentTimeMillis()),
            size = MqttStatusRegistration.DEFAULT_SIZE,
            onRefresh = {},
            nowMillis = 0L,
            locale = Locale.US,
        )
    }
}

@Preview(name = "MQTTStatus · error", showBackground = true)
@Composable
private fun MqttStatusErrorPreview() {
    TeslaSyncTheme {
        MQTTStatusWidgetContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            size = MqttStatusRegistration.DEFAULT_SIZE,
            onRefresh = {},
            nowMillis = 0L,
            locale = Locale.US,
        )
    }
}
