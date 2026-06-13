// The native Jetpack Compose + Material 3 AINLAlertBuilder shared surface — a parity port of
// web/src/components/ai/AINLAlertBuilder.tsx and the `@/components/ai/AIFeatureCard` + `AiOutputPanel`
// scaffold it renders. The web surface is a "header + prompt textarea + Draft button + streaming output" AI
// card: a Helix-branded title + badge + description, a free-text prompt input, an action button that opens an
// SSE stream to /ai/alerts/rules/draft, and an output panel that shows an animated thinking indicator until
// the first delta, then the streamed AlertRule draft (or an inline error). The whole card is wrapped by
// `withAiFeature('nl-alert-builder', …)`, which renders nothing when the AI feature is gated off.
//
// There is no native AIFeatureCard / withAiFeature atom (atomic AI components are the out-of-scope P3
// component-library bundle), so the card scaffold + gate are composed here from the shared atoms (GlassPanel,
// Textarea, Button, typography, EmptyState, ErrorText) — the same approach the sibling AICostForecastNarration
// takes. All data flows through the shared [AINLAlertBuilderViewModel] (P1/S8); the view performs NO HTTP.
// Every visible string resolves through the i18n catalog (P1/S10) and the surfaces carry merged TalkBack
// descriptions.
//
// Parity-with-honesty (Honesty Covenant #9, documented not silent): the web gate renders `null` when AI is
// off — reproduced as the early return on [DraftSurface.Hidden]. Every other state renders a non-blank
// surface (the resting card, the thinking indicator, the streamed draft, a friendly empty body, a stale/
// offline last-known body, or a QueryError-equivalent with retry), folding the useAiStream lifecycle onto the
// P3 loading / empty / content / error / stale / offline contract (see AINLAlertBuilderModel.kt).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ainlalertbuilder

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

// Canonical P1/S10 catalog key for the prompt input hint, resolved by name to mirror the web source's
// t() fallback: this key is absent from the shared catalog today (the web renders its inline default), so the
// surface looks the catalog up by name and falls back to the same default below, staying in parity and
// auto-upgrading if the key is later generated. The documented rationale lives in the gate log (Covenant #9).
private const val DRAFT_PROMPT_HINT_KEY = "translation_notifications_alertStudio_aiBuilder_placeholder" // parity:allow i18n key name

/** The web source's inline default for the hint key — rendered on web today, so the faithful parity value. */
private const val DRAFT_PROMPT_HINT_DEFAULT = "e.g. alert me if battery cell voltage spread is over 50 mV"

/**
 * Stateful entry point — the faithful port of the web `AINLAlertBuilder` surface. Binds the AI gate + draft
 * stream via [source] into an [AINLAlertBuilderViewModel], records the one-shot `view.opened` diagnostic,
 * threads the host's [vehicleId] (web InnerSection's `vehicleId` prop), collects the live state, and renders
 * the card. The surface performs no HTTP; [logger] defaults to the process logger and [instanceKey] scopes the
 * ViewModel per placement.
 *
 * @param vehicleId the active vehicle whose alert rule to draft (web prop); `null` disables the Draft action.
 */
@Composable
fun AINLAlertBuilder(
    source: AINLAlertBuilderSource,
    vehicleId: Long?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = AI_NL_ALERT_BUILDER_SLUG,
) {
    val viewModel: AINLAlertBuilderViewModel =
        viewModel(key = instanceKey, factory = AINLAlertBuilderViewModel.factory(source, logger))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    LaunchedEffect(viewModel, vehicleId) { viewModel.setVehicle(vehicleId) }
    val state by viewModel.state.collectAsStateWithLifecycle()

    AINLAlertBuilderContent(
        state = state,
        modifier = modifier,
        onPromptChange = viewModel::setPrompt,
        onGenerate = viewModel::generate,
        onRetry = viewModel::retry,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Classifies [state] into
 * a [DraftSurface] and renders the AI card, or renders nothing when the AI feature is gated off (web
 * `withAiFeature` → `null`). The card chrome (title + Helix badge + description + prompt input + action) is
 * always present when the gate is on; the output region switches per surface.
 *
 * @param nowMs wall-clock seam for the freshness check (web `Date.now()`); injectable for tests/previews.
 */
@Composable
fun AINLAlertBuilderContent(
    state: AiAlertDraftState,
    modifier: Modifier = Modifier,
    onPromptChange: (String) -> Unit = {},
    onGenerate: () -> Unit = {},
    onRetry: () -> Unit = {},
    nowMs: () -> Long = { System.currentTimeMillis() },
) {
    val surface = classifyDraft(state, nowMs())
    if (surface is DraftSurface.Hidden) return
    DraftCard(
        surface = surface,
        prompt = state.prompt,
        canStart = state.canStart,
        streaming = state.isStreaming,
        onPromptChange = onPromptChange,
        onGenerate = onGenerate,
        onRetry = onRetry,
        modifier = modifier,
    )
}

/** The web AIFeatureCard scaffold: a GlassPanel with the header, the prompt input, the action row, the output. */
@Composable
private fun DraftCard(
    surface: DraftSurface,
    prompt: String,
    canStart: Boolean,
    streaming: Boolean,
    onPromptChange: (String) -> Unit,
    onGenerate: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            DraftHeader()
            DraftPromptField(prompt = prompt, onPromptChange = onPromptChange)
            DraftActionRow(canStart = canStart, streaming = streaming, onGenerate = onGenerate)
            DraftOutput(surface = surface, onRetry = onRetry)
        }
    }
}

/** The web card header: the title + the Helix badge on one row, then the description, merged for TalkBack. */
@Composable
private fun DraftHeader() {
    val title = stringResource(R.string.translation_notifications_alertStudio_aiBuilder_title)
    val badge = stringResource(R.string.translation_notifications_alertStudio_aiBuilder_badge)
    val description = stringResource(R.string.translation_notifications_alertStudio_aiBuilder_description)
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
            Icon(AiAlertGlyphs.Helix, contentDescription = null, size = IconSize.Xs, tint = accent)
            Text(label, style = MaterialTheme.typography.labelSmall)
        }
    }
}

/**
 * The web AIFeatureCard input slot: the free-text prompt Textarea bound to the surface state (web `prompt` /
 * `setPrompt`). It carries a merged TalkBack description (the field has no visible label, mirroring the web
 * hint-only input) so the interactive element announces its purpose plus the example hint.
 */
@Composable
private fun DraftPromptField(
    prompt: String,
    onPromptChange: (String) -> Unit,
) {
    val title = stringResource(R.string.translation_notifications_alertStudio_aiBuilder_title)
    val hint = rememberDraftPromptHint()
    val inputLabel = promptInputAccessibilityLabel(title, hint)
    Textarea(
        value = prompt,
        onValueChange = onPromptChange,
        modifier = Modifier.semantics { contentDescription = inputLabel },
        hint = hint,
        minLines = 3,
    )
}

/**
 * The right-aligned Draft/redraft action — the web AIFeatureCard button. Disabled without a selected vehicle
 * AND a non-blank prompt (web `canStart`) or while a stream is open; the in-flight spinner is the native
 * counterpart of the web "Helix is thinking…" busy label. The button's accessible name is the localized verb.
 */
@Composable
private fun DraftActionRow(
    canStart: Boolean,
    streaming: Boolean,
    onGenerate: () -> Unit,
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Button(
            label = stringResource(R.string.translation_notifications_alertStudio_aiBuilder_draftButton),
            onClick = onGenerate,
            variant = ButtonVariant.Outline,
            size = ButtonSize.Sm,
            enabled = canStart && !streaming,
            loading = streaming,
            leadingIcon = AiAlertGlyphs.Helix,
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
            Icon(AiAlertGlyphs.Helix, contentDescription = null, size = IconSize.Md, tint = accent)
            Caption(stringResource(R.string.translation_chatbot_thinking))
        }
        if (!rememberReducedMotion()) {
            SkeletonLines(lines = 3)
        }
    }
}

/** The streamed AlertRule draft prose — the web `whitespace-pre-wrap` text; Compose preserves line breaks. */
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

/** The friendly empty body shown when a draft completed with no text (never a blank box). */
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
            AiAlertGlyphs.Helix,
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

/**
 * Resolves the prompt input hint through the P1/S10 catalog by its canonical key name, falling back to the web
 * source's inline default when the key is absent — the native analogue of the web `t(key, default)` call.
 * Resolving by name (instead of a compile-time `R.string`) is what lets this surface stay self-contained while
 * the key is not yet in the generated catalog; it auto-upgrades to the catalog value once the key lands.
 */
@Composable
private fun rememberDraftPromptHint(): String {
    val context = LocalContext.current
    val resId =
        remember(context) {
            context.resources.getIdentifier(DRAFT_PROMPT_HINT_KEY, "string", context.packageName)
        }
    return if (resId != 0) stringResource(resId) else DRAFT_PROMPT_HINT_DEFAULT
}

/**
 * The locally authored Helix mark — a four-point sparkle, the AI/Helix brand glyph the web renders as
 * `HelixMark`. It is absent from the shared [io.teslasync.android.components.ui.TeslaGlyphs] catalog and
 * outside this surface's allowed-files scope, so it is drawn here as a 24×24 stroked [ImageVector] recolored
 * at render time by the [Icon] tint — exactly as the sibling AICostForecastNarration authors its Helix mark.
 */
private object AiAlertGlyphs {
    val Helix: ImageVector =
        stroked("AINLAlertHelix") {
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
private const val PREVIEW_PROMPT = "alert me if battery cell voltage spread is over 50 mV"
private const val PREVIEW_DRAFT =
    "AlertRule draft — name: \"Cell imbalance\"; signal: BatteryCellVoltageSpread; op: gt; threshold: 0.05 V; " +
        "window: 5m; severity: warning; notify: push + email. Review the typed fields below before saving."

@Preview(name = "Resting — ready to draft", showBackground = true)
@Composable
private fun AINLAlertBuilderRestingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AINLAlertBuilderContent(
            state = AiAlertDraftState(vehicleId = 1L, prompt = PREVIEW_PROMPT),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Resting — needs a vehicle + prompt", showBackground = true)
@Composable
private fun AINLAlertBuilderEmptyInputsPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AINLAlertBuilderContent(
            state = AiAlertDraftState(vehicleId = null, prompt = ""),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Working — thinking", showBackground = true)
@Composable
private fun AINLAlertBuilderWorkingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AINLAlertBuilderContent(
            state = AiAlertDraftState(vehicleId = 1L, prompt = PREVIEW_PROMPT, phase = DraftPhase.Streaming),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Live — streaming draft", showBackground = true)
@Composable
private fun AINLAlertBuilderLivePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AINLAlertBuilderContent(
            state =
                AiAlertDraftState(
                    vehicleId = 1L,
                    prompt = PREVIEW_PROMPT,
                    phase = DraftPhase.Streaming,
                    streamingText = PREVIEW_DRAFT,
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Ready — fresh", showBackground = true)
@Composable
private fun AINLAlertBuilderReadyFreshPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AINLAlertBuilderContent(
            state =
                AiAlertDraftState(
                    vehicleId = 1L,
                    prompt = PREVIEW_PROMPT,
                    phase = DraftPhase.Done,
                    committedText = PREVIEW_DRAFT,
                    fetchedAt = PREVIEW_FRESH_FETCHED_AT,
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Ready — stale", showBackground = true)
@Composable
private fun AINLAlertBuilderReadyStalePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AINLAlertBuilderContent(
            state =
                AiAlertDraftState(
                    vehicleId = 1L,
                    prompt = PREVIEW_PROMPT,
                    phase = DraftPhase.Done,
                    committedText = PREVIEW_DRAFT,
                    fetchedAt = PREVIEW_STALE_FETCHED_AT,
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Empty — blank result", showBackground = true)
@Composable
private fun AINLAlertBuilderEmptyResultPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AINLAlertBuilderContent(
            state =
                AiAlertDraftState(
                    vehicleId = 1L,
                    prompt = PREVIEW_PROMPT,
                    phase = DraftPhase.Done,
                    committedText = "",
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Cached — offline last-known", showBackground = true)
@Composable
private fun AINLAlertBuilderCachedOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AINLAlertBuilderContent(
            state =
                AiAlertDraftState(
                    vehicleId = 1L,
                    prompt = PREVIEW_PROMPT,
                    phase = DraftPhase.Failed,
                    committedText = PREVIEW_DRAFT,
                    errorKind = ErrorKind.Network,
                    fetchedAt = PREVIEW_FRESH_FETCHED_AT,
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Failed — offline, no last-known", showBackground = true)
@Composable
private fun AINLAlertBuilderFailedOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AINLAlertBuilderContent(
            state =
                AiAlertDraftState(
                    vehicleId = 1L,
                    prompt = PREVIEW_PROMPT,
                    phase = DraftPhase.Failed,
                    errorKind = ErrorKind.Network,
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Failed — server error", showBackground = true)
@Composable
private fun AINLAlertBuilderFailedHttpPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AINLAlertBuilderContent(
            state =
                AiAlertDraftState(
                    vehicleId = 1L,
                    prompt = PREVIEW_PROMPT,
                    phase = DraftPhase.Failed,
                    errorKind = ErrorKind.Http,
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}
