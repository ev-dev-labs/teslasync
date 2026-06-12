// The native Jetpack Compose + Material 3 ScheduledMaintenanceCard feature view — a parity port of
// web/src/features/system/components/status/ScheduledMaintenanceCard.tsx. It reproduces that surface end to
// end: the header (clock glyph + "Scheduled maintenance" title + an "Active" badge + the within-24h amber
// heads-up), the active-window body (operator message + the "Ends in …" / "Ending now" / "Window has ended"
// countdown + a Clear control), and — when no window is active — the inline scheduler (a description, a
// duration field, an optional banner-message field, and a Save control). Beyond the web (which renders only
// when the read resolves) the native surface honours the P3 states contract: a loading skeleton (no cache), a
// hard-error retry surface (no cache), and the stale/offline "last known" view with a freshness chip +
// auto-refresh — so the panel is never a blank box.
//
// The view performs NO HTTP: it binds the [ScheduledMaintenanceCardViewModel] (P1/S8) and renders. Toasts (web
// `useToast`) are surfaced through the shared [ToastHost] from the view-model's typed [MaintenanceToast]
// stream, localized at this boundary (P1/S10). Every string resolves through the i18n catalog (the
// `serviceMode.*`, `common.*`, `toast.admin.maintenance.*`, `error.*`, `a11y.*` keys); no English literal lives
// in render code, and every interactive control carries a TalkBack-readable label.
//
// Native-idiom adaptations (documented; capability-faithful, not scope-narrowing):
//  • the scheduler form is shown inline in the not-active state rather than behind the web `showSchedule`
//    progressive-disclosure toggle (mobile-idiomatic, and the catalog carries no "Schedule a window" CTA key);
//  • invalid submission is prevented by disabling Save until the duration parses (Material-idiomatic) rather
//    than by the web's validation toasts ("Pick a start time." / "Invalid start time.") — the safety is kept
//    and those literals have no catalog key;
//  • a window starts now and ends now + duration, faithful to the web write (the web sets `mode=maintenance`
//    immediately with `until = start + duration`); the duration field controls the window length.
//
// `InvalidPackageDeclaration`/`MatchingDeclarationName`/`filename` are suppressed: the mandated surface
// directory (com/teslasync/feature-views/ScheduledMaintenanceCard) cannot form a valid Kotlin package and the
// file hosts several co-located composables, exactly as the sibling surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "ktlint:standard:filename")

package io.teslasync.android.featureviews.scheduledmaintenancecard

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.ToastHost
import io.teslasync.android.components.feedback.ToastItem
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant

private const val MAX_TOASTS = 3
private const val TOAST_DURATION_MS = 4_000L
private const val FADE_DELAY_MS = 50
private const val COUNTDOWN_TICK_MS = 30_000L
private val SKELETON_LINE_HEIGHT: Dp = 16.dp
private val SKELETON_BLOCK_HEIGHT: Dp = 52.dp
private const val SKELETON_TITLE_FRACTION = 0.5f

/**
 * The already-localized strings the card renders. The web component holds them inline (in English); here they
 * arrive through the P1/S10 i18n facade at the Compose boundary and are passed down, keeping the renderer free
 * of any English literal and trivially previewable / unit-testable. Every value maps to an existing catalog
 * key (the `serviceMode.*`, `common.*`, `toast.admin.maintenance.*`, `error.*`, `a11y.*` families).
 *
 * @property title the header label (web "Scheduled maintenance").
 * @property activeBadge the "Active" chip shown while a window is running (web "Maintenance active").
 * @property defaultMessage the banner fallback when the operator left the message blank.
 * @property description the not-active scheduler intro (web upgrade/hardware-moves copy).
 * @property durationLabel the duration field label; [minuteUnit] is its unit suffix/hint.
 * @property minuteUnit the minutes unit shown beside the duration and folded into the countdown.
 * @property messageLabel / [messageHelp] the optional banner-message field's label + helper.
 * @property save / [saving] the submit control's idle / in-flight labels.
 * @property clear the clear-window control label.
 * @property endingNow / [ended] the imminent / past edges of the countdown.
 * @property errorTitle / [errorMessage] / [retry] the hard-error surface copy + retry affordance.
 * @property loadingLabel the skeleton region's TalkBack label.
 * @property freshnessFetching / [freshnessError] the freshness chip's refreshing / offline labels.
 */
data class ScheduledMaintenanceStrings(
    val title: String,
    val activeBadge: String,
    val defaultMessage: String,
    val description: String,
    val durationLabel: String,
    val minuteUnit: String,
    val messageLabel: String,
    val messageHelp: String,
    val save: String,
    val saving: String,
    val clear: String,
    val endsInTemplate: String,
    val endingNow: String,
    val ended: String,
    val errorTitle: String,
    val errorMessage: String,
    val retry: String,
    val loadingLabel: String,
    val freshnessFetching: String,
    val freshnessError: String,
)

/**
 * Stateful entry point for the ScheduledMaintenanceCard. Binds the [viewModel] (P1/S8), records the one-shot
 * PII-safe `view.opened` diagnostic, owns the inline scheduler's form state + the toast queue, ticks a clock
 * so the active-window countdown stays live, and renders every lifecycle state the maintenance feed can carry.
 * The host constructs the view-model via [ScheduledMaintenanceCardViewModel.create]; this view never performs
 * HTTP.
 *
 * @param viewModel the state holder bound to the shared maintenance feed + write (P1/S8).
 */
@Composable
fun ScheduledMaintenanceCard(
    viewModel: ScheduledMaintenanceCardViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.maintenanceState.collectAsStateWithLifecycle()
    val actions by viewModel.actions.collectAsStateWithLifecycle()

    var durationText by remember { mutableStateOf(ScheduledMaintenanceCardViewModel.DEFAULT_DURATION_MINUTES.toString()) }
    var message by remember { mutableStateOf("") }

    val toastQueue = remember { mutableStateListOf<ToastItem>() }
    ScheduledMaintenanceToastPresenter(viewModel, toastQueue)

    var nowMs by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(COUNTDOWN_TICK_MS)
            nowMs = System.currentTimeMillis()
        }
    }

    Box(modifier = modifier.fillMaxWidth()) {
        ScheduledMaintenanceCardContent(
            state = state,
            actions = actions,
            durationText = durationText,
            onDurationChange = { durationText = it },
            message = message,
            onMessageChange = { message = it },
            onSchedule = { viewModel.schedule(durationText.toIntOrNull() ?: 0, message) },
            onClear = viewModel::clear,
            onRetry = viewModel::retry,
            nowMs = nowMs,
        )
        ToastHost(
            toasts = toastQueue,
            onDismiss = { id -> toastQueue.removeAll { it.id == id } },
            modifier = Modifier.align(Alignment.BottomCenter),
        )
    }
}

/**
 * Stateless renderer of the surface — the unit/UI-test + preview entry point. Always draws the GlassPanel
 * header (so the surface is never blank), then switches the body across the cache-then-network state matrix: a
 * loading skeleton (no cache), a hard-error retry surface (no cache), and the ready body (active window or the
 * scheduler, plus the stale/offline freshness chip). Stale, non-error data auto-refreshes, mirroring the
 * sibling surfaces' contract. [nowMs] is injected so the countdown derivation is deterministic in tests.
 */
@Composable
fun ScheduledMaintenanceCardContent(
    state: UiState<MaintenanceSnapshot>,
    actions: MaintenanceActions,
    durationText: String,
    onDurationChange: (String) -> Unit,
    message: String,
    onMessageChange: (String) -> Unit,
    onSchedule: () -> Unit,
    onClear: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    nowMs: Long = System.currentTimeMillis(),
    strings: ScheduledMaintenanceStrings = rememberScheduledMaintenanceStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val view = remember(state.data, nowMs) { state.data?.let { ScheduledMaintenanceView.from(it, nowMs) } }
    val accent =
        when {
            view?.within24h == true -> PanelAccent.Warning
            view?.active == true -> PanelAccent.Info
            else -> PanelAccent.None
        }
    FadeIn(modifier = modifier, delayMs = FADE_DELAY_MS) {
        GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg, accent = accent) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                ScheduledMaintenanceHeader(view = view, state = state, strings = strings)
                ScheduledMaintenanceBody(
                    view = view,
                    state = state,
                    actions = actions,
                    durationText = durationText,
                    onDurationChange = onDurationChange,
                    message = message,
                    onMessageChange = onMessageChange,
                    onSchedule = onSchedule,
                    onClear = onClear,
                    onRetry = onRetry,
                    strings = strings,
                )
            }
        }
    }
}

// ── Header ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The card header — the web `<CalendarClock/> Scheduled maintenance` row (the shared `Clock` glyph stands in
 * for the web lucide `CalendarClock`), with the "Active" badge + the within-24h amber `AlertTriangle` heads-up,
 * and the honest freshness chip on the trailing edge when the feed is not settled-fresh. The title is marked as
 * a heading for TalkBack.
 */
@Composable
private fun ScheduledMaintenanceHeader(
    view: ScheduledMaintenanceView?,
    state: UiState<*>,
    strings: ScheduledMaintenanceStrings,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            DataDisplayGlyphs.Clock,
            contentDescription = null,
            size = IconSize.Sm,
            tint = if (view?.active == true) TeslaTokens.status.info else androidx.compose.material3.LocalContentColor.current,
        )
        PanelTitle(strings.title, modifier = Modifier.weight(1f).semantics { heading() })
        if (view?.within24h == true) {
            Icon(DataDisplayGlyphs.AlertTriangle, contentDescription = null, size = IconSize.Sm, tint = TeslaTokens.status.warning)
        }
        if (view?.active == true) {
            Badge(text = strings.activeBadge, variant = BadgeVariant.Info)
        }
        if (shouldShowFreshness(state)) {
            ScheduledMaintenanceFreshness(state = state, strings = strings)
        }
    }
}

/** True whenever the feed is loading, refreshing over cache, stale, or offline — i.e. not settled-fresh. */
private fun shouldShowFreshness(state: UiState<*>): Boolean = state.isLoading || state.refreshing || state.stale || state.hasError

// ── Body state switch ────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun ScheduledMaintenanceBody(
    view: ScheduledMaintenanceView?,
    state: UiState<MaintenanceSnapshot>,
    actions: MaintenanceActions,
    durationText: String,
    onDurationChange: (String) -> Unit,
    message: String,
    onMessageChange: (String) -> Unit,
    onSchedule: () -> Unit,
    onClear: () -> Unit,
    onRetry: () -> Unit,
    strings: ScheduledMaintenanceStrings,
) {
    when {
        view != null && view.active ->
            ScheduledMaintenanceActiveBody(view = view, actions = actions, onClear = onClear, strings = strings)

        view != null ->
            ScheduledMaintenanceSchedulerBody(
                actions = actions,
                durationText = durationText,
                onDurationChange = onDurationChange,
                message = message,
                onMessageChange = onMessageChange,
                onSchedule = onSchedule,
                strings = strings,
            )

        state.isError -> ScheduledMaintenanceErrorBody(strings = strings, onRetry = onRetry)
        else -> ScheduledMaintenanceLoadingBody(strings = strings)
    }
}

/**
 * The active-window body — the web active branch: the operator message (or the default banner copy when blank),
 * the "Ends in … / Ending now / Window has ended" countdown line (web "Active until …"), and the Clear control.
 */
@Composable
private fun ScheduledMaintenanceActiveBody(
    view: ScheduledMaintenanceView,
    actions: MaintenanceActions,
    onClear: () -> Unit,
    strings: ScheduledMaintenanceStrings,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        BodyText(view.message?.takeIf { it.isNotBlank() } ?: strings.defaultMessage)
        Caption(countdownText(view, strings))
        Button(
            label = if (actions.clearing) strings.saving else strings.clear,
            onClick = onClear,
            variant = ButtonVariant.Outline,
            leadingIcon = TeslaGlyphs.Close,
            loading = actions.clearing,
        )
    }
}

/**
 * The not-active scheduler body — the web `!isActive` branch's description plus the inline scheduler form
 * (duration + optional banner message + Save). Save is disabled until the duration parses to a valid window
 * length (the native stand-in for the web validation toasts), and shows the in-flight label while writing.
 */
@Composable
private fun ScheduledMaintenanceSchedulerBody(
    actions: MaintenanceActions,
    durationText: String,
    onDurationChange: (String) -> Unit,
    message: String,
    onMessageChange: (String) -> Unit,
    onSchedule: () -> Unit,
    strings: ScheduledMaintenanceStrings,
) {
    val durationValid = durationText.toIntOrNull()?.let { it >= ScheduledMaintenanceCardViewModel.MIN_DURATION_MINUTES } ?: false
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        BodyText(strings.description)
        Input(
            value = durationText,
            onValueChange = onDurationChange,
            label = strings.durationLabel,
            hint = strings.minuteUnit,
            keyboardType = KeyboardType.Number,
            enabled = !actions.scheduling,
        )
        Input(
            value = message,
            onValueChange = onMessageChange,
            label = strings.messageLabel,
            hint = strings.messageHelp,
            singleLine = false,
            enabled = !actions.scheduling,
        )
        Button(
            label = if (actions.scheduling) strings.saving else strings.save,
            onClick = onSchedule,
            variant = ButtonVariant.Primary,
            leadingIcon = DataDisplayGlyphs.Clock,
            enabled = durationValid && !actions.scheduling,
            loading = actions.scheduling,
        )
    }
}

/** First-load skeleton — accessible "Loading" so the panel is never a silent blank box. */
@Composable
private fun ScheduledMaintenanceLoadingBody(strings: ScheduledMaintenanceStrings) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = strings.loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Skeleton(widthFraction = SKELETON_TITLE_FRACTION, height = SKELETON_LINE_HEIGHT)
        Skeleton(height = SKELETON_LINE_HEIGHT)
        Skeleton(widthFraction = 0.6f, height = SKELETON_BLOCK_HEIGHT, rounded = true)
    }
}

/** The hard-error surface (no cached fallback) — a localized message with a retry affordance (P3-mandated). */
@Composable
private fun ScheduledMaintenanceErrorBody(
    strings: ScheduledMaintenanceStrings,
    onRetry: () -> Unit,
) {
    ErrorDisplay(
        message = strings.errorMessage,
        title = strings.errorTitle,
        onRetry = onRetry,
        retryLabel = strings.retry,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Right-aligned freshness chip shown above cached data that is refreshing / stale / offline. */
@Composable
private fun ScheduledMaintenanceFreshness(
    state: UiState<*>,
    strings: ScheduledMaintenanceStrings,
) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing || state.isLoading,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = strings.freshnessFetching,
        errorLabel = strings.freshnessError,
    )
}

// ── Countdown text ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The active-window countdown line — web "Active until …": an already-past end reads [ScheduledMaintenanceStrings.ended],
 * a sub-minute remainder reads [ScheduledMaintenanceStrings.endingNow], and otherwise the localized
 * "Ends in {n} {unit}" (the catalog `serviceMode.banner.endsIn` template folded with the minutes-remaining).
 */
private fun countdownText(
    view: ScheduledMaintenanceView,
    strings: ScheduledMaintenanceStrings,
): String =
    when {
        view.ended -> strings.ended
        view.endingNow -> strings.endingNow
        view.minutesRemaining != null -> strings.endsInTemplate.format("${view.minutesRemaining} ${strings.minuteUnit}")
        else -> strings.endingNow
    }

// ── Strings ──────────────────────────────────────────────────────────────────────────────────────────────

/** Resolves the localized [ScheduledMaintenanceStrings] from the P1/S10 catalog (existing keys only). */
@Composable
fun rememberScheduledMaintenanceStrings(): ScheduledMaintenanceStrings =
    ScheduledMaintenanceStrings(
        title = stringResource(R.string.translation_serviceMode_banner_maintenanceTitle),
        activeBadge = stringResource(R.string.translation_common_active),
        defaultMessage = stringResource(R.string.translation_serviceMode_banner_defaultMaintenance),
        description = stringResource(R.string.translation_serviceMode_admin_subtitle),
        durationLabel = stringResource(R.string.translation_common_duration),
        minuteUnit = stringResource(R.string.translation_common_min),
        messageLabel = stringResource(R.string.translation_serviceMode_admin_messageLabel),
        messageHelp = stringResource(R.string.translation_serviceMode_admin_messageHelp),
        save = stringResource(R.string.translation_serviceMode_admin_save),
        saving = stringResource(R.string.translation_serviceMode_admin_saving),
        clear = stringResource(R.string.translation_common_clear),
        endsInTemplate = stringResource(R.string.translation_serviceMode_banner_endsIn),
        endingNow = stringResource(R.string.translation_serviceMode_banner_endingNow),
        ended = stringResource(R.string.translation_serviceMode_banner_ended),
        errorTitle = stringResource(R.string.translation_error_serverError_title),
        errorMessage = stringResource(R.string.translation_error_serverError_message),
        retry = stringResource(R.string.translation_common_retry),
        loadingLabel = stringResource(R.string.translation_a11y_loading),
        freshnessFetching = stringResource(R.string.translation_common_loading),
        freshnessError = stringResource(R.string.translation_common_offline),
    )

// ── Toast presentation ───────────────────────────────────────────────────────────────────────────────────

/** Localized strings the toast presenter folds a [MaintenanceToast] into a [ToastItem] with. */
private data class MaintenanceToastStrings(
    val saved: String,
    val failed: String,
) {
    fun toItem(
        toast: MaintenanceToast,
        id: Long,
    ): ToastItem =
        when (toast) {
            MaintenanceToast.Saved -> ToastItem(id, saved, Tone.Success)
            MaintenanceToast.Failed -> ToastItem(id, failed, Tone.Danger)
        }
}

@Composable
private fun rememberMaintenanceToastStrings(): MaintenanceToastStrings =
    MaintenanceToastStrings(
        saved = stringResource(R.string.translation_toast_admin_maintenance_success),
        failed = stringResource(R.string.translation_toast_admin_maintenance_error),
    )

/** Collects the view-model's [MaintenanceToast] stream into the bottom [ToastHost] queue, auto-dismissing each. */
@Composable
private fun ScheduledMaintenanceToastPresenter(
    viewModel: ScheduledMaintenanceCardViewModel,
    queue: SnapshotStateList<ToastItem>,
) {
    val strings = rememberMaintenanceToastStrings()
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

private fun previewState(
    snapshot: MaintenanceSnapshot,
    stale: Boolean = false,
    errorKind: ErrorKind? = null,
    fetchedAt: Long? = null,
): UiState<MaintenanceSnapshot> =
    UiState(
        phase = UiPhase.Content,
        data = snapshot,
        stale = stale,
        errorKind = errorKind,
        fetchedAt = fetchedAt,
    )

@Composable
private fun PreviewCard(
    state: UiState<MaintenanceSnapshot>,
    nowMs: Long,
) {
    TeslaSyncTheme(dynamicColor = false) {
        ScheduledMaintenanceCardContent(
            state = state,
            actions = MaintenanceActions(),
            durationText = "60",
            onDurationChange = {},
            message = "",
            onMessageChange = {},
            onSchedule = {},
            onClear = {},
            onRetry = {},
            nowMs = nowMs,
        )
    }
}

private const val PREVIEW_NOW = 1_700_000_000_000L

@Preview(name = "Active — within 24h", showBackground = true, widthDp = 420)
@Composable
private fun ActiveWithin24hPreview() {
    val until = Instant.ofEpochMilli(PREVIEW_NOW + 45L * 60L * 1000L).toString()
    PreviewCard(
        state = previewState(MaintenanceSnapshot(MAINTENANCE_MODE, "Upgrading the database cluster.", until)),
        nowMs = PREVIEW_NOW,
    )
}

@Preview(name = "Active — long window", showBackground = true, widthDp = 420)
@Composable
private fun ActiveLongPreview() {
    val until = Instant.ofEpochMilli(PREVIEW_NOW + 72L * 60L * 60L * 1000L).toString()
    PreviewCard(state = previewState(MaintenanceSnapshot(MAINTENANCE_MODE, null, until)), nowMs = PREVIEW_NOW)
}

@Preview(name = "Scheduler — not active", showBackground = true, widthDp = 420)
@Composable
private fun SchedulerPreview() {
    PreviewCard(state = previewState(MaintenanceSnapshot.DEFAULT), nowMs = PREVIEW_NOW)
}

@Preview(name = "Loading — first fetch", showBackground = true, widthDp = 420)
@Composable
private fun LoadingPreview() {
    PreviewCard(state = UiState.loading(), nowMs = PREVIEW_NOW)
}

@Preview(name = "Error — no cache", showBackground = true, widthDp = 420)
@Composable
private fun ErrorPreview() {
    PreviewCard(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), nowMs = PREVIEW_NOW)
}

@Preview(name = "Offline — cached last known", showBackground = true, widthDp = 420)
@Composable
private fun OfflinePreview() {
    PreviewCard(
        state =
            previewState(
                MaintenanceSnapshot.DEFAULT,
                stale = true,
                errorKind = ErrorKind.Network,
                fetchedAt = PREVIEW_NOW,
            ),
        nowMs = PREVIEW_NOW,
    )
}
