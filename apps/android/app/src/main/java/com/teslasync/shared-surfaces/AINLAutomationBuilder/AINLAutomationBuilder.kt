// The native Jetpack Compose + Material 3 AINLAutomationBuilder shared surface — a parity port of
// web/src/components/ai/AINLAutomationBuilder.tsx and the `@/components/ai/AIFeatureCard` + `AiOutputPanel`
// scaffold it renders. The web surface is a "header + prompt Textarea + Draft button + streaming output" AI
// card: a Helix-branded title + badge + description, a natural-language prompt field, an action button that
// opens an SSE stream to /ai/automations/draft with `{ vehicle_id, prompt }`, and an output panel that shows an
// animated thinking indicator until the first delta, then the streamed draft (or an inline error). The whole
// card is wrapped by `withAiFeature('nl-automation-builder', …)`, which renders nothing when the AI feature is
// gated off.
//
// There is no native AIFeatureCard / withAiFeature atom in this surface's scope (atomic AI components are the
// out-of-scope P3 component-library bundle), so the card scaffold + gate are composed here from the shared
// atoms (GlassPanel, Textarea, Button, typography, EmptyState, ErrorText) — the same approach the sibling
// AICostForecastNarration takes. All data flows through the shared [AINLAutomationBuilderViewModel] (P1/S8);
// the view performs NO HTTP. Every visible string resolves through the i18n catalog (P1/S10) and the surfaces
// carry merged TalkBack descriptions.
//
// Parity-with-honesty (Honesty Covenant #9, documented not silent): the web gate renders `null` when AI is off
// — reproduced as the early return on [DraftSurface.Hidden]. Every other state renders a non-blank surface (the
// resting card with the prompt, the thinking indicator, the streamed draft, a friendly empty body, a stale/
// offline last-known body, or a QueryError-equivalent with retry), folding the useAiStream lifecycle onto the
// P3 loading / empty / content / error / stale / offline contract (see AINLAutomationBuilderModel.kt). The
// prompt-hint i18n key is absent from the catalog (web renders it from the inline `t()` fallback), so it
// resolves through the same English fallback here via [rememberStringResolver] — exact web parity.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces/
// AINLAutomationBuilder) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ainlautomationbuilder

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

/** The Helix badge pill's low-alpha accent wash (mirrors the shared Badge wash). */
private const val BADGE_WASH_ALPHA: Float = 0.16f

/** Web `<Textarea rows={3} />` — the prompt field's resting height. */
private const val PROMPT_MIN_LINES: Int = 3

/**
 * Stateful entry point — the faithful port of the web `AINLAutomationBuilder` surface. Binds the AI gate +
 * draft stream via [source] into an [AINLAutomationBuilderViewModel], records the one-shot `view.opened`
 * diagnostic, threads the host's [vehicleId] (web InnerSection's `vehicleId` prop), collects the live state,
 * and renders the card. The surface performs no HTTP; [logger] defaults to the process logger and [instanceKey]
 * scopes the ViewModel per placement.
 *
 * @param vehicleId the active vehicle the drafted automation is scoped to (web prop); `null` disables the
 *   action until a vehicle is selected (web `canStart`).
 */
@Composable
fun AINLAutomationBuilder(
    source: AINLAutomationBuilderSource,
    vehicleId: Long?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = AI_NL_AUTOMATION_BUILDER_SLUG,
) {
    val viewModel: AINLAutomationBuilderViewModel =
        viewModel(key = instanceKey, factory = AINLAutomationBuilderViewModel.factory(source, logger))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    LaunchedEffect(viewModel, vehicleId) { viewModel.setVehicle(vehicleId) }
    val state by viewModel.state.collectAsStateWithLifecycle()

    AINLAutomationBuilderContent(
        state = state,
        modifier = modifier,
        onPromptChange = viewModel::setPrompt,
        onDraft = viewModel::draft,
        onRetry = viewModel::retry,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Classifies [state] into
 * a [DraftSurface] and renders the AI card, or renders nothing when the AI feature is gated off (web
 * `withAiFeature` → `null`). The card chrome (title + Helix badge + description + prompt field + action) is
 * always present when the gate is on; the output region switches per surface.
 *
 * @param nowMs wall-clock seam for the freshness check (web `Date.now()`); injectable for tests/previews.
 */
@Composable
fun AINLAutomationBuilderContent(
    state: AiDraftState,
    modifier: Modifier = Modifier,
    onPromptChange: (String) -> Unit = {},
    onDraft: () -> Unit = {},
    onRetry: () -> Unit = {},
    nowMs: () -> Long = { System.currentTimeMillis() },
) {
    val surface = classifyDraft(state, nowMs())
    if (surface is DraftSurface.Hidden) return
    val labels = aiNlAutomationBuilderLabels(rememberStringResolver())
    DraftCard(
        surface = surface,
        labels = labels,
        prompt = state.prompt,
        canStart = state.canStart,
        streaming = state.isStreaming,
        onPromptChange = onPromptChange,
        onDraft = onDraft,
        onRetry = onRetry,
        modifier = modifier,
    )
}

/** The web AIFeatureCard scaffold: a GlassPanel with the header, the prompt input, the action row, and output. */
@Composable
private fun DraftCard(
    surface: DraftSurface,
    labels: AINLAutomationBuilderLabels,
    prompt: String,
    canStart: Boolean,
    streaming: Boolean,
    onPromptChange: (String) -> Unit,
    onDraft: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            DraftHeader(labels)
            PromptInput(value = prompt, hint = labels.promptHint, onValueChange = onPromptChange)
            DraftActionRow(label = labels.draftButton, canStart = canStart, streaming = streaming, onDraft = onDraft)
            DraftOutput(surface = surface, onRetry = onRetry)
        }
    }
}

/** The web card header: the title + the Helix badge on one row, then the description, merged for TalkBack. */
@Composable
private fun DraftHeader(labels: AINLAutomationBuilderLabels) {
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
            PanelTitle(labels.title)
            HelixBadge(labels.badge)
        }
        BodyText(labels.description, color = MaterialTheme.colorScheme.onSurfaceVariant)
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
            Icon(AiDraftGlyphs.Helix, contentDescription = null, size = IconSize.Xs, tint = accent)
            Text(label, style = MaterialTheme.typography.labelSmall)
        }
    }
}

/**
 * The web prompt `Textarea` — the always-present input slot. The web example-prompt hint maps to the shared
 * Textarea's floating [label] (Material's floating label sits in the field when empty, giving the same in-field
 * hint affordance while also providing the accessible field name TalkBack announces). Web `rows={3}` →
 * [PROMPT_MIN_LINES]. Kept enabled while streaming (web parity — only the action button gates re-entry).
 */
@Composable
private fun PromptInput(
    value: String,
    hint: String,
    onValueChange: (String) -> Unit,
) {
    Textarea(
        value = value,
        onValueChange = onValueChange,
        label = hint,
        minLines = PROMPT_MIN_LINES,
    )
}

/**
 * The right-aligned Draft/regenerate action — the web AIFeatureCard button. Disabled without the inputs the
 * action needs (web `canStart`: a selected vehicle AND a non-blank prompt) or while a stream is open; the
 * in-flight spinner is the native counterpart of the web "Helix is thinking…" busy label. The button's
 * accessible name is the localized draft verb.
 */
@Composable
private fun DraftActionRow(
    label: String,
    canStart: Boolean,
    streaming: Boolean,
    onDraft: () -> Unit,
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Button(
            label = label,
            onClick = onDraft,
            variant = ButtonVariant.Outline,
            size = ButtonSize.Sm,
            enabled = canStart && !streaming,
            loading = streaming,
            leadingIcon = AiDraftGlyphs.Helix,
        )
    }
}

/**
 * The web AiOutputPanel: the bordered output region. Renders nothing while resting (the web panel is absent
 * until a stream runs) and otherwise a bordered panel carrying the per-state body + a polite live-region
 * announcement so TalkBack reads streamed/failed output as it changes.
 */
@Composable
private fun DraftOutput(
    surface: DraftSurface,
    onRetry: () -> Unit,
) {
    if (surface is DraftSurface.Resting || surface is DraftSurface.Hidden) return
    val labels =
        DraftOutputLabels(
            working = stringResource(R.string.translation_chatbot_thinking),
            empty = stringResource(R.string.translation_common_noData),
            stale = stringResource(R.string.translation_mqtt_stale),
            offline = stringResource(R.string.translation_common_offline),
            error = stringResource(R.string.translation_queryError_title),
        )
    OutputPanel(accessibilityLabel = outputAccessibilityLabel(surface, labels)) {
        when (surface) {
            DraftSurface.Working -> ThinkingIndicator()
            is DraftSurface.Live -> DraftProse(surface.text)
            is DraftSurface.Ready -> ReadyBody(text = surface.text, stale = surface.stale)
            DraftSurface.Empty -> EmptyBody()
            is DraftSurface.Cached -> CachedBody(text = surface.text, offline = surface.offline, onRetry = onRetry)
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
            Icon(AiDraftGlyphs.Helix, contentDescription = null, size = IconSize.Md, tint = accent)
            Caption(stringResource(R.string.translation_chatbot_thinking))
        }
        if (!rememberReducedMotion()) {
            SkeletonLines(lines = 3)
        }
    }
}

/** The streamed draft prose — the web `whitespace-pre-wrap` text; Compose preserves line breaks. */
@Composable
private fun DraftProse(text: String) {
    BodyText(text, modifier = Modifier.fillMaxWidth())
}

/** The completed draft, preceded by a stale chip when the fetch is older than the freshness window. */
@Composable
private fun ReadyBody(
    text: String,
    stale: Boolean,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        if (stale) {
            FreshnessChip(offline = false)
        }
        DraftProse(text)
    }
}

/** The friendly empty body shown when a generation completed with no text (never a blank box). */
@Composable
private fun EmptyBody() {
    EmptyState(message = stringResource(R.string.translation_common_noData))
}

/** A failed re-draft that keeps the last-known draft visible with an offline/stale chip + retry. */
@Composable
private fun CachedBody(
    text: String,
    offline: Boolean,
    onRetry: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        FreshnessChip(offline = offline)
        DraftProse(text)
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            RetryButton(onRetry)
        }
    }
}

/** The web error branch with no last-known output — a danger Helix glyph, a localized title, and retry. */
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
            AiDraftGlyphs.Helix,
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

// ── i18n facade (web `t(key, fallback)`) ─────────────────────────────────────────────────────────────────────

/**
 * By-name resolver against the generated Android catalog, falling back to the web English when a key is absent
 * (web `t(key, default)`). Remembered against the context so a locale change re-resolves the surface. The
 * prompt-hint key is intentionally absent from the catalog (web parity), so it resolves through the fallback.
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

// ── Helix mark (locally authored; absent from the shared glyph catalog + outside allowed-files scope) ────────

/**
 * The locally authored Helix mark — a four-point sparkle, the AI/Helix brand glyph the web renders as
 * `HelixMark`. It is absent from the shared [io.teslasync.android.components.ui.TeslaGlyphs] catalog and
 * outside this surface's allowed-files scope, so it is drawn here as a 24×24 stroked [ImageVector] recolored at
 * render time by the [Icon] tint — exactly as the sibling AICostForecastNarration authors its Helix mark.
 */
private object AiDraftGlyphs {
    val Helix: ImageVector =
        stroked("AINLAutomationBuilderHelix") {
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

// ── Previews (tooling-only; @Preview entry points exercise each rendered state) ──────────────────────────────

private const val PREVIEW_NOW_MS = 10_000_000L
private const val PREVIEW_STALE_FETCHED_AT = 1_000L
private const val PREVIEW_FRESH_FETCHED_AT = PREVIEW_NOW_MS - 1_000L
private const val PREVIEW_PROMPT = "precondition the cabin to 22°C when I leave work on weekdays"
private const val PREVIEW_TEXT =
    "Drafted automation \u201cWeekday work departure preconditioning\u201d:\n" +
        "• Trigger — geofence exit from \u201cWork\u201d on Mon–Fri.\n" +
        "• Condition — local time between 16:00 and 19:00.\n" +
        "• Action — set climate keeper to 22°C and start preconditioning.\n" +
        "Review the typed graph below, then save to enable it."

@Preview(name = "Resting — ready", showBackground = true)
@Composable
private fun AINLAutomationBuilderRestingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AINLAutomationBuilderContent(
            state = AiDraftState(vehicleId = 1L, prompt = PREVIEW_PROMPT),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Resting — empty prompt", showBackground = true)
@Composable
private fun AINLAutomationBuilderEmptyPromptPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AINLAutomationBuilderContent(
            state = AiDraftState(vehicleId = 1L, prompt = ""),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Working — thinking", showBackground = true)
@Composable
private fun AINLAutomationBuilderWorkingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AINLAutomationBuilderContent(
            state = AiDraftState(vehicleId = 1L, prompt = PREVIEW_PROMPT, phase = DraftPhase.Streaming),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Live — streaming", showBackground = true)
@Composable
private fun AINLAutomationBuilderLivePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AINLAutomationBuilderContent(
            state =
                AiDraftState(
                    vehicleId = 1L,
                    prompt = PREVIEW_PROMPT,
                    phase = DraftPhase.Streaming,
                    streamingText = PREVIEW_TEXT,
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Ready — fresh", showBackground = true)
@Composable
private fun AINLAutomationBuilderReadyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AINLAutomationBuilderContent(
            state =
                AiDraftState(
                    vehicleId = 1L,
                    prompt = PREVIEW_PROMPT,
                    phase = DraftPhase.Done,
                    committedText = PREVIEW_TEXT,
                    fetchedAt = PREVIEW_FRESH_FETCHED_AT,
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Ready — stale", showBackground = true)
@Composable
private fun AINLAutomationBuilderStalePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AINLAutomationBuilderContent(
            state =
                AiDraftState(
                    vehicleId = 1L,
                    prompt = PREVIEW_PROMPT,
                    phase = DraftPhase.Done,
                    committedText = PREVIEW_TEXT,
                    fetchedAt = PREVIEW_STALE_FETCHED_AT,
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Empty — blank result", showBackground = true)
@Composable
private fun AINLAutomationBuilderEmptyResultPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AINLAutomationBuilderContent(
            state =
                AiDraftState(
                    vehicleId = 1L,
                    prompt = PREVIEW_PROMPT,
                    phase = DraftPhase.Done,
                    committedText = "",
                    fetchedAt = PREVIEW_FRESH_FETCHED_AT,
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Cached — offline last-known", showBackground = true)
@Composable
private fun AINLAutomationBuilderCachedOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AINLAutomationBuilderContent(
            state =
                AiDraftState(
                    vehicleId = 1L,
                    prompt = PREVIEW_PROMPT,
                    phase = DraftPhase.Failed,
                    committedText = PREVIEW_TEXT,
                    errorKind = io.teslasync.android.data.ErrorKind.Network,
                    fetchedAt = PREVIEW_FRESH_FETCHED_AT,
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Failed — hard error", showBackground = true)
@Composable
private fun AINLAutomationBuilderFailedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AINLAutomationBuilderContent(
            state =
                AiDraftState(
                    vehicleId = 1L,
                    prompt = PREVIEW_PROMPT,
                    phase = DraftPhase.Failed,
                    errorKind = io.teslasync.android.data.ErrorKind.Http,
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}
