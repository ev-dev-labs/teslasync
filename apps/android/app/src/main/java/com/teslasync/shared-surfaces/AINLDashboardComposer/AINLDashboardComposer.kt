// The native Jetpack Compose + Material 3 AINLDashboardComposer surface — a parity port of
// web/src/components/ai/AINLDashboardComposer.tsx. It reproduces the web AIFeatureCard composition end to end: the
// branded header (HelixMark + title + Helix badge + caveat), the prompt textarea (web `inputSlot`), the universal
// "Ask Helix" action (web's Draft-dashboard CTA, disabled while a stream is in flight or the prompt is blank), the
// captured draft with its "Apply to editor" affordance (which hands the typed draft back to the parent editor —
// the AI panel never writes editor state), and every lifecycle state the prompt mandates: a streaming "thinking"
// skeleton, a friendly waiting / no-draft empty state, a hard-error retry surface, a rate-limit / cost-cap banner,
// and stale/offline "last known" with the captured draft kept visible. The view performs NO HTTP — it binds
// [AINLDashboardComposerViewModel] (P1/S8) and renders.
//
// `withAiFeature` parity: the surface returns nothing when the per-feature AI-Off gate is closed (web's HOC
// renders `null`). The card scaffold + gate are reproduced inline here — a complete, working surface — using the
// existing shared primitives (GlassPanel/Button/Textarea/IconBox/Badge/feedback), exactly as the sibling AI
// surfaces do.
//
// `MatchingDeclarationName`/`InvalidPackageDeclaration`/`filename` are suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/AINLDashboardComposer) cannot form a valid Kotlin package and the file hosts
// several co-located composables, exactly as the sibling surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "ktlint:standard:filename")

package io.teslasync.android.sharedsurfaces.ainldashboardcomposer

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
private const val REPLAY_WASH_ALPHA = 0.06f
private const val DRAFT_BORDER_ALPHA = 0.3f
private const val PROMPT_MIN_LINES = 2
private const val PROMPT_MAX_LINES = 4
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

/**
 * Stateful entry point for the surface. Binds the [viewModel] (P1/S8), records the one-shot `view.opened`
 * diagnostic, honors the per-feature AI-Off gate (renders nothing when closed — web `withAiFeature` → null), and
 * hands a captured draft to the parent editor through [onApply]. The host constructs the view-model via
 * [AINLDashboardComposerViewModel.factory]; this view never performs HTTP.
 */
@Composable
fun AINLDashboardComposer(
    viewModel: AINLDashboardComposerViewModel,
    onApply: (DashboardLayoutDraft) -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val gated by viewModel.gated.collectAsStateWithLifecycle()
    if (!gated) return

    val snapshot by viewModel.snapshot.collectAsStateWithLifecycle()
    val resolve = rememberStringResolver()
    AINLDashboardComposerContent(
        snapshot = snapshot,
        resolve = resolve,
        onPromptChange = viewModel::setPrompt,
        onDraft = viewModel::draftDashboard,
        onRetry = viewModel::retry,
        onApply = onApply,
        modifier = modifier,
    )
}

/**
 * Stateless renderer of the surface — the unit/UI-test + @Preview entry point. Reproduces the web AIFeatureCard
 * layout (header → prompt textarea → action button → captured-draft preview → streamed output) and every render
 * state from [AiNlDashboardSnapshot]: loading skeleton chrome, a friendly waiting / no-draft state, a hard-error
 * retry surface, a rate-limit / cost-cap banner, and stale/offline last-known with the captured draft kept
 * visible.
 */
@Composable
fun AINLDashboardComposerContent(
    snapshot: AiNlDashboardSnapshot,
    resolve: StringResolver,
    onPromptChange: (String) -> Unit,
    onDraft: () -> Unit,
    onRetry: () -> Unit,
    onApply: (DashboardLayoutDraft) -> Unit,
    modifier: Modifier = Modifier,
) {
    val labels = remember(resolve) { aiDrafterLabels(resolve) }
    val draftCd = remember(resolve) { draftButtonContentDescription(resolve) }
    FadeIn(modifier = modifier, delayMs = PANEL_FADE_DELAY_MS) {
        GlassPanel(padding = PanelPadding.Lg) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                Header(labels)
                PromptField(snapshot = snapshot, labels = labels, onPromptChange = onPromptChange)
                DraftRow(
                    label = if (snapshot.isBusy) labels.thinking else labels.askHelix,
                    contentDescription = draftCd,
                    enabled = snapshot.canStart,
                    busy = snapshot.isBusy,
                    onDraft = onDraft,
                )
                StateBody(labels = labels, snapshot = snapshot, onRetry = onRetry, onApply = onApply)
            }
        }
    }
}

// ── Header (web AIFeatureCard header + AIBadge) ──────────────────────────────────────────────────────────────

@Composable
private fun Header(labels: AiDrafterLabels) {
    val headerCd = remember(labels) { headerAccessibilityLabel(labels.title, labels.badge, labels.description) }
    Row(
        modifier = Modifier.fillMaxWidth().semantics(mergeDescendants = true) { contentDescription = headerCd },
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

// ── Prompt input (web AIFeatureCard `inputSlot` → Textarea) ──────────────────────────────────────────────────

@Composable
private fun PromptField(
    snapshot: AiNlDashboardSnapshot,
    labels: AiDrafterLabels,
    onPromptChange: (String) -> Unit,
) {
    Textarea(
        value = snapshot.promptText,
        onValueChange = onPromptChange,
        label = labels.promptLabel,
        hint = labels.promptHint,
        enabled = !snapshot.isBusy,
        minLines = PROMPT_MIN_LINES,
        maxLines = PROMPT_MAX_LINES,
    )
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
    labels: AiDrafterLabels,
    snapshot: AiNlDashboardSnapshot,
    onRetry: () -> Unit,
    onApply: (DashboardLayoutDraft) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        when (snapshot.renderState) {
            AiNlDashboardRenderState.Loading -> ThinkingChrome(labels, snapshot.streamedText)
            AiNlDashboardRenderState.Stale -> {
                Badge(labels.stale, variant = BadgeVariant.Warning, dot = true)
                DraftPreview(snapshot, labels, onApply)
                ThinkingChrome(labels, snapshot.streamedText)
            }
            AiNlDashboardRenderState.Offline -> {
                OfflineBanner(message = labels.offline, onRetry = onRetry)
                DraftPreview(snapshot, labels, onApply)
            }
            AiNlDashboardRenderState.Error -> ErrorBody(labels, snapshot, onRetry)
            AiNlDashboardRenderState.Empty ->
                EmptyState(message = if (snapshot.hasResult) labels.empty else labels.waiting)
            AiNlDashboardRenderState.Content -> {
                if (snapshot.streamedText.isNotBlank()) ReplayText(snapshot.streamedText)
                DraftPreview(snapshot, labels, onApply)
            }
        }
    }
}

@Composable
private fun ErrorBody(
    labels: AiDrafterLabels,
    snapshot: AiNlDashboardSnapshot,
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

// ── Captured draft (web's `{draft && (… Apply to editor …)}` children) ───────────────────────────────────────

@Composable
private fun DraftPreview(
    snapshot: AiNlDashboardSnapshot,
    labels: AiDrafterLabels,
    onApply: (DashboardLayoutDraft) -> Unit,
) {
    val draft = snapshot.draft ?: return
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .border(
                    width = 1.dp,
                    color = TeslaTokens.status.info.copy(alpha = DRAFT_BORDER_ALPHA),
                    shape = RoundedCornerShape(Radius.md),
                ).padding(Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Badge(labels.draftReady, variant = BadgeVariant.Success, dot = true)
        BodyText(draftTitle(draft, labels))
        DraftPanels(draft, labels)
        draft.rationale.takeIf { it.isNotBlank() }?.let { HelperText(it) }
        ApplyRow(snapshot = snapshot, labels = labels, draft = draft, onApply = onApply)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DraftPanels(
    draft: DashboardLayoutDraft,
    labels: AiDrafterLabels,
) {
    val names = remember(draft) { draftPanelNames(draft) }
    if (names.isEmpty()) return
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(labels.panelsLabel)
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            names.forEach { name -> Badge(name, variant = BadgeVariant.Neutral) }
        }
    }
}

@Composable
private fun ApplyRow(
    snapshot: AiNlDashboardSnapshot,
    labels: AiDrafterLabels,
    draft: DashboardLayoutDraft,
    onApply: (DashboardLayoutDraft) -> Unit,
) {
    val applyCd = remember(labels) { applyButtonContentDescription(labels) }
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Button(
            label = labels.applyButton,
            onClick = { onApply(draft) },
            modifier = Modifier.semantics { contentDescription = applyCd },
            variant = ButtonVariant.Primary,
            size = ButtonSize.Sm,
            enabled = snapshot.canApply,
        )
    }
}

/** The streaming "thinking" chrome — the descriptive replay text, or shimmering skeleton lines until it arrives. */
@Composable
private fun ThinkingChrome(
    labels: AiDrafterLabels,
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

private val SAMPLE_DRAFT =
    DashboardLayoutDraft(
        prompt = "give me an overview dashboard with daily drives, current battery, and recent alerts",
        dashboard =
            DashboardEnvelope(
                title = "Fleet overview",
                slots =
                    listOf(
                        DashboardSlot("daily_drives", DashboardSlotGrid(0, 0, 6, 4)),
                        DashboardSlot("battery_state_of_charge", DashboardSlotGrid(6, 0, 6, 4)),
                        DashboardSlot("recent_alerts", DashboardSlotGrid(0, 4, 12, 4)),
                    ),
            ),
        rationale = "Combines daily driving, the current battery state, and recent alerts into one overview.",
        referencedPanels = listOf("daily_drives", "battery_state_of_charge", "recent_alerts"),
    )

@Suppress("LongParameterList")
private fun previewSnapshot(
    renderState: AiNlDashboardRenderState,
    promptText: String = "an overview dashboard",
    draft: DashboardLayoutDraft? = null,
    hasResult: Boolean = draft != null,
    phase: AiStreamPhase = AiStreamPhase.Idle,
    streamedText: String = "",
    errorMessage: String? = null,
    limit: AiLimitInfo? = null,
): AiNlDashboardSnapshot {
    val busy = phase == AiStreamPhase.Streaming || phase == AiStreamPhase.PausedConfirm
    return AiNlDashboardSnapshot(
        renderState = renderState,
        phase = phase,
        promptText = promptText,
        hasPrompt = promptText.trim().isNotEmpty(),
        draft = draft,
        hasResult = hasResult,
        streamedText = streamedText,
        canStart = renderState != AiNlDashboardRenderState.Offline && !busy && promptText.trim().isNotEmpty(),
        canApply = draft != null && !busy,
        isBusy = busy,
        errorMessage = errorMessage,
        limit = limit,
        offline = renderState == AiNlDashboardRenderState.Offline,
        stale = renderState == AiNlDashboardRenderState.Stale,
    )
}

@Preview(name = "Content — draft ready")
@Composable
private fun PreviewContent() {
    TeslaSyncTheme {
        AINLDashboardComposerContent(
            snapshot = previewSnapshot(AiNlDashboardRenderState.Content, draft = SAMPLE_DRAFT, phase = AiStreamPhase.Done),
            resolve = FallbackResolver,
            onPromptChange = {},
            onDraft = {},
            onRetry = {},
            onApply = {},
        )
    }
}

@Preview(name = "Loading — Helix thinking")
@Composable
private fun PreviewLoading() {
    TeslaSyncTheme {
        AINLDashboardComposerContent(
            snapshot = previewSnapshot(AiNlDashboardRenderState.Loading, phase = AiStreamPhase.Streaming),
            resolve = FallbackResolver,
            onPromptChange = {},
            onDraft = {},
            onRetry = {},
            onApply = {},
        )
    }
}

@Preview(name = "Empty — waiting for a prompt")
@Composable
private fun PreviewWaiting() {
    TeslaSyncTheme {
        AINLDashboardComposerContent(
            snapshot = previewSnapshot(AiNlDashboardRenderState.Empty, promptText = ""),
            resolve = FallbackResolver,
            onPromptChange = {},
            onDraft = {},
            onRetry = {},
            onApply = {},
        )
    }
}

@Preview(name = "Empty — resolved, no draft")
@Composable
private fun PreviewEmptyResolved() {
    TeslaSyncTheme {
        AINLDashboardComposerContent(
            snapshot = previewSnapshot(AiNlDashboardRenderState.Empty, hasResult = true, phase = AiStreamPhase.Done),
            resolve = FallbackResolver,
            onPromptChange = {},
            onDraft = {},
            onRetry = {},
            onApply = {},
        )
    }
}

@Preview(name = "Error")
@Composable
private fun PreviewError() {
    TeslaSyncTheme {
        AINLDashboardComposerContent(
            snapshot =
                previewSnapshot(
                    AiNlDashboardRenderState.Error,
                    phase = AiStreamPhase.Error,
                    errorMessage = "stream_http_503",
                ),
            resolve = FallbackResolver,
            onPromptChange = {},
            onDraft = {},
            onRetry = {},
            onApply = {},
        )
    }
}

@Preview(name = "Stale — refreshing over last known")
@Composable
private fun PreviewStale() {
    TeslaSyncTheme {
        AINLDashboardComposerContent(
            snapshot =
                previewSnapshot(
                    AiNlDashboardRenderState.Stale,
                    draft = SAMPLE_DRAFT,
                    phase = AiStreamPhase.Streaming,
                ),
            resolve = FallbackResolver,
            onPromptChange = {},
            onDraft = {},
            onRetry = {},
            onApply = {},
        )
    }
}

@Preview(name = "Offline — last known")
@Composable
private fun PreviewOffline() {
    TeslaSyncTheme {
        AINLDashboardComposerContent(
            snapshot = previewSnapshot(AiNlDashboardRenderState.Offline, draft = SAMPLE_DRAFT),
            resolve = FallbackResolver,
            onPromptChange = {},
            onDraft = {},
            onRetry = {},
            onApply = {},
        )
    }
}
