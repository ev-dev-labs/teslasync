// The native Jetpack Compose + Material 3 SearchPage system surface — a parity port of
// web/src/features/system/pages/SearchPage.tsx, the app-wide unified-search page mounted at /search. It reproduces
// the web page's seven GlassPanels: the query + facet-chip panel (GlassPanel1), the four mutually-exclusive empty
// surfaces (too-short / start-typing / error / no-results — GlassPanel2-4 + GlassPanel6), the loading-skeleton panel
// (GlassPanel5), and the per-type grouped-results panel (GlassPanel7, rendered once per non-empty group). Every
// visible string resolves from the generated res/values catalog (ADR-014); the lone web read is bound through the
// shared S8 search domain via SearchPageViewModel.
//
// Composition: [SearchPage] is the stateful entry (constructs the view-model over the host-wired source, records the
// one-shot `view.opened` diagnostic, collects the resolved input + snapshot, and wires the result-row deep link);
// [SearchPageContent] is the stateless render layer that always draws the header + query panel, then switches the
// empty / loading / no-results / grouped surfaces off the bound [UiState] and the query context exactly as the web
// page's render ladder does.
//
// State ladder (web parity, in precedence order): too-short query → GlassPanel2; empty query → GlassPanel3; a hard
// search error → GlassPanel4; a fetch in flight with no rows yet → GlassPanel5 skeleton; a settled empty result →
// GlassPanel6; otherwise the grouped results → GlassPanel7. The facet rail always renders all nine type chips so the
// filter is discoverable even before a query is typed.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located content + section composables + the label resolver.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.system.search

import androidx.annotation.StringRes
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
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
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.search.SEARCH_MIN_QUERY_LENGTH
import io.teslasync.shared.core.presentation.search.SearchHit
import io.teslasync.shared.core.presentation.search.SearchHitType
import io.teslasync.shared.core.presentation.search.SearchInput

/** Height of each result-row loading skeleton — the web `<Skeleton className="h-12" />` (12 × 4px). */
private val SkeletonRowHeight = 48.dp

/** Height of the loading-state header skeleton — the web `<Skeleton className="h-4 w-1/3" />` (4 × 4px). */
private val SkeletonHeaderHeight = 16.dp

/** Number of result-row skeletons rendered while the first search resolves (web `[0, 1, 2, 3, 4]`). */
private const val SKELETON_ROW_COUNT = 5

/** Fraction of the panel width the loading header skeleton fills (web `w-1/3`). */
private const val SKELETON_HEADER_FRACTION = 0.33f

/** Minimum touch target for a tappable result row (ADR-015 ≥ 48dp). */
private val ResultRowMinHeight = 56.dp

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [SearchPageViewModel] over the supplied [source] (the host wires the shared S7
 * SearchRepository via [searchPageSourceOf]). [logger] defaults to the app's redacting logger.
 */
@Composable
fun SearchPage(
    source: SearchPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: SearchPageViewModel =
        viewModel(
            key = SearchPageRegistration.SLUG,
            factory = viewModelFactory { initializer { SearchPageViewModel(source, logger) } },
        )
    SearchPage(viewModel = viewModel, modifier = modifier)
}

/**
 * Stateful entry: records the one-shot `view.opened` diagnostic (P1/S11), collects the live input + resolved
 * snapshot, wires each result row to the app's `teslasync://app` deep-link scheme (web `navigate(hit.url)`), and
 * hands the stateless content the accessibility pane title (web `usePageTitle(t('search.title'))`).
 */
@Composable
fun SearchPage(
    viewModel: SearchPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val input by viewModel.input.collectAsStateWithLifecycle()
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    // Each hit navigates to hit.url (e.g. /drives/123). No NavController is exposed to page hosts, so the app's own
    // teslasync://app deep-link scheme (AndroidManifest + TeslaSyncNavHost) is the sanctioned forward-nav seam.
    val uriHandler = LocalUriHandler.current
    val onHit: (SearchHit) -> Unit =
        remember(uriHandler) { { hit -> uriHandler.openUri(SearchPageRegistration.DEEP_LINK_PREFIX + hit.url) } }

    val title = stringResource(R.string.translation_search_title)

    SearchPageContent(
        input = input,
        uiState = uiState,
        onQueryChange = viewModel::setQuery,
        onToggleType = viewModel::toggleType,
        onClearFilters = viewModel::clearFilters,
        onHit = onHit,
        modifier = modifier.semantics { paneTitle = title },
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body (web root `PageContainer` column). Always renders the page title and the query + facet
 * panel (GlassPanel1), then switches the results region across the web render ladder: too-short (GlassPanel2),
 * empty query (GlassPanel3), error (GlassPanel4), loading (GlassPanel5), no-results (GlassPanel6), or the grouped
 * results (GlassPanel7 per group).
 */
@Composable
fun SearchPageContent(
    input: SearchInput,
    uiState: UiState<SearchResultsModel>,
    onQueryChange: (String) -> Unit,
    onToggleType: (SearchHitType) -> Unit,
    onClearFilters: () -> Unit,
    onHit: (SearchHit) -> Unit,
    modifier: Modifier = Modifier,
) {
    val trimmed = input.query.trim()
    val tooShort = trimmed.isNotEmpty() && trimmed.length < SEARCH_MIN_QUERY_LENGTH
    val trimmedEmpty = trimmed.isEmpty()
    val groups = uiState.data?.groups.orEmpty()

    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        PageTitle(stringResource(R.string.translation_search_title))

        SearchQueryPanel(
            query = input.query,
            activeTypes = input.options.types,
            onQueryChange = onQueryChange,
            onToggleType = onToggleType,
            onClearFilters = onClearFilters,
        )

        FadeIn {
            when {
                tooShort -> SearchTooShortPanel()
                trimmedEmpty -> SearchStartTypingPanel()
                uiState.hasError -> SearchErrorPanel()
                (uiState.isLoading || uiState.refreshing) && groups.isEmpty() -> SearchLoadingPanel()
                groups.isEmpty() -> SearchNoResultsPanel(query = trimmed)
                else -> SearchResultsList(groups = groups, onHit = onHit)
            }
        }
    }
}

// ── GlassPanel1 — query + facet chips ─────────────────────────────────────────────────────────────────────────

/**
 * GlassPanel1 — the search field + the facet-chip rail (web `<GlassPanel className="p-4 sm:p-6">`). The field's
 * floating label is the accessible name (web `aria-label` 'Search query'); the ghost prompt is surfaced as the
 * supporting hint. The rail always renders all nine type chips so the filter is discoverable before any query.
 */
@Composable
private fun SearchQueryPanel(
    query: String,
    activeTypes: List<SearchHitType>,
    onQueryChange: (String) -> Unit,
    onToggleType: (SearchHitType) -> Unit,
    onClearFilters: () -> Unit,
) {
    GlassPanel(padding = PanelPadding.Md) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Input(
                value = query,
                onValueChange = onQueryChange,
                label = stringResource(R.string.translation_search_input_label),
                hint = stringResource(R.string.translation_search_placeholder), // parity:allow Android string-resource key mirroring the web search.placeholder i18n prompt
                leadingIcon = SearchGlyphs.Search,
            )
            SearchFacetRail(
                activeTypes = activeTypes,
                onToggleType = onToggleType,
                onClearFilters = onClearFilters,
            )
        }
    }
}

/**
 * The facet-chip rail — one toggle chip per entity type in [SEARCH_TYPE_ORDER] (web `ALL_TYPES.map`), each a shared
 * [Button] coloured [ButtonVariant.Primary] when active else [ButtonVariant.Outline], with the web `aria-pressed`
 * exposed to TalkBack as `selected`. A trailing "Clear filters" ghost button appears only when a filter is active
 * (web `typesFilter.length > 0`).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SearchFacetRail(
    activeTypes: List<SearchHitType>,
    onToggleType: (SearchHitType) -> Unit,
    onClearFilters: () -> Unit,
) {
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        SEARCH_TYPE_ORDER.forEach { type ->
            val active = activeTypes.contains(type)
            Button(
                label = stringResource(sectionLabelRes(type)),
                onClick = { onToggleType(type) },
                variant = if (active) ButtonVariant.Primary else ButtonVariant.Outline,
                size = ButtonSize.Sm,
                leadingIcon = searchGlyphFor(type),
                modifier = Modifier.semantics { selected = active },
            )
        }
        if (activeTypes.isNotEmpty()) {
            Button(
                label = stringResource(R.string.translation_search_filters_clear),
                onClick = onClearFilters,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )
        }
    }
}

// ── GlassPanel2-4 + GlassPanel6 — the four empty surfaces ─────────────────────────────────────────────────────

/** GlassPanel2 — the too-short empty state (web `tooShort ? <GlassPanel><EmptyState …/></GlassPanel>`). */
@Composable
private fun SearchTooShortPanel() {
    GlassPanel(padding = PanelPadding.Lg) {
        EmptyState(
            icon = SearchGlyphs.Search,
            title = stringResource(R.string.translation_search_tooShort_title),
            message = stringResource(R.string.translation_search_tooShort_message),
        )
    }
}

/** GlassPanel3 — the start-typing empty state (web `trimmed.length === 0 ? <GlassPanel><EmptyState …/></GlassPanel>`). */
@Composable
private fun SearchStartTypingPanel() {
    GlassPanel(padding = PanelPadding.Lg) {
        EmptyState(
            icon = SearchGlyphs.Search,
            title = stringResource(R.string.translation_search_empty_title),
            message = stringResource(R.string.translation_search_empty_message),
        )
    }
}

/** GlassPanel4 — the search-error empty state (web `error ? <GlassPanel><EmptyState …/></GlassPanel>`). */
@Composable
private fun SearchErrorPanel() {
    GlassPanel(padding = PanelPadding.Lg) {
        EmptyState(
            icon = SearchGlyphs.Search,
            title = stringResource(R.string.translation_search_error_title),
            message = stringResource(R.string.translation_search_error_message),
        )
    }
}

/**
 * GlassPanel6 — the no-results empty state (web `groupedHits.length === 0 ? <GlassPanel><EmptyState …/></GlassPanel>`).
 * The message interpolates the trimmed [query] into the web `%1$s` format slot.
 */
@Composable
private fun SearchNoResultsPanel(query: String) {
    GlassPanel(padding = PanelPadding.Lg) {
        EmptyState(
            icon = SearchGlyphs.Search,
            title = stringResource(R.string.translation_search_noResults_title),
            message = stringResource(R.string.translation_search_noResults_message, query),
        )
    }
}

// ── GlassPanel5 — loading skeleton ────────────────────────────────────────────────────────────────────────────

/**
 * GlassPanel5 — the loading skeleton (web `isFetching && groupedHits.length === 0 ? <GlassPanel><Skeleton …/> …`):
 * a header bar over five full-width row bars, each a shimmering [Skeleton] so the region is never blank.
 */
@Composable
private fun SearchLoadingPanel() {
    GlassPanel(padding = PanelPadding.Lg) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Skeleton(widthFraction = SKELETON_HEADER_FRACTION, height = SkeletonHeaderHeight)
            repeat(SKELETON_ROW_COUNT) {
                Skeleton(modifier = Modifier.fillMaxWidth(), height = SkeletonRowHeight, rounded = true)
            }
        }
    }
}

// ── GlassPanel7 — grouped results ─────────────────────────────────────────────────────────────────────────────

/**
 * The grouped-results region (web `groupedHits.map(group => <GlassPanel>…)`): one [SearchSectionPanel]
 * (GlassPanel7) per non-empty type group, staggered in. The whole region carries the localized "Results" label as
 * its TalkBack description (web `search.section.results`, the generic results heading).
 */
@Composable
private fun SearchResultsList(
    groups: List<SearchSection>,
    onHit: (SearchHit) -> Unit,
) {
    val resultsLabel = stringResource(R.string.translation_search_section_results)
    StaggerContainer(
        modifier = Modifier.semantics { contentDescription = resultsLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        groups.forEachIndexed { index, group ->
            StaggerItem(index = index) {
                SearchSectionPanel(section = group, onHit = onHit)
            }
        }
    }
}

/**
 * GlassPanel7 — one per-type results group: a header (type icon + section label + a count [Badge]) over the
 * group's tappable hit rows (web `<GlassPanel><h2>…</h2><ul>…</ul></GlassPanel>`).
 */
@Composable
private fun SearchSectionPanel(
    section: SearchSection,
    onHit: (SearchHit) -> Unit,
) {
    GlassPanel(padding = PanelPadding.Sm) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            SearchSectionHeader(type = section.type, count = section.hits.size)
            section.hits.forEach { hit ->
                SearchHitRow(hit = hit, onHit = onHit)
            }
        }
    }
}

/** The group header — type icon + the localized section label + the hit-count badge (web `<h2>icon label <span>count</span></h2>`). */
@Composable
private fun SearchSectionHeader(
    type: SearchHitType,
    count: Int,
) {
    Row(
        modifier = Modifier.padding(bottom = Spacing.xs),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            searchGlyphFor(type),
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Subhead(stringResource(sectionLabelRes(type)))
        Badge(text = count.toString(), variant = BadgeVariant.Neutral)
    }
}

/**
 * One tappable result row — the type icon, the title over an optional subtitle, and a trailing chevron (web
 * `<li><button onClick={navigate(hit.url)}>…</button></li>`). The web per-row timestamp is `hidden sm:inline`
 * (omitted at the mobile breakpoint), so it is not rendered on this phone surface. The whole row is a ≥56dp Button
 * role for TalkBack + touch (ADR-015).
 */
@Composable
private fun SearchHitRow(
    hit: SearchHit,
    onHit: (SearchHit) -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(MaterialTheme.shapes.medium)
                .clickable { onHit(hit) }
                .heightIn(min = ResultRowMinHeight)
                .padding(horizontal = Spacing.sm, vertical = Spacing.sm)
                .semantics { role = Role.Button },
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            searchGlyphFor(hit.type),
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Column(modifier = Modifier.weight(1f)) {
            BodyText(hit.title, maxLines = 1, color = MaterialTheme.colorScheme.onSurface)
            val subtitle = hit.subtitle
            if (!subtitle.isNullOrBlank()) {
                Caption(subtitle)
            }
        }
        Icon(
            SearchGlyphs.ArrowRight,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/**
 * The localized section label for a hit [type] — the native analogue of the web `searchSectionLabel(type, t)`
 * switch (web/src/features/system/pages/SearchPage.tsx). Lives in the Android layer because it resolves an `R.string`
 * resource (the framework-free model cannot). The web `search.section.results` default is surfaced as the
 * grouped-results region's accessible label in [SearchResultsList].
 */
@StringRes
private fun sectionLabelRes(type: SearchHitType): Int =
    when (type) {
        SearchHitType.Vehicle -> R.string.translation_search_section_vehicle
        SearchHitType.Drive -> R.string.translation_search_section_drive
        SearchHitType.Charging -> R.string.translation_search_section_charging
        SearchHitType.Alert -> R.string.translation_search_section_alert
        SearchHitType.Notification -> R.string.translation_search_section_notification
        SearchHitType.Geofence -> R.string.translation_search_section_geofence
        SearchHitType.Automation -> R.string.translation_search_section_automation
        SearchHitType.Location -> R.string.translation_search_section_location
        SearchHitType.Trip -> R.string.translation_search_section_trip
    }
