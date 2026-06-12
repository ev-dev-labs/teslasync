// The native Jetpack Compose + Material 3 GasPriceSettings feature view — a parity port of
// web/src/features/settings/components/GasPriceSettings.tsx. It reproduces that surface end to end: the Fuel
// header (icon chip + title + subtitle), the auto-poll toggle (web Play/Pause "Running"/"Stopped" pill), the
// poll-interval Select, the current-price + last-polled metric cards, and the "Poll Now" action with the EIA
// source attribution. Beyond the web (which renders unconditionally via `?.` fallbacks) the native surface
// honours the P3 states contract: a loading skeleton (no cache), a hard-error retry surface (no cache), and the
// stale/offline "last known" view with a freshness chip + auto-refresh — so the panel is never a blank box. A
// resolved status always renders the controls (web parity: there is no empty branch — price → "—", last poll →
// "Never"), so the view-model's emptiness predicate folds Empty into Content. The view performs NO HTTP: it
// binds the [GasPriceSettingsViewModel] (P1/S8) and renders. Toasts (web `useToast`) are surfaced through the
// shared [ToastHost] from the view-model's typed [GasPriceToast] stream, localized at this boundary (P1/S10).
//
// `InvalidPackageDeclaration`/`MatchingDeclarationName`/`filename` are suppressed: the mandated surface directory
// (com/teslasync/feature-views/GasPriceSettings) cannot form a valid Kotlin package and the file hosts several
// co-located composables, exactly as the sibling surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "ktlint:standard:filename")

package io.teslasync.android.featureviews.gaspricesettings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.ToastHost
import io.teslasync.android.components.feedback.ToastItem
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.FieldLabelText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelpIcon
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.presentation.settings.GasPriceStatus
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

private const val MAX_TOASTS = 3
private const val TOAST_DURATION_MS = 4_000L
private const val ACCENT_BG_ALPHA = 0.12f
private const val ACCENT_RING_ALPHA = 0.28f
private const val SOURCE_TEXT_WEIGHT = 1f
private const val EM_DASH = "\u2014"
private const val FADE_DELAY_MS = 120
private val ICON_BOX_SIZE = 40.dp
private val CONTROL_SKELETON_HEIGHT = 72.dp
private val METRIC_SKELETON_HEIGHT = 64.dp
private val BUTTON_SKELETON_HEIGHT = 44.dp

/**
 * Stateful entry point for the GasPriceSettings surface. Binds the [viewModel] (P1/S8), records the one-shot
 * PII-safe `view.opened` diagnostic, owns the toast queue, and renders every lifecycle state the status feed can
 * carry. The host constructs the view-model via [GasPriceSettingsViewModel.create]; this view never performs HTTP.
 */
@Composable
fun GasPriceSettings(
    viewModel: GasPriceSettingsViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val status by viewModel.status.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()
    val polling by viewModel.polling.collectAsStateWithLifecycle()

    val toastQueue = remember { mutableStateListOf<ToastItem>() }
    GasPriceToastPresenter(viewModel, toastQueue)

    Box(modifier = modifier.fillMaxWidth()) {
        GasPriceSettingsContent(
            status = status,
            prefs = prefs,
            polling = polling,
            onToggle = viewModel::toggle,
            onIntervalChange = viewModel::updateInterval,
            onPollNow = viewModel::pollNow,
            onRetry = viewModel::retry,
        )
        ToastHost(
            toasts = toastQueue,
            onDismiss = { id -> toastQueue.removeAll { it.id == id } },
            modifier = Modifier.align(Alignment.BottomCenter),
        )
    }
}

/**
 * Stateless renderer of the surface — the unit/UI-test + preview entry point. Always draws the GlassPanel header
 * (so the surface is never blank), then switches the body across the cache-then-network state matrix: a loading
 * skeleton (no cache), a hard-error retry surface (no cache), and the ready body (content + stale/offline cached
 * view with a freshness chip). Stale, non-error data auto-refreshes, mirroring the sibling surfaces' contract.
 */
@Composable
fun GasPriceSettingsContent(
    status: UiState<GasPriceStatus>,
    prefs: GasDisplayPrefs,
    polling: Boolean,
    onToggle: (Boolean) -> Unit,
    onIntervalChange: (String) -> Unit,
    onPollNow: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(status.stale, status.refreshing, status.hasError) {
        if (status.stale && !status.refreshing && !status.hasError) onRetry()
    }
    FadeIn(modifier = modifier, delayMs = FADE_DELAY_MS) {
        GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                GasHeader()
                GasBody(
                    status = status,
                    prefs = prefs,
                    polling = polling,
                    onToggle = onToggle,
                    onIntervalChange = onIntervalChange,
                    onPollNow = onPollNow,
                    onRetry = onRetry,
                )
            }
        }
    }
}

// ── Header ───────────────────────────────────────────────────────────────────────────────────────────────

/** The Fuel icon chip + title + subtitle (web header row). Always rendered so the panel is never blank. */
@Composable
private fun GasHeader() {
    Row(
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        FuelIconChip()
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            SectionTitle(stringResource(R.string.translation_gas_title))
            Caption(stringResource(R.string.translation_gas_subtitle))
        }
    }
}

/** The rounded amber Fuel chip — the native mapping of the web `bg-orange-500/10 text-orange-400` icon badge. */
@Composable
private fun FuelIconChip() {
    val accent = TeslaTokens.status.warning
    Box(
        modifier =
            Modifier
                .size(ICON_BOX_SIZE)
                .clip(RoundedCornerShape(Radius.lg))
                .background(accent.copy(alpha = ACCENT_BG_ALPHA))
                .border(1.dp, accent.copy(alpha = ACCENT_RING_ALPHA), RoundedCornerShape(Radius.lg)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(GasPriceGlyphs.Fuel, contentDescription = null, size = IconSize.Lg, tint = accent)
    }
}

// ── Body state switch ────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun GasBody(
    status: UiState<GasPriceStatus>,
    prefs: GasDisplayPrefs,
    polling: Boolean,
    onToggle: (Boolean) -> Unit,
    onIntervalChange: (String) -> Unit,
    onPollNow: () -> Unit,
    onRetry: () -> Unit,
) {
    val data = status.data
    when {
        data != null ->
            GasReadyBody(
                status = data,
                uiState = status,
                prefs = prefs,
                polling = polling,
                onToggle = onToggle,
                onIntervalChange = onIntervalChange,
                onPollNow = onPollNow,
            )

        status.isError -> GasErrorBody(onRetry)
        else -> GasLoadingBody()
    }
}

/** The populated controls — auto-poll toggle, interval select, the two metric cards, and the Poll Now row. */
@Composable
private fun GasReadyBody(
    status: GasPriceStatus,
    uiState: UiState<GasPriceStatus>,
    prefs: GasDisplayPrefs,
    polling: Boolean,
    onToggle: (Boolean) -> Unit,
    onIntervalChange: (String) -> Unit,
    onPollNow: () -> Unit,
) {
    val snapshot = remember(status, prefs) { GasPriceSettingsSnapshot.from(status, prefs) }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        if (uiState.stale || uiState.refreshing || uiState.hasError) {
            FreshnessChip(uiState)
        }
        AutoPollField(running = snapshot.running, onToggle = onToggle)
        PollIntervalField(selected = snapshot.interval, onIntervalChange = onIntervalChange)
        GasMetricsRow(snapshot)
        PollNowRow(polling = polling, onPollNow = onPollNow)
    }
}

// ── Auto-poll toggle ─────────────────────────────────────────────────────────────────────────────────────

/**
 * The auto-poll control (web ghost Button pill). A labeled, full-width toggle button showing the Play/Pause glyph
 * and the "Running"/"Stopped" state, tinted success when running. Clicking submits the current state; the
 * view-model negates it. The label + state are exposed to TalkBack via [stateDescription].
 */
@Composable
private fun AutoPollField(
    running: Boolean,
    onToggle: (Boolean) -> Unit,
) {
    val label = stringResource(R.string.translation_gas_autoPoll)
    val stateText =
        if (running) {
            stringResource(R.string.translation_gas_running)
        } else {
            stringResource(R.string.translation_gas_stopped)
        }
    val tint = if (running) TeslaTokens.status.success else MaterialTheme.colorScheme.onSurfaceVariant
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            FieldLabelText(label)
            HelpIcon(
                text = stringResource(R.string.translation_help_fields_settings_gasPriceAutoPoll),
                contentDescription = label,
            )
        }
        Button(
            onClick = { onToggle(running) },
            variant = ButtonVariant.Outline,
            modifier = Modifier.fillMaxWidth().semantics { stateDescription = stateText },
        ) {
            Icon(
                if (running) GasPriceGlyphs.Play else GasPriceGlyphs.Pause,
                contentDescription = null,
                size = IconSize.Sm,
                tint = tint,
            )
            Spacer(Modifier.width(Spacing.sm))
            Text(stateText, style = MaterialTheme.typography.labelLarge, color = tint)
        }
    }
}

// ── Poll interval ────────────────────────────────────────────────────────────────────────────────────────

/** The poll-cadence Select (web `<Select>` + inline HelpIcon). */
@Composable
private fun PollIntervalField(
    selected: PollInterval,
    onIntervalChange: (String) -> Unit,
) {
    val label = stringResource(R.string.translation_gas_pollInterval)
    val options =
        listOf(
            SelectOption(PollInterval.Daily.wire, stringResource(PollInterval.Daily.labelRes)),
            SelectOption(PollInterval.Weekly.wire, stringResource(PollInterval.Weekly.labelRes)),
            SelectOption(PollInterval.BiWeekly.wire, stringResource(PollInterval.BiWeekly.labelRes)),
            SelectOption(PollInterval.Monthly.wire, stringResource(PollInterval.Monthly.labelRes)),
        )
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Select(
            options = options,
            selectedValue = selected.wire,
            onSelect = onIntervalChange,
            label = label,
            modifier = Modifier.fillMaxWidth(),
        )
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            HelpIcon(
                text = stringResource(R.string.translation_help_fields_settings_gasPricePollInterval),
                contentDescription = label,
            )
        }
    }
}

// ── Metric cards ─────────────────────────────────────────────────────────────────────────────────────────

/** The current-price + last-polled cards (web two-up grid). */
@Composable
private fun GasMetricsRow(snapshot: GasPriceSettingsSnapshot) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        MetricBox(
            label = stringResource(R.string.translation_gas_currentPrice),
            value = snapshot.priceText ?: EM_DASH,
            emphasised = true,
            modifier = Modifier.weight(1f),
        )
        MetricBox(
            label = stringResource(R.string.translation_gas_lastPolled),
            value = lastPolledText(snapshot.lastPolled),
            emphasised = false,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun MetricBox(
    label: String,
    value: String,
    emphasised: Boolean,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Sm) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Caption(label)
            if (emphasised) MetricValue(value) else BodyText(value)
        }
    }
}

/** Renders a [LastPolled] as localized text — "Never", the "—" fallback, or a device-locale date-time. */
@Composable
private fun lastPolledText(lastPolled: LastPolled): String =
    when (lastPolled) {
        LastPolled.Never -> stringResource(R.string.translation_gas_never)
        LastPolled.Invalid -> EM_DASH
        is LastPolled.At -> rememberFormattedDateTime(lastPolled.epochMillis)
    }

/** Formats [epochMillis] in the device zone + locale as a medium date / short time (web `formatDateTime`). */
@Composable
private fun rememberFormattedDateTime(epochMillis: Long): String =
    remember(epochMillis) {
        val zoned = Instant.ofEpochMilli(epochMillis).atZone(ZoneId.systemDefault())
        DateTimeFormatter
            .ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
            .withLocale(Locale.getDefault())
            .format(zoned)
    }

// ── Poll Now ─────────────────────────────────────────────────────────────────────────────────────────────

/** The primary "Poll Now" button + the EIA source attribution (web action row). */
@Composable
private fun PollNowRow(
    polling: Boolean,
    onPollNow: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Button(
            label = stringResource(R.string.translation_gas_pollNow),
            onClick = onPollNow,
            variant = ButtonVariant.Primary,
            leadingIcon = GasPriceGlyphs.Zap,
            loading = polling,
        )
        Caption(stringResource(R.string.translation_gas_source), modifier = Modifier.weight(SOURCE_TEXT_WEIGHT))
    }
}

// ── Loading / error / freshness ──────────────────────────────────────────────────────────────────────────

/** The first-load skeleton chrome — accessible "Loading" so the panel is never a silent blank box. */
@Composable
private fun GasLoadingBody() {
    val loading = stringResource(R.string.translation_common_loading)
    Column(
        modifier = Modifier.semantics { contentDescription = loading },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(height = CONTROL_SKELETON_HEIGHT)
        Skeleton(height = CONTROL_SKELETON_HEIGHT)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            Skeleton(modifier = Modifier.weight(1f), height = METRIC_SKELETON_HEIGHT)
            Skeleton(modifier = Modifier.weight(1f), height = METRIC_SKELETON_HEIGHT)
        }
        Skeleton(widthFraction = 0.4f, height = BUTTON_SKELETON_HEIGHT)
    }
}

/** The hard-error surface (no cached fallback) — a localized message with a retry affordance. */
@Composable
private fun GasErrorBody(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Right-aligned freshness chip shown above cached data that is refreshing / stale / offline. */
@Composable
private fun FreshnessChip(state: UiState<*>) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
        )
    }
}

// ── Toast presentation ───────────────────────────────────────────────────────────────────────────────────

/** Localized strings the toast presenter folds a [GasPriceToast] into a [ToastItem] with. */
private data class GasToastStrings(
    val enabled: String,
    val disabled: String,
    val intervalUpdated: String,
    val polled: String,
    val toggleFailed: String,
    val intervalFailed: String,
    val pollFailed: String,
) {
    fun toItem(
        toast: GasPriceToast,
        id: Long,
    ): ToastItem =
        when (toast) {
            GasPriceToast.AutoPollEnabled -> ToastItem(id, enabled, Tone.Info)
            GasPriceToast.AutoPollDisabled -> ToastItem(id, disabled, Tone.Info)
            GasPriceToast.IntervalUpdated -> ToastItem(id, intervalUpdated, Tone.Info)
            GasPriceToast.Polled -> ToastItem(id, polled, Tone.Info)
            GasPriceToast.ToggleFailed -> ToastItem(id, toggleFailed, Tone.Danger)
            GasPriceToast.IntervalFailed -> ToastItem(id, intervalFailed, Tone.Danger)
            GasPriceToast.PollFailed -> ToastItem(id, pollFailed, Tone.Danger)
        }
}

@Composable
private fun rememberGasToastStrings(): GasToastStrings =
    GasToastStrings(
        enabled = stringResource(R.string.translation_gas_enabled),
        disabled = stringResource(R.string.translation_gas_disabled),
        intervalUpdated = stringResource(R.string.translation_gas_intervalUpdated),
        polled = stringResource(R.string.translation_gas_pollTriggered),
        toggleFailed = stringResource(R.string.translation_toast_settings_gasPrice_toggle_error),
        intervalFailed = stringResource(R.string.translation_toast_settings_gasPrice_config_error),
        pollFailed = stringResource(R.string.translation_toast_settings_gasPrice_poll_error),
    )

/** Collects the view-model's [GasPriceToast] stream into the bottom [ToastHost] queue, auto-dismissing each. */
@Composable
private fun GasPriceToastPresenter(
    viewModel: GasPriceSettingsViewModel,
    queue: androidx.compose.runtime.snapshots.SnapshotStateList<ToastItem>,
) {
    val strings = rememberGasToastStrings()
    val scope = rememberCoroutineScope()
    var nextId by remember { mutableLongStateOf(0L) }
    LaunchedEffect(viewModel, strings) {
        viewModel.toasts.collect { toast ->
            val item = strings.toItem(toast, nextId++)
            if (queue.size >= MAX_TOASTS) queue.removeAt(0)
            queue.add(item)
            scope.launch {
                delay(TOAST_DURATION_MS)
                queue.removeAll { it.id == item.id }
            }
        }
    }
}

// ── Previews (tooling-only; one @Preview per render branch) ──────────────────────────────────────────────

private val PREVIEW_PREFS = GasDisplayPrefs(currencySymbol = "$", decimalPrecision = 2, gasUnit = "gallon")

private fun previewStatus(
    enabled: Boolean,
    price: Double,
    interval: String = "7d",
    lastPoll: String = "2026-04-04T02:30:00Z",
): GasPriceStatus =
    GasPriceStatus(
        enabled = enabled,
        pollInterval = interval,
        lastPollTime = lastPoll,
        currentPrice = price,
        currentPriceKwhEq = 0.0,
    )

@Preview(name = "Content — running", showBackground = true)
@Composable
private fun GasPriceContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        GasPriceSettingsContent(
            status = UiState(UiPhase.Content, previewStatus(enabled = true, price = 3.45)),
            prefs = PREVIEW_PREFS,
            polling = false,
            onToggle = {},
            onIntervalChange = {},
            onPollNow = {},
            onRetry = {},
        )
    }
}

@Preview(name = "Content — stopped / never polled", showBackground = true)
@Composable
private fun GasPriceStoppedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        GasPriceSettingsContent(
            status =
                UiState(
                    UiPhase.Content,
                    previewStatus(enabled = false, price = 0.0, interval = "daily", lastPoll = LastPolled.ZERO_SENTINEL),
                ),
            prefs = PREVIEW_PREFS,
            polling = false,
            onToggle = {},
            onIntervalChange = {},
            onPollNow = {},
            onRetry = {},
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun GasPriceLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        GasPriceSettingsContent(
            status = UiState(UiPhase.Loading),
            prefs = PREVIEW_PREFS,
            polling = false,
            onToggle = {},
            onIntervalChange = {},
            onPollNow = {},
            onRetry = {},
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun GasPriceErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        GasPriceSettingsContent(
            status = UiState(UiPhase.Error, errorKind = io.teslasync.android.data.ErrorKind.Network),
            prefs = PREVIEW_PREFS,
            polling = false,
            onToggle = {},
            onIntervalChange = {},
            onPollNow = {},
            onRetry = {},
        )
    }
}

@Preview(name = "Offline — cached", showBackground = true)
@Composable
private fun GasPriceOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        GasPriceSettingsContent(
            status =
                UiState(
                    phase = UiPhase.Content,
                    data = previewStatus(enabled = true, price = 3.59),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = io.teslasync.android.data.ErrorKind.Network,
                ),
            prefs = PREVIEW_PREFS,
            polling = false,
            onToggle = {},
            onIntervalChange = {},
            onPollNow = {},
            onRetry = {},
        )
    }
}
