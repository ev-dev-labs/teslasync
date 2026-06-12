// The native Jetpack Compose + Material 3 TelemetryPipelineCard feature view — a parity port of
// web/src/features/system/components/status/TelemetryPipelineCard.tsx. The web component renders, from a
// `space-y-4` stack: a compact fleet rollup grid (vehicles · GPS positions · drives · charging · signal
// log), a liveness summary chip row (per-bucket counts + the MQTT-broker + polling-engine connectivity
// chips, shown only when there are vehicles), a per-vehicle list (status pip + name/VIN/state + battery +
// liveness chip + last/next poll), and a footer of navigation links. Per-vehicle liveness is the UNION of
// the freshest of {last MQTT stream message, last REST poll} under the < 5 min / < 30 min age ladder.
//
// This surface keeps that contract end to end and adds the data-contract states the prop-driven web
// component lacks (the same precedent the sibling BackendStatusSection sets): loading (skeleton), a hard
// error with retry (QueryError), and the stale/offline freshness affordance with auto-refresh — all gated
// on the primary MQTT telemetry feed, with the polling feed folded in best-effort. The "empty" state is
// the no-vehicles branch, rendered as an in-content EmptyState while the rollup grid + footer stay visible
// (faithful to the web's empty-list branch). Data flows through [TelemetryPipelineCardViewModel]; the view
// performs no HTTP. Every string resolves through [rememberTelemetryPipelineStrings] (P1/S10); the refresh
// control, status pips, battery bars, and per-vehicle rows carry TalkBack labels.
//
// i18n: the web card is anonymous (it renders literals, not `t()` keys), so its labels are reproduced
// verbatim in [rememberTelemetryPipelineStrings] as key-as-default parity reproductions (the same
// precedent the sibling surfaces document), while the common chrome (refresh / loading / offline /
// freshness) resolves through existing `translation_*` catalog keys. Never silent drift.
//
// Glyph map (lucide has no bundled Android equivalent): web `Radio` -> DataDisplayGlyphs.Wifi (the
// MQTTStatusWidget precedent), `Activity` -> NavGlyphs.Pulse (the BackendStatusSection precedent), `Car`
// -> NavGlyphs.Car, `Battery` -> DataDisplayGlyphs.Battery, `ExternalLink` -> DataDisplayGlyphs.ExternalLink.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/TelemetryPipelineCard) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")
@file:OptIn(ExperimentalLayoutApi::class)

package io.teslasync.android.featureviews.telemetrypipelinecard

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.EmptyStateAction
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.SkeletonLines
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.navigation.NavGlyphs
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.telemetry.TelemetryStatus
import io.teslasync.shared.core.presentation.telemetry.VehicleTelemetry
import kotlinx.coroutines.delay
import java.util.Locale

/** The web `now` tick that re-renders the relative-time labels (every 5 s page tick). */
private const val NOW_TICK_MS: Long = 5_000L

/** The web `POLLING_REFRESH_MS` — re-fetch both feeds every 15 s while the screen is STARTED. */
private const val REFRESH_INTERVAL_MS: Long = 15_000L

private const val CHIP_BG_ALPHA: Float = 0.16f
private const val SUBTLE_BG_ALPHA: Float = 0.4f
private const val TRAILING_LABEL_ALPHA: Float = 0.7f
private const val ROLLUP_COLUMNS: Int = 2
private const val SKELETON_LINES: Int = 4

private val STATUS_DOT_SIZE = 10.dp
private val CHIP_DOT_SIZE = 6.dp
private val BATTERY_BAR_WIDTH = 48.dp
private val BATTERY_BAR_HEIGHT = 6.dp

/**
 * Navigation callbacks the card raises — the native analogue of the web `react-router-dom` `Link`s. All
 * default to no-ops so previews and the stateless renderer need no wiring; a host supplies real
 * navigation. Kept as a holder so the composable signature stays small.
 */
data class TelemetryPipelineCardActions(
    val onOpenTelemetryCoverage: () -> Unit = {},
    val onOpenMqttInspector: () -> Unit = {},
    val onOpenAllVehicles: () -> Unit = {},
    val onOpenVehicle: (Long) -> Unit = {},
    val onOpenTeslaAccount: () -> Unit = {},
)

/**
 * Stateful entry point. Binds the cache-then-network [source] into a [TelemetryPipelineCardViewModel],
 * records the one-shot `view.opened` diagnostic, re-fetches every [REFRESH_INTERVAL_MS] while the screen is
 * STARTED (the web `refetchInterval`), and renders. [vehicles] + [counts] are the host-provided inputs
 * (the web props); a host builds [source] via `telemetryPipelineCardSource(store, api)`.
 *
 * @param source the cache-then-network MQTT + polling seam (a shared-data-layer adapter).
 * @param vehicles the configured vehicles to list (web `vehicles` prop).
 * @param counts the fleet rollup counts (web `positionCount` / `drivesCount` / … props).
 * @param actions navigation callbacks for the footer + per-vehicle links.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param instanceKey a unique key per placement so multiple hosts each get their own view-model.
 */
@Composable
fun TelemetryPipelineCard(
    source: TelemetryPipelineCardSource,
    vehicles: List<TelemetryPipelineVehicle>,
    counts: FleetCounts,
    modifier: Modifier = Modifier,
    actions: TelemetryPipelineCardActions = TelemetryPipelineCardActions(),
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = TELEMETRY_PIPELINE_CARD_SLUG,
) {
    val viewModel: TelemetryPipelineCardViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { TelemetryPipelineCardViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    val lifecycleOwner = LocalLifecycleOwner.current
    LaunchedEffect(viewModel, lifecycleOwner) {
        lifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                delay(REFRESH_INTERVAL_MS)
                viewModel.refresh()
            }
        }
    }

    TelemetryPipelineCardContent(
        state = state,
        vehicles = vehicles,
        counts = counts,
        onRefresh = viewModel::refresh,
        modifier = modifier,
        actions = actions,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Loading shows
 * skeleton chrome; a hard error shows [QueryError] + retry; otherwise the full card renders (rollup grid +
 * liveness summary + per-vehicle list or no-vehicles EmptyState + footer), with the freshness header
 * surfacing stale/offline + a manual refresh. Stale (non-error) data auto-refreshes, mirroring the web
 * `refetchInterval`. [nowMillis] is injectable for deterministic relative-time; [locale] drives grouping.
 */
@Composable
fun TelemetryPipelineCardContent(
    state: UiState<TelemetryPipelineFeeds>,
    vehicles: List<TelemetryPipelineVehicle>,
    counts: FleetCounts,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    actions: TelemetryPipelineCardActions = TelemetryPipelineCardActions(),
    nowMillis: Long = rememberPipelineNowMillis(),
    locale: Locale = Locale.getDefault(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        when {
            state.isLoading -> PipelineLoading()
            state.isError ->
                QueryError(
                    kind = queryErrorKindOf(state),
                    onRetry = onRefresh,
                    modifier = Modifier.fillMaxWidth(),
                )
            else ->
                PipelineBody(
                    state = state,
                    vehicles = vehicles,
                    counts = counts,
                    onRefresh = onRefresh,
                    actions = actions,
                    nowMillis = nowMillis,
                    locale = locale,
                )
        }
    }
}

@Composable
private fun PipelineBody(
    state: UiState<TelemetryPipelineFeeds>,
    vehicles: List<TelemetryPipelineVehicle>,
    counts: FleetCounts,
    onRefresh: () -> Unit,
    actions: TelemetryPipelineCardActions,
    nowMillis: Long,
    locale: Locale,
) {
    val strings = rememberTelemetryPipelineStrings()
    val feeds = state.data ?: TelemetryPipelineFeeds(mqtt = null, polling = null)
    val display =
        remember(feeds, vehicles, counts, nowMillis, strings, locale) {
            TelemetryPipelineProjection.project(feeds, vehicles, counts, TelemetryPipelineContext(nowMillis, strings, locale))
        }
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        PipelineFreshnessHeader(state = state, onRefresh = onRefresh)
        RollupGridView(rollup = display.rollup, strings = strings)
        if (display.showLivenessSummary) {
            LivenessSummary(display = display, strings = strings)
        }
        if (display.hasVehicles) {
            VehicleListView(vehicles = display.vehicles, actions = actions, strings = strings)
        } else {
            NoVehiclesEmpty(strings = strings, onOpenTeslaAccount = actions.onOpenTeslaAccount)
        }
        FooterLinks(strings = strings, actions = actions)
    }
}

// ── Freshness header (the stale / offline / refresh affordance the prop-driven web lacks) ────────────

@Composable
private fun PipelineFreshnessHeader(
    state: UiState<TelemetryPipelineFeeds>,
    onRefresh: () -> Unit,
) {
    val formatAge = rememberPipelineFreshnessFormatter()
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.End),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = formatAge,
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

// ── Loading skeleton ─────────────────────────────────────────────────────────────────────────────────

@Composable
private fun PipelineLoading() {
    SkeletonLines(modifier = Modifier.fillMaxWidth(), lines = SKELETON_LINES)
}

// ── Fleet rollup grid (web grid-cols-2 md:grid-cols-5) ────────────────────────────────────────────────

@Composable
private fun RollupGridView(
    rollup: RollupGrid,
    strings: TelemetryPipelineStrings,
) {
    val cells =
        listOf(
            strings.vehiclesLabel to rollup.vehiclesValue,
            strings.gpsPositionsLabel to rollup.positionsValue,
            strings.drivesLabel to rollup.drivesValue,
            strings.chargingSessionsLabel to rollup.chargingValue,
            strings.signalLogLabel to rollup.signalLogValue,
        )
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        cells.chunked(ROLLUP_COLUMNS).forEach { rowCells ->
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                rowCells.forEach { (label, value) -> RollupCell(label, value, Modifier.weight(1f)) }
                if (rowCells.size < ROLLUP_COLUMNS) Spacer(modifier = Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun RollupCell(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier) {
        Caption(label)
        BodyText(value, maxLines = 1)
    }
}

// ── Liveness summary chips + connectivity chips (web `list.length > 0` block) ─────────────────────────

@Composable
private fun LivenessSummary(
    display: TelemetryPipelineDisplay,
    strings: TelemetryPipelineStrings,
) {
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Caption(strings.livenessTitle, modifier = Modifier.align(Alignment.CenterVertically))
        display.livenessChips.forEach { chip ->
            PipelineChip(text = chip.label, tone = toneOf(chip.level), dot = true)
        }
        PipelineChip(
            text = display.mqttChip.label,
            tone = if (display.mqttChip.connected) ChipTone.Info else ChipTone.Warning,
            leadingIcon = if (display.mqttChip.connected) DataDisplayGlyphs.Wifi else DataDisplayGlyphs.WifiOff,
        )
        display.pollingChip?.let { polling ->
            PipelineChip(
                text = polling.label,
                tone = if (polling.kind == PollingChipKind.Disabled) ChipTone.Warning else ChipTone.Neutral,
                leadingIcon = if (polling.kind == PollingChipKind.Disabled) DataDisplayGlyphs.WifiOff else null,
            )
        }
    }
}

// ── Per-vehicle list (web `<ul divide-y>` inside a subtle rounded container) ──────────────────────────

@Composable
private fun VehicleListView(
    vehicles: List<VehicleRow>,
    actions: TelemetryPipelineCardActions,
    strings: TelemetryPipelineStrings,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(Radius.md),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = SUBTLE_BG_ALPHA),
    ) {
        Column(modifier = Modifier.fillMaxWidth()) {
            vehicles.forEachIndexed { index, row ->
                if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                VehicleRowView(row = row, onOpenVehicle = actions.onOpenVehicle, strings = strings)
            }
        }
    }
}

@Composable
private fun VehicleRowView(
    row: VehicleRow,
    onOpenVehicle: (Long) -> Unit,
    strings: TelemetryPipelineStrings,
) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            LivenessDot(level = row.level, contentDescription = row.statusContentDescription)
            Icon(NavGlyphs.Car, contentDescription = null, size = IconSize.Sm, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Column(modifier = Modifier.weight(1f)) {
                BodyText(
                    row.name,
                    modifier =
                        Modifier.clickable(role = Role.Button, onClickLabel = row.name) { onOpenVehicle(row.id) },
                    maxLines = 1,
                )
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    Caption(row.vinLabel)
                    Caption("\u00B7")
                    Caption(row.stateLabel)
                }
            }
            LivenessChipView(row = row)
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Icon(
                DataDisplayGlyphs.Battery,
                contentDescription = null,
                size = IconSize.Xs,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (row.batteryPercent != null) {
                BatteryBar(row = row)
            } else {
                Caption(row.batteryText)
            }
            Spacer(modifier = Modifier.weight(1f))
            Text(
                text = lastNextText(row, strings),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun BatteryBar(row: VehicleRow) {
    val tone = batteryToneColor(row.batteryTone)
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Box(
            modifier =
                Modifier
                    .width(BATTERY_BAR_WIDTH)
                    .height(BATTERY_BAR_HEIGHT)
                    .clip(RoundedCornerShape(Radius.pill))
                    .background(MaterialTheme.colorScheme.surfaceVariant)
                    .clearAndSetSemantics { row.batteryContentDescription?.let { desc -> contentDescription = desc } },
        ) {
            Box(
                modifier =
                    Modifier
                        .fillMaxHeight()
                        .fillMaxWidth(row.batteryFraction)
                        .clip(RoundedCornerShape(Radius.pill))
                        .background(tone),
            )
        }
        Text(row.batteryText, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurface)
    }
}

@Composable
private fun LivenessDot(
    level: Liveness,
    contentDescription: String,
) {
    Box(
        modifier =
            Modifier
                .size(STATUS_DOT_SIZE)
                .clip(CircleShape)
                .background(livenessColor(level))
                .semantics { this.contentDescription = contentDescription },
    )
}

@Composable
private fun LivenessChipView(row: VehicleRow) {
    PipelineChip(
        text = row.livenessLabel,
        tone = toneOf(row.level),
        leadingIcon = DataDisplayGlyphs.Wifi,
        trailing = row.sourceLabel,
    )
}

// ── Footer navigation links (web footer, separated by a top border) ───────────────────────────────────

@Composable
private fun FooterLinks(
    strings: TelemetryPipelineStrings,
    actions: TelemetryPipelineCardActions,
) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        FlowRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Button(
                label = strings.openTelemetryCoverage,
                onClick = actions.onOpenTelemetryCoverage,
                variant = ButtonVariant.Secondary,
                size = ButtonSize.Sm,
                leadingIcon = DataDisplayGlyphs.ExternalLink,
            )
            Button(
                label = strings.mqttInspector,
                onClick = actions.onOpenMqttInspector,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                leadingIcon = DataDisplayGlyphs.Wifi,
            )
            Button(
                label = strings.allVehicles,
                onClick = actions.onOpenAllVehicles,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                leadingIcon = NavGlyphs.Pulse,
            )
        }
    }
}

@Composable
private fun NoVehiclesEmpty(
    strings: TelemetryPipelineStrings,
    onOpenTeslaAccount: () -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(Radius.md),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = SUBTLE_BG_ALPHA),
    ) {
        EmptyState(
            message = strings.noVehiclesMessage,
            icon = NavGlyphs.Car,
            action = EmptyStateAction(label = strings.teslaAccountAction, onClick = onOpenTeslaAccount),
        )
    }
}

// ── Reusable chip ─────────────────────────────────────────────────────────────────────────────────────

private enum class ChipTone { Success, Warning, Danger, Info, Neutral }

@Composable
private fun PipelineChip(
    text: String,
    tone: ChipTone,
    modifier: Modifier = Modifier,
    leadingIcon: ImageVector? = null,
    dot: Boolean = false,
    trailing: String? = null,
) {
    val foreground = chipForeground(tone)
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(Radius.sm),
        color = chipBackground(tone, foreground),
        contentColor = foreground,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            if (dot) {
                Box(modifier = Modifier.size(CHIP_DOT_SIZE).clip(CircleShape).background(foreground))
            }
            if (leadingIcon != null) {
                Icon(leadingIcon, contentDescription = null, size = IconSize.Xs, tint = foreground)
            }
            Text(text, style = MaterialTheme.typography.labelSmall)
            if (trailing != null) {
                Text(trailing, style = MaterialTheme.typography.labelSmall, color = foreground.copy(alpha = TRAILING_LABEL_ALPHA))
            }
        }
    }
}

// ── Color + glyph + label helpers ─────────────────────────────────────────────────────────────────────

private fun toneOf(level: Liveness): ChipTone =
    when (level) {
        Liveness.Sending -> ChipTone.Success
        Liveness.Slow -> ChipTone.Warning
        Liveness.Stale -> ChipTone.Danger
        Liveness.Offline -> ChipTone.Neutral
    }

@Composable
private fun livenessColor(level: Liveness): Color =
    when (level) {
        Liveness.Sending -> TeslaTokens.status.success
        Liveness.Slow -> TeslaTokens.status.warning
        Liveness.Stale -> TeslaTokens.status.danger
        Liveness.Offline -> MaterialTheme.colorScheme.onSurfaceVariant
    }

@Composable
private fun chipForeground(tone: ChipTone): Color =
    when (tone) {
        ChipTone.Success -> TeslaTokens.status.success
        ChipTone.Warning -> TeslaTokens.status.warning
        ChipTone.Danger -> TeslaTokens.status.danger
        ChipTone.Info -> TeslaTokens.status.info
        ChipTone.Neutral -> MaterialTheme.colorScheme.onSurfaceVariant
    }

@Composable
private fun chipBackground(
    tone: ChipTone,
    foreground: Color,
): Color =
    if (tone == ChipTone.Neutral) {
        MaterialTheme.colorScheme.surfaceVariant
    } else {
        foreground.copy(alpha = CHIP_BG_ALPHA)
    }

@Composable
private fun batteryToneColor(tone: BatteryTone?): Color =
    when (tone) {
        BatteryTone.Good -> TeslaTokens.status.success
        BatteryTone.Warn -> TeslaTokens.status.warning
        BatteryTone.Critical -> TeslaTokens.status.danger
        null -> MaterialTheme.colorScheme.onSurfaceVariant
    }

private fun lastNextText(
    row: VehicleRow,
    strings: TelemetryPipelineStrings,
): String {
    val last = "${strings.lastPrefix} ${row.lastRelative}"
    return if (row.nextRelative != null) "$last \u00B7 ${strings.nextPrefix} ${row.nextRelative}" else last
}

private fun queryErrorKindOf(state: UiState<TelemetryPipelineFeeds>): QueryErrorKind =
    classifyQueryError(
        status = state.httpStatus,
        online = state.errorKind != ErrorKind.Network && state.errorKind != ErrorKind.Timeout,
        transientWaiting = state.errorKind == ErrorKind.CircuitOpen,
    )

// ── Localized strings (P1/S10 i18n facade) ────────────────────────────────────────────────────────────

/**
 * Resolves the surface labels. The web card renders NATURAL-LANGUAGE literals (no `t()` keys), so those
 * labels are reproduced verbatim here as key-as-default parity reproductions — the same precedent the
 * sibling surfaces document, never silent drift. The common chrome (refresh / loading / offline /
 * freshness) resolves through the existing `translation_*` catalog keys (in the header + freshness
 * formatter). [TelemetryPipelineStrings.formatRelativeTime] reproduces the web `relativeTime` phrasing.
 */
@Composable
fun rememberTelemetryPipelineStrings(): TelemetryPipelineStrings =
    remember {
        TelemetryPipelineStrings(
            // Catalog-absent natural-language labels (web key-as-default) — verbatim parity reproductions.
            vehiclesLabel = "Vehicles",
            gpsPositionsLabel = "GPS positions",
            drivesLabel = "Drives",
            chargingSessionsLabel = "Charging sessions",
            signalLogLabel = "Signal log",
            vehiclesConnectedTemplate = "%d connected",
            noneConfigured = "none configured",
            livenessTitle = "Liveness:",
            sending = "sending",
            slow = "slow",
            stale = "stale",
            offline = "offline",
            fleetTelemetryConnected = "Fleet Telemetry connected",
            mqttBrokerDisconnected = "MQTT broker disconnected",
            pollingEngineOff = "polling engine off (streaming-only)",
            pollingEngineDisabled = "polling engine disabled",
            noVehiclesMessage = "No vehicles configured yet. Add a vehicle to see per-vehicle telemetry status.",
            teslaAccountAction = "Tesla account",
            vinPrefix = "VIN \u00B7\u00B7\u00B7",
            unknownState = "unknown",
            streamLabel = "stream",
            pollLabel = "poll",
            lastPrefix = "last:",
            nextPrefix = "next:",
            statusA11yPrefix = "telemetry status:",
            batteryA11yPrefix = "battery",
            vehicleFallbackNameTemplate = "Vehicle %d",
            openTelemetryCoverage = "Open Telemetry Coverage",
            mqttInspector = "MQTT Inspector",
            allVehicles = "All vehicles",
            formatRelativeTime = ::formatPipelineRelativeTime,
        )
    }

/** The web `relativeTime` phrasing reproduced verbatim (key-as-default): "Ns ago" / "in Ns" per unit. */
private fun formatPipelineRelativeTime(time: RelativeTime): String =
    when (time.unit) {
        RelativeUnit.Seconds -> if (time.past) "${time.value}s ago" else "in ${time.value}s"
        RelativeUnit.Minutes -> if (time.past) "${time.value} min ago" else "in ${time.value} min"
        RelativeUnit.Hours -> if (time.past) "${time.value}h ago" else "in ${time.value}h"
        RelativeUnit.Days -> if (time.past) "${time.value}d ago" else "in ${time.value}d"
    }

/** Maps a [FreshnessAge] bucket to its localized header-chip string (the `translation_freshness_*` keys). */
@Composable
private fun rememberPipelineFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> EM_DASH
                FreshnessAge.JustNow -> justNow
                is FreshnessAge.Seconds -> seconds.format(age.value)
                is FreshnessAge.Minutes -> minutes.format(age.value)
                is FreshnessAge.Hours -> hours.format(age.value)
                is FreshnessAge.Days -> days.format(age.value)
                is FreshnessAge.Weeks -> weeks.format(age.value)
            }
        }
    }
}

@Composable
private fun rememberPipelineNowMillis(): Long {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(NOW_TICK_MS)
            now = System.currentTimeMillis()
        }
    }
    return now
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ────────────────────────

private const val PREVIEW_NOW: Long = 1_750_000_000_000L

private val PREVIEW_VEHICLES =
    listOf(
        TelemetryPipelineVehicle(id = 1, vin = "5YJ3E1EA1KF000001", displayName = "Model 3", state = "online"),
        TelemetryPipelineVehicle(id = 2, vin = "5YJSA1E26MF000002", displayName = "Model S", state = "asleep"),
        TelemetryPipelineVehicle(id = 3, vin = "7SAYGDEE9PF000003", displayName = null, state = "offline"),
    )

private val PREVIEW_FEEDS =
    TelemetryPipelineFeeds(
        mqtt =
            TelemetryStatus(
                connected = true,
                broker = "tcp://mosquitto:1883",
                uptimeSeconds = 1.0,
                vehicles =
                    listOf(
                        VehicleTelemetry(
                            vin = "5YJ3E1EA1KF000001",
                            vehicleId = 1,
                            state = "online",
                            signalCount = 240,
                            batchCount = 12,
                            signalsPerSecond = 4.0,
                            lastReceived = "2025-06-15T13:46:30Z",
                            isStreaming = true,
                            dataSource = "fleet_telemetry",
                            latencyMs = null,
                        ),
                    ),
                topics = emptyList(),
            ),
        polling =
            PollEngineStatus(
                enabled = true,
                vehicles =
                    mapOf(
                        "5YJSA1E26MF000002" to
                            VehiclePollingStatus(
                                lastPollTime = "2025-06-15T13:30:00Z",
                                nextPollAfter = "2025-06-15T13:50:00Z",
                                batteryLevel = 64.0,
                            ),
                        "7SAYGDEE9PF000003" to
                            VehiclePollingStatus(lastPollTime = "2025-06-15T12:00:00Z", nextPollAfter = "", batteryLevel = 12.0),
                    ),
            ),
    )

private val PREVIEW_COUNTS =
    FleetCounts(positionCount = 184_220, drivesCount = 1_204, chargingSessionsCount = 318, signalLogCount = 9_482_100)

private val PREVIEW_EMPTY_COUNTS =
    FleetCounts(positionCount = 0, drivesCount = 0, chargingSessionsCount = null, signalLogCount = null)

@Composable
private fun PipelinePreviewScaffold(
    state: UiState<TelemetryPipelineFeeds>,
    vehicles: List<TelemetryPipelineVehicle> = PREVIEW_VEHICLES,
    counts: FleetCounts = PREVIEW_COUNTS,
) {
    TeslaSyncTheme(dynamicColor = false) {
        Surface {
            TelemetryPipelineCardContent(
                state = state,
                vehicles = vehicles,
                counts = counts,
                onRefresh = {},
                modifier = Modifier.padding(Spacing.md),
                nowMillis = PREVIEW_NOW,
                locale = Locale.US,
            )
        }
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun TelemetryPipelineContentPreview() {
    PipelinePreviewScaffold(UiState(phase = UiPhase.Content, data = PREVIEW_FEEDS, fetchedAt = PREVIEW_NOW))
}

@Preview(name = "Offline / stale", showBackground = true)
@Composable
private fun TelemetryPipelineOfflinePreview() {
    PipelinePreviewScaffold(
        UiState(
            phase = UiPhase.Content,
            data = PREVIEW_FEEDS,
            fetchedAt = PREVIEW_NOW - 600_000,
            stale = true,
            errorKind = ErrorKind.Network,
        ),
    )
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun TelemetryPipelineLoadingPreview() {
    PipelinePreviewScaffold(UiState.loading())
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun TelemetryPipelineErrorPreview() {
    PipelinePreviewScaffold(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network))
}

@Preview(name = "Empty (no vehicles)", showBackground = true)
@Composable
private fun TelemetryPipelineEmptyPreview() {
    PipelinePreviewScaffold(
        state = UiState(phase = UiPhase.Content, data = TelemetryPipelineFeeds(null, null), fetchedAt = PREVIEW_NOW),
        vehicles = emptyList(),
        counts = PREVIEW_EMPTY_COUNTS,
    )
}
