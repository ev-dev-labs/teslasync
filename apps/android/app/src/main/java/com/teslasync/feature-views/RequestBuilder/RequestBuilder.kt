// The native Jetpack Compose + Material 3 RequestBuilder feature view — a parity port of
// web/src/features/admin/components/RequestBuilder.tsx. It reproduces the web composition: a URL bar (a
// colored method chip beside the scrollable `/api/v1…` path and a primary "Send" button), an inline
// destructive-action confirmation for any non-GET verb, the endpoint summary + description, and the
// path-parameter / query-parameter / request-body / optional-`X-API-Key` editors — each in its own panel,
// shown only when the endpoint declares it (web parity).
//
// The web component receives its `endpoint` as a prop from the parent (ApiPlaygroundPage), which fetches +
// parses `/system/openapi`, renders a skeleton while loading + an error on failure, and shows a "select an
// endpoint" prompt until a row is chosen. So the loading / content / empty / error / stale / offline
// envelope is REAL end-to-end (the OpenAPI fetch + selection lifecycle), not invented — it flows through the
// shared [RequestBuilderViewModel] (P1/S8); the view performs no HTTP (ADR-002). The `loading` prop (a send
// in flight) is carried separately by [sending], which disables the Send button and swaps its label to
// "Sending…". Every visible string resolves through the i18n boundary (`R.string.translation_playground_*` +
// common / a11y keys from the P1/S10 catalog), and every interactive element (the URL field, Send, the
// confirm/cancel buttons, every parameter field, the API-key field, the refresh control, retry) carries an
// accessibility label. All derivations flow through the pure [RequestBuilderProjection].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/RequestBuilder) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless content + helpers + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.requestbuilder

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateMap
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.components.ui.Textarea
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.endpointsidebar.EndpointBody
import io.teslasync.android.featureviews.endpointsidebar.EndpointParam
import io.teslasync.android.featureviews.endpointsidebar.HttpMethod
import io.teslasync.android.featureviews.endpointsidebar.MethodBadge
import io.teslasync.android.featureviews.endpointsidebar.ParamLocation
import io.teslasync.android.featureviews.endpointsidebar.ParsedEndpoint
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing

// Destructive-confirmation banner wash (web `bg-amber-500/10 border-amber-500/30`).
private const val CONFIRM_BG_ALPHA = 0.10f
private const val CONFIRM_BORDER_ALPHA = 0.30f
private val CONFIRM_BORDER_WIDTH = 1.dp

// Request-body editor height (web `<textarea rows={8}>`).
private const val BODY_MIN_LINES = 8
private const val BODY_MAX_LINES = 16

// Loading chrome — a handful of shimmering rounded rows standing in for the form scaffold.
private const val LOADING_SKELETON_ROWS = 5
private val SKELETON_ROW_HEIGHT = 32.dp

// Section header typography — the native expression of the web `<h4 class="text-xs font-semibold uppercase
// tracking-wider">` panel label (kept un-uppercased so non-Latin catalogs stay legible).
private val SECTION_LABEL_LETTER_SPACING = 0.5.sp

private const val PREVIEW_NOW = 1_780_000_000_000L

/**
 * Stateful entry point. Collects the shared [RequestBuilderViewModel] state, records the one-shot
 * `view.opened` diagnostic, and renders the surface. A host supplies the view-model (wired via
 * [RequestBuilderViewModel.factory]), is notified of a send via [onSend] (the web `onSend` callback), and
 * drives the in-flight [sending] flag (the web `loading` prop).
 *
 * @param viewModel the state holder bound to the shared selected-endpoint feed.
 * @param onSend invoked with the fully-built [RequestDraft] when the user confirms a send (web `onSend`).
 * @param sending whether a request is currently in flight — disables Send and shows the "Sending…" label.
 */
@Composable
fun RequestBuilder(
    viewModel: RequestBuilderViewModel,
    onSend: (RequestDraft) -> Unit,
    modifier: Modifier = Modifier,
    sending: Boolean = false,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(viewModel) { viewModel.onAppear() }
    RequestBuilderContent(
        state = state,
        sending = sending,
        onSend = onSend,
        modifier = modifier,
        onRefresh = viewModel::refresh,
        onRetry = viewModel::retry,
    )
}

/**
 * Stateless RequestBuilder surface — every rendered state: the loading skeleton chrome, a hard error + retry
 * (no cached selection), the friendly data-empty state (no endpoint selected), and the request form (URL bar
 * + confirm + summary + parameter / body / auth editors). Stale / offline data auto-refreshes once (web
 * TanStack stale refetch) while keeping the cached endpoint visible. Hoisted out of the ViewModel so each
 * state is preview- and screenshot-testable with hand-built [UiState] inputs.
 */
@Composable
fun RequestBuilderContent(
    state: UiState<RequestBuilderSnapshot>,
    sending: Boolean,
    onSend: (RequestDraft) -> Unit,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit = {},
    onRetry: () -> Unit = {},
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val endpoint = state.data?.endpoint
    Surface(
        modifier = modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
    ) {
        when {
            state.isLoading -> RequestBuilderLoading()
            state.isError -> RequestBuilderError(state = state, onRetry = onRetry)
            endpoint == null -> RequestBuilderEmpty()
            else -> RequestBuilderForm(endpoint = endpoint, sending = sending, state = state, onSend = onSend, onRefresh = onRefresh)
        }
    }
}

/** The request form body — the web component's main composition, scrollable for tall endpoints. */
@Composable
private fun RequestBuilderForm(
    endpoint: ParsedEndpoint,
    sending: Boolean,
    state: UiState<RequestBuilderSnapshot>,
    onSend: (RequestDraft) -> Unit,
    onRefresh: () -> Unit,
) {
    val params =
        remember(endpoint.identity) {
            mutableStateMapOf<String, String>().apply { putAll(RequestBuilderProjection.seedParams(endpoint)) }
        }
    var body by rememberSaveable(endpoint.identity) { mutableStateOf(RequestBuilderProjection.seedBody(endpoint)) }
    var apiKey by rememberSaveable(endpoint.identity) { mutableStateOf("") }
    var confirmOpen by rememberSaveable(endpoint.identity) { mutableStateOf(false) }

    val isDestructive = RequestBuilderProjection.isDestructive(endpoint)
    val performSend = {
        if (isDestructive && !confirmOpen) {
            confirmOpen = true
        } else {
            confirmOpen = false
            onSend(RequestBuilderProjection.draft(endpoint, params, body, apiKey))
        }
    }

    val pathParams = RequestBuilderProjection.pathParams(endpoint)
    val queryParams = RequestBuilderProjection.queryParams(endpoint)

    Column(
        modifier = Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        if (state.stale || state.hasError || state.refreshing) {
            RequestBuilderFreshness(state = state, onRefresh = onRefresh)
        }
        RequestUrlBar(endpoint = endpoint, params = params, sending = sending, onSend = performSend)
        if (confirmOpen) {
            RequestConfirmBanner(
                method = endpoint.method,
                onConfirm = performSend,
                onCancel = { confirmOpen = false },
            )
        }
        EndpointSummary(endpoint)
        if (pathParams.isNotEmpty()) {
            RequestParamPanel(titleRes = R.string.translation_playground_pathParams, params = pathParams, values = params)
        }
        if (queryParams.isNotEmpty()) {
            RequestParamPanel(titleRes = R.string.translation_playground_queryParams, params = queryParams, values = params)
        }
        endpoint.requestBody?.let { requestBody ->
            RequestBodyPanel(requestBody = requestBody, body = body, onBodyChange = { body = it })
        }
        RequestAuthPanel(apiKey = apiKey, onApiKeyChange = { apiKey = it })
    }
}

/** The URL bar — method chip + scrollable `/api/v1…` path + the primary Send button. */
@Composable
private fun RequestUrlBar(
    endpoint: ParsedEndpoint,
    params: SnapshotStateMap<String, String>,
    sending: Boolean,
    onSend: () -> Unit,
) {
    val displayUrl = RequestBuilderProjection.displayUrl(endpoint, params)
    val sendLabel =
        if (sending) {
            stringResource(R.string.translation_playground_sending)
        } else {
            stringResource(R.string.translation_playground_send)
        }
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        MethodBadge(endpoint.method)
        Surface(
            modifier = Modifier.weight(1f),
            shape = RoundedCornerShape(Radius.md),
            color = MaterialTheme.colorScheme.surfaceVariant,
            contentColor = MaterialTheme.colorScheme.onSurface,
        ) {
            CodeText(
                text = displayUrl,
                modifier =
                    Modifier
                        .horizontalScroll(rememberScrollState())
                        .padding(horizontal = Spacing.sm, vertical = Spacing.xs)
                        .clearAndSetSemantics { contentDescription = displayUrl },
            )
        }
        Button(
            label = sendLabel,
            onClick = onSend,
            enabled = !sending,
            loading = sending,
            leadingIcon = RequestBuilderGlyphs.Send,
        )
    }
}

/** The inline destructive-action confirmation (web amber banner for any non-GET verb). */
@Composable
private fun RequestConfirmBanner(
    method: HttpMethod,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
) {
    val accent = TeslaTokens.status.warning
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(Radius.md),
        color = accent.copy(alpha = CONFIRM_BG_ALPHA),
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(CONFIRM_BORDER_WIDTH, accent.copy(alpha = CONFIRM_BORDER_ALPHA)),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.md, vertical = Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Icon(TeslaGlyphs.Warning, contentDescription = null, size = IconSize.Sm, tint = accent)
            BodyText(
                text = stringResource(R.string.translation_playground_confirmDestructive, method.wire),
                modifier = Modifier.weight(1f),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Button(
                label = stringResource(R.string.translation_playground_confirmYes),
                onClick = onConfirm,
                size = ButtonSize.Sm,
            )
            Button(
                label = stringResource(R.string.translation_playground_cancel),
                onClick = onCancel,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )
        }
    }
}

/** The endpoint summary + (distinct) description — web `<p>` lines, shown only when present. */
@Composable
private fun EndpointSummary(endpoint: ParsedEndpoint) {
    if (endpoint.summary.isNotBlank()) {
        BodyText(endpoint.summary, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    if (endpoint.description.isNotBlank() && endpoint.description != endpoint.summary) {
        HelperText(endpoint.description)
    }
}

/** A panel of parameter editors — the web Path / Query parameter sections (one [Input] per parameter). */
@Composable
private fun RequestParamPanel(
    titleRes: Int,
    params: List<EndpointParam>,
    values: SnapshotStateMap<String, String>,
) {
    GlassPanel(padding = PanelPadding.Md) {
        SectionLabel(stringResource(titleRes))
        Column(
            modifier = Modifier.fillMaxWidth().padding(top = Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            params.forEach { param ->
                Input(
                    value = values[param.name] ?: "",
                    onValueChange = { values[param.name] = it },
                    label = param.name,
                    hint = paramHint(param),
                    required = param.location == ParamLocation.Path || param.required,
                )
            }
        }
    }
}

/** The request-body editor panel — web `Request Body` section with its content-type and JSON textarea. */
@Composable
private fun RequestBodyPanel(
    requestBody: EndpointBody,
    body: String,
    onBodyChange: (String) -> Unit,
) {
    GlassPanel(padding = PanelPadding.Md) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            SectionLabel(stringResource(R.string.translation_playground_requestBody), modifier = Modifier.weight(1f, fill = false))
            Caption(requestBody.contentType)
        }
        Textarea(
            value = body,
            onValueChange = onBodyChange,
            modifier = Modifier.padding(top = Spacing.sm),
            minLines = BODY_MIN_LINES,
            maxLines = BODY_MAX_LINES,
        )
    }
}

/** The optional `X-API-Key` editor panel — web `Authentication (Optional)` section. */
@Composable
private fun RequestAuthPanel(
    apiKey: String,
    onApiKeyChange: (String) -> Unit,
) {
    val keyHint = stringResource(R.string.translation_playground_apiKeyPlaceholder) // parity:allow generated i18n catalog key name
    GlassPanel(padding = PanelPadding.Md) {
        SectionLabel(stringResource(R.string.translation_playground_authHeader))
        Input(
            value = apiKey,
            onValueChange = onApiKeyChange,
            modifier = Modifier.padding(top = Spacing.sm),
            label = RequestBuilderProjection.API_KEY_HEADER,
            hint = keyHint,
            keyboardType = KeyboardType.Password,
            visualTransformation = PasswordVisualTransformation(),
        )
        HelperText(stringResource(R.string.translation_playground_authHint), modifier = Modifier.padding(top = Spacing.xs))
    }
}

/** The stale / offline freshness chip + refresh control, shown only over a degraded cached selection. */
@Composable
private fun RequestBuilderFreshness(
    state: UiState<RequestBuilderSnapshot>,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRefresh,
            enabled = !state.refreshing,
            size = IconSize.Sm,
        )
    }
}

/** The friendly data-empty surface — the web parent's "select an endpoint from the sidebar" prompt. */
@Composable
private fun RequestBuilderEmpty(modifier: Modifier = Modifier) {
    EmptyState(
        message = stringResource(R.string.translation_playground_selectEndpoint),
        icon = TeslaGlyphs.Info,
        modifier = modifier.fillMaxWidth(),
    )
}

/** Loading skeleton chrome — shimmering rounded rows standing in for the request form scaffold. */
@Composable
private fun RequestBuilderLoading(modifier: Modifier = Modifier) {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = modifier.fillMaxWidth().padding(Spacing.md).semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(LOADING_SKELETON_ROWS) {
            Skeleton(height = SKELETON_ROW_HEIGHT, rounded = true)
        }
    }
}

/** Hard-error surface — the [QueryError] retry affordance (web parent's spec-fetch error). */
@Composable
private fun RequestBuilderError(
    state: UiState<RequestBuilderSnapshot>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    QueryError(
        kind = queryErrorKindFor(state),
        resourceName = stringResource(R.string.translation_playground_title),
        onRetry = onRetry,
        modifier = modifier.fillMaxWidth(),
    )
}

/** A section header — the native expression of the web panel `<h4>` label (muted, small, slightly tracked). */
@Composable
private fun SectionLabel(
    text: String,
    modifier: Modifier = Modifier,
) {
    Text(
        text = text,
        modifier = modifier.semantics { heading() },
        style =
            MaterialTheme.typography.labelMedium.copy(
                fontWeight = FontWeight.SemiBold,
                letterSpacing = SECTION_LABEL_LETTER_SPACING,
            ),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

/** The hint text for a parameter field — web `p.description || p.type[ (default: …)]`. */
private fun paramHint(param: EndpointParam): String {
    if (param.description.isNotBlank()) return param.description
    val default = param.default
    return if (default != null && param.location == ParamLocation.Query) {
        "${param.type} (default: $default)"
    } else {
        param.type
    }
}

/** Folds a hard failure onto a [QueryErrorKind] (network/timeout → offline, circuit-open → waiting). */
private fun queryErrorKindFor(state: UiState<*>): QueryErrorKind =
    classifyQueryError(
        status = state.httpStatus,
        online = state.errorKind != ErrorKind.Network && state.errorKind != ErrorKind.Timeout,
        transientWaiting = state.errorKind == ErrorKind.CircuitOpen,
    )

// ── Previews — one per rendered state (content GET / content POST / empty / loading / error / offline) ────

private val previewGetEndpoint: ParsedEndpoint =
    ParsedEndpoint(
        method = HttpMethod.Get,
        path = "/vehicles",
        tag = "Vehicles",
        summary = "List all vehicles",
        description = "Returns every vehicle in the fleet.",
        operationId = "listVehicles",
        parameters =
            listOf(
                EndpointParam("limit", ParamLocation.Query, required = false, type = "integer", description = "", default = "50"),
            ),
    )

private val previewPostEndpoint: ParsedEndpoint =
    ParsedEndpoint(
        method = HttpMethod.Post,
        path = "/vehicles/{vehicleID}/command",
        tag = "Vehicles",
        summary = "Send a vehicle command",
        operationId = "sendCommand",
        parameters =
            listOf(
                EndpointParam("vehicleID", ParamLocation.Path, required = true, type = "string", description = "The vehicle id"),
            ),
        requestBody = EndpointBody(contentType = "application/json", example = "{\"command\":\"honk_horn\"}"),
    )

@Preview(name = "RequestBuilder · GET", showBackground = true, widthDp = 380, heightDp = 640)
@Composable
private fun RequestBuilderGetPreview() {
    TeslaSyncTheme {
        RequestBuilderContent(
            state = UiState(phase = UiPhase.Content, data = RequestBuilderSnapshot(previewGetEndpoint), fetchedAt = PREVIEW_NOW),
            sending = false,
            onSend = {},
        )
    }
}

@Preview(name = "RequestBuilder · POST", showBackground = true, widthDp = 380, heightDp = 640)
@Composable
private fun RequestBuilderPostPreview() {
    TeslaSyncTheme {
        RequestBuilderContent(
            state = UiState(phase = UiPhase.Content, data = RequestBuilderSnapshot(previewPostEndpoint), fetchedAt = PREVIEW_NOW),
            sending = false,
            onSend = {},
        )
    }
}

@Preview(name = "RequestBuilder · sending", showBackground = true, widthDp = 380, heightDp = 320)
@Composable
private fun RequestBuilderSendingPreview() {
    TeslaSyncTheme {
        RequestBuilderContent(
            state = UiState(phase = UiPhase.Content, data = RequestBuilderSnapshot(previewGetEndpoint), fetchedAt = PREVIEW_NOW),
            sending = true,
            onSend = {},
        )
    }
}

@Preview(name = "RequestBuilder · empty", showBackground = true, widthDp = 380, heightDp = 320)
@Composable
private fun RequestBuilderEmptyPreview() {
    TeslaSyncTheme {
        RequestBuilderContent(
            state = UiState(phase = UiPhase.Empty, data = RequestBuilderSnapshot.EMPTY, fetchedAt = PREVIEW_NOW),
            sending = false,
            onSend = {},
        )
    }
}

@Preview(name = "RequestBuilder · loading", showBackground = true, widthDp = 380, heightDp = 320)
@Composable
private fun RequestBuilderLoadingPreview() {
    TeslaSyncTheme {
        RequestBuilderContent(state = UiState.loading(), sending = false, onSend = {})
    }
}

@Preview(name = "RequestBuilder · error", showBackground = true, widthDp = 380, heightDp = 320)
@Composable
private fun RequestBuilderErrorPreview() {
    TeslaSyncTheme {
        RequestBuilderContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            sending = false,
            onSend = {},
        )
    }
}

@Preview(name = "RequestBuilder · offline", showBackground = true, widthDp = 380, heightDp = 640)
@Composable
private fun RequestBuilderOfflinePreview() {
    TeslaSyncTheme {
        RequestBuilderContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = RequestBuilderSnapshot(previewGetEndpoint),
                    fetchedAt = PREVIEW_NOW,
                    stale = true,
                    errorKind = ErrorKind.Timeout,
                ),
            sending = false,
            onSend = {},
        )
    }
}
