// The native Jetpack Compose + Material 3 SessionListSection feature view — a parity port of
// web/src/features/charging/components/charging-list/SessionListSection.tsx. The web component is purely
// presentational: its parent (the Charging page) owns the filtered/sorted/paged `ChargingSession[]`, the
// search/charger/sort/page state, and the bulk-selection plumbing, and the component renders a search bar +
// active-filter chips, a charger-filter + sort + export control row, a bulk-actions toolbar, the list of
// session cards, and pagination.
//
// This native surface keeps that contract end to end. It performs NO HTTP and binds no data hook of its own;
// its only web hook is `useTranslation` (mapped to the i18n catalog, P1/S10) plus the `useFormatting`
// currency symbol read from the shared settings store (P1/S8). The host supplies the decoded session list
// through the shared state-holder layer as a [UiState], so this feature view renders every lifecycle state
// that layer can carry — loading skeletons, a hard error with retry, the "no sessions yet" empty, content,
// and stale/offline (cached "last known" with a freshness chip + silent auto-refresh) — without ever
// fetching. The stateful [SessionListSection] is self-contained: it owns the search/charger/sort/page and
// selection state and derives the filtered/paged window through the pure [SessionListProjection], so it works
// as a drop-in surface. The stateless [SessionListSectionContent] is the fully-controlled test/preview entry.
//
// Every derivation flows through the pure [SessionListProjection]; the composable resolves the i18n labels
// (P1/S10) and the design-token accents (P1/S9) and draws what they return, using the shared component
// library (forms SearchInput / FilterBar / ActiveFilterChips / PillFilterBar / SortControl, ui Button /
// Badge / Checkbox / Pagination / ConfirmDialog / GlassPanel, data-display BulkActionToolbar / HistoryListRow
// / ScoreBadge / BatteryDelta / RouteDisplay / InlineMetric, motion FadeIn / Stagger, feedback EmptyState /
// Skeleton / ErrorDisplay) so it never reaches for a raw widget. The one-shot PII-safe `view.opened`
// diagnostic (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SessionListSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed
// for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.sessionlistsection

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.BatteryDelta
import io.teslasync.android.components.datadisplay.BatteryDeltaVariant
import io.teslasync.android.components.datadisplay.BulkAction
import io.teslasync.android.components.datadisplay.BulkActionToolbar
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.HistoryListRow
import io.teslasync.android.components.datadisplay.InlineMetric
import io.teslasync.android.components.datadisplay.RouteDisplay
import io.teslasync.android.components.datadisplay.RouteEndpoint
import io.teslasync.android.components.datadisplay.ScoreBadge
import io.teslasync.android.components.datadisplay.ScoreBadgeSize
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.forms.ActiveFilter
import io.teslasync.android.components.forms.ActiveFilterChips
import io.teslasync.android.components.forms.ExportFormat
import io.teslasync.android.components.forms.FilterBar
import io.teslasync.android.components.forms.PillFilterBar
import io.teslasync.android.components.forms.PillItem
import io.teslasync.android.components.forms.SearchInput
import io.teslasync.android.components.forms.SortControl
import io.teslasync.android.components.forms.SortOption
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.StaggerContainer
import io.teslasync.android.components.motion.StaggerItem
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Checkbox
import io.teslasync.android.components.ui.ConfirmDialog
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Pagination
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement
import java.time.ZoneId
import java.util.Locale

/** Web `<FadeIn delay={0.2}>` staggered entry delay, in milliseconds. */
private const val FADE_DELAY_MS = 200

/** The host's default page window when none is supplied. */
private const val DEFAULT_PAGE_SIZE = 25

/** Web loading branch: five `Skeleton h-20` skeleton rows. */
private const val SKELETON_ROWS = 5

private val SKELETON_ROW_HEIGHT: Dp = 72.dp

/** Stable key for the search active-filter chip (web `key: 'q'`). */
private const val FILTER_KEY_QUERY = "q"

/** Stable key for the charger active-filter chip (web `key: 'charger'`). */
private const val FILTER_KEY_CHARGER = "charger"

/**
 * The already-localized strings the surface renders. The web component is anonymous — it resolves every label
 * through `useTranslation` — so these arrive through the P1/S10 i18n facade at the Compose boundary and are
 * passed down, keeping the surface free of any English literal.
 */
data class SessionListStrings(
    val allSessions: String,
    val searchHint: String,
    val filterSearch: String,
    val filterCharger: String,
    val filterAll: String,
    val filterHome: String,
    val filterSc: String,
    val filterDc: String,
    val sortDate: String,
    val sortEnergy: String,
    val sortCost: String,
    val sortTime: String,
    val sortPower: String,
    val exportCsv: String,
    val exportJson: String,
    val emptyTitle: String,
    val emptyMessage: String,
    val noMatchesTitle: String,
    val noMatchesMessage: String,
    val chargerHome: String,
    val chargerSupercharger: String,
    val chargerDc: String,
    val chargerUnknown: String,
    val clear: String,
    val deleteAction: String,
    val deleteConfirm: String,
    val deleteDescription: String,
    val cancel: String,
    val bulkClear: String,
    val selectRow: String,
    val retry: String,
    val errorTitle: String,
    val errorMessage: String,
    val loadingLabel: String,
    val offline: String,
    val loadingShort: String,
    val paginationFirst: String,
    val paginationPrevious: String,
    val paginationNext: String,
    val paginationLast: String,
)

/**
 * Stateful, self-contained entry point. Records the one-shot PII-safe `view.opened` diagnostic (P1/S11),
 * resolves the user's currency symbol from the shared settings store (web `useFormatting`, P1/S8), owns the
 * search / charger-filter / sort / page / selection state, and derives the filtered + paged window through the
 * pure [SessionListProjection]. The host owns the feed (P1/S8) and supplies [onRetry] (its `refetch`),
 * [onExport] (open the export URL), [onOpenSession] (navigate to the detail), and the optional [onBulkDelete]
 * (perform the delete); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the decoded `ChargingSession[]`.
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param onExport invoked with the chosen format when an export button is tapped (web export links).
 * @param onOpenSession invoked with a session id when a row is tapped (web `/charging/{id}` link).
 * @param onBulkDelete when non-null, enables per-row selection + the bulk-delete toolbar (web bulk plumbing).
 * @param settings the shared `/settings` document feed; its `currency_symbol` formats each row's cost.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun SessionListSection(
    state: UiState<List<ChargingSessionItem>>,
    onRetry: () -> Unit,
    onExport: (ExportFormat) -> Unit,
    onOpenSession: (Long) -> Unit,
    modifier: Modifier = Modifier,
    pageSize: Int = DEFAULT_PAGE_SIZE,
    onBulkDelete: ((List<Long>) -> Unit)? = null,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val settingsResource by settings.collectAsStateWithLifecycle()
    val currencySymbol = remember(settingsResource) { SessionListProjection.currencySymbol(settingsResource.cached) }
    val locale: Locale = LocalConfiguration.current.locales[0]
    val zone = remember { ZoneId.systemDefault() }
    val formatTime = remember(zone, locale) { { iso: String -> SessionListTimeFormatting.format(iso, zone, locale) } }
    LaunchedEffect(Unit) { SessionListSectionDiagnostics.recordViewOpened(logger) }

    var searchQuery by remember { mutableStateOf("") }
    var chargerFilter by remember { mutableStateOf(ChargerFilter.All) }
    var sortBy by remember { mutableStateOf(SortKey.Date) }
    var sortDesc by remember { mutableStateOf(true) }
    var selectedIds by remember { mutableStateOf<Set<Long>>(emptySet()) }
    var page by remember(searchQuery, chargerFilter, sortBy, sortDesc) { mutableIntStateOf(1) }

    val sessions = state.data.orEmpty()
    val filtered =
        remember(sessions, searchQuery, chargerFilter, sortBy, sortDesc) {
            SessionListProjection.filterAndSort(sessions, chargerFilter, sortBy, sortDesc, searchQuery)
        }
    val visible = remember(filtered, page, pageSize) { SessionListProjection.pageItems(filtered, page, pageSize) }

    SessionListSectionContent(
        state = state,
        filteredSessions = visible,
        searchQuery = searchQuery,
        onSearchQueryChange = { searchQuery = it },
        chargerFilter = chargerFilter,
        onChargerFilterChange = { chargerFilter = it },
        sortBy = sortBy,
        sortDesc = sortDesc,
        onSortChange = { sortBy = it },
        onSortToggle = { sortDesc = !sortDesc },
        page = page,
        pageSize = pageSize,
        onPageChange = { page = it },
        onExport = onExport,
        onOpenSession = onOpenSession,
        onRetry = onRetry,
        modifier = modifier,
        selectedIds = selectedIds,
        onToggleSelected = { id, on -> selectedIds = if (on) selectedIds + id else selectedIds - id },
        onClearSelection = { selectedIds = emptySet() },
        onBulkDelete =
            onBulkDelete?.let { host ->
                { ids ->
                    host(ids)
                    selectedIds = emptySet()
                }
            },
        currencySymbol = currencySymbol,
        locale = locale,
        formatTime = formatTime,
    )
}

/**
 * Stateless, fully-controlled renderer for every surface state — the unit/UI-test + preview entry point.
 * Reproduces the web component's branches: loading skeletons; the "no charging sessions yet" empty; otherwise
 * the search bar + active chips, the charger-filter + sort + export controls, the optional bulk toolbar, the
 * session list (or the "no matches" empty), and pagination. It adds the lifecycle chrome the host's feed
 * implies — a hard-error retry surface and a freshness chip that reflects refreshing/stale/offline; stale
 * (non-error) data silently auto-refreshes. [currencySymbol]/[locale]/[formatTime] format each row.
 */
@Composable
fun SessionListSectionContent(
    state: UiState<List<ChargingSessionItem>>,
    filteredSessions: List<ChargingSessionItem>,
    searchQuery: String,
    onSearchQueryChange: (String) -> Unit,
    chargerFilter: ChargerFilter,
    onChargerFilterChange: (ChargerFilter) -> Unit,
    sortBy: SortKey,
    sortDesc: Boolean,
    onSortChange: (SortKey) -> Unit,
    onSortToggle: () -> Unit,
    page: Int,
    pageSize: Int,
    onPageChange: (Int) -> Unit,
    onExport: (ExportFormat) -> Unit,
    onOpenSession: (Long) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    selectedIds: Set<Long> = emptySet(),
    onToggleSelected: ((Long, Boolean) -> Unit)? = null,
    onClearSelection: (() -> Unit)? = null,
    onBulkDelete: ((List<Long>) -> Unit)? = null,
    currencySymbol: String = DEFAULT_CURRENCY,
    locale: Locale = Locale.getDefault(),
    formatTime: (String) -> String = { it },
    strings: SessionListStrings = rememberSessionListStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    FadeIn(modifier = modifier, delayMs = FADE_DELAY_MS) {
        when {
            state.isLoading -> SessionListLoading(strings)
            state.isError -> SessionListError(strings = strings, onRetry = onRetry)
            state.isEmpty || state.data.isNullOrEmpty() -> SessionListEmpty(strings)
            else ->
                SessionListBody(
                    state = state,
                    filteredSessions = filteredSessions,
                    searchQuery = searchQuery,
                    onSearchQueryChange = onSearchQueryChange,
                    chargerFilter = chargerFilter,
                    onChargerFilterChange = onChargerFilterChange,
                    sortBy = sortBy,
                    sortDesc = sortDesc,
                    onSortChange = onSortChange,
                    onSortToggle = onSortToggle,
                    page = page,
                    pageSize = pageSize,
                    onPageChange = onPageChange,
                    onExport = onExport,
                    onOpenSession = onOpenSession,
                    selectedIds = selectedIds,
                    onToggleSelected = onToggleSelected,
                    onClearSelection = onClearSelection,
                    onBulkDelete = onBulkDelete,
                    currencySymbol = currencySymbol,
                    locale = locale,
                    formatTime = formatTime,
                    strings = strings,
                )
        }
    }
}

/** The populated content body: freshness chip, search + controls, the list (or no-matches empty), pagination. */
@Composable
private fun SessionListBody(
    state: UiState<List<ChargingSessionItem>>,
    filteredSessions: List<ChargingSessionItem>,
    searchQuery: String,
    onSearchQueryChange: (String) -> Unit,
    chargerFilter: ChargerFilter,
    onChargerFilterChange: (ChargerFilter) -> Unit,
    sortBy: SortKey,
    sortDesc: Boolean,
    onSortChange: (SortKey) -> Unit,
    onSortToggle: () -> Unit,
    page: Int,
    pageSize: Int,
    onPageChange: (Int) -> Unit,
    onExport: (ExportFormat) -> Unit,
    onOpenSession: (Long) -> Unit,
    selectedIds: Set<Long>,
    onToggleSelected: ((Long, Boolean) -> Unit)?,
    onClearSelection: (() -> Unit)?,
    onBulkDelete: ((List<Long>) -> Unit)?,
    currencySymbol: String,
    locale: Locale,
    formatTime: (String) -> String,
    strings: SessionListStrings,
) {
    val context = LocalContext.current
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        if (state.stale || state.refreshing || state.hasError) {
            SessionFreshnessRow(state = state, strings = strings)
        }
        SessionSearchAndControls(
            searchQuery = searchQuery,
            onSearchQueryChange = onSearchQueryChange,
            chargerFilter = chargerFilter,
            onChargerFilterChange = onChargerFilterChange,
            sortBy = sortBy,
            sortDesc = sortDesc,
            onSortChange = onSortChange,
            onSortToggle = onSortToggle,
            onExport = onExport,
            count = filteredSessions.size,
            strings = strings,
        )
        SessionListArea(
            filteredSessions = filteredSessions,
            selectedIds = selectedIds,
            onOpenSession = onOpenSession,
            onToggleSelected = onToggleSelected,
            onClearSelection = onClearSelection,
            onBulkDelete = onBulkDelete,
            currencySymbol = currencySymbol,
            locale = locale,
            formatTime = formatTime,
            strings = strings,
        )
        Pagination(
            page = page,
            pageSize = pageSize,
            total = SessionListProjection.paginationTotal(page, pageSize, filteredSessions.size),
            onPageChange = onPageChange,
            firstLabel = strings.paginationFirst,
            previousLabel = strings.paginationPrevious,
            nextLabel = strings.paginationNext,
            lastLabel = strings.paginationLast,
            showingText = { start, end, total ->
                context.getString(R.string.translation_pagination_showing, start, end, total)
            },
        )
    }
}

/** The web search bar + active-filter chips, then the title row, charger-filter pills, sort, and export. */
@Composable
private fun SessionSearchAndControls(
    searchQuery: String,
    onSearchQueryChange: (String) -> Unit,
    chargerFilter: ChargerFilter,
    onChargerFilterChange: (ChargerFilter) -> Unit,
    sortBy: SortKey,
    sortDesc: Boolean,
    onSortChange: (SortKey) -> Unit,
    onSortToggle: () -> Unit,
    onExport: (ExportFormat) -> Unit,
    count: Int,
    strings: SessionListStrings,
) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        FilterBar {
            SearchInput(
                value = searchQuery,
                onValueChange = onSearchQueryChange,
                hint = strings.searchHint,
                clearLabel = strings.clear,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        ActiveFilterChips(
            filters = activeFilters(searchQuery, chargerFilter, strings),
            onRemove = { key -> removeFilter(key, onSearchQueryChange, onChargerFilterChange) },
            onClearAll = {
                onSearchQueryChange("")
                onChargerFilterChange(ChargerFilter.All)
            },
            clearAllLabel = strings.clear,
        )
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Icon(SessionListGlyphs.Battery, contentDescription = null, size = IconSize.Md, tint = TeslaTokens.chart.battery)
            SectionTitle(strings.allSessions)
            Caption("($count)")
        }
        PillFilterBar(
            items = chargerPills(strings),
            selectedId = chargerFilter.wire,
            onSelect = { onChargerFilterChange(ChargerFilter.fromWire(it)) },
        )
        SortControl(
            field = sortBy.wire,
            direction = if (sortDesc) SortDirection.Desc else SortDirection.Asc,
            options = sortOptions(strings),
            onFieldChange = { onSortChange(SortKey.fromWire(it)) },
            onDirectionChange = { onSortToggle() },
        )
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Button(
                strings.exportCsv,
                onClick = { onExport(ExportFormat.Csv) },
                variant = ButtonVariant.Secondary,
                size = ButtonSize.Sm,
                leadingIcon = SessionListGlyphs.Download,
            )
            Button(
                strings.exportJson,
                onClick = { onExport(ExportFormat.Json) },
                variant = ButtonVariant.Secondary,
                size = ButtonSize.Sm,
                leadingIcon = SessionListGlyphs.Download,
            )
        }
    }
}

/** The list region: the "no matches" empty when filtered to nothing, else the optional bulk bar + the rows. */
@Composable
private fun SessionListArea(
    filteredSessions: List<ChargingSessionItem>,
    selectedIds: Set<Long>,
    onOpenSession: (Long) -> Unit,
    onToggleSelected: ((Long, Boolean) -> Unit)?,
    onClearSelection: (() -> Unit)?,
    onBulkDelete: ((List<Long>) -> Unit)?,
    currencySymbol: String,
    locale: Locale,
    formatTime: (String) -> String,
    strings: SessionListStrings,
) {
    if (filteredSessions.isEmpty()) {
        EmptyState(
            icon = SessionListGlyphs.Battery,
            title = strings.noMatchesTitle,
            message = strings.noMatchesMessage,
        )
        return
    }
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        if (onBulkDelete != null && onClearSelection != null && onToggleSelected != null) {
            SessionBulkSection(
                selectedIds = selectedIds,
                total = filteredSessions.size,
                strings = strings,
                onClear = onClearSelection,
                onBulkDelete = onBulkDelete,
            )
        }
        SessionList(
            filteredSessions = filteredSessions,
            selectedIds = selectedIds,
            onOpenSession = onOpenSession,
            onToggleSelected = onToggleSelected,
            currencySymbol = currencySymbol,
            locale = locale,
            formatTime = formatTime,
            strings = strings,
        )
    }
}

/** The staggered list of session rows — web `StaggerContainer` mapping `filteredSessions` to cards. */
@Composable
private fun SessionList(
    filteredSessions: List<ChargingSessionItem>,
    selectedIds: Set<Long>,
    onOpenSession: (Long) -> Unit,
    onToggleSelected: ((Long, Boolean) -> Unit)?,
    currencySymbol: String,
    locale: Locale,
    formatTime: (String) -> String,
    strings: SessionListStrings,
) {
    StaggerContainer {
        filteredSessions.forEachIndexed { index, item ->
            StaggerItem(index) {
                SessionRow(
                    item = item,
                    selected = selectedIds.contains(item.id),
                    onOpenSession = onOpenSession,
                    onToggleSelected = onToggleSelected,
                    currencySymbol = currencySymbol,
                    locale = locale,
                    formatTime = formatTime,
                    strings = strings,
                )
            }
        }
    }
}

/** One session card — the native mirror of the web `ChargingSessionCard`, built from the shared row slots. */
@Composable
private fun SessionRow(
    item: ChargingSessionItem,
    selected: Boolean,
    onOpenSession: (Long) -> Unit,
    onToggleSelected: ((Long, Boolean) -> Unit)?,
    currencySymbol: String,
    locale: Locale,
    formatTime: (String) -> String,
    strings: SessionListStrings,
) {
    val view = remember(item, currencySymbol, locale) { SessionListProjection.row(item, currencySymbol, locale, formatTime) }
    val hasLocation = view.startPlace != null || (view.startLat != null && view.startLng != null)
    HistoryListRow(
        onClick = { onOpenSession(view.id) },
        selected = selected,
        leading =
            if (view.score != null) {
                { ScoreBadge(score = view.score, size = ScoreBadgeSize.Sm) }
            } else {
                null
            },
        primary = {
            if (onToggleSelected != null) {
                Checkbox(
                    checked = selected,
                    onCheckedChange = { onToggleSelected(view.id, it) },
                    modifier = Modifier.semantics { contentDescription = strings.selectRow },
                )
            }
            Subhead(view.timeText)
            view.durationText?.let { Caption(it) }
            Badge(text = chargerLabel(view.category, strings), variant = chargerVariant(view.category))
            view.energyText?.let { Badge(text = it, variant = BadgeVariant.Info) }
        },
        route =
            if (hasLocation) {
                {
                    RouteDisplay(
                        start = RouteEndpoint(address = view.startPlace, lat = view.startLat, lon = view.startLng),
                    )
                }
            } else {
                null
            },
        metrics = {
            BatteryDelta(startPct = view.startSocPct, endPct = view.endSocPct, variant = BatteryDeltaVariant.Pair)
            view.peakPowerText?.let { InlineMetric(icon = SessionListGlyphs.Bolt, value = it) }
            view.avgPowerText?.let { InlineMetric(icon = SessionListGlyphs.Activity, value = it) }
            view.costText?.let { InlineMetric(icon = SessionListGlyphs.Dollar, value = it) }
            view.costPerKwhText?.let { Caption(it) }
        },
    )
}

/** The bulk-selection toolbar + its delete confirmation — web `BulkActionsToolbar` with the confirm gate. */
@Composable
private fun SessionBulkSection(
    selectedIds: Set<Long>,
    total: Int,
    strings: SessionListStrings,
    onClear: () -> Unit,
    onBulkDelete: (List<Long>) -> Unit,
) {
    val context = LocalContext.current
    var confirming by remember { mutableStateOf(false) }
    val count = selectedIds.size
    BulkActionToolbar(
        selectedCount = count,
        total = total,
        onClear = onClear,
        actions =
            listOf(
                BulkAction(
                    id = "delete",
                    label = strings.deleteAction,
                    onClick = { confirming = true },
                    danger = true,
                ),
            ),
        countText = { n -> context.resources.getQuantityString(R.plurals.translation_bulk_selected, n, n) },
        ofTotalText = { t -> context.getString(R.string.translation_bulk_ofTotal, t) },
        clearLabel = strings.bulkClear,
    )
    if (confirming) {
        val noun = context.resources.getQuantityString(R.plurals.translation_bulk_noun_session, count)
        ConfirmDialog(
            title = context.getString(R.string.translation_bulk_deleteConfirmTitle, count, noun),
            message = strings.deleteDescription,
            confirmLabel = strings.deleteConfirm,
            cancelLabel = strings.cancel,
            onConfirm = {
                confirming = false
                onBulkDelete(selectedIds.toList())
            },
            onCancel = { confirming = false },
        )
    }
}

/** Loading branch: skeleton rows so the section never collapses to a blank box (web 5× `Skeleton h-20`). */
@Composable
private fun SessionListLoading(strings: SessionListStrings) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = strings.loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(SKELETON_ROWS) {
            Skeleton(modifier = Modifier.fillMaxWidth(), height = SKELETON_ROW_HEIGHT, rounded = true)
        }
    }
}

/** Hard-error surface with a retry affordance — the lifecycle chrome the web's parent owns. */
@Composable
private fun SessionListError(
    strings: SessionListStrings,
    onRetry: () -> Unit,
) {
    GlassPanel(padding = PanelPadding.Lg, modifier = Modifier.fillMaxWidth()) {
        ErrorDisplay(
            message = strings.errorMessage,
            title = strings.errorTitle,
            onRetry = onRetry,
            retryLabel = strings.retry,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/** The "no charging sessions yet" empty — web `EmptyState` when the source list is missing/empty. */
@Composable
private fun SessionListEmpty(strings: SessionListStrings) {
    EmptyState(
        icon = SessionListGlyphs.Battery,
        title = strings.emptyTitle,
        message = strings.emptyMessage,
    )
}

/** The "refreshing / stale / offline" freshness chip, right-aligned above the controls. */
@Composable
private fun SessionFreshnessRow(
    state: UiState<List<ChargingSessionItem>>,
    strings: SessionListStrings,
) {
    val formatAge = rememberSessionFreshnessFormatter()
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            fetchingLabel = strings.loadingShort,
            errorLabel = strings.offline,
            formatAge = formatAge,
        )
    }
}

/** The localized charger-category label for a row badge (web `chargerLabels[cat]`). */
private fun chargerLabel(
    category: ChargerCategory,
    strings: SessionListStrings,
): String =
    when (category) {
        ChargerCategory.Home -> strings.chargerHome
        ChargerCategory.Supercharger -> strings.chargerSupercharger
        ChargerCategory.Dc -> strings.chargerDc
        ChargerCategory.Unknown -> strings.chargerUnknown
    }

/** The badge tone for a charger category — web `supercharger→danger`, `dc→warning`, else `success`. */
private fun chargerVariant(category: ChargerCategory): BadgeVariant =
    when (category) {
        ChargerCategory.Supercharger -> BadgeVariant.Danger
        ChargerCategory.Dc -> BadgeVariant.Warning
        else -> BadgeVariant.Success
    }

/** The active-filter chips for the current search + charger selection (web `ActiveFilterChips filters`). */
private fun activeFilters(
    searchQuery: String,
    chargerFilter: ChargerFilter,
    strings: SessionListStrings,
): List<ActiveFilter> =
    buildList {
        if (searchQuery.isNotBlank()) {
            add(ActiveFilter(FILTER_KEY_QUERY, strings.filterSearch, searchQuery))
        }
        if (chargerFilter != ChargerFilter.All) {
            add(ActiveFilter(FILTER_KEY_CHARGER, strings.filterCharger, chargerFilterValue(chargerFilter, strings)))
        }
    }

private fun removeFilter(
    key: String,
    onSearchQueryChange: (String) -> Unit,
    onChargerFilterChange: (ChargerFilter) -> Unit,
) {
    when (key) {
        FILTER_KEY_QUERY -> onSearchQueryChange("")
        FILTER_KEY_CHARGER -> onChargerFilterChange(ChargerFilter.All)
    }
}

private fun chargerFilterValue(
    chargerFilter: ChargerFilter,
    strings: SessionListStrings,
): String =
    when (chargerFilter) {
        ChargerFilter.Home -> strings.filterHome
        ChargerFilter.Supercharger -> strings.filterSc
        ChargerFilter.Dc -> strings.filterDc
        ChargerFilter.All -> strings.filterAll
    }

/** The charger-filter pills (web `[all, home, supercharger, dc]`). */
private fun chargerPills(strings: SessionListStrings): List<PillItem> =
    listOf(
        PillItem(ChargerFilter.All.wire, strings.filterAll),
        PillItem(ChargerFilter.Home.wire, strings.filterHome),
        PillItem(ChargerFilter.Supercharger.wire, strings.filterSc),
        PillItem(ChargerFilter.Dc.wire, strings.filterDc),
    )

/** The sort-field options (web `[date, energy, cost, duration, power]`). */
private fun sortOptions(strings: SessionListStrings): List<SortOption> =
    listOf(
        SortOption(SortKey.Date.wire, strings.sortDate),
        SortOption(SortKey.Energy.wire, strings.sortEnergy),
        SortOption(SortKey.Cost.wire, strings.sortCost),
        SortOption(SortKey.Duration.wire, strings.sortTime),
        SortOption(SortKey.Power.wire, strings.sortPower),
    )

/**
 * Builds the localized [SessionListStrings] from the i18n catalog (P1/S10) — every label the web component
 * reads through `useTranslation`, resolved once at the Compose boundary so the rest of the surface stays free
 * of any English literal.
 */
@Composable
private fun rememberSessionListStrings(): SessionListStrings {
    val searchHint = stringResource(R.string.translation_charging_sessions_searchPlaceholder) // parity:allow i18n key id
    return SessionListStrings(
        allSessions = stringResource(R.string.translation_charging_sessions_allSessions),
        searchHint = searchHint,
        filterSearch = stringResource(R.string.translation_charging_sessions_filterLabel_search),
        filterCharger = stringResource(R.string.translation_charging_sessions_filterLabel_charger),
        filterAll = stringResource(R.string.translation_charging_sessions_filterAll),
        filterHome = stringResource(R.string.translation_charging_sessions_filterHome),
        filterSc = stringResource(R.string.translation_charging_sessions_filterSC),
        filterDc = stringResource(R.string.translation_charging_sessions_filterDC),
        sortDate = stringResource(R.string.translation_charging_sessions_sortDate),
        sortEnergy = stringResource(R.string.translation_charging_sessions_sortEnergy),
        sortCost = stringResource(R.string.translation_charging_sessions_sortCost),
        sortTime = stringResource(R.string.translation_charging_sessions_sortTime),
        sortPower = stringResource(R.string.translation_charging_sessions_sortPower),
        exportCsv = stringResource(R.string.translation_charging_sessions_exportCsv),
        exportJson = stringResource(R.string.translation_charging_sessions_exportJson),
        emptyTitle = stringResource(R.string.translation_charging_list_empty),
        emptyMessage = stringResource(R.string.translation_charging_list_emptyDescription),
        noMatchesTitle = stringResource(R.string.translation_charging_list_noMatches),
        noMatchesMessage = stringResource(R.string.translation_charging_list_noMatchesDescription),
        chargerHome = stringResource(R.string.translation_charging_chargerTypes_home),
        chargerSupercharger = stringResource(R.string.translation_charging_chargerTypes_supercharger),
        chargerDc = stringResource(R.string.translation_charging_chargerTypes_dc),
        chargerUnknown = stringResource(R.string.translation_charging_sessions_filterLabel_charger),
        clear = stringResource(R.string.translation_common_clear),
        deleteAction = stringResource(R.string.translation_bulk_actions_delete),
        deleteConfirm = stringResource(R.string.translation_common_delete),
        deleteDescription = stringResource(R.string.translation_bulk_deleteConfirmDescription),
        cancel = stringResource(R.string.translation_common_cancel),
        bulkClear = stringResource(R.string.translation_bulk_clear),
        selectRow = stringResource(R.string.translation_bulk_selectRow),
        retry = stringResource(R.string.translation_common_retry),
        errorTitle = stringResource(R.string.translation_error_serverError_title),
        errorMessage = stringResource(R.string.translation_error_serverError_message),
        loadingLabel = stringResource(R.string.translation_a11y_loading),
        offline = stringResource(R.string.translation_common_offline),
        loadingShort = stringResource(R.string.translation_common_loading),
        paginationFirst = stringResource(R.string.translation_pagination_first),
        paginationPrevious = stringResource(R.string.translation_pagination_previous),
        paginationNext = stringResource(R.string.translation_pagination_next),
        paginationLast = stringResource(R.string.translation_pagination_last),
    )
}

/** Localized relative-age formatter for the freshness chip (`translation_freshness_*`). */
@Composable
private fun rememberSessionFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> EM_DASH
                FreshnessAge.JustNow -> justNow
                is FreshnessAge.Seconds -> seconds.format(age.value)
                is FreshnessAge.Minutes -> minutes.format(age.value)
                is FreshnessAge.Hours -> hours.format(age.value)
                is FreshnessAge.Days -> days.format(age.value)
                is FreshnessAge.Weeks -> weeks.format(age.value)
            }
        }
    }
}

/**
 * Self-contained line glyphs for the surface, authored as 24×24 stroked vectors (the web library leans on
 * lucide-react, which has no bundled Android equivalent). Each is monochrome and recolored at render time by
 * the consuming `Icon` — the same approach as the sibling feature-view glyphs. The web uses lucide
 * `BatteryCharging` (title + empties), `Download` (export), `TrendingUp` (peak), `Plug` (avg), `DollarSign`.
 */
private object SessionListGlyphs {
    /** lucide `battery-charging` — a battery body, terminal, and an inner bolt. */
    val Battery: ImageVector =
        sessionVector("SessionListBattery") {
            moveTo(2f, 8f)
            lineTo(14f, 8f)
            lineTo(14f, 16f)
            lineTo(2f, 16f)
            close()
            moveTo(16f, 11f)
            lineTo(16f, 13f)
            moveTo(8f, 9f)
            lineTo(6f, 12f)
            lineTo(8f, 12f)
            lineTo(7f, 15f)
            lineTo(10f, 11.5f)
            lineTo(8f, 11.5f)
            close()
        }

    /** lucide `download` — an arrow into an open tray. */
    val Download: ImageVector =
        sessionVector("SessionListDownload") {
            moveTo(4f, 15f)
            lineTo(4f, 20f)
            lineTo(20f, 20f)
            lineTo(20f, 15f)
            moveTo(8f, 11f)
            lineTo(12f, 15f)
            lineTo(16f, 11f)
            moveTo(12f, 3f)
            lineTo(12f, 15f)
        }

    /** lucide `zap` — a lightning bolt (web `TrendingUp` peak metric). */
    val Bolt: ImageVector =
        sessionVector("SessionListBolt") {
            moveTo(13f, 2f)
            lineTo(3f, 14f)
            lineTo(12f, 14f)
            lineTo(11f, 22f)
            lineTo(21f, 10f)
            lineTo(12f, 10f)
            close()
        }

    /** lucide `activity` — a pulse line (web `Plug` average metric). */
    val Activity: ImageVector =
        sessionVector("SessionListActivity") {
            moveTo(22f, 12f)
            lineTo(18f, 12f)
            lineTo(15f, 21f)
            lineTo(9f, 3f)
            lineTo(6f, 12f)
            lineTo(2f, 12f)
        }

    /** lucide `dollar-sign` — a vertical bar through an S (web cost metric). */
    val Dollar: ImageVector =
        sessionVector("SessionListDollar") {
            moveTo(12f, 2f)
            lineTo(12f, 22f)
            moveTo(16f, 7f)
            lineTo(10f, 7f)
            lineTo(10f, 11f)
            lineTo(14f, 11f)
            lineTo(14f, 17f)
            lineTo(8f, 17f)
        }
}

private fun sessionVector(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STRINGS =
    SessionListStrings(
        allSessions = "All Sessions",
        searchHint = "Search by location or charger type…",
        filterSearch = "Search",
        filterCharger = "Charger",
        filterAll = "All",
        filterHome = "Home",
        filterSc = "SC",
        filterDc = "DC",
        sortDate = "Date",
        sortEnergy = "kWh",
        sortCost = "Cost",
        sortTime = "Time",
        sortPower = "Power",
        exportCsv = "CSV",
        exportJson = "JSON",
        emptyTitle = "No charging sessions yet",
        emptyMessage = "Charging data will appear here once your vehicle records a session.",
        noMatchesTitle = "No sessions match your filters",
        noMatchesMessage = "Try clearing the search or charger filter to see more sessions.",
        chargerHome = "Home / AC",
        chargerSupercharger = "Supercharger",
        chargerDc = "DC Fast",
        chargerUnknown = "Charger",
        clear = "Clear",
        deleteAction = "Delete",
        deleteConfirm = "Delete",
        deleteDescription = "This cannot be undone.",
        cancel = "Cancel",
        bulkClear = "Clear selection",
        selectRow = "Select row",
        retry = "Retry",
        errorTitle = "Server error",
        errorMessage = "Something went wrong on our end. Please try again.",
        loadingLabel = "Loading",
        offline = "Offline",
        loadingShort = "Loading...",
        paginationFirst = "First page",
        paginationPrevious = "Previous page",
        paginationNext = "Next page",
        paginationLast = "Last page",
    )

private val PREVIEW_SESSIONS =
    listOf(
        ChargingSessionItem(
            id = 1,
            startedAt = "2026-04-04T18:30:00Z",
            endedAt = "2026-04-04T19:42:00Z",
            chargerType = "Supercharger V3",
            totalEnergyAddedWh = 52_400.0,
            peakPowerW = 246_000.0,
            avgPowerW = null,
            costDecimal = 18.32,
            startSocPct = 18.0,
            endSocPct = 78.0,
            startPlace = "Harris Ranch Supercharger",
            startLat = 36.25,
            startLng = -120.23,
        ),
        ChargingSessionItem(
            id = 2,
            startedAt = "2026-04-03T07:05:00Z",
            endedAt = "2026-04-03T11:05:00Z",
            chargerType = null,
            totalEnergyAddedWh = 19_800.0,
            peakPowerW = 7_400.0,
            avgPowerW = 4_950.0,
            costDecimal = null,
            startSocPct = 42.0,
            endSocPct = 80.0,
            startPlace = "Home",
            startLat = null,
            startLng = null,
        ),
    )

private fun previewState(
    phase: UiPhase,
    data: List<ChargingSessionItem>?,
    errorKind: ErrorKind? = null,
): UiState<List<ChargingSessionItem>> = UiState(phase = phase, data = data, errorKind = errorKind)

@Composable
private fun PreviewSurface(
    state: UiState<List<ChargingSessionItem>>,
    filtered: List<ChargingSessionItem>,
) {
    TeslaSyncTheme(dynamicColor = false) {
        SessionListSectionContent(
            state = state,
            filteredSessions = filtered,
            searchQuery = "",
            onSearchQueryChange = {},
            chargerFilter = ChargerFilter.All,
            onChargerFilterChange = {},
            sortBy = SortKey.Date,
            sortDesc = true,
            onSortChange = {},
            onSortToggle = {},
            page = 1,
            pageSize = DEFAULT_PAGE_SIZE,
            onPageChange = {},
            onExport = {},
            onOpenSession = {},
            onRetry = {},
            onToggleSelected = { _, _ -> },
            onClearSelection = {},
            onBulkDelete = {},
            currencySymbol = "$",
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun SessionListContentPreview() {
    PreviewSurface(previewState(UiPhase.Content, PREVIEW_SESSIONS), PREVIEW_SESSIONS)
}

@Preview(name = "No matches", showBackground = true)
@Composable
private fun SessionListNoMatchesPreview() {
    PreviewSurface(previewState(UiPhase.Content, PREVIEW_SESSIONS), emptyList())
}

@Preview(name = "Empty — no sessions", showBackground = true)
@Composable
private fun SessionListEmptyPreview() {
    PreviewSurface(previewState(UiPhase.Empty, emptyList()), emptyList())
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun SessionListLoadingPreview() {
    PreviewSurface(UiState.loading(), emptyList())
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun SessionListErrorPreview() {
    PreviewSurface(previewState(UiPhase.Error, null, ErrorKind.Network), emptyList())
}
