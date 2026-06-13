// The native Jetpack Compose + Material 3 AIStateMachineDebuggerNarrator shared surface — a parity port of
// web/src/components/ai/AIStateMachineDebuggerNarrator.tsx and the `@/components/ai/AIFeatureCard` +
// `AiOutputPanel` scaffold it renders. The web surface is a "header + Narrate button + streaming output" AI
// card: a Helix-branded title + badge + description, an action button that opens an SSE stream to
// /ai/system/fsm/narrate, and an output panel that shows an animated thinking indicator until the first delta,
// then the streamed narration (or an inline error). The whole card is wrapped by
// `withAiFeature('state-machine-debugger-narrator', …)`, which renders nothing when the AI feature is gated
// off (ADR-015 §I5). Until the parent supplies a valid (vehicle, window) triple the Narrate action is disabled
// and the web `emptyHint` ("Select a vehicle and a valid time window first.") shows beneath the description.
//
// There is no native AIFeatureCard / withAiFeature atom (atomic AI components are the out-of-scope P3
// component-library bundle), so the card scaffold + gate are composed here from the shared atoms (GlassPanel,
// Button, typography, EmptyState, ErrorText) — the same approach the sibling AIPeriodCompareNarration takes.
// All data flows through the shared [AIStateMachineDebuggerNarratorViewModel] (P1/S8); the view performs NO
// HTTP. Every visible string resolves through the i18n catalog (P1/S10) and the surfaces carry merged TalkBack
// descriptions.
//
// Parity-with-honesty (Honesty Covenant #9, documented not silent): the web gate renders `null` when AI is
// off — reproduced as the early return on [NarrationSurface.Hidden]. Every other state renders a non-blank
// surface (the resting card with the empty hint, the thinking indicator, the streamed prose, a friendly empty
// body, a stale/offline last-known body, or a QueryError-equivalent with retry), folding the useAiStream
// lifecycle onto the P3 loading / empty / content / error / stale / offline contract (see
// AIStateMachineDebuggerNarratorModel.kt).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aistatemachinedebuggernarrator

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
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
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

/**
 * Stateful entry point — the faithful port of the web `AIStateMachineDebuggerNarrator` surface. Binds the AI
 * gate + narrate stream via [source] into an [AIStateMachineDebuggerNarratorViewModel], records the one-shot
 * `view.opened` diagnostic, threads the host's in-scope trace ([vehicleId] + the inclusive Unix-second window
 * [fromUnix]..[toUnix], web InnerSection's `vehicleId` / `fromUnix` / `toUnix` props), collects the live state,
 * and renders the card. The surface performs no HTTP; [logger] defaults to the process logger and
 * [instanceKey] scopes the ViewModel per placement.
 *
 * @param vehicleId the active vehicle whose FSM trace to narrate (web prop); non-positive/`null` disables the
 *   action and shows the empty hint.
 * @param fromUnix the inclusive start of the narration window in Unix seconds (web prop); non-positive/`null`
 *   disables the action.
 * @param toUnix the inclusive end of the narration window in Unix seconds (web prop); must be strictly after
 *   [fromUnix] or the action stays disabled.
 */
@Composable
fun AIStateMachineDebuggerNarrator(
    source: AIStateMachineDebuggerNarratorSource,
    vehicleId: Long?,
    fromUnix: Long?,
    toUnix: Long?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = AI_STATE_MACHINE_DEBUGGER_NARRATOR_SLUG,
) {
    val viewModel: AIStateMachineDebuggerNarratorViewModel =
        viewModel(key = instanceKey, factory = AIStateMachineDebuggerNarratorViewModel.factory(source, logger))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    LaunchedEffect(viewModel, vehicleId, fromUnix, toUnix) { viewModel.setScope(vehicleId, fromUnix, toUnix) }
    val state by viewModel.state.collectAsStateWithLifecycle()

    AIStateMachineDebuggerNarratorContent(
        state = state,
        modifier = modifier,
        onGenerate = viewModel::generate,
        onRetry = viewModel::retry,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Classifies [state] into
 * a [NarrationSurface] and renders the AI card, or renders nothing when the AI feature is gated off (web
 * `withAiFeature` → `null`). The card chrome (title + Helix badge + description + action, plus the empty hint
 * when the scope is incomplete) is always present when the gate is on; the output region switches per surface.
 *
 * @param nowMs wall-clock seam for the freshness check (web `Date.now()`); injectable for tests/previews.
 */
@Composable
fun AIStateMachineDebuggerNarratorContent(
    state: AiNarrationState,
    modifier: Modifier = Modifier,
    onGenerate: () -> Unit = {},
    onRetry: () -> Unit = {},
    nowMs: () -> Long = { System.currentTimeMillis() },
) {
    val surface = classifyNarration(state, nowMs())
    if (surface is NarrationSurface.Hidden) return
    NarrationCard(
        surface = surface,
        canStart = state.canStart,
        streaming = state.isStreaming,
        onGenerate = onGenerate,
        onRetry = onRetry,
        modifier = modifier,
    )
}

/** The web AIFeatureCard scaffold: a GlassPanel with the header, the action row, and the output region. */
@Composable
private fun NarrationCard(
    surface: NarrationSurface,
    canStart: Boolean,
    streaming: Boolean,
    onGenerate: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            NarrationHeader(canStart = canStart)
            NarrationActionRow(canStart = canStart, streaming = streaming, onGenerate = onGenerate)
            NarrationOutput(surface = surface, onRetry = onRetry)
        }
    }
}

/**
 * The web card header: the title + the Helix badge on one row, then the description, then the empty hint when
 * the scope is incomplete (web `!canStart && emptyHint`). Merged for TalkBack so the title, badge, description,
 * and (when shown) the hint are announced as one block.
 */
@Composable
private fun NarrationHeader(canStart: Boolean) {
    val title = stringResource(R.string.translation_stateMachineDebugger_aiNarrator_title)
    val badge = stringResource(R.string.translation_stateMachineDebugger_aiNarrator_badge)
    val description = stringResource(R.string.translation_stateMachineDebugger_aiNarrator_description)
    val hint = restingHint(canStart, stringResource(R.string.translation_stateMachineDebugger_aiNarrator_emptyHint))
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .semantics(mergeDescendants = true) {
                    contentDescription = headerAccessibilityLabel(title, badge, description, hint)
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
        if (hint != null) {
            HelperText(hint)
        }
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
            Icon(AiNarrationGlyphs.Helix, contentDescription = null, size = IconSize.Xs, tint = accent)
            Text(label, style = MaterialTheme.typography.labelSmall)
        }
    }
}

/**
 * The right-aligned Narrate/regenerate action — the web AIFeatureCard button. Disabled without a valid scope
 * (web `canStart`) or while a stream is open; the in-flight spinner is the native counterpart of the web
 * "Helix is thinking…" busy label. The button's accessible name is the localized action verb.
 */
@Composable
private fun NarrationActionRow(
    canStart: Boolean,
    streaming: Boolean,
    onGenerate: () -> Unit,
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Button(
            label = stringResource(R.string.translation_stateMachineDebugger_aiNarrator_button),
            onClick = onGenerate,
            variant = ButtonVariant.Outline,
            size = ButtonSize.Sm,
            enabled = canStart && !streaming,
            loading = streaming,
            leadingIcon = AiNarrationGlyphs.Helix,
        )
    }
}

/**
 * The web AiOutputPanel: the bordered output region. Renders nothing while resting (the web panel is absent
 * until a stream runs) and otherwise a bordered panel carrying the per-state body + a polite live-region
 * announcement so TalkBack reads streamed/failed output as it changes.
 */
@Composable
private fun NarrationOutput(
    surface: NarrationSurface,
    onRetry: () -> Unit,
) {
    if (surface is NarrationSurface.Resting || surface is NarrationSurface.Hidden) return
    val labels =
        NarrationOutputLabels(
            working = stringResource(R.string.translation_chatbot_thinking),
            empty = stringResource(R.string.translation_common_noData),
            stale = stringResource(R.string.translation_mqtt_stale),
            offline = stringResource(R.string.translation_common_offline),
            error = stringResource(R.string.translation_queryError_title),
        )
    OutputPanel(accessibilityLabel = outputAccessibilityLabel(surface, labels)) {
        when (surface) {
            NarrationSurface.Working -> ThinkingIndicator()
            is NarrationSurface.Live -> NarrationProse(surface.text)
            is NarrationSurface.Ready -> ReadyBody(text = surface.text, stale = surface.stale)
            NarrationSurface.Empty -> EmptyBody()
            is NarrationSurface.Cached -> CachedBody(text = surface.text, offline = surface.offline, onRetry = onRetry)
            is NarrationSurface.Failed -> FailedBody(offline = surface.offline, onRetry = onRetry)
            NarrationSurface.Hidden, is NarrationSurface.Resting -> Unit
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
            Icon(AiNarrationGlyphs.Helix, contentDescription = null, size = IconSize.Md, tint = accent)
            Caption(stringResource(R.string.translation_chatbot_thinking))
        }
        if (!rememberReducedMotion()) {
            SkeletonLines(lines = 3)
        }
    }
}

/** The streamed narration prose — the web `whitespace-pre-wrap` text; Compose preserves line breaks. */
@Composable
private fun NarrationProse(text: String) {
    BodyText(text, modifier = Modifier.fillMaxWidth())
}

/** The completed narration, preceded by a stale chip when the fetch is older than the freshness window. */
@Composable
private fun ReadyBody(
    text: String,
    stale: Boolean,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        if (stale) {
            FreshnessChip(offline = false)
        }
        NarrationProse(text)
    }
}

/** The friendly empty body shown when a generation completed with no text (never a blank box). */
@Composable
private fun EmptyBody() {
    EmptyState(message = stringResource(R.string.translation_common_noData))
}

/** A failed regenerate that keeps the last-known narration visible with an offline/stale chip + retry. */
@Composable
private fun CachedBody(
    text: String,
    offline: Boolean,
    onRetry: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        FreshnessChip(offline = offline)
        NarrationProse(text)
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
            AiNarrationGlyphs.Helix,
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
 * The locally authored Helix mark — a four-point sparkle, the AI/Helix brand glyph the web renders as
 * `HelixMark`. It is absent from the shared [io.teslasync.android.components.ui.TeslaGlyphs] catalog and
 * outside this surface's allowed-files scope, so it is drawn here as a 24×24 stroked [ImageVector] recolored
 * at render time by the [Icon] tint — exactly as the sibling AIPeriodCompareNarration authors its Helix mark.
 */
private object AiNarrationGlyphs {
    val Helix: ImageVector =
        stroked("AIStateMachineDebuggerHelix") {
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
private const val PREVIEW_FROM_UNIX = 1_700_000_000L
private const val PREVIEW_TO_UNIX = 1_700_003_600L
private const val PREVIEW_TEXT =
    "Over the selected window the vehicle moved through 12 FSM transitions across the drive and charge state " +
        "machines: park → drive once, drive → park twice, and a short asleep → online flap. No edge exceeded " +
        "the flap threshold. These are the same counts the deterministic transition table and state diagram " +
        "above show; Helix only narrates the trace — it never changes a transition row — and the vehicle id, " +
        "coordinates, and place names were redacted before the envelope reached the provider."

private val previewScope =
    NarrationScope(vehicleId = 1L, fromUnix = PREVIEW_FROM_UNIX, toUnix = PREVIEW_TO_UNIX)

@Preview(name = "Resting — ready", showBackground = true)
@Composable
private fun AIStateMachineDebuggerNarratorRestingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIStateMachineDebuggerNarratorContent(
            state = AiNarrationState(scope = previewScope),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Resting — no scope (empty hint)", showBackground = true)
@Composable
private fun AIStateMachineDebuggerNarratorNoScopePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIStateMachineDebuggerNarratorContent(
            state = AiNarrationState(scope = NarrationScope()),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Working — thinking", showBackground = true)
@Composable
private fun AIStateMachineDebuggerNarratorWorkingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIStateMachineDebuggerNarratorContent(
            state = AiNarrationState(scope = previewScope, phase = NarrationPhase.Streaming),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Streaming — live text", showBackground = true)
@Composable
private fun AIStateMachineDebuggerNarratorLivePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIStateMachineDebuggerNarratorContent(
            state =
                AiNarrationState(
                    scope = previewScope,
                    phase = NarrationPhase.Streaming,
                    streamingText = PREVIEW_TEXT,
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Ready — fresh", showBackground = true)
@Composable
private fun AIStateMachineDebuggerNarratorReadyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIStateMachineDebuggerNarratorContent(
            state =
                AiNarrationState(
                    scope = previewScope,
                    phase = NarrationPhase.Done,
                    committedText = PREVIEW_TEXT,
                    fetchedAt = PREVIEW_FRESH_FETCHED_AT,
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Ready — stale", showBackground = true)
@Composable
private fun AIStateMachineDebuggerNarratorStalePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIStateMachineDebuggerNarratorContent(
            state =
                AiNarrationState(
                    scope = previewScope,
                    phase = NarrationPhase.Done,
                    committedText = PREVIEW_TEXT,
                    fetchedAt = PREVIEW_STALE_FETCHED_AT,
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Empty — blank result", showBackground = true)
@Composable
private fun AIStateMachineDebuggerNarratorEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIStateMachineDebuggerNarratorContent(
            state =
                AiNarrationState(
                    scope = previewScope,
                    phase = NarrationPhase.Done,
                    committedText = "",
                    fetchedAt = PREVIEW_FRESH_FETCHED_AT,
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Offline — last known", showBackground = true)
@Composable
private fun AIStateMachineDebuggerNarratorOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIStateMachineDebuggerNarratorContent(
            state =
                AiNarrationState(
                    scope = previewScope,
                    phase = NarrationPhase.Failed,
                    committedText = PREVIEW_TEXT,
                    errorKind = ErrorKind.Network,
                    fetchedAt = PREVIEW_STALE_FETCHED_AT,
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Error — retry", showBackground = true)
@Composable
private fun AIStateMachineDebuggerNarratorErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIStateMachineDebuggerNarratorContent(
            state =
                AiNarrationState(
                    scope = previewScope,
                    phase = NarrationPhase.Failed,
                    errorKind = ErrorKind.Http,
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}
