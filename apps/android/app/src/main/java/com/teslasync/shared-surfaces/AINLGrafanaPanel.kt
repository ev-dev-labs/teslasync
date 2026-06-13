// The native Jetpack Compose + Material 3 AINLGrafanaPanel shared surface — a parity port of
// web/src/components/ai/AINLGrafanaPanel.tsx and the `@/components/ai/AIFeatureCard` + `AiOutputPanel` scaffold
// it renders. The web surface is a "header + natural-language prompt + Draft button + streaming output + Apply"
// AI card: a Helix-branded title + badge + description, a Textarea where the operator describes the panel they
// want, an action button that opens an SSE stream to /ai/power/grafana-panel/draft, an output panel that shows
// an animated thinking indicator until the first delta then the streamed prose, and — once the LLM calls
// `draft_grafana_panel` — a typed draft summary with an "Apply to editor" button that hands the draft to the
// host via `onApply` (the LLM never mutates editor state). The whole card is wrapped by
// `withAiFeature('nl-grafana-panel', …)`, which renders nothing when the AI feature is gated off.
//
// There is no native AIFeatureCard / withAiFeature atom (atomic AI components are the out-of-scope P3
// component-library bundle), so the card scaffold + gate are composed here from the shared atoms (GlassPanel,
// Button, Textarea, typography, EmptyState, ErrorText) — the same approach the sibling AIChargingDiagnosis
// takes. All data flows through the shared [AINLGrafanaPanelViewModel] (P1/S8); the view performs NO HTTP.
// Every visible string resolves through the i18n catalog (P1/S10) and the surfaces carry merged TalkBack
// descriptions.
//
// Parity-with-honesty (Honesty Covenant #9, documented not silent): the web gate renders `null` when AI is off
// — reproduced as the early return on [DraftSurface.Hidden]. Every other state renders a non-blank surface (the
// resting form, the thinking indicator, the streamed prose, a typed draft summary with Apply, a friendly empty
// body, a stale/offline last-known body, or a QueryError-equivalent with retry), folding the useAiStream
// lifecycle onto the P3 loading / empty / content / error / stale / offline contract (see AINLGrafanaPanelModel).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ainlgrafanapanel

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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
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

/** The Helix badge / meta chip low-alpha accent wash (mirrors the shared Badge wash). */
private const val BADGE_WASH_ALPHA: Float = 0.16f

/** The in-field prompt request is short; cap the Textarea so a long request scrolls rather than growing forever. */
private const val PROMPT_MIN_LINES: Int = 2
private const val PROMPT_MAX_LINES: Int = 4

/**
 * Stateful entry point — the faithful port of the web `AINLGrafanaPanel` surface. Binds the AI gate + draft
 * stream via [source] into an [AINLGrafanaPanelViewModel], records the one-shot `view.opened` diagnostic,
 * collects the live state, and renders the card. The surface performs no HTTP; [logger] defaults to the process
 * logger and [instanceKey] scopes the ViewModel per placement.
 *
 * @param onApply invoked with the captured draft when the user clicks "Apply to editor" (web `onApply`). The
 *   host wires this to its Grafana editor setter; this surface never writes editor state itself.
 */
@Composable
fun AINLGrafanaPanel(
    source: AINLGrafanaPanelSource,
    onApply: (GrafanaPanelDraft) -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = AI_NL_GRAFANA_PANEL_SLUG,
) {
    val viewModel: AINLGrafanaPanelViewModel =
        viewModel(key = instanceKey, factory = AINLGrafanaPanelViewModel.factory(source, logger))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    AINLGrafanaPanelContent(
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
 * [DraftSurface] and renders the AI card, or renders nothing when the AI feature is gated off (web
 * `withAiFeature` → `null`). The card chrome (title + Helix badge + description + prompt + Draft action) is
 * always present when the gate is on; the output region switches per surface.
 *
 * @param nowMs wall-clock seam for the freshness check (web `Date.now()`); injectable for tests/previews.
 */
@Composable
fun AINLGrafanaPanelContent(
    state: GrafanaDraftState,
    modifier: Modifier = Modifier,
    onPromptChange: (String) -> Unit = {},
    onDraft: () -> Unit = {},
    onRetry: () -> Unit = {},
    onApply: (GrafanaPanelDraft) -> Unit = {},
    nowMs: () -> Long = { System.currentTimeMillis() },
) {
    val surface = classifyGrafanaDraft(state, nowMs())
    if (surface is DraftSurface.Hidden) return
    DraftCard(
        surface = surface,
        prompt = state.prompt,
        canDraft = state.canDraft,
        canApply = state.canApply,
        streaming = state.isStreaming,
        onPromptChange = onPromptChange,
        onDraft = onDraft,
        onRetry = onRetry,
        onApply = onApply,
        modifier = modifier,
    )
}

/** The web AIFeatureCard scaffold: a GlassPanel with the header, the prompt field, the action row, and output. */
@Composable
private fun DraftCard(
    surface: DraftSurface,
    prompt: String,
    canDraft: Boolean,
    canApply: Boolean,
    streaming: Boolean,
    onPromptChange: (String) -> Unit,
    onDraft: () -> Unit,
    onRetry: () -> Unit,
    onApply: (GrafanaPanelDraft) -> Unit,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            DraftHeader()
            PromptField(prompt = prompt, enabled = !streaming, onPromptChange = onPromptChange)
            DraftActionRow(canDraft = canDraft, streaming = streaming, onDraft = onDraft)
            DraftOutput(surface = surface, canApply = canApply, onRetry = onRetry, onApply = onApply)
        }
    }
}

/** The web card header: the title + the Helix badge on one row, then the description, merged for TalkBack. */
@Composable
private fun DraftHeader() {
    val title = stringResource(R.string.translation_powerGrafana_aiDrafter_title)
    val badge = stringResource(R.string.translation_powerGrafana_aiDrafter_badge)
    val description = stringResource(R.string.translation_powerGrafana_aiDrafter_description)
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .semantics(mergeDescendants = true) {
                    contentDescription = headerAccessibilityLabel(title, badge, description)
                },
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            PanelTitle(title)
            HelixBadge(badge)
        }
        BodyText(description, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** The web `AIBadge` cyan "Helix" pill: a Helix glyph + label on an info-tinted wash. */
@Composable
private fun HelixBadge(label: String) {
    val accent = TeslaTokens.status.info
    Surface(
        shape = RoundedCornerShape(Radius.pill),
        color = accent.copy(alpha = BADGE_WASH_ALPHA),
        contentColor = accent,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(GrafanaDraftGlyphs.Helix, contentDescription = null, size = IconSize.Xs, tint = accent)
            Text(label, style = MaterialTheme.typography.labelSmall)
        }
    }
}

/**
 * The web `Textarea` prompt field: the operator describes the panel they want. The localized prompt label is
 * the field's accessible name (web `aria-label`); the example request renders as the supporting hint (web
 * in-field example). Disabled while a stream is open so the request can't change mid-draft.
 */
@Composable
private fun PromptField(
    prompt: String,
    enabled: Boolean,
    onPromptChange: (String) -> Unit,
) {
    val label = stringResource(R.string.translation_powerGrafana_aiDrafter_promptLabel)
    val hint = stringResource(R.string.translation_powerGrafana_aiDrafter_promptPlaceholder) // parity:allow web i18n key name
    Textarea(
        value = prompt,
        onValueChange = onPromptChange,
        label = label,
        hint = hint,
        enabled = enabled,
        minLines = PROMPT_MIN_LINES,
        maxLines = PROMPT_MAX_LINES,
    )
}

/**
 * The right-aligned Draft action — the web AIFeatureCard button. Disabled without a non-blank prompt (web
 * `canDraft`) or while a stream is open; the in-flight spinner is the native counterpart of the web "Helix is
 * thinking…" busy label. The button's accessible name is the localized action verb.
 */
@Composable
private fun DraftActionRow(
    canDraft: Boolean,
    streaming: Boolean,
    onDraft: () -> Unit,
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Button(
            label = stringResource(R.string.translation_powerGrafana_aiDrafter_button),
            onClick = onDraft,
            variant = ButtonVariant.Outline,
            size = ButtonSize.Sm,
            enabled = canDraft && !streaming,
            loading = streaming,
            leadingIcon = GrafanaDraftGlyphs.Helix,
        )
    }
}

/**
 * The web AiOutputPanel + draft affordance: the bordered output region. Renders nothing while resting (the web
 * panel is absent until a stream runs) and otherwise a bordered panel carrying the per-state body + a polite
 * live-region announcement so TalkBack reads streamed/drafted/failed output as it changes.
 */
@Composable
private fun DraftOutput(
    surface: DraftSurface,
    canApply: Boolean,
    onRetry: () -> Unit,
    onApply: (GrafanaPanelDraft) -> Unit,
) {
    if (surface is DraftSurface.Resting || surface is DraftSurface.Hidden) return
    val labels =
        DraftOutputLabels(
            working = stringResource(R.string.translation_chatbot_thinking),
            empty = stringResource(R.string.translation_powerGrafana_aiDrafter_emptyDraft),
            stale = stringResource(R.string.translation_mqtt_stale),
            offline = stringResource(R.string.translation_common_offline),
            error = stringResource(R.string.translation_queryError_title),
            ready = stringResource(R.string.translation_powerGrafana_aiDrafter_draftHeading),
        )
    OutputPanel(accessibilityLabel = outputAccessibilityLabel(surface, labels)) {
        when (surface) {
            DraftSurface.Working -> ThinkingIndicator()
            is DraftSurface.Live -> NarrationProse(surface.narration)
            is DraftSurface.Ready ->
                ReadyBody(surface.draft, surface.narration, surface.stale, canApply, onApply)

            is DraftSurface.Narrated -> NarratedBody(surface.narration, surface.stale)
            DraftSurface.Empty -> EmptyBody()
            is DraftSurface.Cached ->
                CachedBody(surface.draft, surface.narration, surface.offline, canApply, onRetry, onApply)

            is DraftSurface.Failed -> FailedBody(offline = surface.offline, onRetry = onRetry)
            DraftSurface.Hidden, is DraftSurface.Resting -> Unit
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
 * The web AIThinkingIndicator: a Helix glyph + the localized "Helix is thinking…" label, with shimmering
 * skeleton lines beneath it while the first delta is awaited. The shimmer is suppressed under reduced motion
 * (the label alone conveys the state); the label is always present for TalkBack.
 */
@Composable
private fun ThinkingIndicator() {
    val accent = TeslaTokens.status.info
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Icon(GrafanaDraftGlyphs.Helix, contentDescription = null, size = IconSize.Md, tint = accent)
            Caption(stringResource(R.string.translation_chatbot_thinking))
        }
        if (!rememberReducedMotion()) {
            SkeletonLines(lines = SKELETON_LINES)
        }
    }
}

/** The streamed assistant prose — the web `whitespace-pre-wrap` text; Compose preserves line breaks. */
@Composable
private fun NarrationProse(text: String) {
    BodyText(text, modifier = Modifier.fillMaxWidth())
}

/**
 * The typed panel-draft summary the user is about to apply — the heading, the proposed panel title, a meta row
 * (type chip + datasource), the referenced source tables, and the model's rationale. Every field is real data
 * projected from the parsed [GrafanaPanelDraft]; it is the native presentation of what the web component hands
 * straight to the deterministic editor.
 */
@Composable
private fun DraftSummary(draft: GrafanaPanelDraft) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(stringResource(R.string.translation_powerGrafana_aiDrafter_draftHeading))
        PanelTitle(draft.panel.title)
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            MetaChip(draft.panel.type)
            Caption(draft.panel.datasource.uid)
        }
        if (draft.referencedTables.isNotEmpty()) {
            Caption(stringResource(R.string.translation_powerGrafana_aiDrafter_tablesLabel))
            BodyText(
                draft.referencedTables.joinToString(separator = TABLE_SEPARATOR),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (draft.rationale.isNotBlank()) {
            Caption(stringResource(R.string.translation_powerGrafana_aiDrafter_rationaleLabel))
            BodyText(draft.rationale)
        }
    }
}

/** A small info-tinted pill for a single piece of panel metadata (the panel type). */
@Composable
private fun MetaChip(label: String) {
    val accent = TeslaTokens.status.info
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

/** Completed with a captured draft: an optional stale chip, the draft summary, any prose, then the Apply action. */
@Composable
private fun ReadyBody(
    draft: GrafanaPanelDraft,
    narration: String,
    stale: Boolean,
    canApply: Boolean,
    onApply: (GrafanaPanelDraft) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        if (stale) {
            FreshnessChip(offline = false)
        }
        DraftSummary(draft)
        if (narration.isNotBlank()) {
            NarrationProse(narration)
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            ApplyButton(draft = draft, canApply = canApply, onApply = onApply)
        }
    }
}

/** Completed with prose but no draft (the model answered without calling the tool); stale chip when aged. */
@Composable
private fun NarratedBody(
    narration: String,
    stale: Boolean,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        if (stale) {
            FreshnessChip(offline = false)
        }
        NarrationProse(narration)
    }
}

/** The friendly empty body shown when a draft completed with nothing to apply (never a blank box). */
@Composable
private fun EmptyBody() {
    EmptyState(message = stringResource(R.string.translation_powerGrafana_aiDrafter_emptyDraft))
}

/** A failed redraft that keeps anything this stream captured visible, with an offline/error chip + retry. */
@Composable
private fun CachedBody(
    draft: GrafanaPanelDraft?,
    narration: String,
    offline: Boolean,
    canApply: Boolean,
    onRetry: () -> Unit,
    onApply: (GrafanaPanelDraft) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        FreshnessChip(offline = offline)
        if (draft != null) {
            DraftSummary(draft)
        }
        if (narration.isNotBlank()) {
            NarrationProse(narration)
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.End),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            RetryButton(onRetry)
            if (draft != null) {
                ApplyButton(draft = draft, canApply = canApply, onApply = onApply)
            }
        }
    }
}

/** The web error branch with nothing captured — a danger Helix glyph, a localized title, and retry. */
@Composable
private fun FailedBody(
    offline: Boolean,
    onRetry: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(
            GrafanaDraftGlyphs.Helix,
            contentDescription = null,
            size = IconSize.Md,
            tint = TeslaTokens.status.danger,
        )
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            if (offline) {
                FreshnessChip(offline = true)
            }
            ErrorText(stringResource(R.string.translation_queryError_title))
            RetryButton(onRetry)
        }
    }
}

/**
 * The web "Apply to editor" button — copies the proposed panel into the host editor via [onApply] after an
 * explicit click. Disabled until a draft is captured and the stream ends (web `canApply`). The localized apply
 * tooltip rides along as the control's accessibility description (web `title`).
 */
@Composable
private fun ApplyButton(
    draft: GrafanaPanelDraft,
    canApply: Boolean,
    onApply: (GrafanaPanelDraft) -> Unit,
) {
    val label = stringResource(R.string.translation_powerGrafana_aiDrafter_applyButton)
    val tooltip = stringResource(R.string.translation_powerGrafana_aiDrafter_applyTooltip)
    Button(
        label = label,
        onClick = { onApply(draft) },
        modifier = Modifier.semantics { contentDescription = "$label. $tooltip" },
        variant = ButtonVariant.Primary,
        size = ButtonSize.Sm,
        enabled = canApply,
    )
}

/** The stale/offline freshness chip — the web "last known / offline" affordance. */
@Composable
private fun FreshnessChip(offline: Boolean) {
    val label =
        if (offline) {
            stringResource(R.string.translation_common_offline)
        } else {
            stringResource(R.string.translation_mqtt_stale)
        }
    val accent = TeslaTokens.status.warning
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
private fun RetryButton(onRetry: () -> Unit) {
    Button(
        label = stringResource(R.string.translation_common_retry),
        onClick = onRetry,
        variant = ButtonVariant.Ghost,
        size = ButtonSize.Sm,
        leadingIcon = FeedbackGlyphs.Refresh,
    )
}

/** Skeleton line count shown beneath the thinking indicator while the first delta is awaited. */
private const val SKELETON_LINES: Int = 3

/** The separator joining referenced-table names in the draft summary. */
private const val TABLE_SEPARATOR: String = " · "

/**
 * The locally authored Helix mark — a four-point sparkle, the AI/Helix brand glyph the web renders as
 * `HelixMark`. It is absent from the shared [io.teslasync.android.components.ui.TeslaGlyphs] catalog and outside
 * this surface's allowed-files scope, so it is drawn here as a 24×24 stroked [ImageVector] recolored at render
 * time by the [Icon] tint — exactly as the sibling AIChargingDiagnosis authors its Helix mark.
 */
private object GrafanaDraftGlyphs {
    val Helix: ImageVector =
        stroked("AINLGrafanaHelix") {
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
                    strokeLineWidth = 2f,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                    pathBuilder = build,
                )
            }.build()
}

// ── Previews (tooling-only; @Preview entry points exercise each rendered state) ──────────────────────

private const val PREVIEW_NOW_MS = 10_000_000L
private const val PREVIEW_STALE_FETCHED_AT = 1_000L
private const val PREVIEW_FRESH_FETCHED_AT = PREVIEW_NOW_MS - 1_000L
private const val PREVIEW_PROMPT = "show me a daily time series of how far I drove this month"
private const val PREVIEW_NARRATION =
    "I mapped your request to a daily-resolution time series of summed drive distance over the current month, " +
        "reading the canonical SI distance column and converting at the display boundary."

private val PREVIEW_DRAFT =
    GrafanaPanelDraft(
        prompt = PREVIEW_PROMPT,
        panel =
            GrafanaPanelEnvelope(
                title = "Daily distance driven — this month",
                type = "timeseries",
                datasource = GrafanaDatasourceRef("grafana-postgresql-datasource", "teslasync-tsdb"),
                targets =
                    listOf(
                        GrafanaPanelTarget(
                            refId = "A",
                            rawSql = "SELECT day, sum(distance_m) FROM drives GROUP BY day",
                            format = "time_series",
                        ),
                    ),
                gridPos = GrafanaPanelGridPos(x = 0, y = 0, w = 12, h = 8),
            ),
        rationale = "A daily time series of summed drive distance over the current month.",
        referencedTables = listOf("drives", "drive_segments"),
    )

@Preview(name = "Resting — empty prompt", showBackground = true)
@Composable
private fun AINLGrafanaPanelRestingEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AINLGrafanaPanelContent(state = GrafanaDraftState(), nowMs = { PREVIEW_NOW_MS })
    }
}

@Preview(name = "Resting — with prompt", showBackground = true)
@Composable
private fun AINLGrafanaPanelRestingPromptPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AINLGrafanaPanelContent(state = GrafanaDraftState(prompt = PREVIEW_PROMPT), nowMs = { PREVIEW_NOW_MS })
    }
}

@Preview(name = "Working — thinking", showBackground = true)
@Composable
private fun AINLGrafanaPanelWorkingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AINLGrafanaPanelContent(
            state = GrafanaDraftState(prompt = PREVIEW_PROMPT, phase = DraftPhase.Streaming),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Streaming — live prose", showBackground = true)
@Composable
private fun AINLGrafanaPanelLivePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AINLGrafanaPanelContent(
            state =
                GrafanaDraftState(
                    prompt = PREVIEW_PROMPT,
                    phase = DraftPhase.Streaming,
                    streamingText = PREVIEW_NARRATION,
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Ready — fresh draft", showBackground = true)
@Composable
private fun AINLGrafanaPanelReadyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AINLGrafanaPanelContent(
            state =
                GrafanaDraftState(
                    prompt = PREVIEW_PROMPT,
                    phase = DraftPhase.Done,
                    streamingText = PREVIEW_NARRATION,
                    draft = PREVIEW_DRAFT,
                    fetchedAt = PREVIEW_FRESH_FETCHED_AT,
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Ready — stale draft", showBackground = true)
@Composable
private fun AINLGrafanaPanelStalePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AINLGrafanaPanelContent(
            state =
                GrafanaDraftState(
                    prompt = PREVIEW_PROMPT,
                    phase = DraftPhase.Done,
                    draft = PREVIEW_DRAFT,
                    fetchedAt = PREVIEW_STALE_FETCHED_AT,
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Done — empty", showBackground = true)
@Composable
private fun AINLGrafanaPanelEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AINLGrafanaPanelContent(
            state =
                GrafanaDraftState(
                    prompt = PREVIEW_PROMPT,
                    phase = DraftPhase.Done,
                    fetchedAt = PREVIEW_FRESH_FETCHED_AT,
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Offline — cached draft", showBackground = true)
@Composable
private fun AINLGrafanaPanelCachedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AINLGrafanaPanelContent(
            state =
                GrafanaDraftState(
                    prompt = PREVIEW_PROMPT,
                    phase = DraftPhase.Failed,
                    draft = PREVIEW_DRAFT,
                    errorKind = io.teslasync.android.data.ErrorKind.Network,
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Error — no draft", showBackground = true)
@Composable
private fun AINLGrafanaPanelFailedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AINLGrafanaPanelContent(
            state =
                GrafanaDraftState(
                    prompt = PREVIEW_PROMPT,
                    phase = DraftPhase.Failed,
                    errorKind = io.teslasync.android.data.ErrorKind.Http,
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}
