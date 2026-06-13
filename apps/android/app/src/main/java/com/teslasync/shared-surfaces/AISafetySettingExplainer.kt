// File hosts the AISafetySettingExplainer Compose surface (stateful + stateless + per-state previews);
// named after the surface rather than a single declaration.
//
// It is the native Android (Jetpack Compose / Material 3) parity port of the web AI narration card
// (web/src/components/ai/AISafetySettingExplainer.tsx): the `withAiFeature` gate (renders nothing when
// the AI feature is off — ADR-015), the `AIFeatureCard` scaffold (title + Helix badge + description +
// action button), and the `AiOutputPanel` (a "Helix is thinking" skeleton while streaming, the streamed
// narration text once it arrives, a classified error/offline surface with retry on failure). The web
// surface is a NARRATIVE explainer: Helix explains the user's existing safety settings in plain English;
// it never proposes or changes a value, so there is no "apply" affordance.
//
// All data flows through the [AISafetySettingExplainerViewModel] (P1/S8); the view performs no HTTP.
// Every string resolves from the P1/S10 catalog and every control carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/AISafetySettingExplainer) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless content + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aisafetysettingexplainer

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.SkeletonLines
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.StatusPill
import io.teslasync.android.components.ui.StatusTone
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Stateful entry point — collects the [AISafetySettingExplainerViewModel] state, emits the one-shot
 * `view.opened` diagnostic on first composition (P1/S11), and renders the stateless content.
 *
 * @param viewModel the state holder bound to the shared settings holder + the stream seam.
 */
@Composable
fun AISafetySettingExplainer(
    viewModel: AISafetySettingExplainerViewModel,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { viewModel.onViewOpened() }
    AISafetySettingExplainerContent(
        state = state,
        strings = rememberExplainerStrings(),
        modifier = modifier,
        onExplain = viewModel::explain,
        onCancel = viewModel::cancel,
        onRetry = viewModel::retry,
    )
}

/**
 * Stateless narration card — renders every branch the web source does: nothing when the AI feature is
 * off (web `withAiFeature` → `null`), otherwise the GlassPanel scaffold with the header, the action
 * button (a spinner + Cancel while streaming), and the output region (idle → none, streaming → thinking
 * skeleton, content → narration text, error/offline → classified retry surface). Hoisted out of the
 * ViewModel so it is preview- and screenshot-testable for each state.
 */
@Composable
fun AISafetySettingExplainerContent(
    state: AISafetySettingExplainerState,
    strings: AISafetySettingExplainerStrings,
    modifier: Modifier = Modifier,
    onExplain: () -> Unit = {},
    onCancel: () -> Unit = {},
    onRetry: () -> Unit = {},
) {
    // The AI-Off gate: a disabled feature renders nothing at all (web `withAiFeature` returns null;
    // ADR-015 off-contract — no AI surface leaks into the tree).
    if (!state.gateEnabled) return
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            ExplainerHeader(strings = strings)
            ExplainerActionRow(state = state, strings = strings, onExplain = onExplain, onCancel = onCancel)
            ExplainerOutput(state = state, strings = strings, onRetry = onRetry)
        }
    }
}

@Composable
private fun ExplainerHeader(strings: AISafetySettingExplainerStrings) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            PanelTitle(
                strings.title,
                modifier = Modifier.weight(1f, fill = false).semantics { heading() },
            )
            StatusPill(text = strings.badge, tone = StatusTone.Info)
        }
        BodyText(strings.description, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun ExplainerActionRow(
    state: AISafetySettingExplainerState,
    strings: AISafetySettingExplainerStrings,
    onExplain: () -> Unit,
    onCancel: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm, alignment = Alignment.End),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (state.isStreaming) {
            Button(
                label = strings.cancelLabel,
                onClick = onCancel,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )
        }
        Button(
            label = strings.explainButton,
            onClick = onExplain,
            variant = ButtonVariant.Outline,
            size = ButtonSize.Sm,
            enabled = state.canStart,
            loading = state.isStreaming,
            leadingIcon = HelixSparkGlyph,
        )
    }
}

@Composable
private fun ExplainerOutput(
    state: AISafetySettingExplainerState,
    strings: AISafetySettingExplainerStrings,
    onRetry: () -> Unit,
) {
    when (AISafetySettingExplainerProjection.explainSurface(state)) {
        // Idle (and the unreachable Hidden, already gated above): no output panel — the populated header
        // + description + action button are the surface, never a blank box (web AiOutputPanel → null when idle).
        ExplainSurface.Hidden, ExplainSurface.Idle -> Unit
        ExplainSurface.Streaming -> ExplainerThinking(strings = strings)
        ExplainSurface.Content -> ExplainerText(text = state.text)
        ExplainSurface.Error ->
            QueryError(
                kind =
                    AISafetySettingExplainerProjection.explainQueryErrorKind(
                        state.error ?: ExplainError(message = null),
                    ),
                resourceName = strings.title,
                onRetry = onRetry,
            )
    }
}

@Composable
private fun ExplainerThinking(strings: AISafetySettingExplainerStrings) {
    ExplainerOutputBox {
        Column(
            modifier = Modifier.semantics { contentDescription = strings.loadingLabel },
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            StatusPill(text = strings.streamingLabel, tone = StatusTone.Info, pulse = true)
            SkeletonLines(lines = THINKING_LINES)
        }
    }
}

@Composable
private fun ExplainerText(text: String) {
    ExplainerOutputBox {
        SelectionContainer {
            BodyText(text, color = MaterialTheme.colorScheme.onSurface)
        }
    }
}

@Composable
private fun ExplainerOutputBox(content: @Composable () -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(OUTPUT_RADIUS),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = OUTPUT_BG_ALPHA),
        border = BorderStroke(OUTPUT_BORDER, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(modifier = Modifier.padding(Spacing.md)) { content() }
    }
}

/** Builds the localized labels from the P1/S10 catalog; tests pass a deterministic instance. */
@Composable
private fun rememberExplainerStrings(): AISafetySettingExplainerStrings =
    AISafetySettingExplainerStrings(
        title = stringResource(R.string.translation_safetySettings_aiExplainer_title),
        description = stringResource(R.string.translation_safetySettings_aiExplainer_description),
        explainButton = stringResource(R.string.translation_safetySettings_aiExplainer_button),
        badge = stringResource(R.string.translation_safetySettings_aiExplainer_badge),
        streamingLabel = stringResource(R.string.translation_Streaming),
        loadingLabel = stringResource(R.string.translation_a11y_loading),
        cancelLabel = stringResource(R.string.translation_common_cancel),
    )

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f

// The web HelixMark is a custom brand SVG; the data-display layer has no AI glyph, so the spark is
// authored here as a filled 24×24 four-point star (mirrors the inline-glyph approach in SpeedProfileWidget).
private val HelixSparkGlyph: ImageVector =
    ImageVector
        .Builder(
            name = "HelixSpark",
            defaultWidth = GLYPH_SIZE,
            defaultHeight = GLYPH_SIZE,
            viewportWidth = GLYPH_VIEWPORT,
            viewportHeight = GLYPH_VIEWPORT,
        ).apply {
            path(fill = SolidColor(Color.Black)) {
                moveTo(12f, 2f)
                lineTo(13.6f, 10.4f)
                lineTo(22f, 12f)
                lineTo(13.6f, 13.6f)
                lineTo(12f, 22f)
                lineTo(10.4f, 13.6f)
                lineTo(2f, 12f)
                lineTo(10.4f, 10.4f)
                close()
            }
        }.build()

private const val THINKING_LINES = 3
private val OUTPUT_RADIUS = 12.dp
private val OUTPUT_BORDER = 1.dp
private const val OUTPUT_BG_ALPHA = 0.4f

// ── Previews — one per rendered state (idle / streaming / content / error / off). ─────────────────

private const val PREVIEW_NARRATION =
    "Sentry Mode is on and Speed Limit Mode is off. Your cabin overheat protection keeps the interior " +
        "below 40 °C, and PIN to Drive is disabled. These are the current safety-related toggles on this " +
        "page — Helix only describes them; change any value yourself using the controls below."

@Preview(name = "Explainer · idle", showBackground = true)
@Composable
private fun ExplainerIdlePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AISafetySettingExplainerContent(
            state = AISafetySettingExplainerState(gateEnabled = true),
            strings = rememberExplainerStrings(),
        )
    }
}

@Preview(name = "Explainer · streaming", showBackground = true)
@Composable
private fun ExplainerStreamingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AISafetySettingExplainerContent(
            state =
                AISafetySettingExplainerState(
                    gateEnabled = true,
                    phase = ExplainPhase.Streaming,
                ),
            strings = rememberExplainerStrings(),
        )
    }
}

@Preview(name = "Explainer · content", showBackground = true)
@Composable
private fun ExplainerContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AISafetySettingExplainerContent(
            state =
                AISafetySettingExplainerState(
                    gateEnabled = true,
                    phase = ExplainPhase.Done,
                    text = PREVIEW_NARRATION,
                ),
            strings = rememberExplainerStrings(),
        )
    }
}

@Preview(name = "Explainer · error", showBackground = true)
@Composable
private fun ExplainerErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AISafetySettingExplainerContent(
            state =
                AISafetySettingExplainerState(
                    gateEnabled = true,
                    phase = ExplainPhase.Error,
                    error = ExplainError(message = "stream_http_503", kind = ErrorKind.Http, httpStatus = 503),
                ),
            strings = rememberExplainerStrings(),
        )
    }
}
