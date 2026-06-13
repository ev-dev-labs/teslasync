// The native Jetpack Compose + Material 3 AINLSqlPlayground shared surface — a parity port of
// web/src/components/ai/AINLSqlPlayground.tsx and the `@/components/ai/AIFeatureCard` + `AiOutputPanel` scaffold
// it renders. The web surface is a "header + free-text prompt + Draft button + streamed output" AI card: a Helix-
// branded title + badge + description, a Textarea for the natural-language question, an action button that opens
// an SSE stream to /ai/power/sql/draft, an output panel that shows an animated thinking indicator until the
// first delta then the streamed SQL (or an inline error), and — when the LLM emits a `draft_readonly_sql`
// tool_result — an "Apply to editor" button that hands the typed draft back to the parent editor. The whole card
// is wrapped by `withAiFeature('nl-sql-playground', ...)`, which renders nothing when the AI feature is gated off.
//
// There is no native AIFeatureCard / withAiFeature atom in scope (atomic AI components are the out-of-scope P3
// component-library bundle), so the card scaffold + gate are composed here from the shared atoms (GlassPanel,
// Button, Textarea, typography, EmptyState, ErrorText) — the same approach the sibling AIDigestNarration /
// AICrossRuleConflictDetection surfaces take. All data flows through the shared [AINLSqlPlaygroundViewModel]
// (P1/S8); the view performs NO HTTP and never writes editor state (ADR-015 I8 propose-only — the captured draft
// is relayed to the parent via [onApply], which copies it into the deterministic editor). Every visible string
// resolves through the i18n facade (P1/S10) and the surfaces carry merged TalkBack descriptions.
//
// Parity-with-honesty (Honesty Covenant #9, documented not silent): the web gate renders `null` when AI is off —
// reproduced as the early return on [SqlDraftSurface.Hidden]. Every other state renders a non-blank surface (the
// resting card, the thinking indicator, the streamed SQL, a friendly empty body, a stale/offline last-known body,
// or a QueryError-equivalent with retry), folding the useAiStream lifecycle onto the P3 loading / empty / content
// / error / stale / offline contract (see AINLSqlPlaygroundModel.kt).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ainlsqlplayground

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.SkeletonLines
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Textarea
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Web `border` on the output panel — a 1px hairline. */
private val OUTPUT_BORDER_WIDTH: Dp = 1.dp

/** Web `bg-white/[0.02]` faint output-panel fill, applied to the neutral surface tint. */
private const val OUTPUT_BG_ALPHA: Float = 0.04f

/** The Helix badge pill's low-alpha accent wash (mirrors the shared Badge wash). */
private const val BADGE_WASH_ALPHA: Float = 0.16f

/** The web HelixMark default stroke width (`strokeWidth={1.75}`), thickened slightly for the stroked glyph. */
private const val HELIX_STROKE: Float = 2f

/** Approximation of the web Textarea `rows={2}` height bounds. */
private const val PROMPT_MIN_LINES: Int = 2
private const val PROMPT_MAX_LINES: Int = 4

// ── Stateful entry point (binds the ViewModel — P1/S8) ────────────────────────────────────────────────────────

/**
 * Stateful entry point — the faithful port of the web `AINLSqlPlayground` surface. Binds the AI gate + draft
 * stream via [source] into an [AINLSqlPlaygroundViewModel], records the one-shot `view.opened` diagnostic,
 * collects the live state, and renders the card. The surface performs no HTTP; [logger] defaults to the process
 * logger and [instanceKey] scopes the ViewModel per placement.
 *
 * @param onApply invoked with the captured [SqlDraft] when the user taps "Apply to editor"; the host wires this
 *   to its existing editor `setSql` setter (web `onApply`). The surface itself never writes editor state.
 */
@Composable
fun AINLSqlPlayground(
    source: AINLSqlPlaygroundSource,
    onApply: (SqlDraft) -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = AI_NL_SQL_PLAYGROUND_SLUG,
) {
    val viewModel: AINLSqlPlaygroundViewModel =
        viewModel(key = instanceKey, factory = AINLSqlPlaygroundViewModel.factory(source, logger))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    AINLSqlPlaygroundContent(
        state = state,
        modifier = modifier,
        onPromptChange = viewModel::setPrompt,
        onDraft = viewModel::draft,
        onRetry = viewModel::retry,
        onApply = onApply,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Classifies [state] into a
 * [SqlDraftSurface] and renders the AI card, or renders nothing when the AI feature is gated off (web
 * `withAiFeature` -> `null`). The card chrome (title + Helix badge + description + prompt + Draft action) is
 * always present when the gate is on; the output region + Apply affordance switch per state.
 *
 * @param nowMs wall-clock seam for the freshness check (web `Date.now()`); injectable for tests/previews.
 * @param resolve the i18n facade; defaults to the catalog-backed resolver, overridable to [FallbackResolver].
 */
@Composable
fun AINLSqlPlaygroundContent(
    state: AiSqlDraftState,
    modifier: Modifier = Modifier,
    onPromptChange: (String) -> Unit = {},
    onDraft: () -> Unit = {},
    onRetry: () -> Unit = {},
    onApply: (SqlDraft) -> Unit = {},
    nowMs: () -> Long = { System.currentTimeMillis() },
    resolve: StringResolver = rememberStringResolver(),
) {
    val surface = classifyDraft(state, nowMs())
    if (surface is SqlDraftSurface.Hidden) return
    val labels = remember(resolve) { aiNlSqlLabels(resolve) }
    SqlDraftCard(
        surface = surface,
        labels = labels,
        prompt = state.prompt,
        canStart = state.canStart,
        streaming = state.isStreaming,
        draft = state.draft,
        canApply = state.canApply,
        onPromptChange = onPromptChange,
        onDraft = onDraft,
        onRetry = onRetry,
        onApply = onApply,
        modifier = modifier,
    )
}

/** The web AIFeatureCard scaffold: a GlassPanel with the header, the prompt, the Draft action, the Apply row, and the output region. */
@Composable
@Suppress("LongParameterList")
private fun SqlDraftCard(
    surface: SqlDraftSurface,
    labels: AiNlSqlLabels,
    prompt: String,
    canStart: Boolean,
    streaming: Boolean,
    draft: SqlDraft?,
    canApply: Boolean,
    onPromptChange: (String) -> Unit,
    onDraft: () -> Unit,
    onRetry: () -> Unit,
    onApply: (SqlDraft) -> Unit,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            DraftHeader(labels)
            PromptInput(prompt = prompt, labels = labels, onPromptChange = onPromptChange)
            DraftActionRow(labels = labels, canStart = canStart, streaming = streaming, onDraft = onDraft)
            if (draft != null) {
                ApplyRow(draft = draft, canApply = canApply, labels = labels, onApply = onApply)
            }
            DraftOutput(surface = surface, labels = labels, onRetry = onRetry)
        }
    }
}

/** The web card header: the title + the Helix badge on one row, then the description, merged for TalkBack. */
@Composable
private fun DraftHeader(labels: AiNlSqlLabels) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .semantics(mergeDescendants = true) {
                    contentDescription = headerAccessibilityLabel(labels.title, labels.badge, labels.description)
                },
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            PanelTitle(labels.title, modifier = Modifier.weight(1f, fill = false))
            HelixBadge(labels.badge, labels.badgeAria)
        }
        BodyText(labels.description, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** The web `AIBadge` cyan "Helix" pill: a Helix glyph + label on an info-tinted wash, merged for TalkBack. */
@Composable
private fun HelixBadge(
    label: String,
    contentDescription: String,
) {
    val accent = TeslaTokens.status.info
    Surface(
        modifier = Modifier.semantics(mergeDescendants = true) { this.contentDescription = contentDescription },
        shape = RoundedCornerShape(Radius.pill),
        color = accent.copy(alpha = BADGE_WASH_ALPHA),
        contentColor = accent,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(AiNlSqlGlyphs.Helix, contentDescription = null, size = IconSize.Xs, tint = accent)
            Text(label, style = MaterialTheme.typography.labelSmall)
        }
    }
}

/**
 * The free-text question field (web `<Textarea ... />`). The native [Textarea] exposes `label` + supporting
 * `hint` rather than an in-field example slot: the web `aria-label` ("SQL request") maps to the floating [label]
 * (the field's accessible name), and the web in-field example prompt maps to the supporting [hint] beneath it. The
 * field stays editable while a stream runs so the user can refine the question for a re-draft.
 */
@Composable
private fun PromptInput(
    prompt: String,
    labels: AiNlSqlLabels,
    onPromptChange: (String) -> Unit,
) {
    Textarea(
        value = prompt,
        onValueChange = onPromptChange,
        label = labels.promptLabel,
        hint = labels.promptHint,
        minLines = PROMPT_MIN_LINES,
        maxLines = PROMPT_MAX_LINES,
    )
}

/**
 * The right-aligned Draft action — the web AIFeatureCard "Draft SQL" button. Disabled without a non-empty prompt
 * (web `canStart`) or while a stream is open; the in-flight spinner is the native counterpart of the web "Helix
 * is thinking…" busy label. The button's accessible name is the contextual "Ask Helix · Draft SQL" verb.
 */
@Composable
private fun DraftActionRow(
    labels: AiNlSqlLabels,
    canStart: Boolean,
    streaming: Boolean,
    onDraft: () -> Unit,
) {
    val description = draftButtonContentDescription(labels.askHelix, labels.button)
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Button(
            label = labels.button,
            onClick = onDraft,
            modifier = Modifier.semantics { contentDescription = description },
            variant = ButtonVariant.Outline,
            size = ButtonSize.Sm,
            enabled = canStart && !streaming,
            loading = streaming,
            leadingIcon = AiNlSqlGlyphs.Helix,
        )
    }
}

/**
 * The web propose-only "Apply to editor" affordance, shown once a `draft_readonly_sql` draft is captured. It
 * relays the typed [draft] to the parent through [onApply] (web `handleApply` -> `onApply(draft)`); it is
 * disabled while a re-draft streams (web `canApply = !!draft && !isStreaming`). The button never executes SQL —
 * it only copies the proposal into the deterministic editor, where the user reviews and runs it. The web `title`
 * tooltip is folded into the accessible name so its guidance survives on touch (no hover).
 */
@Composable
private fun ApplyRow(
    draft: SqlDraft,
    canApply: Boolean,
    labels: AiNlSqlLabels,
    onApply: (SqlDraft) -> Unit,
) {
    val description = "${labels.applyButton}. ${labels.applyTooltip}"
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Button(
            label = labels.applyButton,
            onClick = { onApply(draft) },
            modifier = Modifier.semantics { contentDescription = description },
            variant = ButtonVariant.Primary,
            size = ButtonSize.Sm,
            enabled = canApply,
        )
    }
}

/**
 * The web AiOutputPanel: the bordered output region. Renders nothing while resting (the web panel is absent until
 * a stream runs) and otherwise a bordered panel carrying the per-state body + a polite live-region announcement
 * so TalkBack reads streamed/failed output as it changes.
 */
@Composable
private fun DraftOutput(
    surface: SqlDraftSurface,
    labels: AiNlSqlLabels,
    onRetry: () -> Unit,
) {
    if (surface is SqlDraftSurface.Resting || surface is SqlDraftSurface.Hidden) return
    val outputLabels =
        SqlDraftOutputLabels(
            working = labels.thinking,
            empty = labels.empty,
            stale = labels.stale,
            offline = labels.offline,
            error = labels.error,
        )
    OutputPanel(accessibilityLabel = outputAccessibilityLabel(surface, outputLabels)) {
        when (surface) {
            SqlDraftSurface.Working -> ThinkingIndicator(labels.thinking)
            is SqlDraftSurface.Live -> DraftProse(surface.text)
            is SqlDraftSurface.Ready -> ReadyBody(text = surface.text, stale = surface.stale, labels = labels)
            SqlDraftSurface.Empty -> EmptyBody(labels.empty)
            is SqlDraftSurface.Cached ->
                CachedBody(text = surface.text, offline = surface.offline, labels = labels, onRetry = onRetry)

            is SqlDraftSurface.Failed -> FailedBody(offline = surface.offline, labels = labels, onRetry = onRetry)
            SqlDraftSurface.Hidden, is SqlDraftSurface.Resting -> Unit
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
 * The web AIThinkingIndicator: a Helix glyph + the localized "Helix is thinking…" label, with shimmering skeleton
 * lines beneath it while the first delta is awaited. The shimmer is suppressed under reduced motion (the label
 * alone conveys the state); the label is always present for TalkBack.
 */
@Composable
private fun ThinkingIndicator(thinking: String) {
    val accent = TeslaTokens.status.info
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Icon(AiNlSqlGlyphs.Helix, contentDescription = null, size = IconSize.Md, tint = accent)
            Caption(thinking)
        }
        if (!rememberReducedMotion()) {
            SkeletonLines(lines = 3)
        }
    }
}

/** The streamed SQL draft — the web `whitespace-pre-wrap` text; Compose preserves line breaks. */
@Composable
private fun DraftProse(text: String) {
    BodyText(text, modifier = Modifier.fillMaxWidth())
}

/** The completed draft replay, preceded by a stale chip when the fetch is older than the freshness window. */
@Composable
private fun ReadyBody(
    text: String,
    stale: Boolean,
    labels: AiNlSqlLabels,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        if (stale) {
            FreshnessChip(offline = false, labels = labels)
        }
        DraftProse(text)
    }
}

/** The friendly empty body shown when a draft completed with no text (never a blank box). */
@Composable
private fun EmptyBody(message: String) {
    EmptyState(message = message)
}

/** A failed re-draft that keeps the last-known draft replay visible with an offline/stale chip + retry. */
@Composable
private fun CachedBody(
    text: String,
    offline: Boolean,
    labels: AiNlSqlLabels,
    onRetry: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        FreshnessChip(offline = offline, labels = labels)
        DraftProse(text)
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            RetryButton(labels.retry, onRetry)
        }
    }
}

/** The web error branch with no last-known output — a danger Helix glyph, a localized title, and retry. */
@Composable
private fun FailedBody(
    offline: Boolean,
    labels: AiNlSqlLabels,
    onRetry: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(
            AiNlSqlGlyphs.Helix,
            contentDescription = null,
            size = IconSize.Md,
            tint = TeslaTokens.status.danger,
        )
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            if (offline) {
                FreshnessChip(offline = true, labels = labels)
            }
            ErrorText(labels.error)
            RetryButton(labels.retry, onRetry)
        }
    }
}

/** The stale/offline freshness chip — the web "last known / offline" affordance. */
@Composable
private fun FreshnessChip(
    offline: Boolean,
    labels: AiNlSqlLabels,
) {
    val label = if (offline) labels.offline else labels.stale
    val accent = if (offline) TeslaTokens.status.danger else TeslaTokens.status.warning
    Surface(
        shape = RoundedCornerShape(Radius.pill),
        color = accent.copy(alpha = BADGE_WASH_ALPHA),
        contentColor = accent,
    ) {
        Text(
            label,
            modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            style = MaterialTheme.typography.labelSmall,
        )
    }
}

/** The shared retry affordance backing the error/offline surfaces. */
@Composable
private fun RetryButton(
    label: String,
    onRetry: () -> Unit,
) {
    Button(
        label = label,
        onClick = onRetry,
        variant = ButtonVariant.Ghost,
        size = ButtonSize.Sm,
        leadingIcon = FeedbackGlyphs.Refresh,
    )
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

// ── Helix glyph (web `HelixMark`, authored locally; absent from the shared TeslaGlyphs catalog) ──────────────

/**
 * The locally authored Helix mark — a four-point sparkle, the AI/Helix brand glyph the web renders as
 * `HelixMark`. It is absent from the shared [io.teslasync.android.components.ui.TeslaGlyphs] catalog and outside
 * this surface's allowed-files scope, so it is drawn here as a 24×24 stroked [ImageVector] recolored at render
 * time by the [Icon] tint — exactly as the sibling AIDigestNarration authors its Helix mark.
 */
private object AiNlSqlGlyphs {
    val Helix: ImageVector =
        stroked("AINlSqlHelix") {
            // Four-point concave star centered at (12, 12).
            moveTo(12f, 3f)
            lineTo(13.6f, 10.4f)
            lineTo(21f, 12f)
            lineTo(13.6f, 13.6f)
            lineTo(12f, 21f)
            lineTo(10.4f, 13.6f)
            lineTo(3f, 12f)
            lineTo(10.4f, 10.4f)
            close()
            // Small accent sparkle (cross) at the upper-right.
            moveTo(19f, 3f)
            lineTo(19f, 7f)
            moveTo(21f, 5f)
            lineTo(17f, 5f)
        }

    private fun stroked(
        name: String,
        build: PathBuilder.() -> Unit,
    ): ImageVector =
        ImageVector
            .Builder(
                name = name,
                defaultWidth = 24.dp,
                defaultHeight = 24.dp,
                viewportWidth = 24f,
                viewportHeight = 24f,
            ).apply {
                path(
                    stroke = SolidColor(Color.Black),
                    strokeLineWidth = HELIX_STROKE,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                    pathBuilder = build,
                )
            }.build()
}

// ── Previews (FallbackResolver -> web English; tooling-only) ──────────────────────────────────────────────────

private const val PREVIEW_NOW_MS = 10_000_000L
private const val PREVIEW_STALE_FETCHED_AT = 1_000L
private const val PREVIEW_FRESH_FETCHED_AT = PREVIEW_NOW_MS - 1_000L
private const val PREVIEW_SQL =
    "SELECT date_trunc('week', started_at) AS week, count(*) AS drives\nFROM drives\nWHERE started_at >= now() " +
        "- interval '7 days'\nGROUP BY 1\nORDER BY 1;"
private val PREVIEW_DRAFT =
    SqlDraft(
        prompt = "how many drives last week",
        sql = PREVIEW_SQL,
        rationale = "Counts rows in drives within the last seven days, bucketed by ISO week.",
        referencedTables = listOf("drives"),
    )

@Composable
private fun PreviewCard(
    state: AiSqlDraftState,
    nowMs: Long = PREVIEW_NOW_MS,
) {
    TeslaSyncTheme(dynamicColor = false) {
        AINLSqlPlaygroundContent(state = state, nowMs = { nowMs }, resolve = FallbackResolver)
    }
}

@Preview(name = "Resting — empty prompt", showBackground = true)
@Composable
private fun AINLSqlPlaygroundRestingPreview() {
    PreviewCard(AiSqlDraftState())
}

@Preview(name = "Resting — ready to draft", showBackground = true)
@Composable
private fun AINLSqlPlaygroundReadyToDraftPreview() {
    PreviewCard(AiSqlDraftState(prompt = "how many drives last week"))
}

@Preview(name = "Working — thinking", showBackground = true)
@Composable
private fun AINLSqlPlaygroundWorkingPreview() {
    PreviewCard(AiSqlDraftState(prompt = "how many drives last week", phase = DraftPhase.Streaming))
}

@Preview(name = "Streaming — live SQL", showBackground = true)
@Composable
private fun AINLSqlPlaygroundLivePreview() {
    PreviewCard(
        AiSqlDraftState(prompt = "how many drives last week", phase = DraftPhase.Streaming, streamingText = PREVIEW_SQL),
    )
}

@Preview(name = "Ready — fresh + Apply", showBackground = true)
@Composable
private fun AINLSqlPlaygroundReadyPreview() {
    PreviewCard(
        AiSqlDraftState(
            prompt = "how many drives last week",
            phase = DraftPhase.Done,
            streamingText = PREVIEW_SQL,
            committedText = PREVIEW_SQL,
            draft = PREVIEW_DRAFT,
            fetchedAt = PREVIEW_FRESH_FETCHED_AT,
        ),
    )
}

@Preview(name = "Ready — stale", showBackground = true)
@Composable
private fun AINLSqlPlaygroundStalePreview() {
    PreviewCard(
        AiSqlDraftState(
            prompt = "how many drives last week",
            phase = DraftPhase.Done,
            committedText = PREVIEW_SQL,
            draft = PREVIEW_DRAFT,
            fetchedAt = PREVIEW_STALE_FETCHED_AT,
        ),
    )
}

@Preview(name = "Empty — no text", showBackground = true)
@Composable
private fun AINLSqlPlaygroundEmptyPreview() {
    PreviewCard(
        AiSqlDraftState(prompt = "how many drives last week", phase = DraftPhase.Done, committedText = ""),
    )
}

@Preview(name = "Offline — cached", showBackground = true)
@Composable
private fun AINLSqlPlaygroundOfflinePreview() {
    PreviewCard(
        AiSqlDraftState(
            prompt = "how many drives last week",
            phase = DraftPhase.Failed,
            committedText = PREVIEW_SQL,
            draft = PREVIEW_DRAFT,
            errorKind = ErrorKind.Network,
        ),
    )
}

@Preview(name = "Error — hard failure", showBackground = true)
@Composable
private fun AINLSqlPlaygroundErrorPreview() {
    PreviewCard(
        AiSqlDraftState(
            prompt = "how many drives last week",
            phase = DraftPhase.Failed,
            errorKind = ErrorKind.Http,
        ),
    )
}
