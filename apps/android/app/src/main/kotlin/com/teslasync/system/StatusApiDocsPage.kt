// The native Jetpack Compose + Material 3 StatusApiDocsPage system surface — a parity port of
// web/src/features/system/pages/StatusApiDocsPage.tsx, the public `/api/v1/status` contract docs mounted at
// /docs/status-api. It reproduces the web page's header (title + subtitle + the "Back to System Status" action),
// the Overview panel (GlassPanel1), the per-endpoint cards (GlassPanel2 — every endpoint with its method badge,
// path, optional query spec, description, and an expandable example-response JSON block), and the closing
// help/footer panel (GlassPanel3). Every visible string resolves from the platform res/values catalog (ADR-014);
// the page reads no API (the web page renders a hardcoded `<Endpoint>` list), so the static catalog lives in the
// framework-free model and is projected through the shared UiState surface by the view-model.
//
// Composition: [StatusApiDocsPage] is the stateful entry (constructs the view-model over the static catalog, records
// the one-shot `view.opened` diagnostic, collects the resolved snapshot, resolves the back-navigation seam);
// [StatusApiDocsPageContent] is the stateless render layer that switches the loading / error / empty / success
// surfaces off the bound [UiState] and lays out the overview panel, the endpoint cards, and the footer.
//
// Protocol-token note: the HTTP method ("GET"), the endpoint paths, the query specs, and the example JSON bodies are
// wire/protocol identifiers carried verbatim from the web `<Endpoint>` props (the web hardcodes them too); they are
// not localizable UI copy, so they round-trip as model data rather than string resources. Every human-readable
// literal (title, subtitle, descriptions, labels, footer) is externalized.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located content + section composables.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.system.statusapidocs

import androidx.activity.compose.LocalOnBackPressedDispatcherOwner
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.StaggerContainer
import io.teslasync.android.components.motion.StaggerItem
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Height of each endpoint-card loading skeleton (the static catalog never actually shows this). */
private val CardSkeletonHeight = 132.dp

/** Number of skeleton cards shown if a load were ever in flight (web has no spinner; kept for state symmetry). */
private const val SKELETON_COUNT = 4

/** The query-string sigil the web renders before a `query` spec (`?{query}`). A protocol token, not localized copy. */
private const val QUERY_PREFIX = "?"

// ── Stateful entry points ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [StatusApiDocsPageViewModel] over the static canonical catalog. [logger] defaults
 * to the app's redacting logger. The view-model is keyed by this surface's slug so it is scoped to the
 * /docs/status-api entry.
 */
@Composable
fun StatusApiDocsPage(
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: StatusApiDocsPageViewModel =
        viewModel(
            key = StatusApiDocsPageRegistration.SLUG,
            factory = viewModelFactory { initializer { StatusApiDocsPageViewModel(logger = logger) } },
        )
    StatusApiDocsPage(viewModel = viewModel, modifier = modifier)
}

/**
 * Stateful entry: records the one-shot `view.opened` diagnostic (P1/S11), collects the resolved snapshot, resolves
 * the web `<Link to="/system-status">` action to the system back-dispatcher (the sanctioned page-host navigation
 * seam — no `LocalNavController` is exposed to hosts; mirrors the sibling CommandHistoryPage precedent), and hands
 * the stateless content the accessibility pane title (web `usePageTitle(...)`).
 */
@Composable
fun StatusApiDocsPage(
    viewModel: StatusApiDocsPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val title = stringResource(R.string.translation_statusApiDocs_title)

    val backDispatcher = LocalOnBackPressedDispatcherOwner.current?.onBackPressedDispatcher
    val onBackToSystemStatus: () -> Unit = remember(backDispatcher) { { backDispatcher?.onBackPressed() ?: Unit } }

    StatusApiDocsPageContent(
        uiState = uiState,
        onBackToSystemStatus = onBackToSystemStatus,
        onRetry = viewModel::retry,
        modifier = modifier.semantics { paneTitle = title },
    )
}

// ── Stateless content ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body (web root `PageContainer` column). Renders the title/subtitle/back header, then switches
 * off the bound [uiState]: the loading skeletons, the hard-error retry surface, the no-data empty-state, or — on
 * success — the FadeIn Overview panel (GlassPanel1), the per-endpoint cards (GlassPanel2), and the footer panel
 * (GlassPanel3). No region ever collapses to blank.
 */
@Composable
fun StatusApiDocsPageContent(
    uiState: UiState<StatusApiDocsSnapshot>,
    onBackToSystemStatus: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val snapshot = uiState.data

    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        StatusApiDocsHeader(onBackToSystemStatus = onBackToSystemStatus)

        when {
            uiState.isLoading -> StatusApiDocsLoading()
            uiState.isError -> StatusApiDocsError(onRetry = onRetry)
            snapshot == null || snapshot.isEmpty -> StatusApiDocsEmpty()
            else -> {
                FadeIn { OverviewPanel() }
                StaggerContainer(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                    snapshot.endpoints.forEachIndexed { index, endpoint ->
                        StaggerItem(index = index) { EndpointCard(endpoint = endpoint) }
                    }
                }
                FadeIn { FooterPanel() }
            }
        }
    }
}

/** The page header — title + subtitle (web `PageContainer` title/subtitle) and the trailing back action. */
@Composable
private fun StatusApiDocsHeader(onBackToSystemStatus: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.Top,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PageTitle(stringResource(R.string.translation_statusApiDocs_title))
            BodyText(
                stringResource(R.string.translation_statusApiDocs_subtitle),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Button(
            label = stringResource(R.string.translation_statusApiDocs_back),
            onClick = onBackToSystemStatus,
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
            leadingIcon = StatusApiDocsGlyphs.ArrowLeft,
        )
    }
}

/**
 * GlassPanel1 — the Overview panel. A Server-iconed heading above the two contract paragraphs and the amber
 * additive-only note (web Code-iconed callout).
 */
@Composable
private fun OverviewPanel() {
    val heading = stringResource(R.string.translation_statusApiDocs_overviewTitle)
    GlassPanel(
        modifier = Modifier.semantics { contentDescription = heading },
        padding = PanelPadding.Md,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Row(
                modifier = Modifier.semantics { heading() },
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(StatusApiDocsGlyphs.Server, contentDescription = null, size = IconSize.Md)
                PanelTitle(heading)
            }
            BodyText(
                stringResource(R.string.translation_statusApiDocs_overviewBody1),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            BodyText(
                stringResource(R.string.translation_statusApiDocs_overviewBody2),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.Top,
            ) {
                Icon(
                    StatusApiDocsGlyphs.Code,
                    contentDescription = null,
                    size = IconSize.Sm,
                    tint = TeslaTokens.status.warning,
                )
                BodyText(
                    stringResource(R.string.translation_statusApiDocs_additiveNote),
                    modifier = Modifier.weight(1f),
                    color = TeslaTokens.status.warning,
                )
            }
        }
    }
}

/**
 * GlassPanel2 — one endpoint card. A header row (method Badge + monospace path + optional query spec) above the
 * endpoint description and the expandable example-response disclosure.
 */
@Composable
private fun EndpointCard(endpoint: StatusEndpoint) {
    GlassPanel(
        modifier = Modifier.semantics { contentDescription = endpoint.path },
        padding = PanelPadding.Md,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Badge(text = methodLabel(endpoint.method), variant = BadgeVariant.Info)
                CodeText(endpoint.path, modifier = Modifier.weight(1f))
                val query = endpoint.query
                if (query != null) {
                    Caption(QUERY_PREFIX + query)
                }
            }
            BodyText(
                stringResource(endpointDescriptionRes(endpoint.id)),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            ExampleDisclosure(exampleJson = endpoint.exampleJson)
        }
    }
}

/** The web `<details><summary>Example response</summary><pre>…</pre></details>` disclosure as a Compose toggle. */
@Composable
private fun ExampleDisclosure(exampleJson: String) {
    var expanded by remember { mutableStateOf(false) }
    val label = stringResource(R.string.translation_statusApiDocs_exampleResponse)
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(
            text = label,
            modifier =
                Modifier
                    .clickable { expanded = !expanded }
                    .semantics { contentDescription = label },
        )
        if (expanded) {
            JsonBlock(json = exampleJson)
        }
    }
}

/** A monospace, horizontally-scrollable code block on a tonal surface — the web `<pre overflow-x-auto>`. */
@Composable
private fun JsonBlock(json: String) {
    Surface(
        shape = RoundedCornerShape(Radius.sm),
        color = MaterialTheme.colorScheme.surfaceVariant,
        contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
    ) {
        CodeText(
            json,
            modifier =
                Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(Spacing.md),
        )
    }
}

/** GlassPanel3 — the closing help/footer panel (web muted "need an additional endpoint?" callout). */
@Composable
private fun FooterPanel() {
    GlassPanel(padding = PanelPadding.Md) {
        HelperText(stringResource(R.string.translation_statusApiDocs_footer))
    }
}

/** The no-data empty-state — the catalog never resolves to empty, but the seam is implemented for state symmetry. */
@Composable
private fun StatusApiDocsEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_common_noData),
        icon = StatusApiDocsGlyphs.Server,
    )
}

/** The hard-error retry surface — the static catalog never errors, but the seam is implemented for state symmetry. */
@Composable
private fun StatusApiDocsError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_loadFailed),
        icon = StatusApiDocsGlyphs.Server,
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_error_retry),
    )
}

/** The loading skeletons (the static catalog never actually loads, but the surface is implemented for symmetry). */
@Composable
private fun StatusApiDocsLoading() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        repeat(SKELETON_COUNT) {
            Skeleton(modifier = Modifier.fillMaxWidth(), height = CardSkeletonHeight, rounded = true)
        }
    }
}

// ── Visual mapping (Android resources live here, never in the framework-free model) ───────────────────────────

/** The HTTP method badge label — a protocol token, carried verbatim from the web `method` prop (not localized). */
private fun methodLabel(method: StatusHttpMethod): String =
    when (method) {
        StatusHttpMethod.Get -> "GET"
    }

/** Maps a stable [StatusEndpointId] to its localized description string (web `<Endpoint description>` prop). */
private fun endpointDescriptionRes(id: StatusEndpointId): Int =
    when (id) {
        StatusEndpointId.Overall -> R.string.translation_statusApiDocs_overallDescription
        StatusEndpointId.Components -> R.string.translation_statusApiDocs_componentsDescription
        StatusEndpointId.Resources -> R.string.translation_statusApiDocs_resourcesDescription
        StatusEndpointId.Uptime -> R.string.translation_statusApiDocs_uptimeDescription
        StatusEndpointId.Incidents -> R.string.translation_statusApiDocs_incidentsDescription
        StatusEndpointId.Live -> R.string.translation_statusApiDocs_liveDescription
    }
