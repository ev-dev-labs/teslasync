// The native Jetpack Compose + Material 3 AILifetimeStatsQA shared surface — a parity port of
// web/src/components/ai/AILifetimeStatsQA.tsx and the `@/components/ai/AIFeatureCard` + `AiOutputPanel`
// scaffold it renders. The web surface is a Helix-branded "header + question prompt + Ask button + streaming
// output" AI card: a title + badge + description, a Textarea where the user types a natural-language question
// about their all-time stats, an Ask button that opens an SSE stream to /ai/analytics/lifetime/qa, and an
// output panel that shows an animated thinking indicator until the first delta, then the streamed answer (or
// an inline error). The whole card is wrapped by `withAiFeature('lifetime-stats-qa', …)`, which renders
// nothing when the AI feature is gated off.
//
// There is no native AIFeatureCard / withAiFeature atom (atomic AI components are the out-of-scope P3
// component-library bundle), so the card scaffold + gate are composed here from the shared atoms (GlassPanel,
// Button, Textarea, typography, EmptyState, ErrorText) — the same approach the sibling AICostForecastNarration
// takes. All data flows through the shared [AILifetimeStatsQAViewModel] (P1/S8); the view performs NO HTTP.
// Every visible string resolves through the i18n catalog (P1/S10) and the surfaces carry merged TalkBack
// descriptions.
//
// Parity-with-honesty (Honesty Covenant #9, documented not silent):
//   • The web gate renders `null` when AI is off — reproduced as the early return on [QaSurface.Hidden].
//   • Every other state renders a non-blank surface (the resting card with the question form, the thinking
//     indicator, the streamed answer, a friendly empty body, a stale/offline last-known body, or a
//     QueryError-equivalent with retry), folding the useAiStream lifecycle onto the P3 loading / empty /
//     content / error / stale / offline contract (see AILifetimeStatsQAModel.kt).
//   • The web Textarea in-field example text maps to the native Textarea `hint`
//     (Material 3 supporting text), and the web `aria-label` maps to the field `label`, because a floating
//     label + helper text is the idiomatic Material 3 prompt affordance.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ailifetimestatsqa

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

/** The Textarea prompt height bounds — web `rows={3}`, with a little room to grow. */
private const val QUESTION_MIN_LINES: Int = 3
private const val QUESTION_MAX_LINES: Int = 6

/**
 * Stateful entry point — the faithful port of the web `AILifetimeStatsQA` surface. Binds the AI gate + answer
 * stream via [source] into an [AILifetimeStatsQAViewModel], records the one-shot `view.opened` diagnostic,
 * threads the host's [vehicleId] (web InnerSection's `vehicleId` prop), collects the live state, and renders
 * the card. The surface performs no HTTP; [logger] defaults to the process logger and [instanceKey] scopes the
 * ViewModel per placement.
 *
 * @param vehicleId the active vehicle whose lifetime stats to query (web prop); `null` disables the Ask action.
 */
@Composable
fun AILifetimeStatsQA(
    source: AILifetimeStatsQASource,
    vehicleId: Long?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = AI_LIFETIME_STATS_QA_SLUG,
) {
    val viewModel: AILifetimeStatsQAViewModel =
        viewModel(key = instanceKey, factory = AILifetimeStatsQAViewModel.factory(source, logger))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    LaunchedEffect(viewModel, vehicleId) { viewModel.setVehicle(vehicleId) }
    val state by viewModel.state.collectAsStateWithLifecycle()

    AILifetimeStatsQAContent(
        state = state,
        modifier = modifier,
        onQuestionChange = viewModel::setQuestion,
        onAsk = viewModel::ask,
        onRetry = viewModel::retry,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Classifies [state] into
 * a [QaSurface] and renders the AI card, or renders nothing when the AI feature is gated off (web
 * `withAiFeature` → `null`). The card chrome (title + Helix badge + description + question form + Ask action)
 * is always present when the gate is on; the output region switches per surface.
 *
 * @param nowMs wall-clock seam for the freshness check (web `Date.now()`); injectable for tests/previews.
 */
@Composable
fun AILifetimeStatsQAContent(
    state: AiQaState,
    modifier: Modifier = Modifier,
    onQuestionChange: (String) -> Unit = {},
    onAsk: () -> Unit = {},
    onRetry: () -> Unit = {},
    nowMs: () -> Long = { System.currentTimeMillis() },
) {
    val surface = classifyQa(state, nowMs())
    if (surface is QaSurface.Hidden) return
    QaCard(
        surface = surface,
        question = state.question,
        canStart = state.canStart,
        streaming = state.isStreaming,
        onQuestionChange = onQuestionChange,
        onAsk = onAsk,
        onRetry = onRetry,
        modifier = modifier,
    )
}

/** The web AIFeatureCard scaffold: a GlassPanel with the header, the question form, the action, and output. */
@Composable
private fun QaCard(
    surface: QaSurface,
    question: String,
    canStart: Boolean,
    streaming: Boolean,
    onQuestionChange: (String) -> Unit,
    onAsk: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            QaHeader()
            QuestionInput(question = question, streaming = streaming, onQuestionChange = onQuestionChange)
            QaActionRow(canStart = canStart, streaming = streaming, onAsk = onAsk)
            QaOutput(surface = surface, onRetry = onRetry)
        }
    }
}

/** The web card header: the title + the Helix badge on one row, then the description, merged for TalkBack. */
@Composable
private fun QaHeader() {
    val title = stringResource(R.string.translation_lifetime_aiQA_title)
    val badge = stringResource(R.string.translation_lifetime_aiQA_badge)
    val description = stringResource(R.string.translation_lifetime_aiQA_description)
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
            Icon(AiQaGlyphs.Helix, contentDescription = null, size = IconSize.Xs, tint = accent)
            Text(label, style = MaterialTheme.typography.labelSmall)
        }
    }
}

/**
 * The web Textarea inputSlot: the multi-line question prompt. The web `aria-label` ("Your question") maps to
 * the field [Textarea] `label` (announced + floats), and the web in-field example text maps to the field
 * `hint` (Material 3 supporting text). The input stays enabled while streaming so the user can refine the next
 * question; the in-flight request already captured its body at ask time (web parity).
 */
@Composable
private fun QuestionInput(
    question: String,
    streaming: Boolean,
    onQuestionChange: (String) -> Unit,
) {
    Textarea(
        value = question,
        onValueChange = onQuestionChange,
        modifier = Modifier.fillMaxWidth(),
        label = stringResource(R.string.translation_lifetime_aiQA_inputLabel),
        hint = stringResource(R.string.translation_lifetime_aiQA_placeholder), // parity:allow i18n key name
        enabled = !streaming,
        minLines = QUESTION_MIN_LINES,
        maxLines = QUESTION_MAX_LINES,
    )
}

/**
 * The right-aligned Ask action — the web AIFeatureCard button. Disabled without a vehicle + valid question
 * (web `canStart`) or while a stream is open; the in-flight spinner is the native counterpart of the web
 * "Helix is thinking…" busy label. The button's accessible name is the localized "Ask" verb.
 */
@Composable
private fun QaActionRow(
    canStart: Boolean,
    streaming: Boolean,
    onAsk: () -> Unit,
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Button(
            label = stringResource(R.string.translation_lifetime_aiQA_askButton),
            onClick = onAsk,
            variant = ButtonVariant.Outline,
            size = ButtonSize.Sm,
            enabled = canStart && !streaming,
            loading = streaming,
            leadingIcon = AiQaGlyphs.Helix,
        )
    }
}

/**
 * The web AiOutputPanel: the bordered output region. Renders nothing while resting (the web panel is absent
 * until a stream runs) and otherwise a bordered panel carrying the per-state body + a polite live-region
 * announcement so TalkBack reads streamed/failed output as it changes.
 */
@Composable
private fun QaOutput(
    surface: QaSurface,
    onRetry: () -> Unit,
) {
    if (surface is QaSurface.Resting || surface is QaSurface.Hidden) return
    val labels =
        QaOutputLabels(
            working = stringResource(R.string.translation_chatbot_thinking),
            empty = stringResource(R.string.translation_common_noData),
            stale = stringResource(R.string.translation_mqtt_stale),
            offline = stringResource(R.string.translation_common_offline),
            error = stringResource(R.string.translation_queryError_title),
        )
    OutputPanel(accessibilityLabel = outputAccessibilityLabel(surface, labels)) {
        when (surface) {
            QaSurface.Working -> ThinkingIndicator()
            is QaSurface.Live -> QaAnswer(surface.text)
            is QaSurface.Ready -> ReadyBody(text = surface.text, stale = surface.stale)
            QaSurface.Empty -> EmptyBody()
            is QaSurface.Cached -> CachedBody(text = surface.text, offline = surface.offline, onRetry = onRetry)
            is QaSurface.Failed -> FailedBody(offline = surface.offline, onRetry = onRetry)
            QaSurface.Hidden, is QaSurface.Resting -> Unit
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
            Icon(AiQaGlyphs.Helix, contentDescription = null, size = IconSize.Md, tint = accent)
            Caption(stringResource(R.string.translation_chatbot_thinking))
        }
        if (!rememberReducedMotion()) {
            SkeletonLines(lines = 3)
        }
    }
}

/** The streamed answer prose — the web `whitespace-pre-wrap` text; Compose preserves line breaks. */
@Composable
private fun QaAnswer(text: String) {
    BodyText(text, modifier = Modifier.fillMaxWidth())
}

/** The completed answer, preceded by a stale chip when the fetch is older than the freshness window. */
@Composable
private fun ReadyBody(
    text: String,
    stale: Boolean,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        if (stale) {
            FreshnessChip(offline = false)
        }
        QaAnswer(text)
    }
}

/** The friendly empty body shown when an ask completed with no text (never a blank box). */
@Composable
private fun EmptyBody() {
    EmptyState(message = stringResource(R.string.translation_common_noData))
}

/** A failed re-ask that keeps the last-known answer visible with an offline/stale chip + retry. */
@Composable
private fun CachedBody(
    text: String,
    offline: Boolean,
    onRetry: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        FreshnessChip(offline = offline)
        QaAnswer(text)
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
            AiQaGlyphs.Helix,
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
 * at render time by the [Icon] tint — exactly as the sibling AICostForecastNarration authors its Helix mark.
 */
private object AiQaGlyphs {
    val Helix: ImageVector =
        stroked("AILifetimeStatsHelix") {
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
private const val PREVIEW_QUESTION = "How far have I driven in total, and how much have I saved on fuel?"
private const val PREVIEW_ANSWER =
    "You've driven 48,210 km across 1,204 trips since you added this vehicle. Home charging covered about " +
        "82% of your energy and saved an estimated 3,140 in fuel versus a comparable petrol car. Your longest " +
        "single drive was 612 km, and your best month for efficiency was last April at 142 Wh/km."

@Preview(name = "Resting — ready to ask", showBackground = true)
@Composable
private fun AILifetimeStatsQARestingReadyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AILifetimeStatsQAContent(
            state = AiQaState(vehicleId = 1L, question = PREVIEW_QUESTION),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Resting — needs a question", showBackground = true)
@Composable
private fun AILifetimeStatsQARestingNeedsQuestionPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AILifetimeStatsQAContent(
            state = AiQaState(vehicleId = 1L, question = ""),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Resting — no vehicle", showBackground = true)
@Composable
private fun AILifetimeStatsQANoVehiclePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AILifetimeStatsQAContent(
            state = AiQaState(vehicleId = null, question = PREVIEW_QUESTION),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Working — thinking", showBackground = true)
@Composable
private fun AILifetimeStatsQAWorkingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AILifetimeStatsQAContent(
            state = AiQaState(vehicleId = 1L, question = PREVIEW_QUESTION, phase = QaPhase.Streaming),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Streaming — live answer", showBackground = true)
@Composable
private fun AILifetimeStatsQALivePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AILifetimeStatsQAContent(
            state =
                AiQaState(
                    vehicleId = 1L,
                    question = PREVIEW_QUESTION,
                    phase = QaPhase.Streaming,
                    streamingText = PREVIEW_ANSWER,
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Ready — fresh", showBackground = true)
@Composable
private fun AILifetimeStatsQAReadyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AILifetimeStatsQAContent(
            state =
                AiQaState(
                    vehicleId = 1L,
                    question = PREVIEW_QUESTION,
                    phase = QaPhase.Done,
                    committedText = PREVIEW_ANSWER,
                    fetchedAt = PREVIEW_FRESH_FETCHED_AT,
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Ready — stale", showBackground = true)
@Composable
private fun AILifetimeStatsQAStalePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AILifetimeStatsQAContent(
            state =
                AiQaState(
                    vehicleId = 1L,
                    question = PREVIEW_QUESTION,
                    phase = QaPhase.Done,
                    committedText = PREVIEW_ANSWER,
                    fetchedAt = PREVIEW_STALE_FETCHED_AT,
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Empty — blank result", showBackground = true)
@Composable
private fun AILifetimeStatsQAEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AILifetimeStatsQAContent(
            state =
                AiQaState(
                    vehicleId = 1L,
                    question = PREVIEW_QUESTION,
                    phase = QaPhase.Done,
                    committedText = "",
                    fetchedAt = PREVIEW_FRESH_FETCHED_AT,
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Offline — last known", showBackground = true)
@Composable
private fun AILifetimeStatsQAOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AILifetimeStatsQAContent(
            state =
                AiQaState(
                    vehicleId = 1L,
                    question = PREVIEW_QUESTION,
                    phase = QaPhase.Failed,
                    committedText = PREVIEW_ANSWER,
                    errorKind = ErrorKind.Network,
                    fetchedAt = PREVIEW_STALE_FETCHED_AT,
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Error — retry", showBackground = true)
@Composable
private fun AILifetimeStatsQAErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AILifetimeStatsQAContent(
            state =
                AiQaState(
                    vehicleId = 1L,
                    question = PREVIEW_QUESTION,
                    phase = QaPhase.Failed,
                    errorKind = ErrorKind.Http,
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}
