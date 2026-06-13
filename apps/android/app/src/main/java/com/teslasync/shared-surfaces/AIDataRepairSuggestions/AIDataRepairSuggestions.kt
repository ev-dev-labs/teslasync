// The native Jetpack Compose + Material 3 AIDataRepairSuggestions surface — a parity port of
// web/src/components/ai/AIDataRepairSuggestions.tsx. It reproduces the web AIFeatureCard composition end to end:
// the branded header (HelixMark + title + Helix badge + propose-only caveat), the universal "Ask Helix" action
// (web's "Draft repair plan" CTA, disabled while a stream is in flight), and every lifecycle state the prompt
// mandates: a streaming "thinking" skeleton, a friendly empty state, a hard-error retry surface, a rate-limit /
// cost-cap banner, and stale/offline "last known" with the last drafted plan kept visible. The view performs NO
// HTTP — it binds [AIDataRepairSuggestionsViewModel] (P1/S8) and renders.
//
// `withAiFeature` parity: the surface returns nothing when the per-feature AI-Off gate is closed (web's HOC
// renders `null`). `AIFeatureCard`/`withAiFeature` have no shared Android counterparts yet (they are the P3
// component-library bundle's scope), so the card scaffold + gate are reproduced inline here — a complete,
// working surface — using the existing shared primitives (GlassPanel/Button/IconBox/feedback).
//
// `MatchingDeclarationName`/`InvalidPackageDeclaration`/`filename` are suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/AIDataRepairSuggestions) cannot form a valid Kotlin package and the file hosts
// several co-located composables, exactly as the sibling surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "ktlint:standard:filename")

package io.teslasync.android.sharedsurfaces.aidatarepairsuggestions

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.BannerAction
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.OfflineBanner
import io.teslasync.android.components.feedback.SkeletonLines
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.iconColorFor
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import kotlin.math.PI
import kotlin.math.sin

private const val PANEL_FADE_DELAY_MS = 140
private const val BADGE_WASH_ALPHA = 0.12f
private const val REPLAY_WASH_ALPHA = 0.06f
private val HELIX_MARK_SIZE = 20.dp
private val BADGE_MARK_SIZE = 13.dp

// HelixMark geometry (normalized to the canvas' min dimension), mirroring web `HelixMark`.
private const val HELIX_TOP = 0.12f
private const val HELIX_BOTTOM = 0.88f
private const val HELIX_AMPLITUDE = 0.24f
private const val HELIX_STROKE = 0.085f
private const val HELIX_RUNG_STROKE = 0.06f
private const val HELIX_TURNS = 1.5f
private const val HELIX_SEGMENTS = 28
private const val HELIX_RUNGS = 3
private const val SKELETON_LINES = 3
private const val BANNER_LEVEL_CRITICAL = "critical"

/**
 * Stateful entry point for the surface. Binds the [viewModel] (P1/S8), records the one-shot `view.opened`
 * diagnostic, and honors the per-feature AI-Off gate (renders nothing when closed — web `withAiFeature` → null).
 * The host constructs the view-model via [AIDataRepairSuggestionsViewModel.factory]; this view never performs
 * HTTP. The drafted plan is propose-only (ADR-015 §I3/§I8) — the user applies it via the canonical Save / Close /
 * Discard buttons on the baseline DataRepairPage form below this surface, so there is no apply affordance here.
 */
@Composable
fun AIDataRepairSuggestions(
    viewModel: AIDataRepairSuggestionsViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val gated by viewModel.gated.collectAsStateWithLifecycle()
    if (!gated) return

    val snapshot by viewModel.snapshot.collectAsStateWithLifecycle()
    val resolve = rememberStringResolver()
    AIDataRepairSuggestionsContent(
        snapshot = snapshot,
        resolve = resolve,
        onDraft = viewModel::draft,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

/**
 * Stateless renderer of the surface — the unit/UI-test + @Preview entry point. Reproduces the web AIFeatureCard
 * layout (header → action button → streamed output) and every render state from [AiDataRepairSnapshot]: a loading
 * skeleton, a friendly empty state, a hard-error retry surface, a rate-limit / cost-cap banner, and stale/offline
 * last-known with the last drafted plan kept visible.
 */
@Composable
fun AIDataRepairSuggestionsContent(
    snapshot: AiDataRepairSnapshot,
    resolve: StringResolver,
    onDraft: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val labels = remember(resolve) { aiDataRepairLabels(resolve) }
    val draftCd = remember(resolve) { draftButtonContentDescription(resolve) }
    FadeIn(modifier = modifier, delayMs = PANEL_FADE_DELAY_MS) {
        GlassPanel(padding = PanelPadding.Lg) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                Header(labels)
                DraftRow(
                    label = if (snapshot.isBusy) labels.thinking else labels.askHelix,
                    contentDescription = draftCd,
                    enabled = snapshot.canStart && !snapshot.isBusy,
                    busy = snapshot.isBusy,
                    onDraft = onDraft,
                )
                StateBody(labels = labels, snapshot = snapshot, onRetry = onRetry)
            }
        }
    }
}

// ── Header (web AIFeatureCard header + AIBadge) ──────────────────────────────────────────────────────────────

@Composable
private fun Header(labels: AiDataRepairLabels) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.Top,
    ) {
        IconBox(tone = IconBoxTone.Info) {
            HelixMark(tint = iconColorFor(IconBoxTone.Info), modifier = Modifier.size(HELIX_MARK_SIZE))
        }
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                PanelTitle(labels.title, modifier = Modifier.weight(1f, fill = false))
                AiBadge(text = labels.badge, contentDescription = labels.badgeAria)
            }
            HelperText(labels.description)
        }
    }
}

/** The cyan "Helix" pill (web AIBadge): a low-alpha wash behind the brand mark + label, one a11y label. */
@Composable
private fun AiBadge(
    text: String,
    contentDescription: String,
) {
    val color = TeslaTokens.status.info
    Surface(
        modifier = Modifier.semantics { this.contentDescription = contentDescription },
        shape = RoundedCornerShape(Radius.pill),
        color = color.copy(alpha = BADGE_WASH_ALPHA),
        contentColor = color,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            HelixMark(tint = color, modifier = Modifier.size(BADGE_MARK_SIZE))
            Text(text, style = MaterialTheme.typography.labelSmall, color = color)
        }
    }
}

// ── Action button (web AIFeatureCard "Ask Helix" CTA, below placement) ───────────────────────────────────────

@Composable
private fun DraftRow(
    label: String,
    contentDescription: String,
    enabled: Boolean,
    busy: Boolean,
    onDraft: () -> Unit,
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Button(
            label = label,
            onClick = onDraft,
            modifier = Modifier.semantics { this.contentDescription = contentDescription },
            variant = ButtonVariant.Outline,
            size = ButtonSize.Sm,
            enabled = enabled,
            loading = busy,
        )
    }
}

// ── State body (every render state — never a blank box) ──────────────────────────────────────────────────────

@Composable
private fun StateBody(
    labels: AiDataRepairLabels,
    snapshot: AiDataRepairSnapshot,
    onRetry: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        when (snapshot.renderState) {
            AiDataRepairRenderState.Loading -> ThinkingChrome(labels, snapshot.text)
            AiDataRepairRenderState.Stale -> {
                Badge(labels.stale, variant = BadgeVariant.Warning, dot = true)
                if (snapshot.text.isNotBlank()) ReplayText(snapshot.text)
                Caption(labels.thinking)
            }
            AiDataRepairRenderState.Offline -> {
                OfflineBanner(message = labels.offline, onRetry = onRetry)
                if (snapshot.text.isNotBlank()) ReplayText(snapshot.text)
            }
            AiDataRepairRenderState.Error -> ErrorBody(labels, snapshot, onRetry)
            AiDataRepairRenderState.Empty -> EmptyState(message = labels.empty)
            AiDataRepairRenderState.Content -> ReplayText(snapshot.text)
        }
    }
}

@Composable
private fun ErrorBody(
    labels: AiDataRepairLabels,
    snapshot: AiDataRepairSnapshot,
    onRetry: () -> Unit,
) {
    // Mirror the web AiOutputPanel error line ("Helix error: <message>"), defaulting to the web "unknown" copy.
    val detail = snapshot.errorMessage?.takeIf { it.isNotBlank() } ?: labels.errorUnknown
    val message = "${labels.errorLabel} $detail"
    val limit = snapshot.limit
    if (limit != null) {
        AlertBanner(
            message = message,
            tone = if (limit.bannerLevel == BANNER_LEVEL_CRITICAL) Tone.Danger else Tone.Warning,
            title = labels.errorTitle,
            action = BannerAction(labels.retry, onRetry),
        )
    } else {
        ErrorDisplay(
            message = message,
            title = labels.errorTitle,
            onRetry = onRetry,
            retryLabel = labels.retry,
        )
    }
}

/** The streaming "thinking" chrome — the descriptive replay text, or shimmering skeleton lines until it arrives. */
@Composable
private fun ThinkingChrome(
    labels: AiDataRepairLabels,
    streamedText: String,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Caption(labels.thinking)
        if (streamedText.isNotBlank()) ReplayText(streamedText) else SkeletonLines(lines = SKELETON_LINES)
    }
}

/** The accumulated `delta` text — the descriptive repair plan (web AiOutputPanel body). */
@Composable
private fun ReplayText(text: String) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(Radius.md),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = REPLAY_WASH_ALPHA),
        contentColor = MaterialTheme.colorScheme.onSurface,
    ) {
        BodyText(text, modifier = Modifier.padding(Spacing.md))
    }
}

/**
 * The Helix brand mark — two interleaving strands joined by rungs, drawn natively with [Canvas] (no SVG) so it
 * recolors with the active theme / icon-box tone. Mirrors web `HelixMark`.
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
                    val x = centerX + amplitude * sin(fraction * HELIX_TURNS * 2f * PI.toFloat() + phase)
                    if (i == 0) moveTo(x, y) else lineTo(x, y)
                }
            }
        drawPath(strand(0f), color = tint, style = Stroke(width = side * HELIX_STROKE, cap = StrokeCap.Round))
        drawPath(strand(PI.toFloat()), color = tint, style = Stroke(width = side * HELIX_STROKE, cap = StrokeCap.Round))
        for (k in 1..HELIX_RUNGS) {
            val fraction = k / (HELIX_RUNGS + 1).toFloat()
            val y = top + (bottom - top) * fraction
            val angle = fraction * HELIX_TURNS * 2f * PI.toFloat()
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

// ── i18n facade (web `t(key, fallback)`) ─────────────────────────────────────────────────────────────────────

/**
 * By-name resolver against the generated Android catalog, falling back to the web English when a key is absent
 * (web `t(key, default)`). Remembered against the context so a locale change re-resolves the surface.
 */
@Composable
private fun rememberStringResolver(): StringResolver {
    val context = LocalContext.current
    return remember(context) {
        { key: String, fallback: String -> context.optionalString(foldCatalogKey(key)) ?: fallback }
    }
}

@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id).takeIf { it.isNotBlank() } else null
}

// ── Previews (FallbackResolver → web English; tooling-only) ──────────────────────────────────────────────────

@Suppress("LongParameterList")
private fun previewSnapshot(
    renderState: AiDataRepairRenderState,
    phase: AiStreamPhase = AiStreamPhase.Idle,
    text: String = "",
    errorMessage: String? = null,
    limit: AiLimitInfo? = null,
): AiDataRepairSnapshot =
    AiDataRepairSnapshot(
        renderState = renderState,
        phase = phase,
        text = text,
        canStart = renderState != AiDataRepairRenderState.Offline,
        isBusy = phase == AiStreamPhase.Streaming || phase == AiStreamPhase.PausedConfirm,
        errorMessage = errorMessage,
        limit = limit,
        offline = renderState == AiDataRepairRenderState.Offline,
        stale = renderState == AiDataRepairRenderState.Stale,
    )

private const val SAMPLE_PLAN =
    "Close stale charging session #842 (last sample 6h ago, plug disconnected): set status=closed, " +
        "energy_added_wh=18 400. Review on the baseline form before saving."

@Preview(name = "Content — drafted plan")
@Composable
private fun PreviewContent() {
    TeslaSyncTheme {
        AIDataRepairSuggestionsContent(
            snapshot = previewSnapshot(AiDataRepairRenderState.Content, phase = AiStreamPhase.Done, text = SAMPLE_PLAN),
            resolve = FallbackResolver,
            onDraft = {},
            onRetry = {},
        )
    }
}

@Preview(name = "Loading — Helix thinking")
@Composable
private fun PreviewLoading() {
    TeslaSyncTheme {
        AIDataRepairSuggestionsContent(
            snapshot = previewSnapshot(AiDataRepairRenderState.Loading, phase = AiStreamPhase.Streaming),
            resolve = FallbackResolver,
            onDraft = {},
            onRetry = {},
        )
    }
}

@Preview(name = "Empty")
@Composable
private fun PreviewEmpty() {
    TeslaSyncTheme {
        AIDataRepairSuggestionsContent(
            snapshot = previewSnapshot(AiDataRepairRenderState.Empty),
            resolve = FallbackResolver,
            onDraft = {},
            onRetry = {},
        )
    }
}

@Preview(name = "Error")
@Composable
private fun PreviewError() {
    TeslaSyncTheme {
        AIDataRepairSuggestionsContent(
            snapshot =
                previewSnapshot(
                    AiDataRepairRenderState.Error,
                    phase = AiStreamPhase.Error,
                    errorMessage = "stream_http_503",
                ),
            resolve = FallbackResolver,
            onDraft = {},
            onRetry = {},
        )
    }
}

@Preview(name = "Stale — refreshing over last plan")
@Composable
private fun PreviewStale() {
    TeslaSyncTheme {
        AIDataRepairSuggestionsContent(
            snapshot =
                previewSnapshot(AiDataRepairRenderState.Stale, phase = AiStreamPhase.Streaming, text = SAMPLE_PLAN),
            resolve = FallbackResolver,
            onDraft = {},
            onRetry = {},
        )
    }
}

@Preview(name = "Offline — last known")
@Composable
private fun PreviewOffline() {
    TeslaSyncTheme {
        AIDataRepairSuggestionsContent(
            snapshot = previewSnapshot(AiDataRepairRenderState.Offline, text = SAMPLE_PLAN),
            resolve = FallbackResolver,
            onDraft = {},
            onRetry = {},
        )
    }
}
