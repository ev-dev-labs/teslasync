// The native Jetpack Compose + Material 3 FSM-debugger Live/Freeze/Step controls feature view — a parity port of
// web/src/features/system/components/state-machine/LiveControls.tsx. The web component is a purely controlled
// toolbar: it receives `isLive`, the buffer `windowMinutes`, the step-validity flags, and the buffer counts
// (`windowCount` / `totalCount`, plus the @deprecated single-scope `bufferCount`), and renders the Live/Freeze
// segmented pair, prev/next steppers, a Window select, a Clear-buffer action, and a right-hand counter whose
// copy distinguishes the Window-dropdown slice from the underlying 24 h fetch (with a hover/long-press tooltip).
//
// The native surface keeps that controlled contract. Its only web hook is `useTranslation`, mapped here to the
// i18n catalog (P1/S10); it performs NO HTTP and binds no feed of its own — the transition-buffer counts arrive
// through the shared state-holder layer (P1/S8) as a [UiState], exactly as the page parent would feed them.
// Because that layer carries a full lifecycle, the surface renders every state it can carry: a loading skeleton
// while the buffer is first loading, a hard error with retry, the ready toolbar, an always-visible empty-buffer
// hint where the web simply shows "0 buffered", and a stale/offline freshness chip (with auto-refresh) when
// cached counts are shown — never a blank box. A web-parity overload takes the counts directly for hosts that
// already hold them.
//
// Per Android guidelines this is built from native primitives + design tokens (P1/S9), never ported Tailwind
// classes; the web `←` / `→` glyph buttons become Material icon buttons whose `aria-label` becomes the
// `contentDescription` TalkBack reads, and the web `aria-pressed` segmented pair becomes the Material `selected`
// semantics. The Live indicator's pulse honours the reduced-motion preference. `view.opened` is emitted once via
// the sanctioned redacting logger (P1/S11).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/LiveControls — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path, exactly as the sibling surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.livecontrols

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconButtonVariant
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.components.ui.Tooltip
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

private const val EM_DASH: String = "\u2014"
private const val BAR_BG_ALPHA: Float = 0.4f
private const val DOT_MIN_ALPHA: Float = 0.35f
private const val DOT_PULSE_MS: Int = 900
private val WINDOW_FIELD_WIDTH: Dp = 132.dp
private val DIVIDER_HEIGHT: Dp = 20.dp
private val DIVIDER_WIDTH: Dp = 1.dp
private val LIVE_DOT_SIZE: Dp = 8.dp
private val SKELETON_BAR_HEIGHT: Dp = 36.dp

/** The resolved zero state used when a Ready surface has no counts payload (defensive null-fold). */
private val EMPTY_COUNTS: BufferCounts = BufferCounts(inWindow = 0, total = 0, dual = false)

/**
 * Stateful entry point for the FSM-debugger controls bar. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11) and renders every lifecycle [bufferState] the shared feature-view layer can carry. The
 * host owns the transition-buffer feed (P1/S8) and supplies [onRetry]; this view never performs HTTP. The
 * current selections (`isLive`, `windowMinutes`, the step-validity flags) and change callbacks are controlled by
 * the parent, mirroring the web component's props.
 *
 * @param bufferState the transition-buffer count lifecycle projection (cached-then-network). `Loading`/`Error`/
 *   stale are reproduced for full state coverage; a host that already holds the counts can use the web-parity
 *   overload.
 * @param onRetry re-runs the host's buffer load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun LiveControls(
    bufferState: UiState<BufferCounts>,
    isLive: Boolean,
    windowMinutes: Int,
    canStepPrev: Boolean,
    canStepNext: Boolean,
    onToggleLive: (Boolean) -> Unit,
    onStepPrev: () -> Unit,
    onStepNext: () -> Unit,
    onWindowChange: (Int) -> Unit,
    onClearBuffer: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) {
        logger.info("view.opened", mapOf("surface" to LiveControlsRegistration.SLUG))
    }
    LiveControlsContent(
        bufferState = bufferState,
        isLive = isLive,
        windowMinutes = windowMinutes,
        canStepPrev = canStepPrev,
        canStepNext = canStepNext,
        onToggleLive = onToggleLive,
        onStepPrev = onStepPrev,
        onStepNext = onStepNext,
        onWindowChange = onWindowChange,
        onClearBuffer = onClearBuffer,
        onRetry = onRetry,
        modifier = modifier,
    )
}

/**
 * Web-parity overload mirroring the web component's controlled props (the host already holds the counts). Folds
 * the three count props through [LiveControlsProjection.resolveCounts] (preserving the @deprecated `bufferCount`
 * fallback), wraps them in a ready/empty [UiState], and offers no retry affordance since there is no fetch
 * behind it. Records `view.opened` like the stateful entry.
 */
@Composable
fun LiveControls(
    isLive: Boolean,
    onToggleLive: (Boolean) -> Unit,
    onStepPrev: () -> Unit,
    onStepNext: () -> Unit,
    windowMinutes: Int,
    onWindowChange: (Int) -> Unit,
    onClearBuffer: () -> Unit,
    modifier: Modifier = Modifier,
    canStepPrev: Boolean = false,
    canStepNext: Boolean = false,
    windowCount: Int? = null,
    totalCount: Int? = null,
    bufferCount: Int? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val counts =
        remember(windowCount, totalCount, bufferCount) {
            LiveControlsProjection.resolveCounts(windowCount, totalCount, bufferCount)
        }
    val state =
        remember(counts) {
            val phase = if (LiveControlsProjection.isBufferEmpty(counts)) UiPhase.Empty else UiPhase.Content
            UiState(phase = phase, data = counts)
        }
    LiveControls(
        bufferState = state,
        isLive = isLive,
        windowMinutes = windowMinutes,
        canStepPrev = canStepPrev,
        canStepNext = canStepNext,
        onToggleLive = onToggleLive,
        onStepPrev = onStepPrev,
        onStepNext = onStepNext,
        onWindowChange = onWindowChange,
        onClearBuffer = onClearBuffer,
        onRetry = {},
        modifier = modifier,
        logger = logger,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Switches on the host lifecycle: a
 * loading skeleton, a hard-error retry surface, or — when ready — an optional freshness chip (only while
 * refreshing/stale/offline) above the controls bar, plus an always-visible empty-buffer hint when the buffer is
 * empty. Stale (non-error) counts auto-refresh, mirroring the shared freshness contract.
 */
@Composable
fun LiveControlsContent(
    bufferState: UiState<BufferCounts>,
    isLive: Boolean,
    windowMinutes: Int,
    canStepPrev: Boolean,
    canStepNext: Boolean,
    onToggleLive: (Boolean) -> Unit,
    onStepPrev: () -> Unit,
    onStepNext: () -> Unit,
    onWindowChange: (Int) -> Unit,
    onClearBuffer: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    strings: LiveControlsStrings = rememberLiveControlsStrings(),
    windowLabel: (LiveWindow) -> String = rememberWindowLabelResolver(),
) {
    LaunchedEffect(bufferState.stale, bufferState.refreshing, bufferState.hasError) {
        if (bufferState.stale && !bufferState.refreshing && !bufferState.hasError) onRetry()
    }
    val formatAge = rememberLiveFreshnessFormatter()

    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        when (liveControlsSurfaceFor(isLoading = bufferState.isLoading, isError = bufferState.isError)) {
            LiveControlsSurfaceState.Loading ->
                LiveControlsLoading(label = stringResource(R.string.translation_common_loading))

            LiveControlsSurfaceState.Error -> LiveControlsError(onRetry = onRetry)

            LiveControlsSurfaceState.Ready -> {
                val counts = bufferState.data ?: EMPTY_COUNTS
                if (bufferState.stale || bufferState.refreshing || bufferState.hasError) {
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        DataFreshness(
                            updatedAtMillis = bufferState.fetchedAt?.takeIf { it > 0 },
                            isFetching = bufferState.refreshing,
                            isStale = bufferState.stale,
                            isError = bufferState.hasError,
                            fetchingLabel = stringResource(R.string.translation_common_loading),
                            errorLabel = stringResource(R.string.translation_common_offline),
                            formatAge = formatAge,
                        )
                    }
                }
                LiveControlsBar(
                    counts = counts,
                    isLive = isLive,
                    windowMinutes = windowMinutes,
                    canStepPrev = canStepPrev,
                    canStepNext = canStepNext,
                    onToggleLive = onToggleLive,
                    onStepPrev = onStepPrev,
                    onStepNext = onStepNext,
                    onWindowChange = onWindowChange,
                    onClearBuffer = onClearBuffer,
                    strings = strings,
                    windowLabel = windowLabel,
                )
                if (LiveControlsProjection.isBufferEmpty(counts)) {
                    HelperText(strings.emptyHint)
                }
            }
        }
    }
}

/**
 * The bordered controls bar — the native analogue of the web `flex flex-wrap items-center gap-2 rounded-lg
 * border …` container. The controls wrap (web flex-wrap) in a [FlowRow]; the buffer counter is pinned to the
 * trailing edge (web `ml-auto`) with its explanatory tooltip.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LiveControlsBar(
    counts: BufferCounts,
    isLive: Boolean,
    windowMinutes: Int,
    canStepPrev: Boolean,
    canStepNext: Boolean,
    onToggleLive: (Boolean) -> Unit,
    onStepPrev: () -> Unit,
    onStepNext: () -> Unit,
    onWindowChange: (Int) -> Unit,
    onClearBuffer: () -> Unit,
    strings: LiveControlsStrings,
    windowLabel: (LiveWindow) -> String,
) {
    val windowOptions =
        remember(windowLabel) { LiveControlsProjection.windowOptions(windowLabel).toSelectOptions() }

    ToolbarSurface {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.md, vertical = Spacing.sm),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            FlowRow(
                modifier = Modifier.weight(1f),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
                itemVerticalAlignment = Alignment.CenterVertically,
            ) {
                Button(
                    onClick = { onToggleLive(true) },
                    modifier = Modifier.semantics { selected = isLive },
                    variant = if (isLive) ButtonVariant.Primary else ButtonVariant.Secondary,
                    size = ButtonSize.Sm,
                ) {
                    LiveDot(isLive = isLive)
                    Spacer(Modifier.width(Spacing.xs))
                    Text(strings.live, style = MaterialTheme.typography.labelLarge)
                }
                Button(
                    label = strings.freeze,
                    onClick = { onToggleLive(false) },
                    modifier = Modifier.semantics { selected = !isLive },
                    variant = if (!isLive) ButtonVariant.Primary else ButtonVariant.Secondary,
                    size = ButtonSize.Sm,
                )
                ToolbarDivider()
                IconButton(
                    imageVector = TeslaGlyphs.ChevronLeft,
                    contentDescription = strings.stepPrev,
                    onClick = onStepPrev,
                    enabled = canStepPrev,
                    variant = IconButtonVariant.Standard,
                    size = IconSize.Md,
                )
                IconButton(
                    imageVector = TeslaGlyphs.ChevronRight,
                    contentDescription = strings.stepNext,
                    onClick = onStepNext,
                    enabled = canStepNext,
                    variant = IconButtonVariant.Standard,
                    size = IconSize.Md,
                )
                ToolbarDivider()
                Caption(strings.window)
                Select(
                    options = windowOptions,
                    selectedValue = LiveControlsProjection.windowSelectedValue(windowMinutes),
                    onSelect = { value -> LiveControlsProjection.parseWindowSelection(value)?.let(onWindowChange) },
                    label = strings.window,
                    modifier = Modifier.width(WINDOW_FIELD_WIDTH),
                )
                Button(
                    label = strings.clear,
                    onClick = onClearBuffer,
                    variant = ButtonVariant.Ghost,
                    size = ButtonSize.Sm,
                )
            }
            BufferCounter(counts = counts, windowMinutes = windowMinutes)
        }
    }
}

/** The trailing buffer counter — web `<Tooltip><Caption>{counterLabel}</Caption></Tooltip>` (the `ml-auto` slot). */
@Composable
private fun BufferCounter(
    counts: BufferCounts,
    windowMinutes: Int,
) {
    val counterText =
        when (LiveControlsProjection.counterStyle(counts)) {
            CounterStyle.Dual ->
                stringResource(
                    R.string.translation_debugger_controls_bufferedDual,
                    counts.inWindow,
                    counts.total,
                )
            CounterStyle.Single ->
                stringResource(R.string.translation_debugger_controls_buffered, counts.inWindow)
        }
    val tooltipText =
        stringResource(
            R.string.translation_debugger_controls_bufferedTooltip,
            windowMinutes,
            LiveControlsProjection.outsideCount(counts),
        )
    Tooltip(text = tooltipText) {
        Caption(counterText)
    }
}

/** The Live status dot — emerald + pulsing when live (reduced-motion aware), muted when frozen. Decorative. */
@Composable
private fun LiveDot(
    isLive: Boolean,
    modifier: Modifier = Modifier,
) {
    val reduceMotion = rememberReducedMotion()
    val baseColor: Color = if (isLive) TeslaTokens.status.success else MaterialTheme.colorScheme.outline
    val alpha = if (isLive && !reduceMotion) liveDotPulseAlpha() else 1f
    Box(
        modifier =
            modifier
                .size(LIVE_DOT_SIZE)
                .clip(CircleShape)
                .background(baseColor.copy(alpha = alpha)),
    )
}

/** A pulsing alpha in `[DOT_MIN_ALPHA, 1f]` — the native analogue of the web `animate-pulse` dot. */
@Composable
private fun liveDotPulseAlpha(): Float {
    val transition = rememberInfiniteTransition(label = "live-dot")
    val alpha by transition.animateFloat(
        initialValue = DOT_MIN_ALPHA,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(animation = tween(DOT_PULSE_MS), repeatMode = RepeatMode.Reverse),
        label = "live-dot-alpha",
    )
    return alpha
}

/** Thin vertical separator — the native analogue of the web `h-5 w-px bg-[var(--surface-2)]` divider. */
@Composable
private fun ToolbarDivider() {
    Box(
        modifier =
            Modifier
                .width(DIVIDER_WIDTH)
                .height(DIVIDER_HEIGHT)
                .background(MaterialTheme.colorScheme.outlineVariant),
    )
}

/** The bordered, faintly-tinted bar container shared by the ready and loading surfaces. */
@Composable
private fun ToolbarSurface(content: @Composable () -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(Radius.md),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = BAR_BG_ALPHA),
        border = BorderStroke(DIVIDER_WIDTH, MaterialTheme.colorScheme.outlineVariant),
        content = content,
    )
}

/** First-load skeleton — bar-shaped shimmer so the controls bar is never blank while the buffer loads. */
@Composable
private fun LiveControlsLoading(
    label: String,
    modifier: Modifier = Modifier,
) {
    ToolbarSurface {
        Column(
            modifier =
                modifier
                    .fillMaxWidth()
                    .padding(horizontal = Spacing.md, vertical = Spacing.sm)
                    .semantics { contentDescription = label },
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Skeleton(height = SKELETON_BAR_HEIGHT, rounded = true)
            Skeleton(widthFraction = 0.6f, height = SKELETON_BAR_HEIGHT, rounded = true)
        }
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun LiveControlsError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Maps the pure [LiveControlsOption]s onto the shared [Select]'s [SelectOption] (value / label) contract. */
private fun List<LiveControlsOption>.toSelectOptions(): List<SelectOption> = map { SelectOption(value = it.value, label = it.label) }

/**
 * Builds the localized [LiveControlsStrings]. Every control key exists in the catalog (P1/S10) and resolves
 * through compile-time resources; the empty-buffer hint reuses the FSM debugger's `debugger.timeline.empty`
 * copy. Remembered against the resolved strings so a locale change re-projects.
 */
@Composable
private fun rememberLiveControlsStrings(): LiveControlsStrings {
    val live = stringResource(R.string.translation_debugger_controls_live)
    val freeze = stringResource(R.string.translation_debugger_controls_freeze)
    val stepPrev = stringResource(R.string.translation_debugger_controls_stepPrev)
    val stepNext = stringResource(R.string.translation_debugger_controls_stepNext)
    val window = stringResource(R.string.translation_debugger_controls_window)
    val clear = stringResource(R.string.translation_debugger_controls_clear)
    val emptyHint = stringResource(R.string.translation_debugger_timeline_empty)
    return remember(live, freeze, stepPrev, stepNext, window, clear, emptyHint) {
        LiveControlsStrings(
            live = live,
            freeze = freeze,
            stepPrev = stepPrev,
            stepNext = stepNext,
            window = window,
            clear = clear,
            emptyHint = emptyHint,
        )
    }
}

/**
 * The window option-label resolver — web option labels "5 min" / "2 h". Minutes-scale windows resolve through
 * `debugger.window.minutes` (`%1$s min`) and the 2-hour slice through `debugger.window.hours` (`%1$s h`), with
 * an explicit [Locale] so the numeric substitution is locale-correct.
 */
@Composable
private fun rememberWindowLabelResolver(): (LiveWindow) -> String {
    val locale = currentLocale()
    val minutesTemplate = stringResource(R.string.translation_debugger_window_minutes)
    val hoursTemplate = stringResource(R.string.translation_debugger_window_hours)
    return remember(locale, minutesTemplate, hoursTemplate) {
        { window ->
            if (window.isHours) {
                hoursTemplate.format(locale, window.hours)
            } else {
                minutesTemplate.format(locale, window.minutes)
            }
        }
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`), with an explicit
 * [Locale] so the numeric substitution is locale-correct.
 */
@Composable
private fun rememberLiveFreshnessFormatter(): (FreshnessAge) -> String {
    val locale = currentLocale()
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(locale, justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> EM_DASH
                FreshnessAge.JustNow -> justNow
                is FreshnessAge.Seconds -> seconds.format(locale, age.value)
                is FreshnessAge.Minutes -> minutes.format(locale, age.value)
                is FreshnessAge.Hours -> hours.format(locale, age.value)
                is FreshnessAge.Days -> days.format(locale, age.value)
                is FreshnessAge.Weeks -> weeks.format(locale, age.value)
            }
        }
    }
}

/** The active configuration [Locale] (the first in the locale list), falling back to the JVM default. */
@Composable
private fun currentLocale(): Locale {
    val configuration = LocalConfiguration.current
    return if (configuration.locales.isEmpty) Locale.getDefault() else configuration.locales[0]
}

// ── Previews (tooling-only; @Preview entry points exercise each render surface) ──────────────────────────────

private val PREVIEW_COUNTS: BufferCounts = BufferCounts(inWindow = 12, total = 47, dual = true)

@Preview(name = "Ready (live)", showBackground = true)
@Composable
private fun LiveControlsReadyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LiveControlsContent(
            bufferState = UiState(phase = UiPhase.Content, data = PREVIEW_COUNTS),
            isLive = true,
            windowMinutes = 30,
            canStepPrev = true,
            canStepNext = false,
            onToggleLive = {},
            onStepPrev = {},
            onStepNext = {},
            onWindowChange = {},
            onClearBuffer = {},
            onRetry = {},
        )
    }
}

@Preview(name = "Frozen", showBackground = true)
@Composable
private fun LiveControlsFrozenPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LiveControlsContent(
            bufferState = UiState(phase = UiPhase.Content, data = PREVIEW_COUNTS),
            isLive = false,
            windowMinutes = 120,
            canStepPrev = true,
            canStepNext = true,
            onToggleLive = {},
            onStepPrev = {},
            onStepNext = {},
            onWindowChange = {},
            onClearBuffer = {},
            onRetry = {},
        )
    }
}

@Preview(name = "Empty (no transitions)", showBackground = true)
@Composable
private fun LiveControlsEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LiveControlsContent(
            bufferState = UiState(phase = UiPhase.Empty, data = EMPTY_COUNTS),
            isLive = true,
            windowMinutes = 5,
            canStepPrev = false,
            canStepNext = false,
            onToggleLive = {},
            onStepPrev = {},
            onStepNext = {},
            onWindowChange = {},
            onClearBuffer = {},
            onRetry = {},
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun LiveControlsLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LiveControlsContent(
            bufferState = UiState.loading(),
            isLive = true,
            windowMinutes = 10,
            canStepPrev = false,
            canStepNext = false,
            onToggleLive = {},
            onStepPrev = {},
            onStepNext = {},
            onWindowChange = {},
            onClearBuffer = {},
            onRetry = {},
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun LiveControlsErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LiveControlsContent(
            bufferState = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            isLive = true,
            windowMinutes = 10,
            canStepPrev = false,
            canStepNext = false,
            onToggleLive = {},
            onStepPrev = {},
            onStepNext = {},
            onWindowChange = {},
            onClearBuffer = {},
            onRetry = {},
        )
    }
}

@Preview(name = "Offline (stale)", showBackground = true)
@Composable
private fun LiveControlsOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LiveControlsContent(
            bufferState =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_COUNTS,
                    stale = true,
                    errorKind = ErrorKind.Network,
                ),
            isLive = false,
            windowMinutes = 30,
            canStepPrev = true,
            canStepNext = true,
            onToggleLive = {},
            onStepPrev = {},
            onStepNext = {},
            onWindowChange = {},
            onClearBuffer = {},
            onRetry = {},
        )
    }
}
