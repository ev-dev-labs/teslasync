// The native Jetpack Compose + Material 3 ExplorePage feature-hub surface — a parity port of
// web/src/features/explore/pages/ExplorePage.tsx, the "front door" to every feature in the app. It reproduces
// the page's title + live subtitle, the recently-visited strip (GlassPanel-less chip row), the search panel
// (GlassPanel1) with its labeled filter field + the section-anchor overview strip, the categorized feature-card
// grid with in-title/-description query highlighting, and the no-results empty panel (GlassPanel2) with its
// "did you mean" Levenshtein suggestions + clear affordance — every visible string resolved from the generated
// res/values catalog (ADR-014), gated exactly as the web sidebar by the bound `useVehicles` count +
// `useIsForwardAuth` mode.
//
// Composition: [ExplorePage] is the stateful entry (constructs the view-model over the host-wired source, records
// the one-shot `view.opened` diagnostic, collects the gate + the recent feed, and wires forward navigation
// through the shared DeepLinkRouter seam — the sanctioned page-host navigation path, since no NavController is
// exposed to hosts); [ExplorePageContent] is the stateless render layer that builds the localized catalog from
// the shared nav registry and switches the data surfaces. All derivation (gating, filter, grouping, highlight,
// suggestions) lives in the framework-free model (ExplorePageModel.kt).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/explore) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for
// the co-located stateless content + sub-components; `TooManyFunctions`/`LongMethod`/`LongParameterList` for the
// parity-complete region set.
@file:OptIn(ExperimentalLayoutApi::class)
@file:Suppress(
    "InvalidPackageDeclaration",
    "MatchingDeclarationName",
    "TooManyFunctions",
    "LongMethod",
    "LongParameterList",
)

package io.teslasync.android.explore

import android.content.Context
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.feedback.PageLoader
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.recentlyviewed.RecentPageEntry
import io.teslasync.android.navigation.Destinations
import io.teslasync.android.navigation.NavGlyphs
import io.teslasync.android.navigation.RouteTable
import io.teslasync.android.navigation.navGroupTitleRes
import io.teslasync.android.navigation.navIcon
import io.teslasync.android.navigation.navTitleRes
import io.teslasync.android.notifications.LocalDeepLinkRouter
import io.teslasync.android.ui.theme.generated.Elevation
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

private const val HIGHLIGHT_ALPHA = 0.25f
private const val CARD_COLUMNS = 2
private val IconBoxSize = 36.dp

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [ExplorePageViewModel] over the supplied [source] (the host wires the shared
 * Vehicles + auth-mode holders + the on-device recent-pages store via [explorePageSourceOf]). [logger] defaults
 * to the app's redacting logger.
 */
@Composable
fun ExplorePage(
    source: ExplorePageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: ExplorePageViewModel =
        viewModel(
            key = ExplorePageRegistration.SLUG,
            factory = viewModelFactory { initializer { ExplorePageViewModel(source, logger) } },
        )
    ExplorePage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] gate + recent feed to the content and wires forward navigation. */
@Composable
fun ExplorePage(
    viewModel: ExplorePageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val recent by viewModel.recent.collectAsStateWithLifecycle()

    // Forward navigation to a feature route goes through the shared DeepLinkRouter (the same seam widget /
    // shortcut / notification taps use) — no LocalNavController is exposed to page hosts, so this is the
    // sanctioned path. A feature path (e.g. `/drives`) becomes the app's own deep-link URI.
    val deepLinkRouter = LocalDeepLinkRouter.current
    val onNavigate: (String) -> Unit =
        remember(deepLinkRouter) {
            { path -> deepLinkRouter?.request("${RouteTable.APP_SCHEME}://app$path") }
        }

    // URL-driven query on the web (`?q=`); the native analogue is config-change-surviving screen state.
    var query by rememberSaveable { mutableStateOf("") }

    // The screen title (web `usePageTitle(t('explore.pageTitle'))`) surfaced as the accessibility pane title.
    val pageTitle = stringResource(R.string.translation_explore_pageTitle)

    ExplorePageContent(
        uiState = uiState,
        recentEntries = recent,
        query = query,
        onQueryChange = { query = it },
        onNavigate = onNavigate,
        onRetry = viewModel::retry,
        modifier = modifier.semantics { paneTitle = pageTitle },
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body. While the gate is first loading (no cached value yet) it shows the centered loader so
 * no region flashes blank; otherwise it builds the localized catalog from the shared nav registry (gated by the
 * resolved fleet count + auth mode), then renders the header, the recently-visited strip, the search panel
 * (GlassPanel1) + anchor strip, and either the no-results empty panel (GlassPanel2) or the categorized
 * feature-card bands. The catalog renders from the first resolved frame, exactly as the web page renders it
 * immediately with `vehicleCount` defaulting to `0`.
 */
@Composable
fun ExplorePageContent(
    uiState: UiState<ExploreGate>,
    recentEntries: List<RecentPageEntry>,
    query: String,
    onQueryChange: (String) -> Unit,
    onNavigate: (String) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val gate = uiState.data
    if (uiState.isLoading || gate == null) {
        PageLoader(modifier = modifier)
        return
    }

    val context = LocalContext.current
    val catalog = remember(context, gate.vehicleCount, gate.isForwardAuth) { buildExploreCatalog(context, gate) }
    val filtered = remember(catalog, query) { filterExploreCatalog(catalog, query) }
    val grouped = remember(filtered) { groupExploreCatalog(filtered) }
    val recentResolved = remember(catalog, recentEntries) { resolveRecentEntries(catalog, recentEntries) }

    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        ExploreHeader(
            uiState = uiState,
            totalFeatures = catalog.size,
            matchCount = filtered.size,
            query = query,
            onRetry = onRetry,
        )

        // Recently visited — only when not filtering (web: filtering implies narrowing the full catalog).
        if (query.isEmpty() && recentResolved.isNotEmpty()) {
            FadeIn { ExploreRecentStrip(entries = recentResolved, onNavigate = onNavigate) }
        }

        ExploreSearchPanel(query = query, onQueryChange = onQueryChange, sections = grouped)

        if (grouped.isEmpty()) {
            FadeIn {
                ExploreEmptyResult(
                    query = query,
                    catalog = catalog,
                    onPickSuggestion = { path ->
                        onQueryChange("")
                        onNavigate(path)
                    },
                    onClear = { onQueryChange("") },
                )
            }
        } else {
            grouped.forEach { section ->
                FadeIn { ExploreSectionBand(section = section, query = query, onNavigate = onNavigate) }
            }
        }
    }
}

// ── Header (web PageContainer title + subtitle + freshness) ────────────────────────────────────────────────────

/** The page header — the `<h1>` title (web `explore.title`) + the live subtitle + a query-freshness chip. */
@Composable
private fun ExploreHeader(
    uiState: UiState<ExploreGate>,
    totalFeatures: Int,
    matchCount: Int,
    query: String,
    onRetry: () -> Unit,
) {
    val subtitle =
        if (query.isEmpty()) {
            stringResource(R.string.translation_explore_subtitle_all, totalFeatures)
        } else {
            stringResource(R.string.translation_explore_subtitle_filtered, matchCount, totalFeatures, query)
        }
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Top,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PageTitle(stringResource(R.string.translation_explore_title))
            HelperText(subtitle)
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            DataFreshness(
                updatedAtMillis = uiState.fetchedAt?.takeIf { it > 0L },
                isFetching = uiState.refreshing,
                isStale = uiState.stale,
                isError = uiState.hasError,
                compact = true,
            )
            if (uiState.canRetry) {
                Button(
                    label = stringResource(R.string.translation_common_retry),
                    onClick = onRetry,
                    variant = ButtonVariant.Ghost,
                    size = ButtonSize.Sm,
                )
            }
        }
    }
}

// ── Recently visited (web RecentStrip) ──────────────────────────────────────────────────────────────────────

/** The recently-visited chip strip — the web `RecentStrip` (`explore.recent.heading` + a wrap of feature chips). */
@Composable
private fun ExploreRecentStrip(
    entries: List<ExploreEntry>,
    onNavigate: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Subhead(stringResource(R.string.translation_explore_recent_heading))
            Caption(entries.size.toString())
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            entries.forEach { entry ->
                ExploreNavChip(label = entry.label, iconId = entry.id, onClick = { onNavigate(entry.path) })
            }
        }
    }
}

/** A pill chip carrying a feature icon + label, navigating on tap (web recent-strip `<a>`). */
@Composable
private fun ExploreNavChip(
    label: String,
    iconId: String,
    onClick: () -> Unit,
) {
    val icon = remember(iconId) { navIcon(Destinations.require(iconId)) }
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(percent = 50),
        color = MaterialTheme.colorScheme.surfaceVariant,
        contentColor = MaterialTheme.colorScheme.onSurface,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = Spacing.md, vertical = Spacing.sm),
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(icon, contentDescription = null, size = IconSize.Sm, tint = MaterialTheme.colorScheme.primary)
            Text(label, style = MaterialTheme.typography.labelLarge)
        }
    }
}

// ── Search panel (GlassPanel1) + anchor strip ──────────────────────────────────────────────────────────────────

/**
 * GlassPanel1 — the search panel (web sticky search `<GlassPanel>`): a labeled filter field whose value is the
 * query, plus the section-anchor overview strip when there are results. The field's label is the search-label
 * key and its supporting hint is the search-hint key (web's in-field ghost prompt).
 */
@Composable
private fun ExploreSearchPanel(
    query: String,
    onQueryChange: (String) -> Unit,
    sections: List<ExploreSection>,
) {
    GlassPanel(padding = PanelPadding.Md) {
        Input(
            value = query,
            onValueChange = onQueryChange,
            label = stringResource(R.string.translation_explore_searchLabel),
            hint = stringResource(R.string.translation_explore_searchPlaceholder), // parity:allow web i18n key name, not a stub marker
            leadingIcon = NavGlyphs.Search,
        )
        if (sections.isNotEmpty()) {
            ExploreAnchorStrip(sections = sections)
        }
    }
}

/**
 * The section-anchor overview strip (web `SectionAnchorStrip`): one chip per section with its match count. The
 * web jump-links become a labeled section index on a touch surface; the container carries the
 * `explore.sectionsAriaLabel` navigation label and each count carries the `explore.anchorCountAria` label.
 */
@Composable
private fun ExploreAnchorStrip(sections: List<ExploreSection>) {
    val sectionsLabel = stringResource(R.string.translation_explore_sectionsAriaLabel)
    FlowRow(
        modifier = Modifier.fillMaxWidth().padding(top = Spacing.sm).semantics { contentDescription = sectionsLabel },
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        sections.forEach { section ->
            val countLabel = stringResource(R.string.translation_explore_anchorCountAria, section.entries.size)
            Surface(
                shape = RoundedCornerShape(percent = 50),
                color = MaterialTheme.colorScheme.surfaceVariant,
                contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = Spacing.md, vertical = Spacing.xs),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(section.section, style = MaterialTheme.typography.labelMedium)
                    Text(
                        section.entries.size.toString(),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.semantics { contentDescription = countLabel },
                    )
                }
            }
        }
    }
}

// ── Section band + feature card (web SectionBand + FeatureCard) ───────────────────────────────────────────────

/** A section band: the section heading + its count, then the categorized feature-card grid (web `SectionBand`). */
@Composable
private fun ExploreSectionBand(
    section: ExploreSection,
    query: String,
    onNavigate: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Subhead(section.section)
            Caption(section.entries.size.toString())
        }
        FlowRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
            maxItemsInEachRow = CARD_COLUMNS,
        ) {
            section.entries.forEach { entry ->
                ExploreFeatureCard(
                    entry = entry,
                    query = query,
                    onNavigate = onNavigate,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

/** A single feature card: icon box + highlighted label + 2-line highlighted description (web `FeatureCard`). */
@Composable
private fun ExploreFeatureCard(
    entry: ExploreEntry,
    query: String,
    onNavigate: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val icon = remember(entry.id) { navIcon(Destinations.require(entry.id)) }
    Surface(
        onClick = { onNavigate(entry.path) },
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        tonalElevation = Elevation.raised,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Row(
            modifier = Modifier.padding(Spacing.md).semantics(mergeDescendants = true) {},
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.Top,
        ) {
            Box(
                modifier =
                    Modifier
                        .size(IconBoxSize)
                        .clip(MaterialTheme.shapes.medium)
                        .background(MaterialTheme.colorScheme.surfaceVariant),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon, contentDescription = null, size = IconSize.Md, tint = MaterialTheme.colorScheme.primary)
            }
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                HighlightedText(
                    text = entry.label,
                    query = query,
                    style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 2,
                )
                HighlightedText(
                    text = entry.description,
                    query = query,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                )
            }
        }
    }
}

// ── Empty result (GlassPanel2) ───────────────────────────────────────────────────────────────────────────────

/**
 * GlassPanel2 — the no-results empty panel (web `EmptyResult`): the search glyph, the `explore.empty.title`
 * (with the query), the `explore.empty.body`, the "did you mean" Levenshtein suggestions over the visible
 * catalog, and the clear-filter affordance.
 */
@Composable
private fun ExploreEmptyResult(
    query: String,
    catalog: List<ExploreEntry>,
    onPickSuggestion: (String) -> Unit,
    onClear: () -> Unit,
) {
    val suggestions = remember(query, catalog) { closestExploreRoutes(query, catalog) }
    GlassPanel(padding = PanelPadding.Lg) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            Icon(
                NavGlyphs.Search,
                contentDescription = null,
                size = IconSize.Xl,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            PanelTitle(stringResource(R.string.translation_explore_empty_title, query))
            HelperText(stringResource(R.string.translation_explore_empty_body))

            if (suggestions.isNotEmpty()) {
                Caption(stringResource(R.string.translation_explore_empty_didYouMean))
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(Spacing.xs),
                ) {
                    suggestions.forEach { suggestion ->
                        ExploreSuggestionRow(suggestion = suggestion, onClick = { onPickSuggestion(suggestion.path) })
                    }
                }
            }

            Button(
                label = stringResource(R.string.translation_explore_empty_clear),
                onClick = onClear,
                variant = ButtonVariant.Secondary,
                size = ButtonSize.Sm,
            )
        }
    }
}

/** One "did you mean" suggestion row: the feature label + its path, navigating on tap (web suggestion button). */
@Composable
private fun ExploreSuggestionRow(
    suggestion: ExploreSuggestion,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surfaceVariant,
        contentColor = MaterialTheme.colorScheme.onSurface,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.md, vertical = Spacing.sm),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(suggestion.label, style = MaterialTheme.typography.bodyMedium)
            Text(
                suggestion.path,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

// ── Highlight (web Highlight) ─────────────────────────────────────────────────────────────────────────────────

/** Renders [text] with the query-token runs wrapped in a primary wash — the web `<mark>` highlight. */
@Composable
private fun HighlightedText(
    text: String,
    query: String,
    style: TextStyle,
    color: Color,
    modifier: Modifier = Modifier,
    maxLines: Int = Int.MAX_VALUE,
) {
    val markBackground = MaterialTheme.colorScheme.primary.copy(alpha = HIGHLIGHT_ALPHA)
    val markForeground = MaterialTheme.colorScheme.onSurface
    val annotated =
        remember(text, query, markBackground, markForeground) {
            buildAnnotatedString {
                highlightExplore(text, query).forEach { segment ->
                    if (segment.isMatch) {
                        withStyle(SpanStyle(background = markBackground, color = markForeground)) { append(segment.text) }
                    } else {
                        append(segment.text)
                    }
                }
            }
        }
    Text(
        text = annotated,
        modifier = modifier,
        style = style,
        color = color,
        maxLines = maxLines,
        overflow = TextOverflow.Ellipsis,
    )
}

// ── Catalog builders (plain, Context-backed; the localized LayoutStrings precedent) ─────────────────────────────

/**
 * Build the localized, gated catalog from the shared nav registry ([RouteTable.drawerSections]) — the native
 * analogue of the web `buildFeatureCatalog()` over `navSections` + the `visibleCatalog` gate. Labels/sections
 * resolve through the already-localized nav catalog, descriptions through [ExploreDescriptions] (falling back to
 * the `Open %1$s.` template), and each entry is kept only when [ExploreGating] admits it for the current fleet +
 * auth context. Plain (non-`@Composable`) so the whole catalog is built once inside a `remember`, stable across
 * recompositions (e.g. on every search keystroke).
 */
private fun buildExploreCatalog(
    context: Context,
    gate: ExploreGate,
): List<ExploreEntry> {
    val out = ArrayList<ExploreEntry>()
    for (section in RouteTable.drawerSections) {
        val sectionTitle = context.getString(navGroupTitleRes(section.group))
        for (destination in section.items) {
            if (!ExploreGating.isVisible(destination.id, gate.vehicleCount, gate.isForwardAuth)) continue
            val label = context.getString(navTitleRes(destination.id))
            val descriptionRes = ExploreDescriptions.resFor(destination.webPath)
            val description =
                if (descriptionRes != null) {
                    context.getString(descriptionRes)
                } else {
                    context.getString(R.string.translation_explore_cardFallback, label)
                }
            out.add(
                ExploreEntry(
                    id = destination.id,
                    path = destination.webPath,
                    label = label,
                    section = sectionTitle,
                    description = description,
                ),
            )
        }
    }
    return out
}

/**
 * Resolve the on-device recent-page paths against the visible [catalog] — the web `recentResolved` (the first
 * [ExplorePageRegistration.RECENT_LIMIT] recent entries mapped to currently-visible features, capped again).
 */
private fun resolveRecentEntries(
    catalog: List<ExploreEntry>,
    recent: List<RecentPageEntry>,
): List<ExploreEntry> {
    val byPath = catalog.associateBy { it.path }
    return recent
        .take(ExplorePageRegistration.RECENT_LIMIT)
        .mapNotNull { byPath[it.path] }
        .take(ExplorePageRegistration.RECENT_LIMIT)
}
