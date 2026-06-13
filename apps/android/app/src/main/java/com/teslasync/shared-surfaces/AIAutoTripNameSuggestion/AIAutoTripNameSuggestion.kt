// The native Jetpack Compose + Material 3 AIAutoTripNameSuggestion shared surface — a parity port of the
// propose-only "Suggest a trip name" Helix card on the trip-detail page (web/src/components/ai/
// AIAutoTripNameSuggestion.tsx, rendered through AIFeatureCard + AiOutputPanel and gated by withAiFeature).
//
// The web component asks Helix for a short, propose-only trip name over a POST Server-Sent-Events stream and
// streams the suggestion into an output panel, surfacing the useAiStream idle → streaming → done / error
// lifecycle. This port keeps that contract end to end and adds the honest connectivity affordance the P3
// shared-surface contract requires of an action surface: the card always renders its title, the Helix badge,
// and the propose-only description (never a blank box); the "Suggest a name" action streams the proposal into
// a bordered output panel that shows an animated thinking indicator while the first delta is awaited, the
// accumulated proposal once text arrives, and an inline error with a Retry affordance on failure; and an
// offline chip plus a disabled action when there is no connectivity. The withAiFeature off-mode gate is
// reproduced faithfully — the surface renders nothing when AI is off or the feature is not opted in.
//
// Binding (P1/S8): this view performs NO HTTP. The stateful entry owns an AutoTripNameDraftController (the
// useAiStream analogue) over a host-supplied TripNameDraftTransport seam and the settings store, resolves the
// off-mode gate + i18n labels (P1/S10) + tokens (P1/S9), records the PII-safe `view.opened` diagnostic
// (P1/S11), and draws the stateless renderer. Every figure/lifecycle decision flows through the pure model.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/AIAutoTripNameSuggestion) cannot form a valid Kotlin package identifier, so
// the package intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aiautotripnamesuggestion

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.feedback.SkeletonLines
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Low-alpha wash behind the bordered output panel (web `bg-white/[0.02]`); a subtle inset, not a solid fill. */
private const val OUTPUT_WASH_ALPHA: Float = 0.04f

/**
 * Stateful entry point — the faithful port of the web `AIAutoTripNameSuggestion` (the withAiFeature-wrapped
 * card owning a `useAiStream`). Reads the settings document from the shared store (P1/S8) to apply the
 * off-mode gate, and renders nothing when AI is off or the `auto-trip-naming` feature is not opted in — the
 * withAiFeature contract (ADR-015). When enabled it owns an [AutoTripNameDraftController] over the host-
 * supplied [transport], records `view.opened` once, cancels the stream on disposal (the web AbortController-
 * on-unmount path), and draws [AIAutoTripNameSuggestionContent].
 *
 * @param tripId the trip being named (web `tripId` prop); a blank id disables the action.
 * @param transport the SSE seam the host wires to the shared resilient client (production Ktor POST reader).
 * @param online whether connectivity is available; offline disables the action and shows the offline chip.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun AIAutoTripNameSuggestion(
    tripId: String?,
    transport: TripNameDraftTransport,
    modifier: Modifier = Modifier,
    online: Boolean = true,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val settings by LocalDataContainer.current.settingsStore
        .settings()
        .collectAsStateWithLifecycle()
    val enabled = remember(settings) { isAutoTripNamingEnabled(settings.cached) }
    if (!enabled) return

    val scope = rememberCoroutineScope()
    val controller =
        remember(transport, tripId, online, scope, logger) {
            AutoTripNameDraftController(transport, tripId, online, scope, logger)
        }
    LaunchedEffect(controller) { controller.recordViewOpened() }
    DisposableEffect(controller) { onDispose { controller.cancel() } }

    val state by controller.state.collectAsStateWithLifecycle()
    AIAutoTripNameSuggestionContent(
        state = state,
        canStart = controller.canStart,
        online = online,
        onSuggest = controller::suggest,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Reproduces the web card
 * (title + Helix badge, propose-only description, action button, streaming output panel) and adds the honest
 * offline affordance the P3 contract requires. The card chrome is always present so the surface is never a
 * blank box; the output panel renders only once a stream has run (web `AiOutputPanel` `hasAnything` rule).
 *
 * @param state the stream lifecycle (web `useAiStream` `{ state, text, error }`).
 * @param canStart whether the action can fire (web `canStart`, plus offline gating).
 * @param online whether connectivity is available; drives the offline chip.
 * @param onSuggest opens the draft stream (web `stream.start`); also the failed-state retry.
 */
@Composable
fun AIAutoTripNameSuggestionContent(
    state: TripNameDraftUiState,
    canStart: Boolean,
    online: Boolean,
    onSuggest: () -> Unit,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Lg) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            DraftHeader(online = online)
            BodyText(
                text = stringResource(R.string.translation_trips_detail_aiSuggestName_description),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            DraftAction(state = state, canStart = canStart, onSuggest = onSuggest)
            DraftOutput(state = state, onRetry = onSuggest)
        }
    }
}

/** Title + Helix badge (web header), with an offline chip appended when connectivity is unavailable. */
@Composable
private fun DraftHeader(online: Boolean) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Heading(
            text = stringResource(R.string.translation_trips_detail_aiSuggestName_title),
            modifier = Modifier.weight(1f).semantics { heading() },
            level = HeadingLevel.Panel,
        )
        Badge(
            text = stringResource(R.string.translation_trips_detail_aiSuggestName_badge),
            variant = BadgeVariant.Info,
        )
        if (!online) {
            Badge(
                text = stringResource(R.string.translation_common_offline),
                variant = BadgeVariant.Warning,
                dot = true,
            )
        }
    }
}

/**
 * The right-aligned "Suggest a name" action (web `buttonLabel`). Disabled while a stream is in flight or when
 * the action cannot start (no trip / offline); the in-flight spinner is the web "Helix is thinking…" affordance.
 */
@Composable
private fun DraftAction(
    state: TripNameDraftUiState,
    canStart: Boolean,
    onSuggest: () -> Unit,
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Button(
            label = stringResource(R.string.translation_trips_detail_aiSuggestName_generateButton),
            onClick = onSuggest,
            variant = ButtonVariant.Outline,
            size = ButtonSize.Sm,
            enabled = canStart && !state.isStreaming,
            loading = state.isStreaming,
        )
    }
}

/**
 * The streamed-output panel — a port of the web `AiOutputPanel`. Renders nothing until a stream has run, then
 * shows an inline error + retry on failure, an animated thinking indicator while awaiting the first delta,
 * or the accumulated proposed name once text arrives.
 */
@Composable
private fun DraftOutput(
    state: TripNameDraftUiState,
    onRetry: () -> Unit,
) {
    if (!state.hasOutput) return
    OutputContainer {
        when {
            state.isFailed -> DraftError(message = state.error, onRetry = onRetry)
            state.isStreaming && !state.hasSuggestion -> DraftThinking()
            else -> DraftSuggestion(text = state.suggestion)
        }
    }
}

/** Bordered, low-wash inset that frames the streamed output (web `rounded-lg border bg-white/[0.02] p-4`). */
@Composable
private fun OutputContainer(content: @Composable ColumnScope.() -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = OUTPUT_WASH_ALPHA),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(modifier = Modifier.padding(Spacing.md), content = content)
    }
}

/** The pending thinking indicator shown while the stream is open but no text has arrived (web `AIThinkingIndicator`). */
@Composable
private fun DraftThinking() {
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = Modifier.semantics { stateDescription = loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Spinner(size = SpinnerSize.Sm, label = loadingLabel)
            Caption(stringResource(R.string.translation_common_loading))
        }
        SkeletonLines(lines = SKELETON_LINES)
    }
}

/** The accumulated proposed name (web `whitespace-pre-wrap` streamed text). */
@Composable
private fun DraftSuggestion(text: String) {
    BodyText(text = text, modifier = Modifier.fillMaxWidth())
}

/** Inline terminal-error message + retry (web `AiOutputPanel` error branch + the action re-firing). */
@Composable
private fun DraftError(
    message: String?,
    onRetry: () -> Unit,
) {
    val detail = message?.takeIf { it.isNotBlank() } ?: stringResource(R.string.translation_common_unknown)
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        ErrorText("${stringResource(R.string.translation_Error)}: $detail")
        Button(
            label = stringResource(R.string.translation_common_retry),
            onClick = onRetry,
            variant = ButtonVariant.Outline,
            size = ButtonSize.Sm,
        )
    }
}

/** Skeleton line count for the pending thinking indicator (a short two-line shimmer for a one-line proposal). */
private const val SKELETON_LINES: Int = 2

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

@Preview(name = "Idle — ready", showBackground = true, widthDp = 420)
@Composable
private fun DraftIdlePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIAutoTripNameSuggestionContent(
            state = TripNameDraftUiState.IDLE,
            canStart = true,
            online = true,
            onSuggest = {},
        )
    }
}

@Preview(name = "Streaming — thinking", showBackground = true, widthDp = 420)
@Composable
private fun DraftStreamingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIAutoTripNameSuggestionContent(
            state = TripNameDraftUiState(phase = DraftPhase.Streaming),
            canStart = true,
            online = true,
            onSuggest = {},
        )
    }
}

@Preview(name = "Done — proposed name", showBackground = true, widthDp = 420)
@Composable
private fun DraftDonePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIAutoTripNameSuggestionContent(
            state = TripNameDraftUiState(phase = DraftPhase.Done, suggestion = "Sunset Coast Run"),
            canStart = true,
            online = true,
            onSuggest = {},
        )
    }
}

@Preview(name = "Error — retry", showBackground = true, widthDp = 420)
@Composable
private fun DraftErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIAutoTripNameSuggestionContent(
            state = TripNameDraftUiState(phase = DraftPhase.Failed, error = "stream_http_503"),
            canStart = true,
            online = true,
            onSuggest = {},
        )
    }
}

@Preview(name = "Offline — disabled", showBackground = true, widthDp = 420)
@Composable
private fun DraftOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIAutoTripNameSuggestionContent(
            state = TripNameDraftUiState.IDLE,
            canStart = false,
            online = false,
            onSuggest = {},
        )
    }
}
