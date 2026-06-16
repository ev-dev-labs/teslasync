// The native Jetpack Compose + Material 3 LocationsPage maps surface — a parity port of
// web/src/features/maps/pages/LocationsPage.tsx, the visited-locations-ranked-by-frequency dashboard. It reproduces
// the page's ten panels (the six summary stat cards, the two top-N bar-chart panels, the All-Locations list panel,
// and the per-location row card), both charts (a "by visits" + a "by time-spent" bar chart via the A3 chart
// wrappers, never a webview), every data state (loading skeleton / empty / error-retry / content, plus the
// cache-then-network stale/offline tier the bound state holder carries), and every visible string (resolved from the
// generated res/values catalog, ADR-014).
//
// Composition: [LocationsPage] is the stateful entry (constructs the view-model over the host-wired source, records
// the one-shot `view.opened` diagnostic, collects the visited-locations feed + the interaction snapshot + the AI
// applied-name hand-off + the live unit formatter); [LocationsPageContent] is the stateless render layer. The single
// `useLocations` feed powers everything; the framework-free model (LocationsPageModel.kt) folds it through the web
// `useMemo` chain (range filter ▸ stats ▸ search ▸ top-N series ▸ paginate) so the composable only resolves i18n,
// formats at the SI→display boundary, and draws. SI values (`total_duration_s` seconds) are converted to the user's
// units only here via the shared [io.teslasync.android.data.UnitFormatter] (Phase-48 SI-canonical; ADR-013 keeps the
// cache itself SI).
//
// The unnamed-location AI affordance is the real [AIAutoNameUnnamedLocations] shared surface, gated to its web
// default AI-off state (`useAiEnabled` ⇒ off) since the app DI graph exposes no name-draft SSE transport yet; its
// `onApplyName` is wired to the view-model so an accepted proposal surfaces the "ready to save" confirmation
// (`locations.aiAutoName.applied`), exactly as the web page threads `setAppliedName`.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/maps) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located stateless content + sub-components; `LongMethod`/`TooManyFunctions`/`LongParameterList` for the
// parity-complete set.
@file:Suppress(
    "InvalidPackageDeclaration",
    "MatchingDeclarationName",
    "TooManyFunctions",
    "LongMethod",
    "LongParameterList",
)

package io.teslasync.android.maps.locations

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.BarChartWrapper
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.ChartBlockSkeleton
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.EmptyStateAction
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.PageHeaderSkeleton
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.StatGridSkeleton
import io.teslasync.android.components.forms.ActiveFilter
import io.teslasync.android.components.forms.ActiveFilterChips
import io.teslasync.android.components.forms.DateRangeFilter
import io.teslasync.android.components.forms.SearchInput
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.maps.MapsGlyphs
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.Pagination
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.navigation.NavGlyphs
import io.teslasync.android.sharedsurfaces.aiautonameunnamedlocations.AIAutoNameUnnamedLocations
import io.teslasync.android.sharedsurfaces.aiautonameunnamedlocations.AiNameDraftSource
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.locations.VisitedLocation
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlinx.coroutines.flow.emptyFlow

/** Stagger between the body panels' entrance fades (web `FadeIn` cascade), in ms per panel ordinal. */
private const val FADE_STEP_MS = 50

/** The visits-chart panel body height (web `ResponsiveContainer` floor of 300). */
private val VISITS_CHART_HEIGHT = 300.dp

/** The time-spent-chart panel body height (web `ResponsiveContainer` floor of 280). */
private val TIME_CHART_HEIGHT = 280.dp

/** Stat cards per row in the overview grid (web `lg:grid-cols-6`, narrowed to 3 on a phone). */
private const val STAT_CARDS_PER_ROW = 3

/** The em dash shown when there is no most-visited place (web `topLocation?.address_name ?? '—'`). */
private const val EM_DASH = "\u2014"

/** The `/drives` deep link the no-locations empty-state CTA opens (web `actionTo={{ to: '/drives' }}`). */
private const val DRIVES_DEEP_LINK = "teslasync://app/drives"

// The web's data-viz accent hexes (dynamic chart / semantic stat-card tints, not static theme tokens — the sibling
// RegenEfficiencyPage / DrivesListPage precedent). Used for the stat-card glyph tints, the bar fills, and the
// rank-badge coloring.
private val LOC_GREEN = Color(0xFF10B981)
private val LOC_BLUE = Color(0xFF3B82F6)
private val LOC_CYAN = Color(0xFF06B6D4)
private val LOC_PURPLE = Color(0xFFA855F7)
private val LOC_AMBER = Color(0xFFF59E0B)

private const val ACCENT_BADGE_BG_ALPHA = 0.15f

/**
 * A draft source that never emits — the unnamed-location AI affordance is wired to the real
 * [AIAutoNameUnnamedLocations] surface but gated to its web default AI-off state, so this source is never collected
 * (the surface returns before touching it). It exists only to satisfy the surface's non-null seam until the app DI
 * graph exposes a name-draft SSE transport.
 */
private val DisabledAiNameDraftSource = AiNameDraftSource { emptyFlow() }

/** The page's interaction callbacks, wired to the [LocationsPageViewModel] (web event handlers). */
data class LocationsActions(
    val onSetSearch: (String) -> Unit,
    val onClearSearch: () -> Unit,
    val onSetPage: (Int) -> Unit,
    val onSetRange: (LocalDate, LocalDate) -> Unit,
    val onApplyName: (Long, String) -> Unit,
    val onViewDrives: () -> Unit,
    val onRetry: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [LocationsPageViewModel] over the supplied [source] (the host wires the shared
 * location repository + the app-scoped active-vehicle selection via [locationsPageSourceOf]). [logger] defaults to
 * the app's redacting logger.
 */
@Composable
fun LocationsPage(
    source: LocationsPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: LocationsPageViewModel =
        viewModel(
            key = LocationsPageRegistration.SLUG,
            factory = viewModelFactory { initializer { LocationsPageViewModel(source, logger) } },
        )
    LocationsPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] locations feed + interaction + applied-name hand-off + unit formatter. */
@Composable
fun LocationsPage(
    viewModel: LocationsPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val locationsState by viewModel.locationsState.collectAsStateWithLifecycle()
    val interaction by viewModel.interaction.collectAsStateWithLifecycle()
    val appliedNames by viewModel.appliedNames.collectAsStateWithLifecycle()
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()

    val context = LocalContext.current
    val actions =
        remember(viewModel, context) {
            LocationsActions(
                onSetSearch = viewModel::setSearch,
                onClearSearch = viewModel::clearSearch,
                onSetPage = viewModel::setPage,
                onSetRange = viewModel::setRange,
                onApplyName = viewModel::applyName,
                onViewDrives = { openDrivesDeepLink(context) },
                onRetry = viewModel::retry,
            )
        }

    LocationsPageContent(
        locationsState = locationsState,
        interaction = interaction,
        appliedNames = appliedNames,
        formatter = formatter,
        actions = actions,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body. A still-loading feed (with nothing cached) renders the full-page skeleton; otherwise the
 * page header is drawn, then the hard-error retry surface (no cached fallback), or the loaded body — the six stat
 * cards, the two bar-chart panels, and the All-Locations list (which itself renders the no-locations / no-match
 * empty states inline, so no region ever blanks).
 */
@Composable
fun LocationsPageContent(
    locationsState: UiState<List<VisitedLocation>>,
    interaction: LocationsInteraction,
    appliedNames: Map<Long, String>,
    formatter: UnitFormatter,
    actions: LocationsActions,
    modifier: Modifier = Modifier,
) {
    val pageTitle = stringResource(R.string.translation_Locations)
    if (locationsState.isLoading) {
        LocationsLoading(pageTitle, modifier)
        return
    }

    val zone = remember { ZoneId.systemDefault() }
    val all = locationsState.data.orEmpty()
    val ranged = remember(all, interaction.range, zone) { filterToRange(all, interaction.range, zone) }
    val stats = remember(ranged) { LocationsStats.from(ranged) }
    val filtered = remember(ranged, interaction.search) { searchLocations(ranged, interaction.search) }
    val pageItems = remember(filtered, interaction.page) { paginate(filtered, interaction.page) }
    val visits = remember(ranged) { visitsBars(ranged) }
    val time = remember(ranged) { timeBars(ranged) }
    val locale = remember(formatter) { localeOf(formatter) }

    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg)
                .semantics { paneTitle = pageTitle },
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        LocationsHeader(state = locationsState, range = interaction.range, onSetRange = actions.onSetRange)

        if (locationsState.isError && all.isEmpty()) {
            LocationsError(onRetry = actions.onRetry)
            return@Column
        }

        FadeIn { LocationsStatsGrid(stats = stats, formatter = formatter, locale = locale) }
        FadeIn(delayMs = FADE_STEP_MS) {
            VisitsChartPanel(bars = visits, state = locationsState, locale = locale)
        }
        FadeIn(delayMs = FADE_STEP_MS * 2) {
            TimeChartPanel(bars = time, state = locationsState, locale = locale)
        }
        FadeIn(delayMs = FADE_STEP_MS * 3) {
            AllLocationsPanel(
                ranged = ranged,
                filtered = filtered,
                pageItems = pageItems,
                interaction = interaction,
                appliedNames = appliedNames,
                formatter = formatter,
                locale = locale,
                zone = zone,
                actions = actions,
            )
        }
    }
}

/** The full-page loading skeleton shown before the first locations payload (web `PageContainer loading`). */
@Composable
private fun LocationsLoading(
    pageTitle: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxSize().padding(Spacing.lg).semantics { paneTitle = pageTitle },
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        PageHeaderSkeleton()
        StatGridSkeleton(count = STAT_CARDS_PER_ROW)
        StatGridSkeleton(count = STAT_CARDS_PER_ROW)
        ChartBlockSkeleton(height = VISITS_CHART_HEIGHT)
        ChartBlockSkeleton(height = TIME_CHART_HEIGHT)
        repeat(4) { Skeleton(height = 56.dp, rounded = true) }
    }
}

/** The page header — title + muted subtitle + the query-freshness chip + the date-range filter (web `PageContainer`). */
@Composable
private fun LocationsHeader(
    state: UiState<List<VisitedLocation>>,
    range: LocationsRange,
    onSetRange: (LocalDate, LocalDate) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                PageTitle(stringResource(R.string.translation_Visited_Locations))
                BodyText(
                    stringResource(R.string.translation_Places_you_ve_been___ranked_by_frequency),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            DataFreshness(
                updatedAtMillis = state.fetchedAt?.takeIf { it > 0L },
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                compact = true,
            )
        }
        DateRangeFilter(
            startEpochDay = range.start.toEpochDay(),
            endEpochDay = range.end.toEpochDay(),
            onRangeChange = { start, end ->
                onSetRange(
                    start?.let(LocalDate::ofEpochDay) ?: range.start,
                    end?.let(LocalDate::ofEpochDay) ?: range.end,
                )
            },
        )
    }
}

/** The hard-error surface for the locations feed (no cached fallback) — a retry-able error panel (web `error` prop). */
@Composable
private fun LocationsError(onRetry: () -> Unit) {
    GlassPanel {
        ErrorDisplay(
            message = stringResource(R.string.translation_error_serverError_message),
            title = stringResource(R.string.translation_error_serverError_title),
            onRetry = onRetry,
            retryLabel = stringResource(R.string.translation_common_retry),
        )
    }
}

// ── Summary stats (the six MetricCard panels) ───────────────────────────────────────────────────────────────────

/**
 * The six overview stat cards (web summary grid) — Unique Places, Unique Cities, Total Visits, Total Time, Most
 * Visited, and Avg Visit. Durations are SI seconds formatted at the display boundary via [formatter]; counts are
 * locale-grouped.
 */
@Composable
private fun LocationsStatsGrid(
    stats: LocationsStats,
    formatter: UnitFormatter,
    locale: Locale,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            StatCardCell(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_Unique_Places),
                value = formatCount(stats.uniquePlaces.toLong(), locale),
                icon = MapsGlyphs.Navigation,
                accent = LOC_GREEN,
            )
            StatCardCell(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_Unique_Cities),
                value = formatCount(stats.uniqueCities.toLong(), locale),
                icon = MapsGlyphs.Map,
                accent = LOC_BLUE,
            )
            StatCardCell(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_Total_Visits),
                value = formatCount(stats.totalVisits, locale),
                icon = DataDisplayGlyphs.History,
                accent = LOC_CYAN,
            )
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            StatCardCell(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_Total_Time),
                value = formatter.duration(stats.totalTimeS.toDouble()), // parity:allow SI seconds → Double, not a TODO stub
                icon = DataDisplayGlyphs.Clock,
                accent = LOC_PURPLE,
            )
            StatCardCell(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_Most_Visited),
                value = stats.topName?.takeIf { it.isNotBlank() } ?: EM_DASH,
                icon = NavGlyphs.Flag,
                accent = LOC_AMBER,
            )
            StatCardCell(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_Avg_Visit),
                value = formatter.duration(stats.avgDurationS),
                icon = DataDisplayGlyphs.Clock,
                accent = LOC_CYAN,
            )
        }
    }
}

@Composable
private fun StatCardCell(
    label: String,
    value: String,
    icon: ImageVector,
    accent: Color,
    modifier: Modifier = Modifier,
) {
    MetricCard(
        label = label,
        value = value,
        modifier = modifier,
        icon = icon,
        accent = accent,
        iconContentDescription = null,
    )
}

// ── Charts (GlassPanel7 + GlassPanel8) ──────────────────────────────────────────────────────────────────────────

/** The "Top Locations by Visits" bar-chart panel (web GlassPanel + vertical BarChart). */
@Composable
private fun VisitsChartPanel(
    bars: List<LocationBar>,
    state: UiState<List<VisitedLocation>>,
    locale: Locale,
) {
    val title = stringResource(R.string.translation_Top_Locations_by_Visits)
    val seriesLabel = stringResource(R.string.translation_Visits)
    val series =
        remember(bars, seriesLabel) {
            listOf(
                ChartSeries(
                    key = "visits",
                    label = seriesLabel,
                    values = bars.map { it.value },
                    kind = ChartSeriesKind.Bar,
                    color = LOC_GREEN,
                ),
            )
        }
    val labels = remember(bars) { bars.map { it.label } }
    ChartContainer(
        title = title,
        status = chartStatusOf(state, bars.isEmpty()),
        height = VISITS_CHART_HEIGHT,
        accessibleDescription = title,
        emptyMessage = stringResource(R.string.translation_No_visited_location_data),
        errorMessage = stringResource(R.string.translation_error_serverError_message),
        retryLabel = stringResource(R.string.translation_common_retry),
    ) {
        BarChartWrapper(
            series = series,
            xLabels = labels,
            height = VISITS_CHART_HEIGHT,
            yValueFormatter = { ChartFormat.number(it, 0, locale) },
        )
    }
}

/** The "Top Locations by Time Spent (hours)" bar-chart panel (web GlassPanel + vertical BarChart). */
@Composable
private fun TimeChartPanel(
    bars: List<LocationBar>,
    state: UiState<List<VisitedLocation>>,
    locale: Locale,
) {
    val title = stringResource(R.string.translation_Top_Locations_by_Time_Spent__hours_)
    val seriesLabel = stringResource(R.string.translation_Hours)
    val series =
        remember(bars, seriesLabel) {
            listOf(
                ChartSeries(
                    key = "hours",
                    label = seriesLabel,
                    values = bars.map { it.value },
                    kind = ChartSeriesKind.Bar,
                    color = LOC_PURPLE,
                ),
            )
        }
    val labels = remember(bars) { bars.map { it.label } }
    ChartContainer(
        title = title,
        status = chartStatusOf(state, bars.isEmpty()),
        height = TIME_CHART_HEIGHT,
        accessibleDescription = title,
        emptyMessage = stringResource(R.string.translation_No_time_spent_data_available),
        errorMessage = stringResource(R.string.translation_error_serverError_message),
        retryLabel = stringResource(R.string.translation_common_retry),
    ) {
        BarChartWrapper(
            series = series,
            xLabels = labels,
            height = TIME_CHART_HEIGHT,
            yValueFormatter = { ChartFormat.number(it, 1, locale) },
        )
    }
}

// ── All Locations list (GlassPanel9 + the per-row GlassPanel10) ─────────────────────────────────────────────────

/**
 * The All-Locations list panel — the search field + active-filter chip, then the no-locations / no-match empty
 * states or the paginated list of per-location rows. Never blanks: every branch renders content or a friendly empty
 * state.
 */
@Composable
private fun AllLocationsPanel(
    ranged: List<VisitedLocation>,
    filtered: List<VisitedLocation>,
    pageItems: List<VisitedLocation>,
    interaction: LocationsInteraction,
    appliedNames: Map<Long, String>,
    formatter: UnitFormatter,
    locale: Locale,
    zone: ZoneId,
    actions: LocationsActions,
) {
    GlassPanel {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            PanelTitle(stringResource(R.string.translation_All_Locations))
            SearchInput(
                value = interaction.search,
                onValueChange = actions.onSetSearch,
                hint = stringResource(R.string.translation_Search_by_address_),
                clearLabel = stringResource(R.string.translation_Clear_search),
            )
            if (interaction.search.isNotBlank()) {
                ActiveFilterChips(
                    filters =
                        listOf(
                            ActiveFilter(
                                key = "q",
                                label = stringResource(R.string.translation_locations_filterLabel_search),
                                value = interaction.search,
                            ),
                        ),
                    onRemove = { actions.onClearSearch() },
                    onClearAll = actions.onClearSearch,
                    clearAllLabel = stringResource(R.string.translation_Clear_search),
                )
            }
            when {
                ranged.isEmpty() ->
                    EmptyState(
                        icon = DataDisplayGlyphs.MapPin,
                        title = stringResource(R.string.translation_No_locations),
                        message = stringResource(R.string.translation_No_visited_locations_recorded_yet),
                        action =
                            EmptyStateAction(
                                label = stringResource(R.string.translation_locations_empty_cta),
                                onClick = actions.onViewDrives,
                            ),
                    )

                filtered.isEmpty() ->
                    EmptyState(
                        icon = DataDisplayGlyphs.MapPin,
                        title = stringResource(R.string.translation_No_locations),
                        message = stringResource(R.string.translation_No_locations_match_your_search),
                        action =
                            EmptyStateAction(
                                label = stringResource(R.string.translation_Clear_search),
                                onClick = actions.onClearSearch,
                            ),
                    )

                else ->
                    LocationsList(
                        pageItems = pageItems,
                        filteredCount = filtered.size,
                        offset = pageOffset(interaction.page),
                        page = interaction.page,
                        appliedNames = appliedNames,
                        formatter = formatter,
                        locale = locale,
                        zone = zone,
                        actions = actions,
                    )
            }
        }
    }
}

@Composable
private fun LocationsList(
    pageItems: List<VisitedLocation>,
    filteredCount: Int,
    offset: Int,
    page: Int,
    appliedNames: Map<Long, String>,
    formatter: UnitFormatter,
    locale: Locale,
    zone: ZoneId,
    actions: LocationsActions,
) {
    val dateFormatter = remember(locale) { DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale) }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        pageItems.forEachIndexed { index, loc ->
            LocationRow(
                rank = offset + index + 1,
                location = loc,
                appliedName = appliedNames[loc.id],
                formatter = formatter,
                locale = locale,
                zone = zone,
                dateFormatter = dateFormatter,
                onApplyName = actions.onApplyName,
            )
        }
        LocationsPagination(
            page = page,
            total = filteredCount,
            locale = locale,
            onPageChange = actions.onSetPage,
        )
    }
}

/** A single visited-location row (web per-location GlassPanel) — rank badge, name + stats line, and visit count. */
@Composable
private fun LocationRow(
    rank: Int,
    location: VisitedLocation,
    appliedName: String?,
    formatter: UnitFormatter,
    locale: Locale,
    zone: ZoneId,
    dateFormatter: DateTimeFormatter,
    onApplyName: (Long, String) -> Unit,
) {
    val subtitle = rowSubtitle(location, formatter, zone, dateFormatter)
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        GlassPanel {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                RankBadge(rank)
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    BodyText(location.addressName, maxLines = 1)
                    Caption(subtitle)
                    if (appliedName != null) {
                        Caption(
                            "${stringResource(R.string.translation_locations_aiAutoName_applied)} $appliedName",
                            modifier = Modifier.semantics { contentDescription = appliedName },
                        )
                    }
                }
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                ) {
                    Icon(DataDisplayGlyphs.History, contentDescription = null, size = IconSize.Sm, tint = LOC_GREEN)
                    BodyText(formatCount(location.visitCount, locale), color = LOC_GREEN)
                }
            }
        }
        if (isUnnamedLocation(location.addressName)) {
            // Faithful port of the web `<AIAutoNameUnnamedLocations onApplyName={…} />`: the real propose-only Helix
            // surface, gated to its web default AI-off state (the app DI graph exposes no name-draft SSE transport
            // yet), so it renders nothing until AI is enabled. Its onApplyName surfaces the "ready to save"
            // confirmation above, exactly as the web threads setAppliedName.
            AIAutoNameUnnamedLocations(
                locationId = location.id,
                onApplyName = { name -> onApplyName(location.id, name) },
                source = DisabledAiNameDraftSource,
                enabled = false,
                currentName = location.addressName,
            )
        }
    }
}

/** The rank chip — amber for #1, cyan for the podium, muted otherwise (web rank-badge classes). */
@Composable
private fun RankBadge(rank: Int) {
    val color =
        when {
            rank == 1 -> LOC_AMBER
            rank <= 3 -> LOC_CYAN
            else -> MaterialTheme.colorScheme.onSurfaceVariant
        }
    Box(
        modifier =
            Modifier
                .size(32.dp)
                .clip(RoundedCornerShape(Radius.md))
                .background(color.copy(alpha = ACCENT_BADGE_BG_ALPHA)),
        contentAlignment = Alignment.Center,
    ) {
        Caption("#$rank")
    }
}

@Composable
private fun LocationsPagination(
    page: Int,
    total: Int,
    locale: Locale,
    onPageChange: (Int) -> Unit,
) {
    val showingTemplate = stringResource(R.string.translation_pagination_showing)
    Pagination(
        page = page,
        pageSize = LocationsPageRegistration.PAGE_SIZE,
        total = total,
        onPageChange = onPageChange,
        firstLabel = stringResource(R.string.translation_pagination_first),
        previousLabel = stringResource(R.string.translation_pagination_previous),
        nextLabel = stringResource(R.string.translation_pagination_next),
        lastLabel = stringResource(R.string.translation_pagination_last),
        showingText = { start, end, count ->
            String.format(locale, showingTemplate, start.toString(), end.toString(), count.toString())
        },
    )
}

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Maps the feed state + whether the series is empty onto the chart's lifecycle (web loading/empty/data switch). */
private fun chartStatusOf(
    state: UiState<List<VisitedLocation>>,
    isEmpty: Boolean,
): ChartStatus =
    when {
        state.isLoading -> ChartStatus.Loading
        state.isError && isEmpty -> ChartStatus.Error
        isEmpty -> ChartStatus.Empty
        else -> ChartStatus.Ready
    }

/** Builds the per-row stats line: `N visits · total · ~avg avg[ · Last: date]` (web row subtitle). */
@Composable
private fun rowSubtitle(
    location: VisitedLocation,
    formatter: UnitFormatter,
    zone: ZoneId,
    dateFormatter: DateTimeFormatter,
): String {
    val visitsWord = stringResource(R.string.translation_visits)
    val totalWord = stringResource(R.string.translation_total)
    val avgWord = stringResource(R.string.translation_avg)
    val lastWord = stringResource(R.string.translation_Last)
    val avgPerVisit =
        if (location.visitCount > 0) {
            location.totalDurationS.toDouble() / location.visitCount // parity:allow SI seconds → Double mean, not a TODO stub
        } else {
            0.0
        }
    val totalDuration = formatter.duration(location.totalDurationS.toDouble()) // parity:allow SI seconds → Double, not a TODO stub
    val averageDuration = formatter.duration(avgPerVisit)
    val base =
        "${location.visitCount} $visitsWord \u00B7 $totalDuration $totalWord \u00B7 ~$averageDuration $avgWord"
    val date = formatVisited(location.lastVisited, zone, dateFormatter)
    return if (date != null) "$base \u00B7 $lastWord: $date" else base
}

/** Formats `last_visited` as a localized date (web `formatDate`); `null` when the stamp is absent/unparseable. */
private fun formatVisited(
    raw: String?,
    zone: ZoneId,
    dateFormatter: DateTimeFormatter,
): String? {
    val millis = visitedMillisOf(raw, zone) ?: return null
    return Instant.ofEpochMilli(millis).atZone(zone).toLocalDate().format(dateFormatter)
}

/** Locale-grouped integer count (web `fmtNumber` / `MetricCard` numeric value). */
private fun formatCount(
    value: Long,
    locale: Locale,
): String = String.format(locale, "%,d", value)

/** The display locale from the live unit preferences (web `useUnits` locale), falling back to the JVM default. */
private fun localeOf(formatter: UnitFormatter): Locale {
    val tag = formatter.prefs.locale
    return if (tag.isNullOrBlank()) Locale.getDefault() else Locale.forLanguageTag(tag)
}

/**
 * Opens the in-app `/drives` deep link (web no-locations CTA `actionTo={{ to: '/drives' }}`). A missing resolver is
 * swallowed — the global nav rail still exposes Drives — so the empty-state CTA can never crash the surface.
 */
private fun openDrivesDeepLink(context: Context) {
    try {
        context.startActivity(
            Intent(Intent.ACTION_VIEW, Uri.parse(DRIVES_DEEP_LINK)).setPackage(context.packageName),
        )
    } catch (_: ActivityNotFoundException) {
        // No activity resolves the in-app deep link in this build variant; the nav rail still reaches Drives.
    }
}
