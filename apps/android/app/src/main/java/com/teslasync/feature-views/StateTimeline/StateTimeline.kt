// The native Jetpack Compose + Material 3 StateTimeline feature view — a parity port of
// web/src/features/system/components/state-machine/StateTimeline.tsx. The web component is the FSM debugger's
// horizontal mini-timeline: a translucent bordered panel that, when the active window holds transitions,
// renders an axis (the window's start time, a "Window: N min" caption, and its end time) above a track of
// colored tick buttons — each placed by its `created_at` fraction of the window, tinted by its destination
// state via the shared FSM theme, enlarged with a ring when selected, and wrapped in a "from → to · time"
// tooltip. When the window is empty it instead surfaces a friendly hint: "No transitions in window", an
// optional "· Last transition {rel}" relative time, and optional "Widen window to {label}" / "Jump to last
// transition" actions when the page exposes them.
//
// The surface binds no data hook of its own (web parity): the FSM debugger page owns the buffer, the window
// length, and the selected id, and hands the pre-windowed `transitions` down. Its only web hooks are
// `useTranslation` (the i18n catalog, P1/S10) and `useDateFormat` (the browser locale/timezone boundary,
// mapped here to the device [Locale]/[ZoneId]). The host supplies the transitions through the shared P1/S8
// state-holder layer as a [UiState], so this feature view also renders every lifecycle state that layer can
// carry — loading, hard error with retry, content, the empty window, and stale/offline (cached "last known")
// — without ever fetching. Every derivation flows through the pure [StateTimelineProjection] /
// [FsmStateAccents]; the composable is a thin render layer.
//
// Color mapping (P1/S9 tokens, no ported Tailwind): the FSM `dot` palette resolves to design tokens —
// success → `status.success`, warning → `status.warning`, danger → `status.danger`, the info-blue dot →
// `chart.speed`, the cyan override → `chart.regen`, the purple override → `chart.power`, and the neutral/muted
// dot → `onSurfaceVariant`. The axis baseline (web `--surface-2`) → `surfaceVariant`; the empty/loading
// chrome uses the same shared primitives as the sibling timeline surfaces. Motion honors the reduced-motion
// preference (P1/S9) through the shared [FadeIn]. Accessibility: each tick is a 44 dp Material touch target
// exposing the localized "{from} to {to}" label and the Button role; the decorative baseline is cleared from
// the semantics tree. The one-shot PII-safe `view.opened` diagnostic (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/StateTimeline) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.statetimeline

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.Tooltip
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.delay
import java.time.ZoneId
import java.util.Locale

// Web `h-10` track + `h-2.5/h-4` ticks, expanded to a 44 dp Material touch target around each dot.
private val TRACK_HEIGHT: Dp = 48.dp
private val TOUCH_TARGET: Dp = 44.dp
private val TICK_DOT: Dp = 10.dp
private val TICK_DOT_SELECTED: Dp = 16.dp
private val TICK_RING: Dp = 2.dp
private val BASELINE_HEIGHT: Dp = 1.dp

// Web `ring-white/30` selection ring alpha.
private const val RING_ALPHA = 0.3f

// Loading skeleton geometry — three axis-label bars over a baseline with sample ticks.
private val AXIS_LABEL_HEIGHT: Dp = 10.dp
private const val AXIS_SKELETON_FRACTION = 0.22f
private val SKELETON_TICK_FRACTIONS = listOf(0.18f, 0.42f, 0.61f, 0.86f)

// Live clock cadence for the relative hint + scrolling window when no fixed anchor is supplied.
private const val NOW_TICK_MS = 30_000L

/**
 * Stateful entry point for the FSM state timeline. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11) and renders every lifecycle [state] the shared transitions feed can carry. The host owns the feed
 * (P1/S8) and the presentational inputs below; this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the pre-windowed `FSMTransition[]` (web `transitions`).
 * @param fsmType the machine whose theme resolves each tick's destination-state color (web `fsmType`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param selectedId the currently selected transition id, highlighted on the track (web `selectedId`).
 * @param onSelect selection callback receiving the tapped transition (web `onSelect`).
 * @param windowMinutes the window length in minutes used for the axis labels (web `windowMinutes`).
 * @param anchorMillis a fixed end-time anchor in epoch millis, or `null` to track "now" live (web `anchor`).
 * @param lastTransition the most recent transition (in or outside the window) for the empty-state hint.
 * @param widerPreset the smallest preset (in minutes) that would include [lastTransition] (web `widerPreset`).
 * @param onWidenWindow snaps the window to [widerPreset] (web `onWidenWindow`); `null` hides the action.
 * @param onJumpToLast freezes and selects [lastTransition] (web `onJumpToLast`); `null` hides the action.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun StateTimeline(
    state: UiState<List<FsmTransition>>,
    fsmType: String,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    selectedId: Long? = null,
    onSelect: (FsmTransition) -> Unit = {},
    windowMinutes: Int = STATE_TIMELINE_DEFAULT_WINDOW_MINUTES,
    anchorMillis: Long? = null,
    lastTransition: FsmTransition? = null,
    widerPreset: Int? = null,
    onWidenWindow: (() -> Unit)? = null,
    onJumpToLast: (() -> Unit)? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { StateTimelineDiagnostics.recordViewOpened(logger) }
    StateTimelineContent(
        state = state,
        fsmType = fsmType,
        onRetry = onRetry,
        modifier = modifier,
        selectedId = selectedId,
        onSelect = onSelect,
        windowMinutes = windowMinutes,
        anchorMillis = anchorMillis,
        lastTransition = lastTransition,
        widerPreset = widerPreset,
        onWidenWindow = onWidenWindow,
        onJumpToLast = onJumpToLast,
    )
}

/**
 * Web-parity overload mirroring the web component's `transitions: FSMTransition[]` prop, for hosts that
 * already hold the pre-windowed list. An empty list renders the empty-window hint (web `ticks.length === 0`);
 * a non-empty list renders the track. Records `view.opened` like the stateful entry. There is no fetch behind
 * it, so it offers no retry affordance.
 */
@Composable
fun StateTimeline(
    transitions: List<FsmTransition>,
    fsmType: String,
    modifier: Modifier = Modifier,
    selectedId: Long? = null,
    onSelect: (FsmTransition) -> Unit = {},
    windowMinutes: Int = STATE_TIMELINE_DEFAULT_WINDOW_MINUTES,
    anchorMillis: Long? = null,
    lastTransition: FsmTransition? = null,
    widerPreset: Int? = null,
    onWidenWindow: (() -> Unit)? = null,
    onJumpToLast: (() -> Unit)? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(transitions) {
            val phase = if (transitions.isEmpty()) UiPhase.Empty else UiPhase.Content
            UiState(phase = phase, data = transitions)
        }
    StateTimeline(
        state = state,
        fsmType = fsmType,
        onRetry = {},
        modifier = modifier,
        selectedId = selectedId,
        onSelect = onSelect,
        windowMinutes = windowMinutes,
        anchorMillis = anchorMillis,
        lastTransition = lastTransition,
        widerPreset = widerPreset,
        onWidenWindow = onWidenWindow,
        onJumpToLast = onJumpToLast,
        logger = logger,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web component's
 * empty-window and populated-track branches and adds the lifecycle chrome the host's feed implies: a loading
 * skeleton, a hard-error retry surface, and a freshness chip that reflects refreshing/stale/offline. Stale
 * (non-error) data auto-refreshes, mirroring the web freshness contract. [locale]/[zoneId] format every
 * timestamp; [nowMillis] supplies the live clock (defaulting to a 30 s ticking wall clock) so tests can pin it.
 */
@Composable
fun StateTimelineContent(
    state: UiState<List<FsmTransition>>,
    fsmType: String,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    selectedId: Long? = null,
    onSelect: (FsmTransition) -> Unit = {},
    windowMinutes: Int = STATE_TIMELINE_DEFAULT_WINDOW_MINUTES,
    anchorMillis: Long? = null,
    lastTransition: FsmTransition? = null,
    widerPreset: Int? = null,
    onWidenWindow: (() -> Unit)? = null,
    onJumpToLast: (() -> Unit)? = null,
    locale: Locale = Locale.getDefault(),
    zoneId: ZoneId = ZoneId.systemDefault(),
    nowMillis: Long = rememberNowMillis(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val palette = rememberFsmAccentPalette()
    val now = nowMillis
    val anchor = anchorMillis ?: now

    FadeIn(modifier = modifier) {
        GlassPanel(padding = PanelPadding.Md) {
            when (stateTimelineSurfaceFor(state.isLoading, state.isError)) {
                StateTimelineSurface.Loading ->
                    StateTimelineLoading(label = stringResource(R.string.translation_common_loading))
                StateTimelineSurface.Error -> StateTimelineError(onRetry = onRetry)
                StateTimelineSurface.Ready -> {
                    if (state.stale || state.refreshing || state.hasError) {
                        StateTimelineFreshness(state = state)
                    }
                    val window =
                        remember(state.data, anchor, windowMinutes) {
                            StateTimelineProjection.project(state.data ?: emptyList(), anchor, windowMinutes)
                        }
                    if (window.ticks.isEmpty()) {
                        StateTimelineEmptyWindow(
                            lastTransition = lastTransition,
                            widerPreset = widerPreset,
                            onWidenWindow = onWidenWindow,
                            onJumpToLast = onJumpToLast,
                            nowMillis = now,
                            zoneId = zoneId,
                            locale = locale,
                        )
                    } else {
                        StateTimelineTrack(
                            window = window,
                            fsmType = fsmType,
                            selectedId = selectedId,
                            onSelect = onSelect,
                            windowMinutes = windowMinutes,
                            palette = palette,
                            zoneId = zoneId,
                            locale = locale,
                        )
                    }
                }
            }
        }
    }
}

/** The freshness chip row (web "offline / last known" affordance), right-aligned above the body. */
@Composable
private fun StateTimelineFreshness(state: UiState<List<FsmTransition>>) {
    val formatAge = rememberStateTimelineFreshnessFormatter()
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        horizontalArrangement = Arrangement.End,
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
    }
}

/**
 * The populated branch: the three-up axis (start time, the "Window: N min" caption, end time) above the
 * baseline track of placed ticks. The track measures its own width so each tick is centered on its time
 * fraction, mirroring the web `left: {pct}%` + `translateX(-50%)` placement.
 */
@Composable
private fun StateTimelineTrack(
    window: StateTimelineWindow,
    fsmType: String,
    selectedId: Long?,
    onSelect: (FsmTransition) -> Unit,
    windowMinutes: Int,
    palette: FsmAccentPalette,
    zoneId: ZoneId,
    locale: Locale,
) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Caption(StateTimelineTime.formatClock(window.startMillis, zoneId, locale))
            Caption(stringResource(R.string.translation_debugger_timeline_windowLabel, windowMinutes))
            Caption(StateTimelineTime.formatClock(window.endMillis, zoneId, locale))
        }
        Spacer(Modifier.height(Spacing.sm))
        BoxWithConstraints(modifier = Modifier.fillMaxWidth().height(TRACK_HEIGHT)) {
            val trackWidth = maxWidth
            Box(
                modifier =
                    Modifier
                        .align(Alignment.CenterStart)
                        .fillMaxWidth()
                        .height(BASELINE_HEIGHT)
                        .background(MaterialTheme.colorScheme.surfaceVariant)
                        .clearAndSetSemantics {},
            )
            window.ticks.forEach { tick ->
                StateTimelineTickMarker(
                    tick = tick,
                    fsmType = fsmType,
                    selectedId = selectedId,
                    onSelect = onSelect,
                    palette = palette,
                    trackWidth = trackWidth,
                    zoneId = zoneId,
                    locale = locale,
                )
            }
        }
    }
}

/**
 * One placed tick — a 44 dp touch target centered on its time fraction, holding the accent-tinted dot
 * (enlarged with a ring when [selectedId] matches). Wrapped in a tooltip showing "from → to · time" and
 * exposing the localized "{from} to {to}" label + Button role to TalkBack.
 */
@Composable
private fun BoxScope.StateTimelineTickMarker(
    tick: StateTimelineTick,
    fsmType: String,
    selectedId: Long?,
    onSelect: (FsmTransition) -> Unit,
    palette: FsmAccentPalette,
    trackWidth: Dp,
    zoneId: ZoneId,
    locale: Locale,
) {
    val transition = tick.transition
    val accent = remember(fsmType, transition.toState) { FsmStateAccents.accentFor(fsmType, transition.toState) }
    val color = palette.colorFor(accent)
    val isSelected = selectedId != null && transition.id == selectedId
    val dotSize = if (isSelected) TICK_DOT_SELECTED else TICK_DOT
    val ringColor = MaterialTheme.colorScheme.onSurface.copy(alpha = RING_ALPHA)
    val aria =
        stringResource(R.string.translation_debugger_timeline_tickAria, transition.fromState, transition.toState)
    val clock = StateTimelineTime.formatClock(transition.ts, zoneId, locale)
    val tooltip = "${transition.fromState} \u2192 ${transition.toState} \u00B7 $clock"
    val centerX = trackWidth * tick.leftFraction.coerceIn(0f, 1f)

    Tooltip(
        text = tooltip,
        modifier = Modifier.align(Alignment.CenterStart).offset(x = centerX - TOUCH_TARGET / 2),
    ) {
        Box(
            modifier =
                Modifier
                    .size(TOUCH_TARGET)
                    .clip(CircleShape)
                    .clickable(role = Role.Button, onClickLabel = aria) { onSelect(transition) }
                    .semantics { contentDescription = aria },
            contentAlignment = Alignment.Center,
        ) {
            val dotModifier =
                Modifier
                    .size(dotSize)
                    .clip(CircleShape)
                    .background(color)
            Box(
                modifier =
                    if (isSelected) {
                        dotModifier.border(TICK_RING, ringColor, CircleShape)
                    } else {
                        dotModifier
                    },
            )
        }
    }
}

/**
 * The empty branch (web `ticks.length === 0`): the "No transitions in window" message, an optional
 * "· Last transition {rel}" relative hint when [lastTransition] is present, and optional actions — a primary
 * "Widen window to {label}" when [widerPreset] + [onWidenWindow] are set, and a ghost "Jump to last
 * transition" when [lastTransition] + [onJumpToLast] are set. Never a blank box.
 */
@Composable
private fun StateTimelineEmptyWindow(
    lastTransition: FsmTransition?,
    widerPreset: Int?,
    onWidenWindow: (() -> Unit)?,
    onJumpToLast: (() -> Unit)?,
    nowMillis: Long,
    zoneId: ZoneId,
    locale: Locale,
) {
    val context = LocalContext.current
    val emptyText = stringResource(R.string.translation_debugger_timeline_empty)
    val hasHint = lastTransition != null
    val showWiden = widerPreset != null && onWidenWindow != null
    val showJump = lastTransition != null && onJumpToLast != null

    val relText =
        lastTransition?.let { transition ->
            val lastSeen = stateTimelineLastSeen(StateTimelineTime.parseMillis(transition.ts), nowMillis)
            stateTimelineRelativeLabel(context, lastSeen, zoneId, locale)
        }
    val message =
        if (relText != null) {
            "$emptyText \u00B7 ${context.getString(R.string.translation_debugger_timeline_lastSeen, relText)}"
        } else {
            emptyText
        }

    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        HelperText(message)
        if (hasHint && (showWiden || showJump)) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                if (showWiden) {
                    Button(
                        label =
                            context.getString(
                                R.string.translation_debugger_timeline_widenTo,
                                stateTimelineWindowPresetLabel(context, widerPreset),
                            ),
                        onClick = onWidenWindow,
                        variant = ButtonVariant.Primary,
                        size = ButtonSize.Sm,
                    )
                }
                if (showJump) {
                    Button(
                        label = stringResource(R.string.translation_debugger_timeline_jumpToLast),
                        onClick = onJumpToLast,
                        variant = ButtonVariant.Ghost,
                        size = ButtonSize.Sm,
                    )
                }
            }
        }
    }
}

/** First-load skeleton — axis-label bars over a baseline with sample ticks, so the panel is never blank. */
@Composable
private fun StateTimelineLoading(label: String) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            repeat(SKELETON_AXIS_LABELS) {
                Skeleton(widthFraction = AXIS_SKELETON_FRACTION, height = AXIS_LABEL_HEIGHT)
            }
        }
        BoxWithConstraints(modifier = Modifier.fillMaxWidth().height(TRACK_HEIGHT)) {
            val trackWidth = maxWidth
            Box(
                modifier =
                    Modifier
                        .align(Alignment.CenterStart)
                        .fillMaxWidth()
                        .height(BASELINE_HEIGHT)
                        .background(MaterialTheme.colorScheme.surfaceVariant),
            )
            SKELETON_TICK_FRACTIONS.forEach { fraction ->
                Box(
                    modifier =
                        Modifier
                            .align(Alignment.CenterStart)
                            .offset(x = trackWidth * fraction - TICK_DOT / 2)
                            .size(TICK_DOT),
                ) {
                    Skeleton(height = TICK_DOT, rounded = true)
                }
            }
        }
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun StateTimelineError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Resolved per-theme accent palette — the native analogue of the web FSM `dot` color table, mapped to design
 * tokens (never a raw hex in render code). Read once in [rememberFsmAccentPalette] and captured here so the
 * track's per-tick lambda can resolve a color without a composable context.
 */
private class FsmAccentPalette(
    private val colors: Map<FsmAccent, Color>,
) {
    fun colorFor(accent: FsmAccent): Color = colors.getValue(accent)
}

@Composable
private fun rememberFsmAccentPalette(): FsmAccentPalette {
    val success = TeslaTokens.status.success
    val warning = TeslaTokens.status.warning
    val danger = TeslaTokens.status.danger
    val info = TeslaTokens.chart.speed
    val neutral = MaterialTheme.colorScheme.onSurfaceVariant
    val cyan = TeslaTokens.chart.regen
    val purple = TeslaTokens.chart.power
    return remember(success, warning, danger, info, neutral, cyan, purple) {
        FsmAccentPalette(
            mapOf(
                FsmAccent.Success to success,
                FsmAccent.Warning to warning,
                FsmAccent.Danger to danger,
                FsmAccent.Info to info,
                FsmAccent.Neutral to neutral,
                FsmAccent.Cyan to cyan,
                FsmAccent.Purple to purple,
            ),
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling timeline surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberStateTimelineFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> STATE_TIMELINE_EM_DASH
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

/** Ticks the wall clock every 30 s so the relative hint + live window stay current. */
@Composable
private fun rememberNowMillis(): Long {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(NOW_TICK_MS)
            now = System.currentTimeMillis()
        }
    }
    return now
}

private const val SKELETON_AXIS_LABELS = 3

// ── Non-composable label resolvers (Context.getString for `%1$s`-interpolated catalog strings) ──

/**
 * Maps a [StateTimelineLastSeen] bucket to its localized relative string — the web `formatRelative` output.
 * Returns `null` for [StateTimelineLastSeen.Unknown] so the composable omits the hint entirely.
 */
private fun stateTimelineRelativeLabel(
    context: Context,
    lastSeen: StateTimelineLastSeen,
    zoneId: ZoneId,
    locale: Locale,
): String? =
    when (lastSeen) {
        StateTimelineLastSeen.Unknown -> null
        StateTimelineLastSeen.JustNow -> context.getString(R.string.translation_freshness_justNow)
        is StateTimelineLastSeen.Minutes -> context.getString(R.string.translation_freshness_minutes, lastSeen.value)
        is StateTimelineLastSeen.Hours -> context.getString(R.string.translation_freshness_hours, lastSeen.value)
        is StateTimelineLastSeen.Days -> context.getString(R.string.translation_freshness_days, lastSeen.value)
        is StateTimelineLastSeen.AbsoluteDate -> StateTimelineTime.formatDate(lastSeen.millis, zoneId, locale)
    }

/** Maps a window length in minutes to its localized preset label — the web `presetLabel` output. */
private fun stateTimelineWindowPresetLabel(
    context: Context,
    minutes: Int,
): String =
    when (val preset = stateTimelineWindowPreset(minutes)) {
        is StateTimelineWindowPreset.Minutes ->
            context.getString(R.string.translation_debugger_window_minutes, preset.value)
        is StateTimelineWindowPreset.Hours ->
            context.getString(R.string.translation_debugger_window_hours, preset.value)
        StateTimelineWindowPreset.Day -> context.getString(R.string.translation_debugger_window_day)
    }
