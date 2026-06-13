// The native Jetpack Compose + Material 3 AICrossRuleConflictDetection surface — a parity port of
// web/src/components/ai/AICrossRuleConflictDetection.tsx. It reproduces the web AIFeatureCard composition end to
// end: the branded header (HelixMark + title + Helix badge + review-only caveat), the universal "Ask Helix"
// action (web's Detect-conflicts CTA, disabled while a stream is in flight or fewer than two rules are in
// scope), the captured conflict list with its per-row severity chips and two "Review rule {id}" affordances
// (which hand the offending rule back to the parent editor — the AI panel never persists), and every lifecycle
// state the prompt mandates: a streaming "thinking" skeleton, a friendly empty/waiting state, a hard-error retry
// surface, a rate-limit / cost-cap banner, and stale/offline "last known" with the captured conflicts kept
// visible. The view performs NO HTTP — it binds [AICrossRuleConflictDetectionViewModel] (P1/S8) and renders.
//
// `withAiFeature` parity: the surface returns nothing when the per-feature AI-Off gate is closed (web's HOC
// renders `null`). `AIFeatureCard`/`withAiFeature` have no shared Android counterparts yet (they are the P3
// component-library bundle's scope), so the card scaffold + gate are reproduced inline here — a complete,
// working surface, not a stub — using the existing shared primitives (GlassPanel/Button/IconBox/Badge/feedback).
//
// `MatchingDeclarationName`/`InvalidPackageDeclaration`/`filename` are suppressed: the mandated surface
// directory (com/teslasync/shared-surfaces/AICrossRuleConflictDetection) cannot form a valid Kotlin package and
// the file hosts several co-located composables, exactly as the sibling surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "ktlint:standard:filename")

package io.teslasync.android.sharedsurfaces.aicrossruleconflictdetection

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
private const val ROW_BORDER_ALPHA = 0.3f
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
 * forwards a chosen conflict to the parent editor through [onSelectRule]. The host constructs the view-model via
 * [AICrossRuleConflictDetectionViewModel.factory]; this view never performs HTTP.
 */
@Composable
fun AICrossRuleConflictDetection(
    viewModel: AICrossRuleConflictDetectionViewModel,
    onSelectRule: (Long) -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val gated by viewModel.gated.collectAsStateWithLifecycle()
    if (!gated) return

    val snapshot by viewModel.snapshot.collectAsStateWithLifecycle()
    val resolve = rememberStringResolver()
    AICrossRuleConflictDetectionContent(
        snapshot = snapshot,
        resolve = resolve,
        onDetect = viewModel::detect,
        onRetry = viewModel::retry,
        onSelectRule = onSelectRule,
        modifier = modifier,
    )
}

/**
 * Stateless renderer of the surface — the unit/UI-test + @Preview entry point. Reproduces the web AIFeatureCard
 * layout (header → action button → captured conflict list → streamed output) and every render state from
 * [AiConflictsSnapshot]: loading skeleton chrome, a friendly empty/waiting state, a hard-error retry surface, a
 * rate-limit / cost-cap banner, and stale/offline last-known with the captured conflicts kept visible.
 */
@Composable
fun AICrossRuleConflictDetectionContent(
    snapshot: AiConflictsSnapshot,
    resolve: StringResolver,
    onDetect: () -> Unit,
    onRetry: () -> Unit,
    onSelectRule: (Long) -> Unit,
    modifier: Modifier = Modifier,
) {
    val labels = remember(resolve) { aiConflictsLabels(resolve) }
    val detectCd = remember(resolve) { detectButtonContentDescription(resolve) }
    FadeIn(modifier = modifier, delayMs = PANEL_FADE_DELAY_MS) {
        GlassPanel(padding = PanelPadding.Lg) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                Header(labels)
                DetectRow(
                    label = if (snapshot.isBusy) labels.thinking else labels.askHelix,
                    contentDescription = detectCd,
                    enabled = snapshot.canStart && !snapshot.isBusy,
                    busy = snapshot.isBusy,
                    onDetect = onDetect,
                )
                StateBody(labels = labels, snapshot = snapshot, onRetry = onRetry, onSelectRule = onSelectRule)
            }
        }
    }
}

// ── Header (web AIFeatureCard header + AIBadge) ──────────────────────────────────────────────────────────────

@Composable
private fun Header(labels: AiConflictsLabels) {
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
private fun DetectRow(
    label: String,
    contentDescription: String,
    enabled: Boolean,
    busy: Boolean,
    onDetect: () -> Unit,
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Button(
            label = label,
            onClick = onDetect,
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
    labels: AiConflictsLabels,
    snapshot: AiConflictsSnapshot,
    onRetry: () -> Unit,
    onSelectRule: (Long) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        when (snapshot.renderState) {
            AiConflictsRenderState.Loading -> ThinkingChrome(labels, snapshot.streamedText)
            AiConflictsRenderState.Stale -> {
                Badge(labels.stale, variant = BadgeVariant.Warning, dot = true)
                ConflictsList(snapshot.conflicts, labels, onSelectRule)
                ThinkingChrome(labels, snapshot.streamedText)
            }
            AiConflictsRenderState.Offline -> {
                OfflineBanner(message = labels.offline, onRetry = onRetry)
                ConflictsList(snapshot.conflicts, labels, onSelectRule)
            }
            AiConflictsRenderState.Error -> ErrorBody(labels, snapshot, onRetry)
            AiConflictsRenderState.Empty ->
                EmptyState(message = if (snapshot.hasResult) labels.emptyMessage else labels.waiting)
            AiConflictsRenderState.Content -> {
                if (snapshot.streamedText.isNotBlank()) ReplayText(snapshot.streamedText)
                ConflictsList(snapshot.conflicts, labels, onSelectRule)
            }
        }
    }
}

@Composable
private fun ErrorBody(
    labels: AiConflictsLabels,
    snapshot: AiConflictsSnapshot,
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

// ── Captured conflict list (web's conflicts `<ul>` with per-row chips + Review buttons) ──────────────────────

@Composable
private fun ConflictsList(
    conflicts: List<RuleConflict>,
    labels: AiConflictsLabels,
    onSelectRule: (Long) -> Unit,
) {
    if (conflicts.isEmpty()) return
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        conflicts.forEach { conflict ->
            ConflictRow(conflict = conflict, labels = labels, onSelectRule = onSelectRule)
        }
    }
}

@Composable
private fun ConflictRow(
    conflict: RuleConflict,
    labels: AiConflictsLabels,
    onSelectRule: (Long) -> Unit,
) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .border(
                    width = 1.dp,
                    color = TeslaTokens.status.warning.copy(alpha = ROW_BORDER_ALPHA),
                    shape = RoundedCornerShape(Radius.md),
                ).padding(Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                BodyText(labelForKind(conflict.kind, labels), color = TeslaTokens.status.warning)
                HelperText(conflictPairLine(conflict, labels.rulePrefix))
                conflict.reason?.let { HelperText(it) }
                ConflictChips(conflictChips(conflict, labels))
            }
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                ReviewButton(labels, conflict.ruleAId, onSelectRule)
                ReviewButton(labels, conflict.ruleBId, onSelectRule)
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ConflictChips(chips: List<ConflictChip>) {
    if (chips.isEmpty()) return
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        chips.forEach { chip -> Badge(chip.text, variant = badgeVariantFor(chip.tone)) }
    }
}

private fun badgeVariantFor(tone: ConflictChipTone): BadgeVariant =
    when (tone) {
        ConflictChipTone.Amber -> BadgeVariant.Warning
        ConflictChipTone.Rose -> BadgeVariant.Danger
    }

@Composable
private fun ReviewButton(
    labels: AiConflictsLabels,
    ruleId: Long,
    onSelectRule: (Long) -> Unit,
) {
    val label = reviewRuleLabel(labels, ruleId)
    Button(
        label = label,
        onClick = { onSelectRule(ruleId) },
        modifier = Modifier.semantics { contentDescription = label },
        variant = ButtonVariant.Outline,
        size = ButtonSize.Sm,
    )
}

/** The streaming "thinking" chrome — the descriptive replay text, or shimmering skeleton lines until it arrives. */
@Composable
private fun ThinkingChrome(
    labels: AiConflictsLabels,
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
    renderState: AiConflictsRenderState,
    conflicts: List<RuleConflict> = emptyList(),
    hasResult: Boolean = conflicts.isNotEmpty(),
    phase: AiStreamPhase = AiStreamPhase.Idle,
    streamedText: String = "",
    errorMessage: String? = null,
    limit: AiLimitInfo? = null,
): AiConflictsSnapshot =
    AiConflictsSnapshot(
        renderState = renderState,
        phase = phase,
        conflicts = conflicts,
        hasResult = hasResult,
        streamedText = streamedText,
        canStart = renderState != AiConflictsRenderState.Offline,
        isBusy = phase == AiStreamPhase.Streaming || phase == AiStreamPhase.PausedConfirm,
        errorMessage = errorMessage,
        limit = limit,
        offline = renderState == AiConflictsRenderState.Offline,
        stale = renderState == AiConflictsRenderState.Stale,
    )

private val SAMPLE_CONFLICTS =
    listOf(
        RuleConflict(
            kind = "redundant_duplicate",
            ruleAId = 12,
            ruleBId = 34,
            ruleAName = "Low battery",
            ruleBName = "Battery low",
            signalName = "soc",
            reason = "Both fire on soc < 20%.",
            subsumes = true,
        ),
        RuleConflict(
            kind = "overlapping_threshold",
            ruleAId = 7,
            ruleBId = 9,
            signalName = "tpms_fl",
            severityMismatch = true,
            cooldownMismatch = true,
        ),
    )

@Preview(name = "Content — conflicts found")
@Composable
private fun PreviewContent() {
    TeslaSyncTheme {
        AICrossRuleConflictDetectionContent(
            snapshot = previewSnapshot(AiConflictsRenderState.Content, conflicts = SAMPLE_CONFLICTS, phase = AiStreamPhase.Done),
            resolve = FallbackResolver,
            onDetect = {},
            onRetry = {},
            onSelectRule = {},
        )
    }
}

@Preview(name = "Loading — Helix thinking")
@Composable
private fun PreviewLoading() {
    TeslaSyncTheme {
        AICrossRuleConflictDetectionContent(
            snapshot = previewSnapshot(AiConflictsRenderState.Loading, phase = AiStreamPhase.Streaming),
            resolve = FallbackResolver,
            onDetect = {},
            onRetry = {},
            onSelectRule = {},
        )
    }
}

@Preview(name = "Empty — no conflicts")
@Composable
private fun PreviewEmpty() {
    TeslaSyncTheme {
        AICrossRuleConflictDetectionContent(
            snapshot = previewSnapshot(AiConflictsRenderState.Empty, hasResult = true),
            resolve = FallbackResolver,
            onDetect = {},
            onRetry = {},
            onSelectRule = {},
        )
    }
}

@Preview(name = "Error")
@Composable
private fun PreviewError() {
    TeslaSyncTheme {
        AICrossRuleConflictDetectionContent(
            snapshot =
                previewSnapshot(
                    AiConflictsRenderState.Error,
                    phase = AiStreamPhase.Error,
                    errorMessage = "stream_http_503",
                ),
            resolve = FallbackResolver,
            onDetect = {},
            onRetry = {},
            onSelectRule = {},
        )
    }
}

@Preview(name = "Stale — refreshing over last known")
@Composable
private fun PreviewStale() {
    TeslaSyncTheme {
        AICrossRuleConflictDetectionContent(
            snapshot =
                previewSnapshot(
                    AiConflictsRenderState.Stale,
                    conflicts = SAMPLE_CONFLICTS,
                    phase = AiStreamPhase.Streaming,
                ),
            resolve = FallbackResolver,
            onDetect = {},
            onRetry = {},
            onSelectRule = {},
        )
    }
}

@Preview(name = "Offline — last known")
@Composable
private fun PreviewOffline() {
    TeslaSyncTheme {
        AICrossRuleConflictDetectionContent(
            snapshot = previewSnapshot(AiConflictsRenderState.Offline, conflicts = SAMPLE_CONFLICTS),
            resolve = FallbackResolver,
            onDetect = {},
            onRetry = {},
            onSelectRule = {},
        )
    }
}
