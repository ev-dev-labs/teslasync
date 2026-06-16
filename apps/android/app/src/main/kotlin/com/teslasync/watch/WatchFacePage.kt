// The native Jetpack Compose + Material 3 WatchFacePage wearable surface — a parity port of
// web/src/features/watch/pages/WatchFacePage.tsx, the chrome-less `/watch` Apple-Watch / Wear-OS glance. It
// reproduces the web `WatchShell` (a single, non-scrolling screen: vehicle name, a large central battery gauge,
// a charging indicator, the coarse state badge, the tap-friendly lock / climate / sentry quick actions, and the
// last-updated stamp) over one of three surfaces — a loading spinner, a "No vehicle found" message, or the
// glance body. All data flows through the shared [WatchFacePageViewModel] (P1/S8); the view performs NO HTTP.
// Range, cabin temperature and time-to-full are SI→display converted at this render boundary via the shared
// [UnitFormatter] (web `useUnits()`), every visible string resolves through the i18n catalog (P1/S10), and every
// interactive element carries a TalkBack label with a ≥48dp target (ADR-015).
//
// Parity note: the web page also renders an OPT-IN Helix narrator (`<AIWatchFaceNLResponse />`) as a sibling
// AFTER the shell that returns null in the default AI-off mode — the wearable invariant. That narrator is its own
// shared-surface parity unit (it binds the `useAiStream` data source, which is NOT one of this page's data
// sources) and is therefore covered separately, not embedded here; the chrome-less shell below is the canonical
// baseline every user sees, exactly as the web off-mode renders.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/watch) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located stateless renderer + helpers.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.watch.watchface

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.computeAgeSeconds
import io.teslasync.android.components.datadisplay.relativeAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.EmptyStateAction
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiEvent
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.watch.WatchSummary
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.StateFlow

/**
 * Stateful entry point. Binds the shared Watch summary + command feeds via [source] into a
 * [WatchFacePageViewModel], records the one-shot `view.opened` diagnostic, collects the live state + display
 * [units] formatter + the in-flight [WatchFacePageViewModel.sending] flag, folds command outcomes into a
 * snackbar (web `useWatchCommand` toast), drives the web `refetchInterval` poll, and renders the surface. The
 * host supplies [source] (an adapter over the shared resilient Watch repository) and the optional [vehicleId]
 * (web `vehicle_id`; `null` reads the primary vehicle).
 */
@Composable
fun WatchFacePage(
    source: WatchFacePageSource,
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    logger: Logger = LocalDataContainer.current.logger,
    units: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
) {
    val viewModel: WatchFacePageViewModel =
        viewModel(
            key = WatchFaceRegistration.ROUTE_ID,
            factory = WatchFacePageViewModel.factory(source, logger, vehicleId),
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val formatter by units.collectAsStateWithLifecycle()
    val sending by viewModel.sending.collectAsStateWithLifecycle()

    val snackbarHostState = remember { SnackbarHostState() }
    val sentLabel = stringResource(R.string.translation_widget_commandSuccess)
    val failedLabel = stringResource(R.string.translation_widget_commandFailed)
    LaunchedEffect(viewModel, sentLabel, failedLabel) {
        viewModel.events.collect { event ->
            if (event is UiEvent.CommandOutcome) {
                snackbarHostState.showSnackbar(if (event.success) sentLabel else failedLabel)
            }
        }
    }
    WatchFaceAutoRefresh(state = state, onRefresh = viewModel::refresh)

    WatchFacePageContent(
        state = state,
        formatter = formatter,
        sending = sending,
        modifier = modifier,
        snackbarHostState = snackbarHostState,
        onCommand = viewModel::sendCommand,
        onRetry = viewModel::retry,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Reproduces the web
 * `WatchShell` short-circuits: a first load → a centered spinner (web `<Spinner size="lg" />`), a hard
 * failure / blank decode → the "No vehicle found" message (web `error || !data`), otherwise the glance body.
 * A stale (non-error) snapshot keeps its body visible while [WatchFaceAutoRefresh] revalidates it.
 */
@Composable
fun WatchFacePageContent(
    state: UiState<WatchSummary>,
    formatter: UnitFormatter,
    sending: Boolean,
    modifier: Modifier = Modifier,
    snackbarHostState: SnackbarHostState = remember { SnackbarHostState() },
    onCommand: (String) -> Unit = {},
    onRetry: () -> Unit = {},
) {
    WatchShell(modifier = modifier, snackbarHostState = snackbarHostState) {
        when {
            state.isLoading -> WatchFaceLoading()
            else -> {
                val display = remember(state.data, formatter) { WatchFaceProjection.project(state.data, formatter) }
                if (display.hasData) {
                    WatchFaceBody(display = display, sending = sending, onCommand = onCommand)
                } else {
                    WatchFaceMessage(canRetry = state.canRetry, onRetry = onRetry)
                }
            }
        }
    }
}

/**
 * The chrome-less wearable shell (web `<WatchShell>` — `h-screen … flex flex-col p-3`): a full-screen themed
 * surface that fills the display and overlays the transient command-outcome snackbar at the bottom. Theme
 * colors (not a hardcoded black) keep dark / dynamic-color / light all working (ADR-005, ADR-015).
 */
@Composable
private fun WatchShell(
    modifier: Modifier,
    snackbarHostState: SnackbarHostState,
    content: @Composable BoxScope.() -> Unit,
) {
    Surface(
        modifier = modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
    ) {
        Box(modifier = Modifier.fillMaxSize().padding(Spacing.md)) {
            content()
            SnackbarHost(hostState = snackbarHostState, modifier = Modifier.align(Alignment.BottomCenter))
        }
    }
}

/** First-load surface (web `<Spinner size="lg" />`), centered, with a TalkBack "Loading" description. */
@Composable
private fun BoxScope.WatchFaceLoading() {
    Spinner(
        modifier = Modifier.align(Alignment.Center),
        size = SpinnerSize.Lg,
        accessibleLabel = stringResource(R.string.translation_a11y_loading),
    )
}

/** No-vehicle / hard-error surface (web `error || !data` → "No vehicle found"), with a Retry affordance. */
@Composable
private fun BoxScope.WatchFaceMessage(
    canRetry: Boolean,
    onRetry: () -> Unit,
) {
    val retryLabel = stringResource(R.string.translation_common_retry)
    EmptyState(
        message = stringResource(R.string.translation_glance_noVehicle),
        modifier = Modifier.align(Alignment.Center),
        icon = WatchFaceGlyphs.Bolt,
        action = if (canRetry) EmptyStateAction(label = retryLabel, onClick = onRetry) else null,
    )
}

/**
 * The glance body (web `else` branch): vehicle name at the top, the central battery gauge + charging indicator
 * + state badge filling the middle, then the lock / climate / sentry quick actions and the last-updated stamp at
 * the bottom — the chrome-less single-screen layout, no scrolling.
 */
@Composable
private fun BoxScope.WatchFaceBody(
    display: WatchFaceDisplay,
    sending: Boolean,
    onCommand: (String) -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Caption(text = display.vehicleName, modifier = Modifier.semantics { heading() })
        Column(
            modifier = Modifier.weight(1f).fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            BatteryGauge(display)
            if (display.isCharging) {
                Spacer(Modifier.height(Spacing.sm))
                ChargingIndicator(timeText = display.chargingTimeText)
            }
            display.stateLabel?.let { label ->
                Spacer(Modifier.height(Spacing.sm))
                Badge(text = label, variant = stateBadgeVariant(display.stateTone))
            }
        }
        WatchQuickActions(display = display, sending = sending, onCommand = onCommand)
        watchRelativeAge(display.lastUpdatedMillis)?.let { age ->
            Spacer(Modifier.height(Spacing.xs))
            Caption(text = age)
        }
    }
}

/** The central battery gauge (web `<BatteryGauge>`): a colored arc with `level%` centered and the range below. */
@Composable
private fun BatteryGauge(display: WatchFaceDisplay) {
    RadialGauge(
        value = display.batteryLevel,
        max = BATTERY_MAX_PERCENT,
        label = display.rangeText,
        unit = BATTERY_PERCENT_UNIT,
        color = batteryBandColor(display.colorBand),
        size = GAUGE_SIZE,
        decimals = DISPLAY_DECIMALS,
    )
}

/** The charging indicator (web `is_charging` branch): a bolt + the time-to-full, in the success accent. */
@Composable
private fun ChargingIndicator(timeText: String) {
    val accent = TeslaTokens.status.success
    val label = stringResource(R.string.translation_widget_charging)
    val toFull = stringResource(R.string.translation_widget_timeToFull)
    Row(
        modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = "$label, $timeText, $toFull" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(imageVector = WatchFaceGlyphs.Bolt, contentDescription = null, size = IconSize.Sm, tint = accent)
        BodyText(text = timeText, color = accent, maxLines = 1)
        Caption(text = toFull)
    }
}

/**
 * The tap-friendly quick actions (web `StatusIcon` row): lock/unlock (toggles the lock command), climate
 * (toggles climate with the cabin temperature as its label), and a non-interactive Sentry-Mode indicator. Each
 * is a ≥48dp target with a TalkBack description (ADR-015); all are disabled while a command is [sending].
 */
@Composable
private fun WatchQuickActions(
    display: WatchFaceDisplay,
    sending: Boolean,
    onCommand: (String) -> Unit,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.lg), verticalAlignment = Alignment.Top) {
        val locked = display.isLocked
        WatchActionIcon(
            icon = if (locked) WatchFaceGlyphs.Lock else WatchFaceGlyphs.Unlock,
            contentDescription =
                stringResource(
                    if (locked) R.string.translation_glance_action_unlock else R.string.translation_glance_action_lock,
                ),
            active = locked,
            activeTint = if (locked) TeslaTokens.status.success else TeslaTokens.status.danger,
            enabled = !sending,
            onClick = { onCommand(if (locked) COMMAND_UNLOCK else COMMAND_LOCK) },
        )

        val climateOn = display.isClimateOn
        val climateLabel =
            stringResource(
                if (climateOn) R.string.translation_glance_action_climateOff else R.string.translation_glance_action_climateOn,
            )
        WatchActionIcon(
            icon = WatchFaceGlyphs.Thermometer,
            contentDescription = "$climateLabel, ${display.cabinTempText}",
            active = climateOn,
            activeTint = MaterialTheme.colorScheme.primary,
            enabled = !sending,
            onClick = { onCommand(if (climateOn) COMMAND_CLIMATE_OFF else COMMAND_CLIMATE_ON) },
            label = display.cabinTempText,
        )

        WatchActionIcon(
            icon = WatchFaceGlyphs.Shield,
            contentDescription = stringResource(R.string.translation_common_sentry),
            active = display.sentryMode,
            activeTint = TeslaTokens.status.warning,
            enabled = true,
            onClick = null,
        )
    }
}

/**
 * One quick-action cell (web `StatusIcon`): a circular ≥48dp tonal target with a centered icon and an optional
 * value [label] below it. [active] selects the [activeTint] (else a muted tint); a `null` [onClick] renders a
 * non-interactive indicator (the Sentry cell). Disabled cells dim, mirroring the web `opacity-50` pending state.
 */
@Composable
private fun WatchActionIcon(
    icon: ImageVector,
    contentDescription: String,
    active: Boolean,
    activeTint: Color,
    enabled: Boolean,
    onClick: (() -> Unit)?,
    label: String? = null,
) {
    val tint = if (active) activeTint else MaterialTheme.colorScheme.onSurfaceVariant
    val interactive =
        if (onClick != null) {
            Modifier.clickable(
                enabled = enabled,
                role = Role.Button,
                onClickLabel = contentDescription,
                onClick = onClick,
            )
        } else {
            Modifier
        }
    Surface(
        modifier =
            Modifier
                .size(ACTION_SIZE)
                .graphicsLayer { alpha = if (enabled) 1f else DISABLED_ALPHA }
                .then(interactive)
                .semantics { this.contentDescription = contentDescription },
        shape = CircleShape,
        color = MaterialTheme.colorScheme.surfaceVariant,
        contentColor = tint,
    ) {
        Column(
            modifier = Modifier.fillMaxSize().padding(Spacing.xs),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Icon(imageVector = icon, contentDescription = null, size = IconSize.Lg, tint = tint)
            if (label != null) {
                Caption(text = label)
            }
        }
    }
}

// ── Helpers: badge tone, battery band color, relative age, auto-refresh, ticking clock ────────────────

@Composable
private fun stateBadgeVariant(tone: WatchStateTone): BadgeVariant =
    when (tone) {
        WatchStateTone.Info -> BadgeVariant.Info
        WatchStateTone.Success -> BadgeVariant.Success
        WatchStateTone.Neutral -> BadgeVariant.Neutral
    }

@Composable
private fun batteryBandColor(band: BatteryColorBand): Color =
    when (band) {
        BatteryColorBand.Green -> TeslaTokens.status.success
        BatteryColorBand.Amber -> TeslaTokens.status.warning
        BatteryColorBand.Red -> TeslaTokens.status.danger
        BatteryColorBand.Unknown -> MaterialTheme.colorScheme.surfaceVariant
    }

/**
 * The localized last-updated relative age (web `formatRelativeTime(data.last_updated)`): re-derives every
 * [TICK_MS] from a ticking clock so the age stays live. `null` when there is no parseable stamp (render nothing).
 */
@Composable
private fun watchRelativeAge(lastUpdatedMillis: Long?): String? {
    if (lastUpdatedMillis == null) return null
    val now = rememberNowTicker()
    return relativeAgeLabel(relativeAge(computeAgeSeconds(lastUpdatedMillis, now)))
}

@Composable
private fun relativeAgeLabel(age: FreshnessAge): String? =
    when (age) {
        FreshnessAge.Unknown -> null
        FreshnessAge.JustNow -> stringResource(R.string.translation_freshness_justNow)
        is FreshnessAge.Seconds -> stringResource(R.string.translation_freshness_seconds, age.value.toString())
        is FreshnessAge.Minutes -> stringResource(R.string.translation_freshness_minutes, age.value.toString())
        is FreshnessAge.Hours -> stringResource(R.string.translation_freshness_hours, age.value.toString())
        is FreshnessAge.Days -> stringResource(R.string.translation_freshness_days, age.value.toString())
        is FreshnessAge.Weeks -> stringResource(R.string.translation_freshness_weeks, age.value.toString())
    }

/**
 * Drives the web auto-refresh (`refetchInterval` — the page polls every 30s) plus the ADR-013
 * stale-while-revalidate trigger: a cached/offline snapshot revalidates once it goes stale.
 */
@Composable
private fun WatchFaceAutoRefresh(
    state: UiState<*>,
    onRefresh: () -> Unit,
) {
    LaunchedEffect(Unit) {
        while (true) {
            delay(POLL_INTERVAL_MS)
            onRefresh()
        }
    }
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
}

/** A wall-clock millisecond value that re-emits every [TICK_MS] so the last-updated relative age stays live. */
@Composable
private fun rememberNowTicker(): Long {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(TICK_MS)
            now = System.currentTimeMillis()
        }
    }
    return now
}

private const val COMMAND_LOCK = "lock"
private const val COMMAND_UNLOCK = "unlock"
private const val COMMAND_CLIMATE_ON = "climate_on"
private const val COMMAND_CLIMATE_OFF = "climate_off"

private val GAUGE_SIZE: Dp = 140.dp
private val ACTION_SIZE: Dp = 56.dp
private const val DISABLED_ALPHA = 0.5f
private const val POLL_INTERVAL_MS = 30_000L
private const val TICK_MS = 30_000L

// ── Previews — one per rendered state (content / charging / loading / no-vehicle) ─────────────────────

private val previewSummary =
    WatchSummary(
        vehicleName = "Model 3 Performance",
        state = "online",
        batteryLevel = 73.0,
        rangeKm = 312.0,
        isCharging = false,
        isLocked = true,
        sentryMode = true,
        insideTempC = 21.0,
        isClimateOn = false,
        lastUpdated = "2026-06-16T04:00:00Z",
    )

@Preview(name = "Watch face — content")
@Composable
private fun WatchFaceContentPreview() {
    TeslaSyncTheme {
        WatchFacePageContent(
            state = UiState(phase = UiPhase.Content, data = previewSummary, fetchedAt = System.currentTimeMillis()),
            formatter = UnitFormatter.default(),
            sending = false,
        )
    }
}

@Preview(name = "Watch face — charging")
@Composable
private fun WatchFaceChargingPreview() {
    TeslaSyncTheme {
        WatchFacePageContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data =
                        previewSummary.copy(
                            state = "charging",
                            batteryLevel = 34.0,
                            isCharging = true,
                            timeToFull = 45.0,
                            isLocked = false,
                            isClimateOn = true,
                        ),
                    fetchedAt = System.currentTimeMillis(),
                ),
            formatter = UnitFormatter.default(),
            sending = false,
        )
    }
}

@Preview(name = "Watch face — loading")
@Composable
private fun WatchFaceLoadingPreview() {
    TeslaSyncTheme {
        WatchFacePageContent(
            state = UiState.loading(),
            formatter = UnitFormatter.default(),
            sending = false,
        )
    }
}

@Preview(name = "Watch face — no vehicle")
@Composable
private fun WatchFaceEmptyPreview() {
    TeslaSyncTheme {
        WatchFacePageContent(
            state = UiState(phase = UiPhase.Empty, data = WatchSummary()),
            formatter = UnitFormatter.default(),
            sending = false,
        )
    }
}
