// The native Jetpack Compose + Material 3 AIThinkingIndicator shared surface — a parity port of
// web/src/components/ai/AIThinkingIndicator.tsx. The web surface is the streaming-but-empty pending state an AI
// surface shows while its SSE connection is open and the first `delta.text` frame has not arrived (it is what
// `AiOutputPanel` renders as its `pendingChild`): an animated "Helix is thinking" label — a HelixMark glyph, the
// label, and three rippling dots — above three shimmering cyan skeleton lines of decreasing width (full, 11/12,
// 9/12). The web component is reduced-motion-aware via Tailwind's `motion-safe:` variant: under
// `prefers-reduced-motion` the dots stop bouncing and the lines drop the shimmer while the static skeleton stays
// visible. The web also exports a compact `AIThinkingDots` (an in-button label + three dots), reproduced here.
//
// The reduced-motion signal is bound through the shared [AIThinkingIndicatorViewModel] (P1/S8) over
// [AIThinkingIndicatorSource]; the view reads no platform setting and performs NO HTTP. The label is a pure
// render parameter (web's `label` prop). The default label resolves from the P1/S10 catalog
// (`R.string.translation_chatbot_thinking` = "Helix is thinking…") — the canonical entry the web default
// `t('helix.thinking', 'Helix is thinking')` falls back to (see AIThinkingIndicatorModel.DEFAULT_LABEL_CATALOG_KEY
// for the provenance). There is no native `HelixMark` atom (atomic AI/branding components are the out-of-scope P3
// component-library bundle), so the mark is authored here as a native [Canvas] double-helix in the shared
// monochrome style (mirroring web `HelixMark` and the sibling AIChatbotIndicator surface) — a complete, working
// surface, not a skeleton-only scaffold.
//
// Parity-with-honesty (Honesty Covenant #9 — documented, not silent): this surface IS the "loading" state of a
// host AI surface and has no feed of its own, so the generic empty / error / stale / offline data-states do not
// apply (see AIThinkingIndicatorModel.kt for the full rationale). Its real states — the animated indicator and
// the reduced-motion static variant, the caller's label override, and the compact dots form — are all reproduced
// and previewed below.
//
// `MatchingDeclarationName`/`InvalidPackageDeclaration` are suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/AIThinkingIndicator) cannot form a valid Kotlin package and the file hosts
// several co-located composables, exactly as the sibling surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aithinkingindicator

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.StartOffset
import androidx.compose.animation.core.StartOffsetType
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.MutableStateFlow
import kotlin.math.PI
import kotlin.math.sin

/** Web `h-4 w-4` HelixMark glyph size (16px). */
private val HELIX_MARK_SIZE: Dp = 16.dp

/** Web `h-1 w-1` dot size (4px). */
private val DOT_SIZE: Dp = 4.dp

/** Web `h-3` skeleton line height (12px). */
private val SKELETON_LINE_HEIGHT: Dp = 12.dp

/** Peak upward travel of a bouncing dot (web `animate-bounce`). */
private val BOUNCE_TRAVEL: Dp = 4.dp

/** Web `text-cyan-300/90` — the label sits at 90% of the cyan accent. */
private const val LABEL_ALPHA: Float = 0.90f

/** Base fill of a skeleton bar — the static skeleton stays visible even under reduced motion. */
private const val SKELETON_BASE_ALPHA: Float = 0.12f

/** Brightness of the sweeping shimmer highlight over a skeleton bar (web cyan gradient midpoint). */
private const val SHIMMER_HIGHLIGHT_ALPHA: Float = 0.30f

/** Width of the moving shimmer band as a fraction of the bar width. */
private const val SHIMMER_BAND_FRACTION: Float = 0.6f

/** One full left-to-right shimmer sweep, in ms. */
private const val SHIMMER_PERIOD_MS: Int = 1500

/** One up-and-down dot bounce, in ms. */
private const val BOUNCE_PERIOD_MS: Int = 560

/** One HelixMark pulse cycle, in ms (web `animate-pulse`). */
private const val PULSE_PERIOD_MS: Int = 1000

/** HelixMark pulse fades the mark between full and half opacity. */
private const val PULSE_MIN_ALPHA: Float = 0.5f
private const val PULSE_MAX_ALPHA: Float = 1f

// HelixMark geometry (normalized to the canvas' min dimension), mirroring web `HelixMark`.
private const val HELIX_TOP = 0.12f
private const val HELIX_BOTTOM = 0.88f
private const val HELIX_AMPLITUDE = 0.24f
private const val HELIX_STROKE = 0.085f
private const val HELIX_RUNG_STROKE = 0.06f
private const val HELIX_TURNS = 1.5f
private const val HELIX_SEGMENTS = 28
private const val HELIX_RUNGS = 3
private const val HELIX_HALF_TURN = 2f

/**
 * Stateful entry point — the faithful port of the web `AIThinkingIndicator`. Binds the reduced-motion signal via
 * [source] into an [AIThinkingIndicatorViewModel], records the one-shot `view.opened` diagnostic, collects the
 * live state, and renders the indicator. The optional [label] overrides the default catalog label (web
 * `label ?? t('helix.thinking', …)`). The surface performs no HTTP; [logger] defaults to the process logger and
 * [instanceKey] scopes the ViewModel per placement.
 */
@Composable
fun AIThinkingIndicator(
    modifier: Modifier = Modifier,
    label: String? = null,
    source: AIThinkingIndicatorSource = rememberPlatformReducedMotionSource(),
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = AI_THINKING_INDICATOR_SLUG,
) {
    val viewModel: AIThinkingIndicatorViewModel =
        viewModel(key = instanceKey, factory = AIThinkingIndicatorViewModel.factory(source, logger))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    AIThinkingIndicatorContent(
        state = state,
        defaultLabel = stringResource(R.string.translation_chatbot_thinking),
        modifier = modifier,
        label = label,
    )
}

/**
 * Bridges the platform reduced-motion preference (`rememberReducedMotion()` — Android's `prefers-reduced-motion`
 * equivalent) into an [AIThinkingIndicatorSource] flow the ViewModel can bind, keeping the value current across
 * recompositions so a live toggle of the system "remove animations" setting switches the render.
 */
@Composable
fun rememberPlatformReducedMotionSource(): AIThinkingIndicatorSource {
    val reduced = rememberReducedMotion()
    val flow = remember { MutableStateFlow(reduced) }
    SideEffect { flow.value = reduced }
    return remember(flow) { aiThinkingIndicatorSource { flow } }
}

/**
 * Stateless renderer for the surface — the unit/UI-test + `@Preview` entry point. Projects [state] (with the
 * caller's [label] resolved against the catalog [defaultLabel]) and renders the label row over the skeleton. The
 * whole indicator is a polite live region (web `role="status"` + `aria-live="polite"`); the label supplies the
 * spoken text and the decorative glyph / dots / bars carry no semantics (web `aria-hidden`).
 */
@Composable
fun AIThinkingIndicatorContent(
    state: ThinkingIndicatorState,
    defaultLabel: String,
    modifier: Modifier = Modifier,
    label: String? = null,
) {
    val projection = projectThinkingIndicator(state, labelOverride = label, defaultLabel = defaultLabel)
    Column(
        modifier = modifier.semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        IndicatorLabelRow(projection = projection)
        IndicatorSkeleton(projection = projection)
    }
}

/**
 * The compact in-button thinking indicator — a label followed by three rippling dots, the parity port of the web
 * `AIThinkingDots`. The dots inherit the surrounding content color (web `bg-current`), so the label reads as a
 * streaming-state caption inside an action button. [reducedMotion] defaults to the platform preference and the
 * dots freeze when it is `true`.
 */
@Composable
fun AIThinkingDots(
    label: String,
    modifier: Modifier = Modifier,
    reducedMotion: Boolean = rememberReducedMotion(),
) {
    val projection = projectThinkingDots(reducedMotion)
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = MaterialTheme.typography.labelLarge)
        ThinkingDotsRow(dots = projection.dots, animated = projection.animated, color = LocalContentColor.current)
    }
}

/** The label row: the pulsing HelixMark, the cyan label, and the rippling dots (web's first flex row). */
@Composable
private fun IndicatorLabelRow(projection: ThinkingIndicatorProjection) {
    val accent = TeslaTokens.status.info
    Row(
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        HelixMark(modifier = Modifier.size(HELIX_MARK_SIZE), tint = accent, pulsing = projection.animated)
        Text(
            projection.label,
            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium),
            color = accent.copy(alpha = LABEL_ALPHA),
        )
        ThinkingDotsRow(dots = projection.dots, animated = projection.animated, color = accent)
    }
}

/** The three shimmering skeleton lines of decreasing width (web's second flex column). */
@Composable
private fun IndicatorSkeleton(projection: ThinkingIndicatorProjection) {
    val accent = TeslaTokens.status.info
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        projection.lines.forEach { line ->
            ShimmerSkeletonLine(spec = line, animated = projection.animated, accent = accent)
        }
    }
}

/** A horizontal row of bottom-aligned bouncing dots (web `inline-flex items-end gap-1`). */
@Composable
private fun ThinkingDotsRow(
    dots: List<ThinkingDotSpec>,
    animated: Boolean,
    color: Color,
) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.Bottom,
    ) {
        dots.forEach { dot -> BouncingDot(spec = dot, animated = animated, color = color) }
    }
}

/**
 * One bouncing dot. When [animated], an infinite reverse tween lifts it by [BOUNCE_TRAVEL], fast-forwarded by the
 * spec's stagger so the three dots ripple (web `animate-bounce` + negative delays); when not, it renders static.
 */
@Composable
private fun BouncingDot(
    spec: ThinkingDotSpec,
    animated: Boolean,
    color: Color,
) {
    val offsetY =
        if (animated) {
            val transition = rememberInfiniteTransition(label = "dot")
            val lift by transition.animateFloat(
                initialValue = 0f,
                targetValue = 1f,
                animationSpec =
                    infiniteRepeatable(
                        animation = tween(durationMillis = BOUNCE_PERIOD_MS, easing = FastOutSlowInEasing),
                        repeatMode = RepeatMode.Reverse,
                        initialStartOffset = StartOffset(spec.animationDelayMs, StartOffsetType.FastForward),
                    ),
                label = "dot-bounce",
            )
            -(BOUNCE_TRAVEL.value * lift)
        } else {
            0f
        }
    Box(
        modifier =
            Modifier
                .offset(y = offsetY.dp)
                .size(DOT_SIZE)
                .clip(CircleShape)
                .background(color),
    )
}

/**
 * One skeleton bar at [spec]'s width. The base fill is always visible; when [animated] a sweeping cyan highlight
 * (offset by the spec's stagger) crosses it (web `animate-shimmer`), otherwise the static bar shows (web's
 * reduced-motion fallback — the skeleton stays, the shimmer drops).
 */
@Composable
private fun ShimmerSkeletonLine(
    spec: SkeletonLineSpec,
    animated: Boolean,
    accent: Color,
) {
    val bar =
        Modifier
            .fillMaxWidth(spec.widthFraction)
            .height(SKELETON_LINE_HEIGHT)
            .clip(RoundedCornerShape(Radius.sm))
            .background(accent.copy(alpha = SKELETON_BASE_ALPHA))
    if (!animated) {
        Box(modifier = bar)
        return
    }
    val transition = rememberInfiniteTransition(label = "skeleton")
    val progress by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec =
            infiniteRepeatable(
                animation = tween(durationMillis = SHIMMER_PERIOD_MS, easing = LinearEasing),
                repeatMode = RepeatMode.Restart,
                initialStartOffset = StartOffset(spec.animationDelayMs),
            ),
        label = "shimmer",
    )
    val highlight = listOf(Color.Transparent, accent.copy(alpha = SHIMMER_HIGHLIGHT_ALPHA), Color.Transparent)
    Box(
        modifier =
            bar.drawBehind {
                val band = size.width * SHIMMER_BAND_FRACTION
                val start = -band + progress * (size.width + 2f * band)
                drawRect(
                    brush = Brush.linearGradient(highlight, start = Offset(start, 0f), end = Offset(start + band, 0f)),
                )
            },
    )
}

/**
 * The Helix brand mark — two interleaving strands joined by rungs, drawn natively with [Canvas] (no SVG) so it
 * recolors with the [tint]. Mirrors web `HelixMark` and the sibling AIChatbotIndicator glyph. When [pulsing] an
 * infinite reverse tween fades it between full and half opacity (web `animate-pulse`). Decorative: the indicator
 * announces its label, not this mark.
 */
@Composable
private fun HelixMark(
    modifier: Modifier = Modifier,
    tint: Color = LocalContentColor.current,
    pulsing: Boolean = false,
) {
    val alpha =
        if (pulsing) {
            val transition = rememberInfiniteTransition(label = "helix-pulse")
            val value by transition.animateFloat(
                initialValue = PULSE_MAX_ALPHA,
                targetValue = PULSE_MIN_ALPHA,
                animationSpec =
                    infiniteRepeatable(
                        animation = tween(durationMillis = PULSE_PERIOD_MS, easing = FastOutSlowInEasing),
                        repeatMode = RepeatMode.Reverse,
                    ),
                label = "helix-alpha",
            )
            value
        } else {
            PULSE_MAX_ALPHA
        }
    val color = tint.copy(alpha = alpha)
    Canvas(modifier = modifier) {
        val side = size.minDimension
        val centerX = size.width / 2f
        val top = side * HELIX_TOP
        val bottom = side * HELIX_BOTTOM
        val amplitude = side * HELIX_AMPLITUDE

        fun strand(phase: Float): Path =
            Path().apply {
                for (i in 0..HELIX_SEGMENTS) {
                    val fraction = i / HELIX_SEGMENTS.toFloat()
                    val y = top + (bottom - top) * fraction
                    val x = centerX + amplitude * sin(fraction * HELIX_TURNS * HELIX_HALF_TURN * PI.toFloat() + phase)
                    if (i == 0) moveTo(x, y) else lineTo(x, y)
                }
            }
        drawPath(strand(0f), color = color, style = Stroke(width = side * HELIX_STROKE, cap = StrokeCap.Round))
        drawPath(
            strand(PI.toFloat()),
            color = color,
            style = Stroke(width = side * HELIX_STROKE, cap = StrokeCap.Round),
        )
        for (k in 1..HELIX_RUNGS) {
            val fraction = k / (HELIX_RUNGS + 1).toFloat()
            val y = top + (bottom - top) * fraction
            val angle = fraction * HELIX_TURNS * HELIX_HALF_TURN * PI.toFloat()
            drawLine(
                color = color,
                start = Offset(centerX + amplitude * sin(angle), y),
                end = Offset(centerX + amplitude * sin(angle + PI.toFloat()), y),
                strokeWidth = side * HELIX_RUNG_STROKE,
                cap = StrokeCap.Round,
            )
        }
    }
}

// ── Previews — one per rendered state (animated / reduced-motion / custom label / dots / dark). ──────────────

private const val PREVIEW_DEFAULT_LABEL = "Helix is thinking…"
private const val PREVIEW_CUSTOM_LABEL = "Helix is summarising"

@Preview(name = "Indicator · animated", showBackground = true)
@Composable
private fun ThinkingIndicatorAnimatedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIThinkingIndicatorContent(
            state = ThinkingIndicatorState(reducedMotion = false),
            defaultLabel = PREVIEW_DEFAULT_LABEL,
        )
    }
}

@Preview(name = "Indicator · reduced motion", showBackground = true)
@Composable
private fun ThinkingIndicatorReducedMotionPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIThinkingIndicatorContent(
            state = ThinkingIndicatorState(reducedMotion = true),
            defaultLabel = PREVIEW_DEFAULT_LABEL,
        )
    }
}

@Preview(name = "Indicator · custom label", showBackground = true)
@Composable
private fun ThinkingIndicatorCustomLabelPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIThinkingIndicatorContent(
            state = ThinkingIndicatorState(reducedMotion = false),
            defaultLabel = PREVIEW_DEFAULT_LABEL,
            label = PREVIEW_CUSTOM_LABEL,
        )
    }
}

@Preview(name = "Indicator · dark", showBackground = true)
@Composable
private fun ThinkingIndicatorDarkPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        AIThinkingIndicatorContent(
            state = ThinkingIndicatorState(reducedMotion = false),
            defaultLabel = PREVIEW_DEFAULT_LABEL,
        )
    }
}

@Preview(name = "Dots · animated", showBackground = true)
@Composable
private fun ThinkingDotsAnimatedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIThinkingDots(label = PREVIEW_DEFAULT_LABEL, reducedMotion = false)
    }
}

@Preview(name = "Dots · reduced motion", showBackground = true)
@Composable
private fun ThinkingDotsReducedMotionPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIThinkingDots(label = PREVIEW_DEFAULT_LABEL, reducedMotion = true)
    }
}
