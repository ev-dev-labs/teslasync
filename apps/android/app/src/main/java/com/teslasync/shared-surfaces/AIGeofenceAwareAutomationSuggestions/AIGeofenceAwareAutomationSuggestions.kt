// The native Jetpack Compose + Material 3 AIGeofenceAwareAutomationSuggestions surface — a parity port of
// web/src/components/ai/AIGeofenceAwareAutomationSuggestions.tsx. It reproduces the web AIFeatureCard
// composition end to end: the branded header (HelixMark + title + Helix badge + propose-only description), the
// free-form prompt input (web `inputSlot` Textarea), the universal "Ask Helix" action (web's Suggest-automation
// CTA, disabled while a stream is in flight, no vehicle is selected, or the prompt is blank), the captured
// automation-graph proposal with its "Apply to form" affordance (which hands the typed graph back to the parent
// editor — the AI panel never persists, ADR-015 §I3/§I8 — and is disabled when the validator rejected the
// graph), and every lifecycle state the prompt mandates: a streaming "thinking" skeleton, a friendly
// empty/waiting state, a hard-error retry surface, a rate-limit / cost-cap banner, and stale/offline "last
// known" with the captured graph kept visible. The view performs NO HTTP — it binds
// [AIGeofenceAwareAutomationSuggestionsViewModel] (P1/S8) and renders.
//
// `withAiFeature` parity: the surface returns nothing when the per-feature AI-Off gate is closed (web's HOC
// renders `null`). `AIFeatureCard`/`withAiFeature` have no shared Android counterparts yet (they are the P3
// component-library bundle's scope), so the card scaffold + gate are reproduced inline here — a complete,
// working surface — using the existing shared primitives (GlassPanel/Button/Textarea/IconBox/feedback).
//
// `MatchingDeclarationName`/`InvalidPackageDeclaration`/`filename` are suppressed: the mandated surface
// directory (com/teslasync/shared-surfaces/AIGeofenceAwareAutomationSuggestions) cannot form a valid Kotlin
// package and the file hosts several co-located composables, exactly as the sibling surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "ktlint:standard:filename")

package io.teslasync.android.sharedsurfaces.aigeofenceawareautomationsuggestions

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.ui.semantics.heading
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
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Textarea
import io.teslasync.android.components.ui.iconColorFor
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import kotlin.math.PI
import kotlin.math.sin

private const val PANEL_FADE_DELAY_MS = 140
private const val BADGE_WASH_ALPHA = 0.12f
private const val PROPOSAL_WASH_ALPHA = 0.05f
private const val PROPOSAL_BORDER_ALPHA = 0.3f
private const val REPLAY_WASH_ALPHA = 0.04f
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
private const val BANNER_LEVEL_CRITICAL = "critical"
private const val COUNT_SEPARATOR = " · "
private const val PROMPT_MIN_LINES = 3
private const val PROMPT_MAX_LINES = 5

/**
 * Stateful entry point for the surface. Binds the [viewModel] (P1/S8), records the one-shot `view.opened`
 * diagnostic, honors the per-feature AI-Off gate (renders nothing when closed — web `withAiFeature` → null),
 * forwards the prompt edits back to the state holder, and hands a captured graph to the parent editor through
 * [onApplyDraft] (only when the validator accepted it). The host constructs the view-model via
 * [AIGeofenceAwareAutomationSuggestionsViewModel.factory]; this view never performs HTTP.
 */
@Composable
fun AIGeofenceAwareAutomationSuggestions(
    viewModel: AIGeofenceAwareAutomationSuggestionsViewModel,
    onApplyDraft: (AutomationGraphDraft) -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val gated by viewModel.gated.collectAsStateWithLifecycle()
    if (!gated) return

    val snapshot by viewModel.snapshot.collectAsStateWithLifecycle()
    val prompt by viewModel.prompt.collectAsStateWithLifecycle()
    val resolve = rememberStringResolver()
    AIGeofenceAwareAutomationSuggestionsContent(
        snapshot = snapshot,
        prompt = prompt,
        resolve = resolve,
        onPromptChange = viewModel::setPrompt,
        onSuggest = viewModel::suggest,
        onRetry = viewModel::retry,
        onApply = { snapshot.proposal?.let { if (it.isOk) onApplyDraft(it.graph) } },
        modifier = modifier,
    )
}

/**
 * Stateless renderer of the surface — the unit/UI-test + @Preview entry point. Reproduces the web AIFeatureCard
 * layout (header → prompt input → action button → captured-graph proposal → streamed output) and every render
 * state from [GeofenceDraftSnapshot]: loading skeleton chrome, a friendly empty/waiting state, a hard-error
 * retry surface, a rate-limit / cost-cap banner, and stale/offline last-known with the captured graph kept
 * visible.
 */
@Composable
fun AIGeofenceAwareAutomationSuggestionsContent(
    snapshot: GeofenceDraftSnapshot,
    prompt: String,
    resolve: StringResolver,
    onPromptChange: (String) -> Unit,
    onSuggest: () -> Unit,
    onRetry: () -> Unit,
    onApply: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val labels = remember(resolve) { geofenceDraftLabels(resolve) }
    val suggestCd = remember(resolve) { suggestButtonContentDescription(resolve) }
    FadeIn(modifier = modifier, delayMs = PANEL_FADE_DELAY_MS) {
        GlassPanel(padding = PanelPadding.Lg) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                Header(labels)
                Textarea(
                    value = prompt,
                    onValueChange = onPromptChange,
                    hint = labels.promptHint,
                    minLines = PROMPT_MIN_LINES,
                    maxLines = PROMPT_MAX_LINES,
                )
                SuggestRow(
                    label = if (snapshot.isBusy) labels.thinking else labels.askHelix,
                    contentDescription = suggestCd,
                    enabled = snapshot.canStart && !snapshot.isBusy,
                    busy = snapshot.isBusy,
                    onSuggest = onSuggest,
                )
                StateBody(labels = labels, snapshot = snapshot, onRetry = onRetry, onApply = onApply)
            }
        }
    }
}

// ── Header (web AIFeatureCard header + AIBadge) ──────────────────────────────────────────────────────────────

@Composable
private fun Header(labels: GeofenceDraftLabels) {
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
                PanelTitle(
                    labels.title,
                    modifier = Modifier.weight(1f, fill = false).semantics { heading() },
                )
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
private fun SuggestRow(
    label: String,
    contentDescription: String,
    enabled: Boolean,
    busy: Boolean,
    onSuggest: () -> Unit,
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Button(
            label = label,
            onClick = onSuggest,
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
    labels: GeofenceDraftLabels,
    snapshot: GeofenceDraftSnapshot,
    onRetry: () -> Unit,
    onApply: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        when (snapshot.renderState) {
            GeofenceDraftRenderState.Loading -> ThinkingChrome(labels, snapshot.streamedText)
            GeofenceDraftRenderState.Stale -> {
                Badge(labels.stale, variant = BadgeVariant.Warning, dot = true)
                snapshot.proposal?.let { ProposalPreview(labels, it, onApply = onApply) }
                ThinkingChrome(labels, snapshot.streamedText)
            }
            GeofenceDraftRenderState.Offline -> {
                OfflineBanner(message = labels.offline, onRetry = onRetry)
                snapshot.proposal?.let { ProposalPreview(labels, it, onApply = onApply) }
            }
            GeofenceDraftRenderState.Error -> ErrorBody(labels, snapshot, onRetry)
            GeofenceDraftRenderState.Empty ->
                EmptyState(message = if (snapshot.canStart) labels.empty else labels.waiting)
            GeofenceDraftRenderState.Content -> {
                if (snapshot.streamedText.isNotBlank()) ReplayText(snapshot.streamedText)
                snapshot.proposal?.let { ProposalPreview(labels, it, onApply = onApply) }
            }
        }
    }
}

@Composable
private fun ErrorBody(
    labels: GeofenceDraftLabels,
    snapshot: GeofenceDraftSnapshot,
    onRetry: () -> Unit,
) {
    val limit = snapshot.limit
    if (limit != null) {
        AlertBanner(
            message = snapshot.errorMessage ?: labels.errorTitle,
            tone = if (limit.bannerLevel == BANNER_LEVEL_CRITICAL) Tone.Danger else Tone.Warning,
            title = labels.errorTitle,
            action = BannerAction(labels.retry, onRetry),
        )
    } else {
        ErrorDisplay(
            message = snapshot.errorMessage ?: labels.errorTitle,
            title = labels.errorTitle,
            onRetry = onRetry,
            retryLabel = labels.retry,
        )
    }
}

/**
 * The captured automation-graph preview + "Apply to form" affordance (web's proposal box + Apply button). Shows
 * the proposed name (or "(unnamed)"), the description, the trigger / condition / action counts, the optional
 * validator message, and — when the validator rejected the graph — the rejected notice with a disabled Apply.
 */
@Composable
private fun ProposalPreview(
    labels: GeofenceDraftLabels,
    proposal: AutomationProposal,
    onApply: () -> Unit,
) {
    val graph = proposal.graph
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .background(
                    color = TeslaTokens.status.info.copy(alpha = PROPOSAL_WASH_ALPHA),
                    shape = RoundedCornerShape(Radius.md),
                ).border(
                    width = 1.dp,
                    color = TeslaTokens.status.info.copy(alpha = PROPOSAL_BORDER_ALPHA),
                    shape = RoundedCornerShape(Radius.md),
                ).padding(Spacing.md),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                ProposalHeadline(labels.proposalLabel)
                BodyText(graph.name.ifEmpty { labels.unnamed })
                if (graph.description.isNotBlank()) HelperText(graph.description)
                HelperText(countSummary(labels, graph))
                proposal.validationError?.let { HelperText(it) }
                if (!proposal.isOk) ErrorText(labels.rejectedLabel)
            }
            Button(
                label = labels.applyButton,
                onClick = onApply,
                modifier = Modifier.semantics { contentDescription = labels.applyButton },
                variant = ButtonVariant.Outline,
                size = ButtonSize.Sm,
                enabled = proposal.isOk,
            )
        }
    }
}

/** The cyan "Proposed automation" eyebrow above the graph summary (web `text-cyan-300` label). */
@Composable
private fun ProposalHeadline(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.labelSmall,
        color = TeslaTokens.status.info,
    )
}

/** The trigger / condition / action counts on one line (web `Triggers: N · Conditions: N · Actions: N`). */
private fun countSummary(
    labels: GeofenceDraftLabels,
    graph: AutomationGraphDraft,
): String =
    buildString {
        append(labels.triggersLabel).append(": ").append(graph.triggerCount)
        append(COUNT_SEPARATOR)
        append(labels.conditionsLabel).append(": ").append(graph.conditionCount)
        append(COUNT_SEPARATOR)
        append(labels.actionsLabel).append(": ").append(graph.actionCount)
    }

/** The streaming "thinking" chrome — the descriptive replay text, or shimmering skeleton lines until it arrives. */
@Composable
private fun ThinkingChrome(
    labels: GeofenceDraftLabels,
    streamedText: String,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Caption(labels.thinking)
        if (streamedText.isNotBlank()) ReplayText(streamedText) else SkeletonLines(lines = 3)
    }
}

/** The accumulated `delta` text — descriptive replay only (web AiOutputPanel body). */
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
    renderState: GeofenceDraftRenderState,
    proposal: AutomationProposal? = null,
    phase: AiStreamPhase = AiStreamPhase.Idle,
    streamedText: String = "",
    errorMessage: String? = null,
    limit: AiLimitInfo? = null,
): GeofenceDraftSnapshot =
    GeofenceDraftSnapshot(
        renderState = renderState,
        phase = phase,
        proposal = proposal,
        streamedText = streamedText,
        canStart = renderState != GeofenceDraftRenderState.Offline,
        isBusy = phase == AiStreamPhase.Streaming || phase == AiStreamPhase.PausedConfirm,
        errorMessage = errorMessage,
        limit = limit,
        offline = renderState == GeofenceDraftRenderState.Offline,
        stale = renderState == GeofenceDraftRenderState.Stale,
    )

private fun sampleProposal(status: String = "ok"): AutomationProposal =
    AutomationProposal(
        graph =
            AutomationGraphDraft(
                name = "Arrive home → cabin overheat protection",
                description = "When I arrive at Home on a weekday after sunset, enable cabin overheat protection.",
                vehicleId = 7L,
                enabled = true,
                triggers = emptyList(),
                conditions = emptyList(),
                actions = emptyList(),
            ),
        status = status,
        validationError = if (status == "ok") null else "place_id not found in your geofence catalog",
    )

@Preview(name = "Content — proposed automation")
@Composable
private fun PreviewContent() {
    TeslaSyncTheme {
        AIGeofenceAwareAutomationSuggestionsContent(
            snapshot = previewSnapshot(GeofenceDraftRenderState.Content, proposal = sampleProposal(), phase = AiStreamPhase.Done),
            prompt = "when I arrive home on a weekday after sunset, turn on cabin overheat protection",
            resolve = FallbackResolver,
            onPromptChange = {},
            onSuggest = {},
            onRetry = {},
            onApply = {},
        )
    }
}

@Preview(name = "Content — rejected by validator")
@Composable
private fun PreviewRejected() {
    TeslaSyncTheme {
        AIGeofenceAwareAutomationSuggestionsContent(
            snapshot = previewSnapshot(GeofenceDraftRenderState.Content, proposal = sampleProposal("invalid"), phase = AiStreamPhase.Done),
            prompt = "turn on sentry near the office",
            resolve = FallbackResolver,
            onPromptChange = {},
            onSuggest = {},
            onRetry = {},
            onApply = {},
        )
    }
}

@Preview(name = "Loading — Helix thinking")
@Composable
private fun PreviewLoading() {
    TeslaSyncTheme {
        AIGeofenceAwareAutomationSuggestionsContent(
            snapshot = previewSnapshot(GeofenceDraftRenderState.Loading, phase = AiStreamPhase.Streaming),
            prompt = "warm the cabin when I leave work",
            resolve = FallbackResolver,
            onPromptChange = {},
            onSuggest = {},
            onRetry = {},
            onApply = {},
        )
    }
}

@Preview(name = "Empty")
@Composable
private fun PreviewEmpty() {
    TeslaSyncTheme {
        AIGeofenceAwareAutomationSuggestionsContent(
            snapshot = previewSnapshot(GeofenceDraftRenderState.Empty),
            prompt = "",
            resolve = FallbackResolver,
            onPromptChange = {},
            onSuggest = {},
            onRetry = {},
            onApply = {},
        )
    }
}

@Preview(name = "Error")
@Composable
private fun PreviewError() {
    TeslaSyncTheme {
        AIGeofenceAwareAutomationSuggestionsContent(
            snapshot =
                previewSnapshot(
                    GeofenceDraftRenderState.Error,
                    phase = AiStreamPhase.Error,
                    errorMessage = "stream_http_503",
                ),
            prompt = "warm the cabin when I leave work",
            resolve = FallbackResolver,
            onPromptChange = {},
            onSuggest = {},
            onRetry = {},
            onApply = {},
        )
    }
}

@Preview(name = "Offline — last known")
@Composable
private fun PreviewOffline() {
    TeslaSyncTheme {
        AIGeofenceAwareAutomationSuggestionsContent(
            snapshot = previewSnapshot(GeofenceDraftRenderState.Offline, proposal = sampleProposal()),
            prompt = "when I arrive home on a weekday after sunset, turn on cabin overheat protection",
            resolve = FallbackResolver,
            onPromptChange = {},
            onSuggest = {},
            onRetry = {},
            onApply = {},
        )
    }
}
