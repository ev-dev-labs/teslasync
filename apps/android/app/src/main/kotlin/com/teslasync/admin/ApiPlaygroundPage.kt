// The native Jetpack Compose + Material 3 ApiPlaygroundPage admin surface — a parity port of
// web/src/features/admin/pages/ApiPlaygroundPage.tsx, the OpenAPI explorer + request builder mounted at
// /api-playground. It reproduces the web composition: the page title/subtitle header (web `PageContainer` chrome),
// then the two panels the web page draws — GlassPanel1, the endpoint sidebar (the parsed `/system/openapi` catalog,
// searchable + grouped by tag), and GlassPanel2, the "select an endpoint" empty-state panel (with the available-
// endpoint count) shown until a row is chosen. Choosing a row swaps the main area to the request-builder experience
// (the RequestBuilder form, the runnable code snippet, and the response viewer) — exactly as the web page swaps
// `!selected ? <EmptyState/> : <RequestBuilder/>…`.
//
// The endpoint sidebar, request builder and response viewer are the already-built shared feature views (A3, DRY):
// this page binds their sources to its own state (the shared `/system/openapi` catalog feed for the sidebar, the
// current selection for the builder) and orchestrates selection — it never re-implements them.
//
// Every visible string resolves from the generated res/values catalog (ADR-014); the four required keys
// (playground.title / playground.subtitle / playground.selectEndpoint / playground.endpointCount) plus the shared
// error keys are sourced through `stringResource`. The four data states the web page renders are reproduced 1:1:
// loading (the spec fetch in flight → the sidebar skeleton + the select-endpoint prompt), error (the spec fetch
// failed → a retry surface, web `PageContainer error`), empty (the spec parsed to no operations → the sidebar's own
// empty + the select-endpoint prompt), and success (the catalog renders + a selection drives the builder).
//
// Honesty note (no silent drift, mirrors the SqlPlaygroundPage deferred-AI precedent): the web page additionally
// EXECUTES the built request in-browser via `fetch` and renders the live response. The native resilient
// `ApiHttpClient` the DataContainer exposes is a typed-decode client; it does not surface the raw status line +
// response headers a faithful response capture needs, and a raw exchange engine is outside this prompt's allowed
// files. So "Send" builds the request and reveals its runnable cURL/JS/Python/Go snippet (the genuinely useful,
// fully-wired capability), and the ResponseViewer renders its honest "send a request to see the response" state;
// live in-app response capture is left to a future client-capability wiring phase rather than faked with a synthetic
// response.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located content + section composables and the source-bridge helpers.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.admin.apiplayground

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.endpointsidebar.EndpointSidebar
import io.teslasync.android.featureviews.endpointsidebar.EndpointSidebarSource
import io.teslasync.android.featureviews.endpointsidebar.EndpointSidebarViewModel
import io.teslasync.android.featureviews.endpointsidebar.ParsedEndpoint
import io.teslasync.android.featureviews.requestbuilder.RequestBuilder
import io.teslasync.android.featureviews.requestbuilder.RequestBuilderProjection
import io.teslasync.android.featureviews.requestbuilder.RequestBuilderSource
import io.teslasync.android.featureviews.requestbuilder.RequestBuilderViewModel
import io.teslasync.android.featureviews.requestbuilder.RequestDraft
import io.teslasync.android.featureviews.responseviewer.ResponseViewer
import io.teslasync.android.featureviews.responseviewer.SnippetPanel
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/** The fixed height of the scrollable endpoint sidebar panel (web sidebar `w-72`, internally scrolling). */
private val SIDEBAR_HEIGHT: Dp = 360.dp

/** The height of one loading skeleton row (web sidebar `<Skeleton className="h-6 rounded" />`). */
private val SKELETON_ROW_HEIGHT: Dp = 24.dp

/** The number of skeleton rows the loading sidebar shows (web `Array.from({ length: 10 })`). */
private const val SKELETON_ROWS = 10

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: resolves the app data graph, builds the [ApiPlaygroundPageViewModel] over the shared resilient
 * client (`container.api`), and keys it to this surface's slug so it is scoped to the /api-playground navigation
 * entry. [logger] defaults to the app's redacting logger.
 */
@Composable
fun ApiPlaygroundPage(
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val container = LocalDataContainer.current
    val source = remember(container) { container.api.asApiPlaygroundSource() }
    val viewModel: ApiPlaygroundPageViewModel =
        viewModel(
            key = ApiPlaygroundPageRegistration.SLUG,
            factory = ApiPlaygroundPageViewModel.factory(source, logger),
        )
    ApiPlaygroundPage(viewModel = viewModel, modifier = modifier, logger = logger)
}

/**
 * Stateful entry: records the one-shot `view.opened` diagnostic (P1/S11), constructs the embedded EndpointSidebar +
 * RequestBuilder feature-view ViewModels (their sources stream this page's catalog feed + selection, P1/S8),
 * collects the page state, and binds the stateless content.
 */
@Composable
fun ApiPlaygroundPage(
    viewModel: ApiPlaygroundPageViewModel,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val sidebarSource = remember(viewModel) { viewModel.asEndpointSidebarSource() }
    val sidebarViewModel: EndpointSidebarViewModel =
        viewModel(
            key = "${ApiPlaygroundPageRegistration.SLUG}-sidebar",
            factory = EndpointSidebarViewModel.factory(sidebarSource, logger),
        )

    val builderSource = remember(viewModel) { viewModel.asRequestBuilderSource() }
    val builderViewModel: RequestBuilderViewModel =
        viewModel(
            key = "${ApiPlaygroundPageRegistration.SLUG}-builder",
            factory = RequestBuilderViewModel.factory(builderSource, logger),
        )

    val catalog by viewModel.catalog.collectAsStateWithLifecycle()
    val selected by viewModel.selected.collectAsStateWithLifecycle()
    val lastRequest by viewModel.lastRequest.collectAsStateWithLifecycle()

    ApiPlaygroundPageContent(
        catalog = catalog,
        selected = selected,
        lastRequest = lastRequest,
        sidebarViewModel = sidebarViewModel,
        builderViewModel = builderViewModel,
        onSelect = viewModel::select,
        onSend = viewModel::onSend,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body (web root `PageContainer > FadeIn`): the title/subtitle header, then the catalog-driven
 * body. The four web data states are reproduced 1:1 — loading (sidebar skeleton + select-endpoint prompt), error
 * (retry surface), empty (sidebar empty + select-endpoint prompt) and success (sidebar + selection-driven builder).
 */
@Composable
fun ApiPlaygroundPageContent(
    catalog: UiState<List<ParsedEndpoint>>,
    selected: ParsedEndpoint?,
    lastRequest: RequestDraft?,
    sidebarViewModel: EndpointSidebarViewModel,
    builderViewModel: RequestBuilderViewModel,
    onSelect: (ParsedEndpoint) -> Unit,
    onSend: (RequestDraft) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        ApiPlaygroundHeader()

        FadeIn {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                when {
                    catalog.isLoading -> ApiPlaygroundLoading()

                    catalog.isError -> ApiPlaygroundErrorPanel(onRetry = onRetry)

                    else ->
                        ApiPlaygroundLoaded(
                            endpoints = catalog.data ?: emptyList(),
                            selected = selected,
                            lastRequest = lastRequest,
                            sidebarViewModel = sidebarViewModel,
                            builderViewModel = builderViewModel,
                            onSelect = onSelect,
                            onSend = onSend,
                        )
                }
            }
        }
    }
}

/** The page header — the title heading + the muted subtitle (web `PageContainer` title/subtitle). */
@Composable
private fun ApiPlaygroundHeader() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        PageTitle(stringResource(R.string.translation_playground_title))
        BodyText(
            stringResource(R.string.translation_playground_subtitle),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

// ── Data states ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Loading surface (web `specLoading`): GlassPanel1 renders the ten-row sidebar skeleton (web `Array.from({ length:
 * 10 }).map(<Skeleton/>)`), and GlassPanel2 renders the select-endpoint prompt — so neither panel region is ever
 * blank while the spec is in flight.
 */
@Composable
private fun ApiPlaygroundLoading() {
    SidebarPanel {
        Column(
            modifier = Modifier.fillMaxWidth().padding(Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            repeat(SKELETON_ROWS) {
                Skeleton(modifier = Modifier.fillMaxWidth(), height = SKELETON_ROW_HEIGHT, rounded = true)
            }
        }
    }
    SelectEndpointPanel(endpointCount = 0)
}

/** Hard-error surface with a retry affordance (web `PageContainer error`). */
@Composable
private fun ApiPlaygroundErrorPanel(onRetry: () -> Unit) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(Spacing.xl2),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Icon(
                TeslaGlyphs.Octagon,
                contentDescription = null,
                size = IconSize.Xl,
                tint = MaterialTheme.colorScheme.error,
            )
            ErrorText(stringResource(R.string.translation_error_loadFailed))
            Button(
                label = stringResource(R.string.translation_error_retry),
                onClick = onRetry,
                variant = ButtonVariant.Secondary,
                size = ButtonSize.Sm,
            )
        }
    }
}

/**
 * The loaded body (web `!specLoading && !specError`): GlassPanel1 — the endpoint sidebar feature view (which renders
 * its own content / data-empty / search-empty states) — above the main area, which is GlassPanel2 (the select-
 * endpoint prompt + available count) until a row is chosen, then the request-builder experience.
 */
@Composable
private fun ApiPlaygroundLoaded(
    endpoints: List<ParsedEndpoint>,
    selected: ParsedEndpoint?,
    lastRequest: RequestDraft?,
    sidebarViewModel: EndpointSidebarViewModel,
    builderViewModel: RequestBuilderViewModel,
    onSelect: (ParsedEndpoint) -> Unit,
    onSend: (RequestDraft) -> Unit,
) {
    // GlassPanel1 — the endpoint sidebar (web sidebar GlassPanel).
    SidebarPanel {
        Box(modifier = Modifier.fillMaxWidth().height(SIDEBAR_HEIGHT)) {
            EndpointSidebar(
                viewModel = sidebarViewModel,
                modifier = Modifier.fillMaxWidth(),
                onEndpointSelected = onSelect,
            )
        }
    }

    if (selected == null) {
        // GlassPanel2 — the "select an endpoint" prompt + the available-endpoint count.
        SelectEndpointPanel(endpointCount = endpoints.size)
    } else {
        SelectedEndpointSection(
            builderViewModel = builderViewModel,
            lastRequest = lastRequest,
            onSend = onSend,
        )
    }
}

/** GlassPanel1 wrapper — an edge-to-edge glass panel for the sidebar (web `<GlassPanel className="overflow-hidden">`). */
@Composable
private fun SidebarPanel(content: @Composable () -> Unit) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.None) {
        content()
    }
}

/**
 * GlassPanel2 — the select-endpoint empty-state panel: the centered prompt (web `<EmptyState message={…} />`) and,
 * when the catalog has endpoints, the available-endpoint count line (web `playground.endpointCount`).
 */
@Composable
private fun SelectEndpointPanel(endpointCount: Int) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(Spacing.lg),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            EmptyState(message = stringResource(R.string.translation_playground_selectEndpoint))
            if (endpointCount > 0) {
                Caption(text = stringResource(R.string.translation_playground_endpointCount, endpointCount))
            }
        }
    }
}

/**
 * The selected-endpoint experience (web `selected` branch): the RequestBuilder form, the runnable code snippet for
 * the last dispatched request, and the ResponseViewer. See the file header honesty note — "Send" reveals the
 * snippet (the fully-wired capability); live in-app response capture is deferred, so the ResponseViewer renders its
 * own "send a request to see the response" state.
 */
@Composable
private fun SelectedEndpointSection(
    builderViewModel: RequestBuilderViewModel,
    lastRequest: RequestDraft?,
    onSend: (RequestDraft) -> Unit,
) {
    RequestBuilder(
        viewModel = builderViewModel,
        onSend = onSend,
        modifier = Modifier.fillMaxWidth(),
    )

    lastRequest?.let { draft ->
        SnippetPanel(
            method = draft.method,
            url = "${RequestBuilderProjection.API_PREFIX}${draft.url}",
            modifier = Modifier.fillMaxWidth(),
            body = draft.body,
        )
    }

    ResponseViewer(
        response = null,
        loading = false,
        history = emptyList(),
        onReplay = {},
        modifier = Modifier.fillMaxWidth(),
    )
}

// ── Feature-view source bridges ─────────────────────────────────────────────────────────────────────────────────

/**
 * Adapts this page's shared catalog feed to the EndpointSidebar's data seam (web `endpoints` prop). The sidebar's
 * own ViewModel re-projects the feed to its loading / content / empty / error surface; `refresh` is a no-op because
 * the page owns the re-fetch (its error surface's retry re-collects the feed).
 */
private fun ApiPlaygroundPageViewModel.asEndpointSidebarSource(): EndpointSidebarSource =
    object : EndpointSidebarSource {
        override fun endpoints(): Flow<Resource<List<ParsedEndpoint>>> = endpointsFeed()

        override suspend fun refresh() = Unit
    }

/**
 * Adapts this page's current selection to the RequestBuilder's data seam (web `endpoint` prop). A `null` selection
 * is the builder's data-empty state; a non-null selection drives the request form. `refresh` is a no-op (the
 * selection is local state, not a network feed).
 */
private fun ApiPlaygroundPageViewModel.asRequestBuilderSource(): RequestBuilderSource =
    object : RequestBuilderSource {
        override fun selectedEndpoint(): Flow<Resource<ParsedEndpoint?>> =
            selected.map { endpoint -> Resource.Success(endpoint, fetchedAt = 0L, stale = false) }

        override suspend fun refresh() = Unit
    }
