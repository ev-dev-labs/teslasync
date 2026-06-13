// The native Jetpack Compose + Material 3 AINLDriveSearch shared surface — a parity port of
// web/src/components/ai/AINLDriveSearch.tsx and the `@/components/ai/AIFeatureCard` + `AiOutputPanel` scaffold it
// renders. The web surface is a "header + prompt textarea + Search button + streaming output" AI card: a Helix-
// branded title + badge + propose-only description, a free-text prompt (web `inputSlot` Textarea), an action
// button that opens an SSE stream to /ai/drives/search, and an output panel that shows an animated thinking
// indicator until the first delta, then the streamed narration of the matching drive (or an inline error). The
// whole card is wrapped by `withAiFeature('nl-drive-search-replay', …)`, which renders nothing when the AI
// feature is gated off.
//
// There is no native AIFeatureCard / withAiFeature atom (atomic AI components are the out-of-scope P3
// component-library bundle), so the card scaffold + gate are composed here from the shared atoms (GlassPanel,
// Button, Textarea, typography, EmptyState, ErrorText) — the same approach the sibling AICostForecastNarration /
// AIGeofenceAwareAutomationSuggestions take. All data flows through the shared [AINLDriveSearchViewModel]
// (P1/S8); the view performs NO HTTP. Every visible string resolves through the i18n facade (P1/S10) and the
// surfaces carry merged TalkBack descriptions.
//
// Parity-with-honesty (Honesty Covenant #9, documented not silent): the web gate renders `null` when AI is off —
// reproduced as the early return on [DriveSearchSurface.Hidden]. Every other state renders a non-blank surface
// (the resting card, the thinking indicator, the streamed prose, a friendly empty body, a stale/offline
// last-known body, or a QueryError-equivalent with retry), folding the useAiStream lifecycle onto the P3
// loading / empty / content / error / stale / offline contract (see AINLDriveSearchModel.kt).
//
// `MatchingDeclarationName`/`InvalidPackageDeclaration`/`filename` are suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/AINLDriveSearch) cannot form a valid Kotlin package and the file hosts several
// co-located composables, exactly as the sibling surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "ktlint:standard:filename")

package io.teslasync.android.sharedsurfaces.ainldrivesearch

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.SkeletonLines
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.rememberReducedMotion
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
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlin.math.PI
import kotlin.math.sin

private const val PANEL_FADE_DELAY_MS = 140
private const val BADGE_WASH_ALPHA = 0.12f
private const val OUTPUT_BG_ALPHA = 0.04f
private val OUTPUT_BORDER_WIDTH = 1.dp
private val HELIX_MARK_SIZE = 20.dp
private val BADGE_MARK_SIZE = 13.dp
private const val PROMPT_MIN_LINES = 3
private const val PROMPT_MAX_LINES = 5
private const val SKELETON_LINES = 3

// HelixMark geometry (normalized to the canvas' min dimension), mirroring web `HelixMark`.
private const val HELIX_TOP = 0.12f
private const val HELIX_BOTTOM = 0.88f
private const val HELIX_AMPLITUDE = 0.24f
private const val HELIX_STROKE = 0.085f
private const val HELIX_RUNG_STROKE = 0.06f
private const val HELIX_TURNS = 1.5f
private const val HELIX_SEGMENTS = 28
private const val HELIX_RUNGS = 3

/**
 * Stateful entry point — the faithful port of the web `AINLDriveSearch` surface. Binds the AI gate + search
 * stream via [source] into an [AINLDriveSearchViewModel], records the one-shot `view.opened` diagnostic, collects
 * the live state, and renders the card. The surface performs no HTTP; [logger] defaults to the process logger
 * and [instanceKey] scopes the ViewModel per placement.
 */
@Composable
fun AINLDriveSearch(
    source: AINLDriveSearchSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = AI_NL_DRIVE_SEARCH_SLUG,
) {
    val viewModel: AINLDriveSearchViewModel =
        viewModel(key = instanceKey, factory = AINLDriveSearchViewModel.factory(source, logger))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val resolve = rememberStringResolver()

    AINLDriveSearchContent(
        state = state,
        resolve = resolve,
        modifier = modifier,
        onPromptChange = viewModel::setPrompt,
        onSearch = viewModel::search,
        onRetry = viewModel::retry,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Classifies [state] into a
 * [DriveSearchSurface] and renders the AI card, or renders nothing when the AI feature is gated off (web
 * `withAiFeature` → `null`). The card chrome (title + Helix badge + description + prompt + action) is always
 * present when the gate is on; the output region switches per surface.
 *
 * @param nowMs wall-clock seam for the freshness check (web `Date.now()`); injectable for tests/previews.
 */
@Composable
fun AINLDriveSearchContent(
    state: DriveSearchState,
    resolve: StringResolver,
    modifier: Modifier = Modifier,
    onPromptChange: (String) -> Unit = {},
    onSearch: () -> Unit = {},
    onRetry: () -> Unit = {},
    nowMs: () -> Long = { System.currentTimeMillis() },
) {
    val surface = classifyDriveSearch(state, nowMs())
    if (surface is DriveSearchSurface.Hidden) return
    val labels = remember(resolve) { driveSearchLabels(resolve) }
    val searchCd = remember(resolve) { searchButtonContentDescription(resolve) }
    FadeIn(modifier = modifier, delayMs = PANEL_FADE_DELAY_MS) {
        GlassPanel(padding = PanelPadding.Lg) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                Header(labels)
                Textarea(
                    value = state.prompt,
                    onValueChange = onPromptChange,
                    hint = labels.promptHint,
                    minLines = PROMPT_MIN_LINES,
                    maxLines = PROMPT_MAX_LINES,
                )
                SearchRow(
                    label = if (state.isStreaming) labels.thinking else labels.askHelix,
                    contentDescription = searchCd,
                    enabled = state.canStart && !state.isStreaming,
                    busy = state.isStreaming,
                    onSearch = onSearch,
                )
                SearchOutput(surface = surface, labels = labels, canStart = state.canStart, onRetry = onRetry)
            }
        }
    }
}

// ── Header (web AIFeatureCard header + AIBadge) ──────────────────────────────────────────────────────────────

@Composable
private fun Header(labels: DriveSearchLabels) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .semantics(mergeDescendants = true) {
                    heading()
                    contentDescription = headerAccessibilityLabel(labels.title, labels.badge, labels.description)
                },
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
private fun SearchRow(
    label: String,
    contentDescription: String,
    enabled: Boolean,
    busy: Boolean,
    onSearch: () -> Unit,
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Button(
            label = label,
            onClick = onSearch,
            modifier = Modifier.semantics { this.contentDescription = contentDescription },
            variant = ButtonVariant.Outline,
            size = ButtonSize.Sm,
            enabled = enabled,
            loading = busy,
        )
    }
}

// ── Output region (every render state — never a blank box) ───────────────────────────────────────────────────

/**
 * The web AiOutputPanel: the bordered output region. Renders nothing while resting (the web panel is absent
 * until a stream runs) and otherwise a bordered panel carrying the per-state body + a polite live-region
 * announcement so TalkBack reads streamed/failed output as it changes.
 */
@Composable
private fun SearchOutput(
    surface: DriveSearchSurface,
    labels: DriveSearchLabels,
    canStart: Boolean,
    onRetry: () -> Unit,
) {
    if (surface is DriveSearchSurface.Resting || surface is DriveSearchSurface.Hidden) return
    val outputLabels =
        DriveSearchOutputLabels(
            working = labels.thinking,
            empty = labels.noMatch,
            stale = labels.stale,
            offline = labels.offline,
            error = labels.errorTitle,
        )
    OutputPanel(accessibilityLabel = searchOutputAccessibilityLabel(surface, outputLabels)) {
        when (surface) {
            DriveSearchSurface.Working -> ThinkingIndicator(labels.thinking)
            is DriveSearchSurface.Live -> ResultProse(surface.text)
            is DriveSearchSurface.Ready -> ReadyBody(labels = labels, text = surface.text, stale = surface.stale)
            DriveSearchSurface.Empty -> EmptyState(message = labels.noMatch)
            is DriveSearchSurface.Cached ->
                CachedBody(
                    labels = labels,
                    text = surface.text,
                    offline = surface.offline,
                    canStart = canStart,
                    onRetry = onRetry,
                )

            is DriveSearchSurface.Failed ->
                FailedBody(labels = labels, offline = surface.offline, canStart = canStart, onRetry = onRetry)
            DriveSearchSurface.Hidden, is DriveSearchSurface.Resting -> Unit
        }
    }
}

/** The bordered output container — the web `rounded-lg border bg-white/[0.02] p-4` panel. */
@Composable
private fun OutputPanel(
    accessibilityLabel: String?,
    content: @Composable () -> Unit,
) {
    val described =
        if (accessibilityLabel != null) {
            Modifier.semantics {
                liveRegion = LiveRegionMode.Polite
                contentDescription = accessibilityLabel
            }
        } else {
            Modifier
        }
    Surface(
        modifier = Modifier.fillMaxWidth().then(described),
        shape = RoundedCornerShape(Radius.md),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = OUTPUT_BG_ALPHA),
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(OUTPUT_BORDER_WIDTH, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(modifier = Modifier.fillMaxWidth().padding(Spacing.md)) { content() }
    }
}

/**
 * The web AIThinkingIndicator: the localized "Helix is thinking…" label, with shimmering skeleton lines beneath
 * it while the first delta is awaited. The shimmer is suppressed under reduced motion (the label alone conveys
 * the state); the label is always present for TalkBack.
 */
@Composable
private fun ThinkingIndicator(thinking: String) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Caption(thinking)
        if (!rememberReducedMotion()) {
            SkeletonLines(lines = SKELETON_LINES)
        }
    }
}

/** The streamed/completed narration prose — the web `whitespace-pre-wrap` text; Compose preserves line breaks. */
@Composable
private fun ResultProse(text: String) {
    BodyText(text, modifier = Modifier.fillMaxWidth())
}

/** The completed result, preceded by a stale chip when the result is older than the freshness window. */
@Composable
private fun ReadyBody(
    labels: DriveSearchLabels,
    text: String,
    stale: Boolean,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        if (stale) {
            Badge(labels.stale, variant = BadgeVariant.Warning, dot = true)
        }
        ResultProse(text)
    }
}

/** A failed re-search that keeps the last-known result visible with an offline/stale chip + retry. */
@Composable
private fun CachedBody(
    labels: DriveSearchLabels,
    text: String,
    offline: Boolean,
    canStart: Boolean,
    onRetry: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Badge(if (offline) labels.offline else labels.stale, variant = BadgeVariant.Warning, dot = true)
        ResultProse(text)
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            RetryButton(label = labels.retry, enabled = canStart, onRetry = onRetry)
        }
    }
}

/** The web error branch with no last-known output — a danger Helix mark, a localized title, and retry. */
@Composable
private fun FailedBody(
    labels: DriveSearchLabels,
    offline: Boolean,
    canStart: Boolean,
    onRetry: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.Top,
    ) {
        HelixMark(tint = TeslaTokens.status.danger, modifier = Modifier.size(HELIX_MARK_SIZE))
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            if (offline) {
                Badge(labels.offline, variant = BadgeVariant.Warning, dot = true)
            }
            ErrorText(labels.errorTitle)
            RetryButton(label = labels.retry, enabled = canStart, onRetry = onRetry)
        }
    }
}

/** The shared retry affordance backing the error/offline surfaces. */
@Composable
private fun RetryButton(
    label: String,
    enabled: Boolean,
    onRetry: () -> Unit,
) {
    Button(
        label = label,
        onClick = onRetry,
        variant = ButtonVariant.Ghost,
        size = ButtonSize.Sm,
        enabled = enabled,
    )
}

/**
 * The Helix brand mark — two interleaving strands joined by rungs, drawn natively with [Canvas] (no SVG) so it
 * recolors with the active theme / icon-box tone. Mirrors web `HelixMark`.
 */
@Composable
private fun HelixMark(
    tint: Color,
    modifier: Modifier = Modifier,
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
private fun previewState(
    phase: DriveSearchPhase,
    prompt: String = "last Friday's trip to the coast",
    streamingText: String = "",
    committedText: String = "",
    errorKind: ErrorKind? = null,
    fetchedAt: Long? = null,
): DriveSearchState =
    DriveSearchState(
        gateEnabled = true,
        prompt = prompt,
        phase = phase,
        streamingText = streamingText,
        committedText = committedText,
        errorKind = errorKind,
        fetchedAt = fetchedAt,
    )

private const val SAMPLE_RESULT =
    "Found it — your drive last Friday afternoon from Home to Pacifica State Beach: 38.2 km in 47 minutes, " +
        "ending with 61% charge. Tap replay to scrub the route."

@Preview(name = "Resting — invite a search")
@Composable
private fun PreviewResting() {
    TeslaSyncTheme {
        AINLDriveSearchContent(
            state = previewState(DriveSearchPhase.Idle, prompt = ""),
            resolve = FallbackResolver,
        )
    }
}

@Preview(name = "Loading — Helix thinking")
@Composable
private fun PreviewLoading() {
    TeslaSyncTheme {
        AINLDriveSearchContent(
            state = previewState(DriveSearchPhase.Streaming),
            resolve = FallbackResolver,
        )
    }
}

@Preview(name = "Content — narrated result")
@Composable
private fun PreviewContent() {
    TeslaSyncTheme {
        AINLDriveSearchContent(
            state = previewState(DriveSearchPhase.Done, committedText = SAMPLE_RESULT, fetchedAt = 0L),
            resolve = FallbackResolver,
            nowMs = { 0L },
        )
    }
}

@Preview(name = "Empty — no matching drive")
@Composable
private fun PreviewEmpty() {
    TeslaSyncTheme {
        AINLDriveSearchContent(
            state = previewState(DriveSearchPhase.Done, committedText = ""),
            resolve = FallbackResolver,
        )
    }
}

@Preview(name = "Error")
@Composable
private fun PreviewError() {
    TeslaSyncTheme {
        AINLDriveSearchContent(
            state = previewState(DriveSearchPhase.Failed, errorKind = ErrorKind.Http),
            resolve = FallbackResolver,
        )
    }
}

@Preview(name = "Offline — last known")
@Composable
private fun PreviewOffline() {
    TeslaSyncTheme {
        AINLDriveSearchContent(
            state =
                previewState(
                    DriveSearchPhase.Failed,
                    committedText = SAMPLE_RESULT,
                    errorKind = ErrorKind.Network,
                    fetchedAt = 0L,
                ),
            resolve = FallbackResolver,
        )
    }
}
