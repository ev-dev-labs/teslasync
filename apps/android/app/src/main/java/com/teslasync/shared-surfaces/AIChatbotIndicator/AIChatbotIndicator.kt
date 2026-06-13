// The native Jetpack Compose + Material 3 AIChatbotIndicator shared surface — a parity port of
// web/src/components/ai/AIChatbotIndicator.tsx. The web surface is `withAiFeature('chatbot-llm', InnerIndicator)`:
// a small inline cyan chip (a `HelixMark` glyph + the "Helix" label) carrying a `title` tooltip and an
// `aria-label`, rendered only when the `chatbot-llm` AI feature is enabled and otherwise nothing (the HOC
// returns `null`). The chip tells the user the chatbot's responses are LLM-generated (so redaction + tools are
// active).
//
// There is no native `withAiFeature` / `HelixMark` atom (atomic AI/branding components are the out-of-scope P3
// component-library bundle), so the gate is composed here from the shared [AIChatbotIndicatorViewModel] (P1/S8)
// and the Helix mark is authored as a native [Canvas] double-helix in the shared monochrome style (mirroring web
// `HelixMark` and the sibling AISettings / AIAlertTuningSuggestions surfaces) — a complete, working surface, not
// a stub. The view performs NO HTTP. Every visible string resolves through the i18n catalog (P1/S10) — the
// existing `translation_chatbot_llm_*` keys whose values exactly match the web source's three strings — and the
// chip carries a merged TalkBack description.
//
// Parity-with-honesty (Honesty Covenant #9, documented not silent): the web gate renders `null` when the AI
// feature is off / unresolved — reproduced as the early return on [IndicatorSurface.Hidden]. The only other
// state is the visible chip ([IndicatorSurface.Visible]); the badge body is static, so the generic
// loading / empty / error / stale / offline data-states do not apply to this feature-gated brand badge (see
// AIChatbotIndicatorModel.kt for the full rationale).
//
// `MatchingDeclarationName`/`InvalidPackageDeclaration` are suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/AIChatbotIndicator) cannot form a valid Kotlin package and the file hosts
// several co-located composables, exactly as the sibling surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aichatbotindicator

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlin.math.PI
import kotlin.math.sin

/** Web `border` on the chip — a 1px cyan hairline (`border-cyan-300/30`). */
private val INDICATOR_BORDER_WIDTH: Dp = 1.dp

/** Web `bg-cyan-300/10` chip fill, applied as a low-alpha wash of the cyan accent. */
private const val INDICATOR_BG_ALPHA: Float = 0.10f

/** Web `border-cyan-300/30` chip border, applied as a low-alpha wash of the cyan accent. */
private const val INDICATOR_BORDER_ALPHA: Float = 0.30f

/** Web `h-3.5 w-3.5` HelixMark glyph size (14px). */
private val HELIX_MARK_SIZE: Dp = 14.dp

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
 * Stateful entry point — the faithful port of the web `AIChatbotIndicator` surface. Binds the AI-feature gate via
 * [source] into an [AIChatbotIndicatorViewModel], records the one-shot `view.opened` diagnostic, collects the
 * live state, and renders the chip (or nothing when the gate is closed — web `withAiFeature` → `null`). The
 * surface performs no HTTP; [logger] defaults to the process logger and [instanceKey] scopes the ViewModel per
 * placement.
 */
@Composable
fun AIChatbotIndicator(
    source: AIChatbotIndicatorSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = AI_CHATBOT_INDICATOR_SLUG,
) {
    val viewModel: AIChatbotIndicatorViewModel =
        viewModel(key = instanceKey, factory = AIChatbotIndicatorViewModel.factory(source, logger))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    AIChatbotIndicatorContent(state = state, modifier = modifier)
}

/**
 * Stateless renderer for the surface — the unit/UI-test + `@Preview` entry point. Classifies [state] into an
 * [IndicatorSurface] and renders the Helix chip, or renders nothing when the AI feature is gated off (web
 * `withAiFeature` → `null`).
 */
@Composable
fun AIChatbotIndicatorContent(
    state: ChatbotIndicatorState,
    modifier: Modifier = Modifier,
) {
    when (classifyIndicator(state)) {
        IndicatorSurface.Hidden -> Unit
        IndicatorSurface.Visible -> HelixIndicatorChip(modifier = modifier)
    }
}

/**
 * The web `InnerIndicator` chip: a pill with a cyan border + low-alpha cyan fill carrying the [HelixMark] glyph
 * and the localized "Helix" label, both in the cyan accent. The chip is informational (not interactive); its
 * merged semantics description folds the terse accessible name (web `aria-label`) and the long-form tooltip (web
 * `title`) into one TalkBack announcement, and the decorative glyph is subsumed by the merge.
 */
@Composable
private fun HelixIndicatorChip(modifier: Modifier = Modifier) {
    val badge = stringResource(R.string.translation_chatbot_llm_badge)
    val ariaLabel = stringResource(R.string.translation_chatbot_llm_indicator)
    val tooltip = stringResource(R.string.translation_chatbot_llm_indicatorTooltip)
    val accent = TeslaTokens.status.info
    val description = indicatorAccessibilityLabel(ariaLabel, tooltip)
    Surface(
        modifier = modifier.semantics(mergeDescendants = true) { contentDescription = description },
        shape = RoundedCornerShape(Radius.pill),
        color = accent.copy(alpha = INDICATOR_BG_ALPHA),
        contentColor = accent,
        border = BorderStroke(INDICATOR_BORDER_WIDTH, accent.copy(alpha = INDICATOR_BORDER_ALPHA)),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            HelixMark(modifier = Modifier.size(HELIX_MARK_SIZE), tint = accent)
            Text(badge, style = MaterialTheme.typography.labelSmall)
        }
    }
}

/**
 * The Helix brand mark — two interleaving strands joined by rungs, drawn natively with [Canvas] (no SVG) so it
 * recolors with the [tint]. Mirrors web `HelixMark` (a stylised vertical double helix) and the sibling AISettings
 * / AIAlertTuningSuggestions surfaces' authored glyph. Decorative: callers announce the chip, not this mark.
 */
@Composable
private fun HelixMark(
    modifier: Modifier = Modifier,
    tint: Color = LocalContentColor.current,
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

// ── Previews (tooling-only; the @Preview entry points exercise the visible chip) ─────────────────────────────

@Preview(name = "Visible — Helix chip", showBackground = true)
@Composable
private fun AIChatbotIndicatorVisiblePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIChatbotIndicatorContent(state = ChatbotIndicatorState(gateEnabled = true))
    }
}

@Preview(name = "Visible — Helix chip (dark)", showBackground = true)
@Composable
private fun AIChatbotIndicatorVisibleDarkPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        AIChatbotIndicatorContent(state = ChatbotIndicatorState(gateEnabled = true))
    }
}
