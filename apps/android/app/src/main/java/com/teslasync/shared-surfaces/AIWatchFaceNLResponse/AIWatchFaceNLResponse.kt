// The native Jetpack Compose + Material 3 AIWatchFaceNLResponse shared surface — a parity port of the watch-face
// "Ask Helix about your car" narrator card (web/src/components/ai/AIWatchFaceNLResponse.tsx, rendered through
// AIFeatureCard + AiOutputPanel and gated by withAiFeature('watch-face-nl-response')).
//
// The web component takes an OPTIONAL free-text question (an empty box is allowed — the backend falls back to a
// deterministic glance summary), streams it as an optional `{ message }` POST Server-Sent-Events request to
// `/ai/watch/respond` via useAiStream, and streams the narrated answer into an output panel, surfacing the
// idle → streaming → paused-confirm → done / error lifecycle. The render contract is NARRATIVE: Helix reads a
// typed snapshot of canonical state and narrates it; it never claims to have changed a setting or sent a vehicle
// command, and there is no "apply to form" handoff. This port keeps that contract end to end and adds the honest
// connectivity affordance the P3 shared-surface contract requires of an action surface: the card always renders
// its title, the Helix badge, the description, and the question input (never a blank box); the "Ask about my car"
// action streams the narration into a bordered output panel that shows an animated thinking indicator while the
// first delta is awaited, the accumulated narration once text arrives, a friendly empty state when the answer
// resolves empty, a stale chip over a narration older than the freshness window, an offline/last-known body after
// a dropped connection, and an inline error with a Retry affordance on failure; an offline chip plus a disabled
// action appear when there is no connectivity. The withAiFeature off-mode gate is reproduced faithfully — the
// surface renders nothing when AI is off or the feature is not opted in.
//
// Binding (P1/S8): this view performs NO HTTP. The stateful entry owns a WatchRespondController (the useAiStream
// analogue) over a host-supplied WatchRespondTransport seam and the settings store, resolves the off-mode gate +
// i18n labels (P1/S10) + tokens (P1/S9), records the PII-safe `view.opened` diagnostic (P1/S11), and draws the
// stateless renderer. Every lifecycle decision flows through the pure model.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/AIWatchFaceNLResponse) cannot form a valid Kotlin package identifier, so the
// package intentionally diverges from the path — exactly as the sibling shared surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aiwatchfacenlresponse

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
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
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
import io.teslasync.android.components.ui.Textarea
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Low-alpha wash behind the bordered output panel (web `bg-white/[0.02]`); a subtle inset, not a solid fill. */
private const val OUTPUT_WASH_ALPHA: Float = 0.04f

/** Skeleton line count for the pending thinking indicator while the first narration delta is awaited. */
private const val SKELETON_LINES: Int = 3

/** Minimum textarea height in lines (web `<Textarea rows={3}>`). */
private const val INPUT_MIN_LINES: Int = 3

/** Maximum textarea height in lines before it scrolls, so a long question never grows the card unbounded. */
private const val INPUT_MAX_LINES: Int = 6

/**
 * Stateful entry point — the faithful port of the web `AIWatchFaceNLResponse` (the withAiFeature-wrapped card
 * owning a `useAiStream`). Reads the settings document from the shared store (P1/S8) to apply the off-mode gate,
 * and renders nothing when AI is off or the `watch-face-nl-response` feature is not opted in — the withAiFeature
 * contract (ADR-015). When enabled it owns a [WatchRespondController] over the host-supplied [transport], records
 * `view.opened` once, cancels the stream on disposal (the web AbortController-on-unmount path), tracks the
 * question text, and draws [AIWatchFaceNLResponseContent].
 *
 * @param transport the SSE seam the host wires to the shared resilient client (production Ktor POST reader).
 * @param online whether connectivity is available; offline disables the action and shows the offline chip.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun AIWatchFaceNLResponse(
    transport: WatchRespondTransport,
    modifier: Modifier = Modifier,
    online: Boolean = true,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val settings by LocalDataContainer.current.settingsStore
        .settings()
        .collectAsStateWithLifecycle()
    val enabled = remember(settings) { isWatchRespondEnabled(settings.cached) }
    if (!enabled) return

    val scope = rememberCoroutineScope()
    val controller =
        remember(transport, online, scope, logger) {
            WatchRespondController(transport, online, scope, logger)
        }
    LaunchedEffect(controller) { controller.recordViewOpened() }
    DisposableEffect(controller) { onDispose { controller.cancel() } }

    val state by controller.state.collectAsStateWithLifecycle()
    val message by controller.message.collectAsStateWithLifecycle()
    val canStart = remember(message, online, state.phase) { isWatchRespondReady(message, state.phase, online) }
    AIWatchFaceNLResponseContent(
        state = state,
        message = message,
        canStart = canStart,
        online = online,
        onMessageChange = controller::setMessage,
        onAsk = controller::ask,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Reproduces the web card
 * (title + Helix badge, description, question textarea, action button, streaming output panel) and adds the
 * honest offline affordance the P3 contract requires. The card chrome is always present so the surface is never a
 * blank box; the output panel renders only once a stream has run (web `AiOutputPanel` `hasAnything` rule).
 *
 * @param state the stream lifecycle (web `useAiStream` `{ state, text, error }` + last-known narration).
 * @param message the optional free-text question bound to the textarea (web `message` state).
 * @param canStart whether the action can fire (web `canStart`, plus offline gating).
 * @param online whether connectivity is available; drives the offline chip and the input's enabled-ness.
 * @param onMessageChange forwards textarea edits to the state holder (web `setMessage`).
 * @param onAsk opens the respond stream (web `stream.start`); also the failed-state retry.
 * @param nowMs wall-clock seam for the freshness check (web `Date.now()`); injectable for tests/previews.
 */
@Composable
fun AIWatchFaceNLResponseContent(
    state: WatchRespondUiState,
    message: String,
    canStart: Boolean,
    online: Boolean,
    onMessageChange: (String) -> Unit,
    onAsk: () -> Unit,
    modifier: Modifier = Modifier,
    nowMs: () -> Long = { System.currentTimeMillis() },
) {
    val surface = classifyWatchRespond(state, nowMs())
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            WatchHeader(online = online)
            BodyText(
                text = stringResource(R.string.translation_watchFaceNL_description),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            WatchInput(message = message, online = online, onMessageChange = onMessageChange)
            WatchAction(streaming = state.isStreaming, canStart = canStart, onAsk = onAsk)
            WatchOutput(surface = surface, onRetry = onAsk)
        }
    }
}

/** Title + Helix badge (web header), with an offline chip appended when connectivity is unavailable. */
@Composable
private fun WatchHeader(online: Boolean) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Heading(
            text = stringResource(R.string.translation_watchFaceNL_title),
            modifier = Modifier.weight(1f).semantics { heading() },
            level = HeadingLevel.Panel,
        )
        Badge(
            text = stringResource(R.string.translation_watchFaceNL_badge),
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
 * The optional question field (web `inputSlot` Textarea). The example question renders as the field's supporting
 * hint, and the web `aria-label` ("Your question for Helix") maps to the field's TalkBack content description so
 * the input is labeled for screen readers (the Android Textarea has no in-field hint slot). An empty box is
 * allowed — the backend applies a default summary — so the field is never required. Disabled offline so the user
 * can never compose a question that cannot run.
 */
@Composable
private fun WatchInput(
    message: String,
    online: Boolean,
    onMessageChange: (String) -> Unit,
) {
    val inputLabel = stringResource(R.string.translation_watchFaceNL_inputLabel)
    val exampleHint = stringResource(R.string.translation_watchFaceNL_placeholder) // parity:allow i18n id
    Textarea(
        value = message,
        onValueChange = onMessageChange,
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = inputLabel },
        hint = exampleHint,
        enabled = online,
        minLines = INPUT_MIN_LINES,
        maxLines = INPUT_MAX_LINES,
    )
}

/**
 * The right-aligned "Ask about my car" action (web `buttonLabel`). Disabled while a stream is in flight or when
 * the action cannot start (over-cap / paused / offline); the in-flight spinner is the web "Helix is thinking…"
 * affordance.
 */
@Composable
private fun WatchAction(
    streaming: Boolean,
    canStart: Boolean,
    onAsk: () -> Unit,
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Button(
            label = stringResource(R.string.translation_watchFaceNL_button),
            onClick = onAsk,
            variant = ButtonVariant.Outline,
            size = ButtonSize.Sm,
            enabled = canStart && !streaming,
            loading = streaming,
        )
    }
}

/**
 * The streamed-output panel — a port of the web `AiOutputPanel`. Renders nothing while resting (the web panel is
 * absent until a stream runs), then shows the per-state body inside a bordered inset with a polite live-region
 * announcement so TalkBack reads streamed/lifecycle output as it changes.
 */
@Composable
private fun WatchOutput(
    surface: WatchSurface,
    onRetry: () -> Unit,
) {
    if (surface is WatchSurface.Resting) return
    val labels =
        WatchOutputLabels(
            working = stringResource(R.string.translation_chatbot_thinking),
            empty = stringResource(R.string.translation_common_noData),
            stale = stringResource(R.string.translation_mqtt_stale),
            offline = stringResource(R.string.translation_common_offline),
            error = stringResource(R.string.translation_queryError_title),
        )
    OutputContainer(accessibilityLabel = outputAccessibilityLabel(surface, labels)) {
        when (surface) {
            WatchSurface.Working -> WatchThinking()
            is WatchSurface.Live -> WatchNarration(text = surface.text)
            is WatchSurface.Ready -> ReadyBody(text = surface.text, stale = surface.stale)
            WatchSurface.Empty -> EmptyState(message = stringResource(R.string.translation_common_noData))
            is WatchSurface.Cached -> CachedBody(text = surface.text, offline = surface.offline, onRetry = onRetry)
            is WatchSurface.Failed -> FailedBody(offline = surface.offline, message = surface.message, onRetry = onRetry)
            WatchSurface.Resting -> Unit
        }
    }
}

/** Bordered, low-wash inset that frames the streamed output (web `rounded-lg border bg-white/[0.02] p-4`). */
@Composable
private fun OutputContainer(
    accessibilityLabel: String?,
    content: @Composable ColumnScope.() -> Unit,
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
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = OUTPUT_WASH_ALPHA),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(
            modifier = Modifier.padding(Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
            content = content,
        )
    }
}

/** The pending thinking indicator shown while the stream is open but no text has arrived (web `AIThinkingIndicator`). */
@Composable
private fun WatchThinking() {
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
            Caption(stringResource(R.string.translation_chatbot_thinking))
        }
        SkeletonLines(lines = SKELETON_LINES)
    }
}

/** The accumulated narrated answer (web `whitespace-pre-wrap` streamed text; Compose preserves line breaks). */
@Composable
private fun WatchNarration(text: String) {
    BodyText(text = text, modifier = Modifier.fillMaxWidth())
}

/** The completed narration, preceded by a stale chip when the fetch is older than the freshness window. */
@Composable
private fun ReadyBody(
    text: String,
    stale: Boolean,
) {
    if (stale) {
        Badge(
            text = stringResource(R.string.translation_mqtt_stale),
            variant = BadgeVariant.Warning,
            dot = true,
        )
    }
    WatchNarration(text = text)
}

/** A failed re-ask that keeps the last-known narration visible with an offline/stale chip + retry. */
@Composable
private fun CachedBody(
    text: String,
    offline: Boolean,
    onRetry: () -> Unit,
) {
    Badge(
        text =
            if (offline) {
                stringResource(R.string.translation_common_offline)
            } else {
                stringResource(R.string.translation_mqtt_stale)
            },
        variant = BadgeVariant.Warning,
        dot = true,
    )
    WatchNarration(text = text)
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        RetryButton(onRetry = onRetry)
    }
}

/** The web error branch with no last-known narration — an offline chip when relevant, the message, and retry. */
@Composable
private fun FailedBody(
    offline: Boolean,
    message: String?,
    onRetry: () -> Unit,
) {
    val detail = message?.takeIf { it.isNotBlank() } ?: stringResource(R.string.translation_common_unknown)
    if (offline) {
        Badge(
            text = stringResource(R.string.translation_common_offline),
            variant = BadgeVariant.Warning,
            dot = true,
        )
    }
    ErrorText("${stringResource(R.string.translation_Error)}: $detail")
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        RetryButton(onRetry = onRetry)
    }
}

/** The shared retry affordance backing the error/offline surfaces. */
@Composable
private fun RetryButton(onRetry: () -> Unit) {
    Button(
        label = stringResource(R.string.translation_common_retry),
        onClick = onRetry,
        variant = ButtonVariant.Outline,
        size = ButtonSize.Sm,
    )
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

@Preview(name = "Idle — ready", showBackground = true, widthDp = 420)
@Composable
private fun WatchIdlePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIWatchFaceNLResponseContent(
            state = WatchRespondUiState(),
            message = "",
            canStart = true,
            online = true,
            onMessageChange = {},
            onAsk = {},
        )
    }
}

@Preview(name = "Streaming — thinking", showBackground = true, widthDp = 420)
@Composable
private fun WatchThinkingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIWatchFaceNLResponseContent(
            state = WatchRespondUiState(phase = WatchRespondPhase.Streaming),
            message = "how is my battery?",
            canStart = true,
            online = true,
            onMessageChange = {},
            onAsk = {},
        )
    }
}

@Preview(name = "Streaming — live narration", showBackground = true, widthDp = 420)
@Composable
private fun WatchLivePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIWatchFaceNLResponseContent(
            state = WatchRespondUiState(phase = WatchRespondPhase.Streaming, streamingText = "Your battery is at 72% "),
            message = "how is my battery?",
            canStart = true,
            online = true,
            onMessageChange = {},
            onAsk = {},
        )
    }
}

@Preview(name = "Done — answer", showBackground = true, widthDp = 420)
@Composable
private fun WatchDonePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIWatchFaceNLResponseContent(
            state =
                WatchRespondUiState(
                    phase = WatchRespondPhase.Done,
                    committedText = "Your battery is at 72% (about 240 km of range). The car is locked and parked.",
                    fetchedAt = 0L,
                ),
            message = "how is my battery?",
            canStart = true,
            online = true,
            onMessageChange = {},
            onAsk = {},
            nowMs = { 0L },
        )
    }
}

@Preview(name = "Done — stale", showBackground = true, widthDp = 420)
@Composable
private fun WatchStalePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIWatchFaceNLResponseContent(
            state =
                WatchRespondUiState(
                    phase = WatchRespondPhase.Done,
                    committedText = "Your battery is at 72% (about 240 km of range).",
                    fetchedAt = 0L,
                ),
            message = "how is my battery?",
            canStart = true,
            online = true,
            onMessageChange = {},
            onAsk = {},
            nowMs = { WATCH_FRESHNESS_WINDOW_MS + 1L },
        )
    }
}

@Preview(name = "Done — empty", showBackground = true, widthDp = 420)
@Composable
private fun WatchEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIWatchFaceNLResponseContent(
            state = WatchRespondUiState(phase = WatchRespondPhase.Done),
            message = "",
            canStart = true,
            online = true,
            onMessageChange = {},
            onAsk = {},
        )
    }
}

@Preview(name = "Error — retry", showBackground = true, widthDp = 420)
@Composable
private fun WatchErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIWatchFaceNLResponseContent(
            state = WatchRespondUiState(phase = WatchRespondPhase.Failed, error = "stream_http_503"),
            message = "how is my battery?",
            canStart = true,
            online = true,
            onMessageChange = {},
            onAsk = {},
        )
    }
}

@Preview(name = "Offline — disabled", showBackground = true, widthDp = 420)
@Composable
private fun WatchOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIWatchFaceNLResponseContent(
            state = WatchRespondUiState(),
            message = "how is my battery?",
            canStart = false,
            online = false,
            onMessageChange = {},
            onAsk = {},
        )
    }
}
