// The native Jetpack Compose + Material 3 AIMqttSseInspectorExplanations shared surface — a parity port of
// web/src/components/ai/AIMqttSseInspectorExplanations.tsx and the `@/components/ai/AIFeatureCard` + `AiOutputPanel`
// scaffold it renders. The web surface is a "header + Explain-streams button + streaming output" AI card: a
// Helix-branded title + badge + description, an action button that opens an SSE stream to
// /ai/system/streams/explain over the in-scope (from_unix, to_unix) window, and an output panel that shows an
// animated thinking indicator until the first delta, then the streamed explanation (or an inline error). The
// whole card is wrapped by `withAiFeature('mqtt-sse-inspector-explanations', …)`, which renders nothing when the
// AI feature is gated off.
//
// The atomic AIFeatureCard / withAiFeature scaffold is the out-of-scope P3 component-library bundle, so the card
// scaffold + gate are reproduced here from the shared atoms (GlassPanel, Button, typography, EmptyState,
// ErrorText, SkeletonLines) — the same approach the sibling AICostForecastNarration takes. All data flows
// through the shared [AIMqttSseInspectorExplanationsViewModel] (P1/S8); the view performs NO HTTP. Every visible
// string resolves through the i18n catalog (P1/S10) and the surfaces carry merged TalkBack descriptions.
//
// Parity-with-honesty (Honesty Covenant #9, documented not silent): the web gate renders `null` when AI is off —
// reproduced as the early return on [ExplainerSurface.Hidden]. Every other state renders a non-blank surface
// (the resting card, the thinking indicator, the streamed prose, a friendly empty body, a stale/offline
// last-known body, or a QueryError-equivalent with retry), folding the useAiStream lifecycle onto the P3
// loading / empty / content / error / stale / offline contract (see AIMqttSseInspectorExplanationsModel.kt). The
// deterministic broker-status snapshot table the web keeps above the explainer is owned by the host
// MQTTInspectorPage and is out of this surface's scope (ADR-015 §I3).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aimqttsseinspectorexplanations

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
 * Stateful entry point — the faithful port of the web `AIMqttSseInspectorExplanations` surface. Binds the AI
 * gate + explain stream via [source] into an [AIMqttSseInspectorExplanationsViewModel], records the one-shot
 * `view.opened` diagnostic, threads the host's explanation window ([fromUnix]..[toUnix], web InnerSection's
 * `fromUnix` / `toUnix` props), collects the live state, and renders the card. The surface performs no HTTP;
 * [logger] defaults to the process logger and [instanceKey] scopes the ViewModel per placement.
 *
 * @param fromUnix inclusive window start in Unix seconds (web prop); an invalid window disables the action.
 * @param toUnix inclusive window end in Unix seconds (web prop); must be greater than [fromUnix] to enable it.
 */
@Composable
fun AIMqttSseInspectorExplanations(
    source: AIMqttSseInspectorExplanationsSource,
    fromUnix: Long?,
    toUnix: Long?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = AI_MQTT_SSE_INSPECTOR_EXPLANATIONS_SLUG,
) {
    val viewModel: AIMqttSseInspectorExplanationsViewModel =
        viewModel(key = instanceKey, factory = AIMqttSseInspectorExplanationsViewModel.factory(source, logger))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    LaunchedEffect(viewModel, fromUnix, toUnix) { viewModel.setWindow(fromUnix, toUnix) }
    val state by viewModel.state.collectAsStateWithLifecycle()

    AIMqttSseInspectorExplanationsContent(
        state = state,
        modifier = modifier,
        onGenerate = viewModel::generate,
        onRetry = viewModel::retry,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Classifies [state] into
 * an [ExplainerSurface] and renders the AI card, or renders nothing when the AI feature is gated off (web
 * `withAiFeature` → `null`). The card chrome (title + Helix badge + description + action) is always present when
 * the gate is on; the output region switches per surface.
 *
 * @param nowMs wall-clock seam for the freshness check (web `Date.now()`); injectable for tests/previews.
 */
@Composable
fun AIMqttSseInspectorExplanationsContent(
    state: MqttExplainerState,
    modifier: Modifier = Modifier,
    onGenerate: () -> Unit = {},
    onRetry: () -> Unit = {},
    nowMs: () -> Long = { System.currentTimeMillis() },
) {
    val surface = classifyExplainer(state, nowMs())
    if (surface is ExplainerSurface.Hidden) return
    ExplainerCard(
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
private fun ExplainerCard(
    surface: ExplainerSurface,
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
            ExplainerHeader(canStart = canStart)
            ExplainerActionRow(canStart = canStart, streaming = streaming, onGenerate = onGenerate)
            ExplainerOutput(surface = surface, onRetry = onRetry)
        }
    }
}

/**
 * The web card header: the title + the Helix badge on one row, then the description, merged for TalkBack. When
 * the window is not yet valid (web `emptyHint = haveWindow ? undefined : t(…)`), a subtle hint Caption explains
 * why the action is disabled.
 */
@Composable
private fun ExplainerHeader(canStart: Boolean) {
    val title = stringResource(R.string.translation_mqttSseInspector_aiExplainer_title)
    val badge = stringResource(R.string.translation_mqttSseInspector_aiExplainer_badge)
    val description = stringResource(R.string.translation_mqttSseInspector_aiExplainer_description)
    val emptyHint = stringResource(R.string.translation_mqttSseInspector_aiExplainer_emptyHint)
    val mergedDescription = if (canStart) description else "$description $emptyHint"
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .semantics(mergeDescendants = true) {
                    contentDescription = headerAccessibilityLabel(title, badge, mergedDescription)
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
        if (!canStart) {
            Caption(emptyHint)
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
            Icon(AiExplainerGlyphs.Helix, contentDescription = null, size = IconSize.Xs, tint = accent)
            Text(label, style = MaterialTheme.typography.labelSmall)
        }
    }
}

/**
 * The right-aligned "Explain streams" action — the web AIFeatureCard button. Disabled without a valid window
 * (web `canStart`) or while a stream is open; the in-flight spinner is the native counterpart of the web "Helix
 * is thinking…" busy label. The button's accessible name is the localized action verb.
 */
@Composable
private fun ExplainerActionRow(
    canStart: Boolean,
    streaming: Boolean,
    onGenerate: () -> Unit,
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Button(
            label = stringResource(R.string.translation_mqttSseInspector_aiExplainer_button),
            onClick = onGenerate,
            variant = ButtonVariant.Outline,
            size = ButtonSize.Sm,
            enabled = canStart && !streaming,
            loading = streaming,
            leadingIcon = AiExplainerGlyphs.Helix,
        )
    }
}

/**
 * The web AiOutputPanel: the bordered output region. Renders nothing while resting (the web panel is absent
 * until a stream runs) and otherwise a bordered panel carrying the per-state body + a polite live-region
 * announcement so TalkBack reads streamed/failed output as it changes.
 */
@Composable
private fun ExplainerOutput(
    surface: ExplainerSurface,
    onRetry: () -> Unit,
) {
    if (surface is ExplainerSurface.Resting || surface is ExplainerSurface.Hidden) return
    val labels =
        ExplainerOutputLabels(
            working = stringResource(R.string.translation_chatbot_thinking),
            empty = stringResource(R.string.translation_common_noData),
            stale = stringResource(R.string.translation_mqtt_stale),
            offline = stringResource(R.string.translation_common_offline),
            error = stringResource(R.string.translation_queryError_title),
        )
    OutputPanel(accessibilityLabel = outputAccessibilityLabel(surface, labels)) {
        when (surface) {
            ExplainerSurface.Working -> ThinkingIndicator()
            is ExplainerSurface.Live -> ExplainerProse(surface.text)
            is ExplainerSurface.Ready -> ReadyBody(text = surface.text, stale = surface.stale)
            ExplainerSurface.Empty -> EmptyBody()
            is ExplainerSurface.Cached -> CachedBody(text = surface.text, offline = surface.offline, onRetry = onRetry)
            is ExplainerSurface.Failed -> FailedBody(offline = surface.offline, onRetry = onRetry)
            ExplainerSurface.Hidden, is ExplainerSurface.Resting -> Unit
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
            Icon(AiExplainerGlyphs.Helix, contentDescription = null, size = IconSize.Md, tint = accent)
            Caption(stringResource(R.string.translation_chatbot_thinking))
        }
        if (!rememberReducedMotion()) {
            SkeletonLines(lines = 3)
        }
    }
}

/** The streamed explanation prose — the web `whitespace-pre-wrap` text; Compose preserves line breaks. */
@Composable
private fun ExplainerProse(text: String) {
    BodyText(text, modifier = Modifier.fillMaxWidth())
}

/** The completed explanation, preceded by a stale chip when the fetch is older than the freshness window. */
@Composable
private fun ReadyBody(
    text: String,
    stale: Boolean,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        if (stale) {
            FreshnessChip(offline = false)
        }
        ExplainerProse(text)
    }
}

/** The friendly empty body shown when a generation completed with no text (never a blank box). */
@Composable
private fun EmptyBody() {
    EmptyState(message = stringResource(R.string.translation_common_noData))
}

/** A failed regenerate that keeps the last-known explanation visible with an offline/stale chip + retry. */
@Composable
private fun CachedBody(
    text: String,
    offline: Boolean,
    onRetry: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        FreshnessChip(offline = offline)
        ExplainerProse(text)
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
            AiExplainerGlyphs.Helix,
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
 * `HelixMark`. It is absent from the shared [io.teslasync.android.components.ui.TeslaGlyphs] catalog and outside
 * this surface's allowed-files scope, so it is drawn here as a 24×24 stroked [ImageVector] recolored at render
 * time by the [Icon] tint — exactly as the sibling AICostForecastNarration authors its Helix mark.
 */
private object AiExplainerGlyphs {
    val Helix: ImageVector =
        stroked("AIMqttSseInspectorHelix") {
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
private val PREVIEW_WINDOW = ExplainerWindow(fromUnix = 1_700_000_000L, toUnix = 1_700_001_800L)
private const val PREVIEW_TEXT =
    "The MQTT broker is connected with three vehicles streaming telemetry; the SSE hub has two live clients and " +
        "the background jobs ran within the last minute. Throughput is steady at roughly 40 messages a second " +
        "across the fleet, with no per-vehicle stream stalled. This explanation reads the deterministic " +
        "broker-status envelope only; the snapshot table above remains the canonical raw view."

@Preview(name = "Resting — ready", showBackground = true)
@Composable
private fun AIMqttSseInspectorExplanationsRestingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIMqttSseInspectorExplanationsContent(
            state = MqttExplainerState(window = PREVIEW_WINDOW),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Resting — no window", showBackground = true)
@Composable
private fun AIMqttSseInspectorExplanationsNoWindowPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIMqttSseInspectorExplanationsContent(
            state = MqttExplainerState(window = ExplainerWindow()),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Working — thinking", showBackground = true)
@Composable
private fun AIMqttSseInspectorExplanationsWorkingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIMqttSseInspectorExplanationsContent(
            state = MqttExplainerState(window = PREVIEW_WINDOW, phase = ExplainerPhase.Streaming),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Streaming — live text", showBackground = true)
@Composable
private fun AIMqttSseInspectorExplanationsLivePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIMqttSseInspectorExplanationsContent(
            state =
                MqttExplainerState(
                    window = PREVIEW_WINDOW,
                    phase = ExplainerPhase.Streaming,
                    streamingText = PREVIEW_TEXT,
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Ready — fresh", showBackground = true)
@Composable
private fun AIMqttSseInspectorExplanationsReadyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIMqttSseInspectorExplanationsContent(
            state =
                MqttExplainerState(
                    window = PREVIEW_WINDOW,
                    phase = ExplainerPhase.Done,
                    committedText = PREVIEW_TEXT,
                    fetchedAt = PREVIEW_FRESH_FETCHED_AT,
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Ready — stale", showBackground = true)
@Composable
private fun AIMqttSseInspectorExplanationsStalePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIMqttSseInspectorExplanationsContent(
            state =
                MqttExplainerState(
                    window = PREVIEW_WINDOW,
                    phase = ExplainerPhase.Done,
                    committedText = PREVIEW_TEXT,
                    fetchedAt = PREVIEW_STALE_FETCHED_AT,
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Empty — no output", showBackground = true)
@Composable
private fun AIMqttSseInspectorExplanationsEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIMqttSseInspectorExplanationsContent(
            state =
                MqttExplainerState(
                    window = PREVIEW_WINDOW,
                    phase = ExplainerPhase.Done,
                    committedText = "",
                    fetchedAt = PREVIEW_FRESH_FETCHED_AT,
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Cached — offline last known", showBackground = true)
@Composable
private fun AIMqttSseInspectorExplanationsCachedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIMqttSseInspectorExplanationsContent(
            state =
                MqttExplainerState(
                    window = PREVIEW_WINDOW,
                    phase = ExplainerPhase.Failed,
                    committedText = PREVIEW_TEXT,
                    errorKind = ErrorKind.Network,
                    fetchedAt = PREVIEW_FRESH_FETCHED_AT,
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}

@Preview(name = "Failed — error retry", showBackground = true)
@Composable
private fun AIMqttSseInspectorExplanationsFailedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIMqttSseInspectorExplanationsContent(
            state =
                MqttExplainerState(
                    window = PREVIEW_WINDOW,
                    phase = ExplainerPhase.Failed,
                    errorKind = ErrorKind.Http,
                ),
            nowMs = { PREVIEW_NOW_MS },
        )
    }
}
