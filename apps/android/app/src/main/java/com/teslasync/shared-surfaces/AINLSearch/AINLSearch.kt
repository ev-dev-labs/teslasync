// The native Jetpack Compose + Material 3 AINLSearch shared surface — a parity port of the "Search with natural
// language" Helix card (web/src/components/ai/AINLSearch.tsx, rendered through AIFeatureCard + AiOutputPanel and
// gated by withAiFeature('nl-search')).
//
// The web component takes a free-form query, streams it as a `{ prompt }` POST Server-Sent-Events request to
// `/ai/search/query` via useAiStream, and streams the narrated answer into an output panel, surfacing the
// idle → streaming → done / error lifecycle. This port keeps that contract end to end and adds the honest
// connectivity affordance the P3 shared-surface contract requires of an action surface: the card always renders
// its title, the Helix badge, the description, and the query input (never a blank box); the "Search with Helix"
// action streams the answer into a bordered output panel that shows an animated thinking indicator while the
// first delta is awaited, the accumulated answer once text arrives, a friendly empty state when the search
// resolves with no answer, and an inline error with a Retry affordance on failure; and an offline chip plus a
// disabled action when there is no connectivity. The withAiFeature off-mode gate is reproduced faithfully — the
// surface renders nothing when AI is off or the feature is not opted in.
//
// Binding (P1/S8): this view performs NO HTTP. The stateful entry owns a NlSearchController (the useAiStream
// analogue) over a host-supplied NlSearchTransport seam and the settings store, resolves the off-mode gate +
// i18n labels (P1/S10) + tokens (P1/S9), records the PII-safe `view.opened` diagnostic (P1/S11), and draws the
// stateless renderer. Every figure/lifecycle decision flows through the pure model.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/AINLSearch) cannot form a valid Kotlin package identifier, so the package
// intentionally diverges from the path — exactly as the sibling shared surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ainlsearch

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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
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

/** Skeleton line count for the pending thinking indicator while the first answer delta is awaited. */
private const val SKELETON_LINES: Int = 3

/** Minimum textarea height in lines (web `<Textarea rows={3}>`). */
private const val QUERY_MIN_LINES: Int = 3

/** Maximum textarea height in lines before it scrolls, so a long query never grows the card unbounded. */
private const val QUERY_MAX_LINES: Int = 6

/**
 * Stateful entry point — the faithful port of the web `AINLSearch` (the withAiFeature-wrapped card owning a
 * `useAiStream`). Reads the settings document from the shared store (P1/S8) to apply the off-mode gate, and
 * renders nothing when AI is off or the `nl-search` feature is not opted in — the withAiFeature contract
 * (ADR-015). When enabled it owns a [NlSearchController] over the host-supplied [transport], records
 * `view.opened` once, cancels the stream on disposal (the web AbortController-on-unmount path), tracks the query
 * text, and draws [AINLSearchContent].
 *
 * @param transport the SSE seam the host wires to the shared resilient client (production Ktor POST reader).
 * @param online whether connectivity is available; offline disables the action and shows the offline chip.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun AINLSearch(
    transport: NlSearchTransport,
    modifier: Modifier = Modifier,
    online: Boolean = true,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val settings by LocalDataContainer.current.settingsStore
        .settings()
        .collectAsStateWithLifecycle()
    val enabled = remember(settings) { isNlSearchEnabled(settings.cached) }
    if (!enabled) return

    val scope = rememberCoroutineScope()
    val controller =
        remember(transport, online, scope, logger) {
            NlSearchController(transport, online, scope, logger)
        }
    LaunchedEffect(controller) { controller.recordViewOpened() }
    DisposableEffect(controller) { onDispose { controller.cancel() } }

    val state by controller.state.collectAsStateWithLifecycle()
    val prompt by controller.prompt.collectAsStateWithLifecycle()
    val canStart = remember(prompt, online) { isSearchReady(prompt, online) }
    AINLSearchContent(
        state = state,
        prompt = prompt,
        canStart = canStart,
        online = online,
        onPromptChange = controller::setPrompt,
        onSearch = controller::search,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Reproduces the web card
 * (title + Helix badge, description, query textarea, action button, streaming output panel) and adds the honest
 * offline affordance the P3 contract requires. The card chrome is always present so the surface is never a
 * blank box; the output panel renders only once a stream has run (web `AiOutputPanel` `hasAnything` rule).
 *
 * @param state the stream lifecycle (web `useAiStream` `{ state, text, error }`).
 * @param prompt the free-form query bound to the textarea (web `prompt` state).
 * @param canStart whether the action can fire (web `canStart`, plus offline gating).
 * @param online whether connectivity is available; drives the offline chip and the input's enabled-ness.
 * @param onPromptChange forwards textarea edits to the state holder (web `setPrompt`).
 * @param onSearch opens the query stream (web `stream.start`); also the failed-state retry.
 */
@Composable
fun AINLSearchContent(
    state: NlSearchUiState,
    prompt: String,
    canStart: Boolean,
    online: Boolean,
    onPromptChange: (String) -> Unit,
    onSearch: () -> Unit,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Lg) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            SearchHeader(online = online)
            BodyText(
                text = stringResource(R.string.translation_search_aiSearch_description),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            SearchInput(prompt = prompt, online = online, onPromptChange = onPromptChange)
            SearchAction(state = state, canStart = canStart, onSearch = onSearch)
            SearchOutput(state = state, onRetry = onSearch)
        }
    }
}

/** Title + Helix badge (web header), with an offline chip appended when connectivity is unavailable. */
@Composable
private fun SearchHeader(online: Boolean) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Heading(
            text = stringResource(R.string.translation_search_aiSearch_title),
            modifier = Modifier.weight(1f).semantics { heading() },
            level = HeadingLevel.Panel,
        )
        Badge(
            text = stringResource(R.string.translation_search_aiSearch_badge),
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
 * The free-form query field (web `inputSlot` Textarea). The example query renders as the field's supporting hint
 * and doubles as its TalkBack content description so the input is labeled for screen readers (the Android
 * Textarea has no in-field hint slot). Disabled offline so the user can never compose a query that cannot run.
 */
@Composable
private fun SearchInput(
    prompt: String,
    online: Boolean,
    onPromptChange: (String) -> Unit,
) {
    val exampleHint = stringResource(R.string.translation_search_aiSearch_placeholder) // parity:allow i18n id
    Textarea(
        value = prompt,
        onValueChange = onPromptChange,
        modifier = Modifier.semantics { contentDescription = exampleHint },
        hint = exampleHint,
        enabled = online,
        minLines = QUERY_MIN_LINES,
        maxLines = QUERY_MAX_LINES,
    )
}

/**
 * The right-aligned "Search with Helix" action (web `buttonLabel`). Disabled while a stream is in flight or when
 * the action cannot start (blank query / offline); the in-flight spinner is the web "Helix is thinking…"
 * affordance.
 */
@Composable
private fun SearchAction(
    state: NlSearchUiState,
    canStart: Boolean,
    onSearch: () -> Unit,
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Button(
            label = stringResource(R.string.translation_search_aiSearch_searchButton),
            onClick = onSearch,
            variant = ButtonVariant.Outline,
            size = ButtonSize.Sm,
            enabled = canStart && !state.isStreaming,
            loading = state.isStreaming,
        )
    }
}

/**
 * The streamed-output panel — a port of the web `AiOutputPanel`. Renders nothing until a stream has run, then
 * shows an inline error + retry on failure, an animated thinking indicator while awaiting the first delta, a
 * friendly empty state when the search resolved with no answer, or the accumulated narrated answer.
 */
@Composable
private fun SearchOutput(
    state: NlSearchUiState,
    onRetry: () -> Unit,
) {
    if (!state.hasOutput) return
    OutputContainer {
        when {
            state.isFailed -> SearchError(message = state.error, onRetry = onRetry)
            state.isStreaming && !state.hasResults -> SearchThinking()
            state.isDone && !state.hasResults ->
                EmptyState(message = stringResource(R.string.translation_common_noData))

            else -> SearchResults(text = state.results)
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
private fun SearchThinking() {
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

/** The accumulated narrated answer (web `whitespace-pre-wrap` streamed text). */
@Composable
private fun SearchResults(text: String) {
    BodyText(text = text, modifier = Modifier.fillMaxWidth())
}

/** Inline terminal-error message + retry (web `AiOutputPanel` error branch + the action re-firing). */
@Composable
private fun SearchError(
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

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

@Preview(name = "Idle — ready", showBackground = true, widthDp = 420)
@Composable
private fun SearchIdlePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AINLSearchContent(
            state = NlSearchUiState.IDLE,
            prompt = "",
            canStart = false,
            online = true,
            onPromptChange = {},
            onSearch = {},
        )
    }
}

@Preview(name = "Streaming — thinking", showBackground = true, widthDp = 420)
@Composable
private fun SearchStreamingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AINLSearchContent(
            state = NlSearchUiState(phase = SearchPhase.Streaming),
            prompt = "drives last weekend over 200 km",
            canStart = true,
            online = true,
            onPromptChange = {},
            onSearch = {},
        )
    }
}

@Preview(name = "Done — answer", showBackground = true, widthDp = 420)
@Composable
private fun SearchDonePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AINLSearchContent(
            state =
                NlSearchUiState(
                    phase = SearchPhase.Done,
                    results = "Found 2 drives: \"Coast Run\" (218 km) and \"Cabin Trip\" (241 km).",
                ),
            prompt = "drives last weekend over 200 km",
            canStart = true,
            online = true,
            onPromptChange = {},
            onSearch = {},
        )
    }
}

@Preview(name = "Done — no matches", showBackground = true, widthDp = 420)
@Composable
private fun SearchEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AINLSearchContent(
            state = NlSearchUiState(phase = SearchPhase.Done),
            prompt = "drives to the moon",
            canStart = true,
            online = true,
            onPromptChange = {},
            onSearch = {},
        )
    }
}

@Preview(name = "Error — retry", showBackground = true, widthDp = 420)
@Composable
private fun SearchErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AINLSearchContent(
            state = NlSearchUiState(phase = SearchPhase.Failed, error = "stream_http_503"),
            prompt = "drives last weekend over 200 km",
            canStart = true,
            online = true,
            onPromptChange = {},
            onSearch = {},
        )
    }
}

@Preview(name = "Offline — disabled", showBackground = true, widthDp = 420)
@Composable
private fun SearchOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AINLSearchContent(
            state = NlSearchUiState.IDLE,
            prompt = "drives last weekend over 200 km",
            canStart = false,
            online = false,
            onPromptChange = {},
            onSearch = {},
        )
    }
}
