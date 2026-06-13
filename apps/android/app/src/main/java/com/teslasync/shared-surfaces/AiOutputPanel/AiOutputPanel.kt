// The native Jetpack Compose + Material 3 AiOutputPanel shared surface — a parity port of the shared
// streaming-output renderer web/src/components/ai/AiOutputPanel.tsx, together with its default pending child
// web/src/components/ai/AIThinkingIndicator.tsx.
//
// AiOutputPanel is the presentation every Helix feature reuses for a streamed proposal/narrative: a bordered
// inset that shows the accumulated `delta.text` as it streams, an animated thinking indicator while the SSE is
// open but no text has arrived yet, and an inline error when the stream settled in error. It renders nothing
// until a stream has run at least once (web `hasAnything`), and once a stream has run it stays visible so the
// user can re-read the output after the stream closes — the `useAiStream` idle -> streaming -> done / error
// lifecycle. Every render decision flows through the pure [aiOutputBranch] model so the composable is a thin
// layer the unit gate verifies off-device.
//
// There is no native HelixMark / AIThinkingIndicator atom yet (atomic AI/branding components are the
// out-of-scope P3 component-library bundle), so — exactly as the sibling AIChatbotIndicator does — the Helix
// brand mark is authored here as a native [Canvas] double-helix and the thinking indicator is composed from the
// shared feedback primitives ([SkeletonLines]) plus an authored bouncing-dot row. Both are complete, working
// surfaces, not skeletons. The view performs NO HTTP: it is driven entirely by the caller's stream props (the
// `useAiStream` analogue state holder lives with the consuming feature, P1/S8). Every visible string resolves
// through the i18n facade (P1/S10), and the motion honors the platform reduce-motion setting (web
// `motion-safe:`).
//
// `InvalidPackageDeclaration`/`MatchingDeclarationName` are suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/AiOutputPanel) cannot form a valid Kotlin package and the file hosts several
// co-located composables, exactly as the sibling surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aioutputpanel

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.StartOffset
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.feedback.SkeletonLines
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlin.math.PI
import kotlin.math.roundToInt
import kotlin.math.sin

/** Low-alpha wash behind the bordered output panel (web `bg-white/[0.02]`); a subtle inset, not a solid fill. */
private const val OUTPUT_WASH_ALPHA: Float = 0.04f

/** Web `h-4 w-4` HelixMark glyph size used in the error line and the thinking indicator (16px). */
private val HELIX_MARK_SIZE: Dp = 16.dp

/** Parity test tag for the bordered output panel (web `data-testid="ai-output-panel"`). */
const val AI_OUTPUT_PANEL_TEST_TAG: String = "ai-output-panel"

/** Parity test tag for the thinking indicator (web `data-testid="ai-thinking-indicator"`). */
const val AI_THINKING_INDICATOR_TEST_TAG: String = "ai-thinking-indicator"

// ── HelixMark geometry (normalized to the canvas' min dimension), mirroring web `HelixMark`. ─────────────────
private const val HELIX_TOP = 0.12f
private const val HELIX_BOTTOM = 0.88f
private const val HELIX_AMPLITUDE = 0.24f
private const val HELIX_STROKE = 0.085f
private const val HELIX_RUNG_STROKE = 0.06f
private const val HELIX_TURNS = 1.5f
private const val HELIX_SEGMENTS = 28
private const val HELIX_RUNGS = 3
private const val HELIX_HALF_TURN = 2f

// ── Thinking indicator animation (web AIThinkingIndicator bouncing dots + pulsing mark + shimmer lines). ──────
private const val THINKING_DOT_COUNT = 3
private val THINKING_DOT_SIZE: Dp = 4.dp
private val THINKING_DOT_GAP: Dp = 3.dp
private val THINKING_DOT_BOUNCE: Dp = 4.dp
private const val THINKING_DOT_BOUNCE_MS = 380
private const val THINKING_DOT_STAGGER_MS = 150
private const val THINKING_PULSE_MS = 1100
private const val THINKING_PULSE_MIN_ALPHA = 0.45f
private const val THINKING_PULSE_MAX_ALPHA = 1f
private const val THINKING_SKELETON_LINES = 3

/**
 * Stateful entry point — the faithful port of the web `AiOutputPanel`. Records the one-shot PII-safe
 * `view.opened` diagnostic (P1/S11), then draws the stateless renderer. The surface performs no HTTP; it is
 * driven entirely by the caller's stream slice ([text] / [state] / [error]), which the consuming feature's
 * `useAiStream` analogue state holder supplies (P1/S8). [logger] defaults to the process logger.
 *
 * @param text the accumulated `delta.text` payload from the stream (web `text`).
 * @param state the current stream lifecycle (web `state`).
 * @param error the terminal error message; only read when [state] is [AiStreamState.Error] (web `error`).
 * @param pendingContent the body shown while the stream is open but no text has arrived. Defaults to the
 *   authored [AiThinkingIndicator] (web's default `<AIThinkingIndicator />`); pass `null` to omit the inner
 *   body while keeping the bordered panel (web's `pendingChild={null}`).
 */
@Composable
fun AiOutputPanel(
    text: String,
    state: AiStreamState,
    error: String?,
    modifier: Modifier = Modifier,
    pendingContent: (@Composable () -> Unit)? = { AiThinkingIndicator() },
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { AiOutputPanelDiagnostics.recordViewOpened(logger) }
    AiOutputPanelContent(
        text = text,
        state = state,
        error = error,
        modifier = modifier,
        pendingContent = pendingContent,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + `@Preview` entry point. Classifies
 * ([text], [state]) via [aiOutputBranch] and renders nothing (web `return null`), the inline Helix-error line,
 * the thinking child, or the streamed paragraph. The bordered panel is always present for a non-hidden branch
 * (web's always-rendered `<div>`), so a `pendingContent` of `null` still shows the inset.
 */
@Composable
fun AiOutputPanelContent(
    text: String,
    state: AiStreamState,
    error: String?,
    modifier: Modifier = Modifier,
    pendingContent: (@Composable () -> Unit)? = { AiThinkingIndicator() },
) {
    when (aiOutputBranch(text, state)) {
        AiOutputBranch.Hidden -> Unit
        AiOutputBranch.Error -> OutputContainer(modifier) { HelixErrorLine(error) }
        AiOutputBranch.Pending -> OutputContainer(modifier) { pendingContent?.invoke() }
        AiOutputBranch.Text -> OutputContainer(modifier) { StreamedText(text) }
    }
}

/** Bordered, low-wash inset that frames the streamed output (web `rounded-lg border bg-white/[0.02] p-4`). */
@Composable
private fun OutputContainer(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Surface(
        modifier = modifier.fillMaxWidth().testTag(AI_OUTPUT_PANEL_TEST_TAG),
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = OUTPUT_WASH_ALPHA),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(modifier = Modifier.padding(Spacing.md), content = content)
    }
}

/**
 * The inline terminal-error line — a port of the web error paragraph: a red Helix mark beside the bold "Helix
 * error:" label and the resolved message (`error ?? 'unknown'`). The whole row carries one merged accessible
 * label so TalkBack announces "Helix error: <detail>" once and the decorative mark is subsumed.
 */
@Composable
private fun HelixErrorLine(error: String?) {
    val label = stringResource(R.string.ai_output_panel_error_label)
    val unknown = stringResource(R.string.ai_output_panel_error_unknown)
    val detail = resolveErrorDetail(error, unknown)
    val announced = aiOutputErrorLine(label, detail)
    val errorColor = MaterialTheme.colorScheme.error
    Row(
        modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = announced },
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.Top,
    ) {
        HelixMark(modifier = Modifier.size(HELIX_MARK_SIZE), tint = errorColor)
        Text(
            text =
                buildAnnotatedString {
                    withStyle(SpanStyle(fontWeight = FontWeight.Medium)) { append(label) }
                    append(" ")
                    append(detail)
                },
            style = MaterialTheme.typography.bodySmall,
            color = errorColor,
            modifier = Modifier.weight(1f),
        )
    }
}

/** The accumulated streamed text (web `whitespace-pre-wrap` paragraph); newlines preserved by default. */
@Composable
private fun StreamedText(text: String) {
    BodyText(text = text, modifier = Modifier.fillMaxWidth())
}

/**
 * The native port of the web `AIThinkingIndicator` — the streaming-but-empty affordance shown while the SSE is
 * open and the first `delta` is awaited. A pulsing Helix mark beside the localized "Helix is thinking" label
 * and a row of bouncing dots, over three shimmering skeleton lines of decreasing width (mimicking prose). The
 * whole control is a single polite live region announcing [label] (web `role="status" aria-live="polite"`), so
 * the decorative animation is hidden from TalkBack. Motion honors the platform reduce-motion setting: with
 * reduced motion the dots rest and the mark stays opaque (the static skeleton is still visible).
 *
 * @param label optional override of the leading label (web `label ?? t('helix.thinking', 'Helix is thinking')`).
 */
@Composable
fun AiThinkingIndicator(
    modifier: Modifier = Modifier,
    label: String? = null,
) {
    val text = label ?: stringResource(R.string.ai_output_panel_thinking)
    val accent = TeslaTokens.status.info
    val reduced = rememberReducedMotion()
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .testTag(AI_THINKING_INDICATOR_TEST_TAG)
                .semantics(mergeDescendants = true) {
                    liveRegion = LiveRegionMode.Polite
                    contentDescription = text
                },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            HelixMark(
                modifier = Modifier.size(HELIX_MARK_SIZE).alpha(thinkingPulseAlpha(reduced)),
                tint = accent,
            )
            Text(text = text, style = MaterialTheme.typography.bodySmall, color = accent)
            BouncingDots(color = accent, reduced = reduced)
        }
        SkeletonLines(lines = THINKING_SKELETON_LINES)
    }
}

/** The pulsing alpha applied to the thinking mark (web `motion-safe:animate-pulse`); opaque when reduced. */
@Composable
private fun thinkingPulseAlpha(reduced: Boolean): Float {
    if (reduced) return THINKING_PULSE_MAX_ALPHA
    val transition = rememberInfiniteTransition(label = "thinking-pulse")
    val alpha by transition.animateFloat(
        initialValue = THINKING_PULSE_MAX_ALPHA,
        targetValue = THINKING_PULSE_MIN_ALPHA,
        animationSpec =
            infiniteRepeatable(
                animation = tween(durationMillis = THINKING_PULSE_MS),
                repeatMode = RepeatMode.Reverse,
            ),
        label = "thinking-pulse-alpha",
    )
    return alpha
}

/** The bouncing-dot row trailing the thinking label (web's three staggered `animate-bounce` dots). */
@Composable
private fun BouncingDots(
    color: Color,
    reduced: Boolean,
) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(THINKING_DOT_GAP),
        verticalAlignment = Alignment.Bottom,
    ) {
        for (index in 0 until THINKING_DOT_COUNT) {
            BouncingDot(color = color, index = index, reduced = reduced)
        }
    }
}

/** One dot of [BouncingDots]; bounces on a per-[index] staggered phase, or rests when [reduced]. */
@Composable
private fun BouncingDot(
    color: Color,
    index: Int,
    reduced: Boolean,
) {
    val bouncePx = with(LocalDensity.current) { THINKING_DOT_BOUNCE.toPx() }
    val offsetY =
        if (reduced) {
            0f
        } else {
            val transition = rememberInfiniteTransition(label = "thinking-dot-$index")
            val value by transition.animateFloat(
                initialValue = 0f,
                targetValue = -bouncePx,
                animationSpec =
                    infiniteRepeatable(
                        animation = tween(durationMillis = THINKING_DOT_BOUNCE_MS),
                        repeatMode = RepeatMode.Reverse,
                        initialStartOffset = StartOffset(index * THINKING_DOT_STAGGER_MS),
                    ),
                label = "thinking-dot-offset-$index",
            )
            value
        }
    Box(
        modifier =
            Modifier
                .offset { IntOffset(0, offsetY.roundToInt()) }
                .size(THINKING_DOT_SIZE)
                .clip(CircleShape)
                .background(color),
    )
}

/**
 * The Helix brand mark — two interleaving strands joined by rungs, drawn natively with [Canvas] (no SVG) so it
 * recolors with the [tint]. Mirrors web `HelixMark` (a stylised vertical double helix) and the sibling
 * AIChatbotIndicator's authored glyph. Decorative: callers announce the surrounding row, not this mark.
 */
@Composable
private fun HelixMark(
    modifier: Modifier = Modifier,
    tint: Color = MaterialTheme.colorScheme.onSurface,
) {
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
        drawPath(strand(0f), color = tint, style = Stroke(width = side * HELIX_STROKE, cap = StrokeCap.Round))
        drawPath(strand(PI.toFloat()), color = tint, style = Stroke(width = side * HELIX_STROKE, cap = StrokeCap.Round))
        for (k in 1..HELIX_RUNGS) {
            val fraction = k / (HELIX_RUNGS + 1).toFloat()
            val y = top + (bottom - top) * fraction
            val angle = fraction * HELIX_TURNS * HELIX_HALF_TURN * PI.toFloat()
            drawLine(
                color = tint,
                start = Offset(centerX + amplitude * sin(angle), y),
                end = Offset(centerX + amplitude * sin(angle + PI.toFloat()), y),
                strokeWidth = side * HELIX_RUNG_STROKE,
                cap = StrokeCap.Round,
            )
        }
    }
}

// ── Previews (tooling-only; the @Preview entry points exercise each render branch) ───────────────────────────

@Preview(name = "Streaming — thinking", showBackground = true, widthDp = 420)
@Composable
private fun AiOutputPanelPendingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AiOutputPanelContent(text = "", state = AiStreamState.Streaming, error = null)
    }
}

@Preview(name = "Done — streamed text", showBackground = true, widthDp = 420)
@Composable
private fun AiOutputPanelTextPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AiOutputPanelContent(
            text = "Your battery held a steady 91% state of health across the last 30 charge cycles.",
            state = AiStreamState.Done,
            error = null,
        )
    }
}

@Preview(name = "Error — inline", showBackground = true, widthDp = 420)
@Composable
private fun AiOutputPanelErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AiOutputPanelContent(text = "", state = AiStreamState.Error, error = "stream_http_503")
    }
}

@Preview(name = "Error — inline (dark)", showBackground = true, widthDp = 420)
@Composable
private fun AiOutputPanelErrorDarkPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        AiOutputPanelContent(text = "", state = AiStreamState.Error, error = null)
    }
}

@Preview(name = "Thinking indicator", showBackground = true, widthDp = 420)
@Composable
private fun AiThinkingIndicatorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AiThinkingIndicator()
    }
}
