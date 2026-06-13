// The native Jetpack Compose + Material 3 AIQuietHoursSuggestion surface — a parity port of
// web/src/components/ai/AIQuietHoursSuggestion.tsx. It reproduces the web AIFeatureCard composition end to
// end: the branded header (HelixMark + title + Helix badge + the privacy-preserving description), the
// universal "Ask Helix" action (web's Suggest-quiet-hours CTA, disabled while a stream is in flight), the
// captured-proposal preview with its "Apply to form" affordance (which hands the typed window back to the
// parent QuietHoursPanel — the AI panel never persists), and every lifecycle state the prompt mandates: a
// resting invitation card, a streaming "thinking" skeleton, a friendly empty state, a hard-error retry
// surface, a rate-limit / cost-cap banner, and stale/offline "last known" with the captured window kept
// visible. The view performs NO HTTP — it binds [AIQuietHoursSuggestionViewModel] (P1/S8) and renders.
//
// `withAiFeature` parity: the surface returns nothing when the per-feature AI-Off gate is closed (web's HOC
// renders `null`). `AIFeatureCard`/`withAiFeature` have no shared Android counterparts yet (they are the P3
// component-library bundle's scope), so the card scaffold + gate are reproduced inline here — a complete,
// working surface, not a skeleton — using the existing shared primitives (GlassPanel/Button/IconBox/feedback).
//
// `MatchingDeclarationName`/`InvalidPackageDeclaration`/`filename` are suppressed: the mandated surface
// directory (com/teslasync/shared-surfaces/AIQuietHoursSuggestion) cannot form a valid Kotlin package and the
// file hosts several co-located composables, exactly as the sibling surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "ktlint:standard:filename")

package io.teslasync.android.sharedsurfaces.aiquiethourssuggestion

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.Canvas
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
import io.teslasync.android.components.ui.FieldLabelText
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
private const val PREVIEW_WASH_ALPHA = 0.06f
private const val PREVIEW_BORDER_ALPHA = 0.3f
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
private const val PREVIEW_BULLET = "•  "

/**
 * Stateful entry point for the surface. Binds the [viewModel] (P1/S8), records the one-shot `view.opened`
 * diagnostic, honors the per-feature AI-Off gate (renders nothing when closed — web `withAiFeature` → null),
 * and forwards a captured proposal to the parent QuietHoursPanel through [onApplyDraft]. The host constructs
 * the view-model via [AIQuietHoursSuggestionViewModel.factory]; this view never performs HTTP.
 */
@Composable
fun AIQuietHoursSuggestion(
    viewModel: AIQuietHoursSuggestionViewModel,
    onApplyDraft: (QuietHoursWindowInput) -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val gated by viewModel.gated.collectAsStateWithLifecycle()
    if (!gated) return

    val snapshot by viewModel.snapshot.collectAsStateWithLifecycle()
    val resolve = rememberStringResolver()
    val previewProvider = rememberPreviewProvider()
    AIQuietHoursSuggestionContent(
        snapshot = snapshot,
        resolve = resolve,
        previewProvider = previewProvider,
        onSuggest = viewModel::suggest,
        onRetry = viewModel::retry,
        onApply = { snapshot.proposal?.let { onApplyDraft(it.toInput()) } },
        modifier = modifier,
    )
}

/**
 * Stateless renderer of the surface — the unit/UI-test + @Preview entry point. Reproduces the web AIFeatureCard
 * layout (header → action button → captured-proposal preview → streamed output) and every render state from
 * [QuietHoursSnapshot]: a resting invitation card, a loading skeleton, a friendly empty state, a hard-error
 * retry surface, a rate-limit / cost-cap banner, and stale/offline last-known with the captured window kept
 * visible.
 */
@Composable
fun AIQuietHoursSuggestionContent(
    snapshot: QuietHoursSnapshot,
    resolve: StringResolver,
    previewProvider: PreviewStringProvider,
    onSuggest: () -> Unit,
    onRetry: () -> Unit,
    onApply: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val labels = remember(resolve) { aiQuietHoursLabels(resolve) }
    val suggestCd = remember(resolve) { suggestButtonContentDescription(resolve) }
    FadeIn(modifier = modifier, delayMs = PANEL_FADE_DELAY_MS) {
        GlassPanel(padding = PanelPadding.Lg) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                Header(labels)
                SuggestRow(
                    label = if (snapshot.isBusy) labels.thinking else labels.askHelix,
                    contentDescription = suggestCd,
                    enabled = snapshot.canStart && !snapshot.isBusy,
                    busy = snapshot.isBusy,
                    onSuggest = onSuggest,
                )
                StateBody(
                    labels = labels,
                    snapshot = snapshot,
                    previewProvider = previewProvider,
                    onRetry = onRetry,
                    onApply = onApply,
                )
            }
        }
    }
}

// ── Header (web AIFeatureCard header + AIBadge) ──────────────────────────────────────────────────────────────

@Composable
private fun Header(labels: AiQuietHoursLabels) {
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
    labels: AiQuietHoursLabels,
    snapshot: QuietHoursSnapshot,
    previewProvider: PreviewStringProvider,
    onRetry: () -> Unit,
    onApply: () -> Unit,
) {
    // Resting (idle) mirrors the web AiOutputPanel rendering nothing before a stream starts — the header's
    // description is the friendly invitation, so no output region is emitted (and no extra gap appears).
    if (snapshot.renderState == QuietHoursRenderState.Resting) return
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        when (snapshot.renderState) {
            QuietHoursRenderState.Resting -> Unit
            QuietHoursRenderState.Loading -> ThinkingChrome(labels, snapshot.streamedText)
            QuietHoursRenderState.Stale -> {
                Badge(labels.stale, variant = BadgeVariant.Warning, dot = true)
                snapshot.proposal?.let {
                    ProposalPreview(labels, it, previewProvider, busy = true, onApply = onApply)
                }
                ThinkingChrome(labels, snapshot.streamedText)
            }
            QuietHoursRenderState.Offline -> {
                OfflineBanner(message = labels.offline, onRetry = onRetry)
                snapshot.proposal?.let {
                    ProposalPreview(labels, it, previewProvider, busy = false, onApply = onApply)
                }
            }
            QuietHoursRenderState.Error -> ErrorBody(labels, snapshot, onRetry)
            QuietHoursRenderState.Empty -> EmptyState(message = labels.empty)
            QuietHoursRenderState.Content -> {
                if (snapshot.streamedText.isNotBlank()) ReplayText(snapshot.streamedText)
                snapshot.proposal?.let {
                    ProposalPreview(labels, it, previewProvider, busy = false, onApply = onApply)
                }
            }
        }
    }
}

@Composable
private fun ErrorBody(
    labels: AiQuietHoursLabels,
    snapshot: QuietHoursSnapshot,
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

/** The captured window preview + "Apply to form" affordance (web's proposal `<ul>` + Apply button). */
@Composable
private fun ProposalPreview(
    labels: AiQuietHoursLabels,
    proposal: QuietHoursWindowProposal,
    previewProvider: PreviewStringProvider,
    busy: Boolean,
    onApply: () -> Unit,
) {
    val lines = remember(proposal, previewProvider) { quietHoursPreviewLines(proposal, previewProvider) }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            Button(
                label = labels.applyButton,
                onClick = onApply,
                modifier = Modifier.semantics { contentDescription = labels.applyButton },
                variant = ButtonVariant.Primary,
                size = ButtonSize.Sm,
                enabled = !busy,
            )
        }
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .border(
                        width = 1.dp,
                        color = TeslaTokens.status.success.copy(alpha = PREVIEW_BORDER_ALPHA),
                        shape = RoundedCornerShape(Radius.md),
                    ).padding(Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            FieldLabelText(labels.previewLabel)
            lines.forEach { line -> PreviewLineText(line) }
        }
    }
}

/** One preview list item — secondary copy, or the amber conservative-default caveat (web `text-amber-300`). */
@Composable
private fun PreviewLineText(line: QuietHoursPreviewLine) {
    val text = "$PREVIEW_BULLET${line.text}"
    when (line.tone) {
        PreviewTone.Secondary -> HelperText(text)
        PreviewTone.Warning ->
            Text(
                text = text,
                style = MaterialTheme.typography.bodySmall,
                color = TeslaTokens.status.warning,
            )
    }
}

/** The streaming "thinking" chrome — the descriptive replay text, or shimmering skeleton lines until it arrives. */
@Composable
private fun ThinkingChrome(
    labels: AiQuietHoursLabels,
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
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = PREVIEW_WASH_ALPHA),
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

/**
 * The parameterized-preview resolver: resolves each preview line against the generated Android positional
 * catalog (`%1$s`/`%2$s`/…) and falls back to the web `{{token}}` template when a key is absent. Remembered
 * against the context so a locale change re-resolves the surface. The argument array is at most three elements
 * (the window line), so [SpreadOperator] is suppressed — its full-copy performance rationale does not apply.
 */
@Suppress("SpreadOperator")
@Composable
private fun rememberPreviewProvider(): PreviewStringProvider {
    val context = LocalContext.current
    return remember(context) {
        PreviewStringProvider { key, args ->
            val id = context.stringResId(foldCatalogKey(key.dottedKey))
            if (id != 0) {
                context.getString(id, *args.toTypedArray())
            } else {
                FallbackPreviewProvider.format(key, args)
            }
        }
    }
}

@SuppressLint("DiscouragedApi")
private fun Context.stringResId(resourceName: String): Int = resources.getIdentifier(resourceName, "string", packageName)

private fun Context.optionalString(resourceName: String): String? {
    val id = stringResId(resourceName)
    return if (id != 0) getString(id).takeIf { it.isNotBlank() } else null
}

// ── Previews (FallbackResolver → web English; tooling-only) ──────────────────────────────────────────────────

@Suppress("LongParameterList")
private fun previewSnapshot(
    renderState: QuietHoursRenderState,
    proposal: QuietHoursWindowProposal? = null,
    phase: AiStreamPhase = AiStreamPhase.Idle,
    streamedText: String = "",
    errorMessage: String? = null,
    limit: AiLimitInfo? = null,
): QuietHoursSnapshot =
    QuietHoursSnapshot(
        renderState = renderState,
        phase = phase,
        proposal = proposal,
        streamedText = streamedText,
        canStart = renderState != QuietHoursRenderState.Offline,
        isBusy = phase == AiStreamPhase.Streaming || phase == AiStreamPhase.PausedConfirm,
        errorMessage = errorMessage,
        limit = limit,
        offline = renderState == QuietHoursRenderState.Offline,
        stale = renderState == QuietHoursRenderState.Stale,
    )

private val SAMPLE_PROPOSAL =
    QuietHoursWindowProposal(
        startLocal = "22:00",
        endLocal = "07:00",
        timezone = "America/Los_Angeles",
        weekdays = 127,
        bypassSeverities = listOf("critical", "high"),
        status = STATUS_INSUFFICIENT_HISTORY,
        existingWindowsCount = 2,
    )

@Preview(name = "Resting — invitation card")
@Composable
private fun PreviewResting() {
    TeslaSyncTheme {
        AIQuietHoursSuggestionContent(
            snapshot = previewSnapshot(QuietHoursRenderState.Resting),
            resolve = FallbackResolver,
            previewProvider = FallbackPreviewProvider,
            onSuggest = {},
            onRetry = {},
            onApply = {},
        )
    }
}

@Preview(name = "Content — proposed window")
@Composable
private fun PreviewContent() {
    TeslaSyncTheme {
        AIQuietHoursSuggestionContent(
            snapshot = previewSnapshot(QuietHoursRenderState.Content, proposal = SAMPLE_PROPOSAL, phase = AiStreamPhase.Done),
            resolve = FallbackResolver,
            previewProvider = FallbackPreviewProvider,
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
        AIQuietHoursSuggestionContent(
            snapshot = previewSnapshot(QuietHoursRenderState.Loading, phase = AiStreamPhase.Streaming),
            resolve = FallbackResolver,
            previewProvider = FallbackPreviewProvider,
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
        AIQuietHoursSuggestionContent(
            snapshot = previewSnapshot(QuietHoursRenderState.Empty, phase = AiStreamPhase.Done),
            resolve = FallbackResolver,
            previewProvider = FallbackPreviewProvider,
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
        AIQuietHoursSuggestionContent(
            snapshot =
                previewSnapshot(
                    QuietHoursRenderState.Error,
                    phase = AiStreamPhase.Error,
                    errorMessage = "stream_http_503",
                ),
            resolve = FallbackResolver,
            previewProvider = FallbackPreviewProvider,
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
        AIQuietHoursSuggestionContent(
            snapshot = previewSnapshot(QuietHoursRenderState.Offline, proposal = SAMPLE_PROPOSAL),
            resolve = FallbackResolver,
            previewProvider = FallbackPreviewProvider,
            onSuggest = {},
            onRetry = {},
            onApply = {},
        )
    }
}
