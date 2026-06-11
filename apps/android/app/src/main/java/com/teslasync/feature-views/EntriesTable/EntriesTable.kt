// The native Jetpack Compose + Material 3 DLQ-Inspector EntriesTable feature view — a parity port of
// web/src/features/admin/components/dlq-inspector/EntriesTable.tsx. The web component is purely
// presentational: its parent page loads the DLQ rows via `useDLQList` and passes `rows` + `loading` down,
// and it renders the shared `DataTable` with sortable columns, a per-row Inspect action, a Replayable
// badge, and an empty/loading message. Its only hooks are `useTranslation` (mapped here to the P1/S10 i18n
// catalog) and `useSortToggle` (mapped to the shared `SortState.toggledBy`); it performs NO HTTP.
//
// This surface keeps that contract and binds to the shared P1/S8 state-holder layer as a [UiState] (the
// cache-then-network projection of the `DlqStore.list()` feed), so it also renders every lifecycle state
// that layer can carry — loading skeleton, hard error with retry, empty, content, and stale/offline
// ("last known") — without ever fetching. A web-parity overload that takes the raw `rows` + `loading`
// props is also provided for hosts that already hold the loaded list.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/EntriesTable — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.entriestable

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.TableSkeleton
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Pagination
import io.teslasync.android.components.ui.PaginationMath
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.SortState
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.components.ui.toggledBy
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.Locale

private val PAGE_SIZE_SELECT_WIDTH: Dp = 168.dp
private const val SKELETON_ROWS = 6
private const val SKELETON_COLUMNS = 6

// Column weights — VIN and source topic are the widest free-text fields; the right-aligned numeric
// columns are narrower, matching the web table's natural column sizing.
private const val ARRIVED_WEIGHT = 1.3f
private const val REASON_WEIGHT = 1.4f
private const val VIN_WEIGHT = 1.7f
private const val TOPIC_WEIGHT = 1.8f
private const val REDELIVERIES_WEIGHT = 0.8f
private const val PAYLOAD_WEIGHT = 1.0f
private const val REPLAYABLE_WEIGHT = 1.1f
private const val ACTIONS_WEIGHT = 1.1f

/**
 * Stateful entry point — binds to the shared DLQ-list feed (P1/S8) as a [UiState] and records the one-shot
 * PII-safe `view.opened` diagnostic (P1/S11) on first composition. The host owns the feed and supplies
 * [onRetry] (the feed's refetch); this view never performs HTTP. [onInspect] opens the entry drawer (the
 * web `onInspect` prop).
 *
 * @param state the cache-then-network projection of the DLQ rows (web `useDLQList`).
 * @param onInspect invoked with the row whose Inspect action was pressed (web `onInspect`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 */
@Composable
fun EntriesTable(
    state: UiState<List<DLQEntrySummary>>,
    onInspect: (DLQEntrySummary) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordEntriesTableOpened(logger) }
    EntriesTableContent(state = state, onInspect = onInspect, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `rows` + `loading` props for hosts that already hold
 * the loaded list. `loading` renders the skeleton; an empty resolved list renders the empty state (web
 * `emptyMessage`); a non-empty list renders the table. Records `view.opened` like the stateful entry; with
 * no feed behind it there is no retry affordance.
 */
@Composable
fun EntriesTable(
    rows: List<DLQEntrySummary>,
    loading: Boolean,
    onInspect: (DLQEntrySummary) -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(rows, loading) {
            val phase =
                when {
                    loading -> UiPhase.Loading
                    rows.isEmpty() -> UiPhase.Empty
                    else -> UiPhase.Content
                }
            UiState(phase = phase, data = rows)
        }
    EntriesTable(state = state, onInspect = onInspect, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Renders the loading skeleton,
 * the hard-error retry surface (web `QueryError` equivalent), or the loaded table; the empty branch is the
 * table's own empty message (web parity), and a freshness chip reflects refreshing/stale/offline. Stale
 * (non-error) data auto-refreshes, mirroring the web freshness contract. [locale]/[zoneId] format the
 * arrived timestamps.
 */
@Composable
fun EntriesTableContent(
    state: UiState<List<DLQEntrySummary>>,
    onInspect: (DLQEntrySummary) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    zoneId: ZoneId = ZoneId.systemDefault(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when {
            state.isLoading -> EntriesTableLoading()
            state.isError -> EntriesTableError(onRetry = onRetry)
            else -> EntriesTableLoaded(state = state, onInspect = onInspect, locale = locale, zoneId = zoneId)
        }
    }
}

/**
 * The loaded surface: hoists the [SortState] (web `useSortToggle('arrived_at', 'desc')`), the page size
 * (web `defaultPageSize: 25`), and the current page; sorts + paginates the rows through the pure
 * [EntriesTableProjection]; and renders the [DataTable] with a freshness chip and a pagination + page-size
 * footer. The empty list is handled by the table's own empty message, so the empty state is never a blank
 * box (web parity).
 */
@Composable
private fun ColumnScope.EntriesTableLoaded(
    state: UiState<List<DLQEntrySummary>>,
    onInspect: (DLQEntrySummary) -> Unit,
    locale: Locale,
    zoneId: ZoneId,
) {
    var sort by remember { mutableStateOf(SortState(EntriesColumnKey.ARRIVED, SortDirection.Desc)) }
    var pageSize by remember { mutableIntStateOf(ENTRIES_DEFAULT_PAGE_SIZE) }
    var page by remember { mutableIntStateOf(1) }

    val rowsData = state.data ?: emptyList()
    val sorted =
        remember(rowsData, sort) {
            EntriesTableProjection.sortRows(rowsData, sort.key, sort.direction == SortDirection.Desc)
        }
    val total = sorted.size
    val visible =
        if (total == 0) {
            emptyList()
        } else {
            val slice = PaginationMath.sliceBounds(page, pageSize, total)
            sorted.subList(slice.first, slice.last + 1)
        }
    val projected =
        remember(visible, locale, zoneId) {
            visible.map { row ->
                EntriesRow(
                    entry = row,
                    cells = EntriesTableProjection.cellTextOf(row) { iso -> EntriesTableTimeFormatting.format(iso, zoneId, locale) },
                )
            }
        }

    if (state.stale || state.refreshing || state.hasError) {
        EntriesFreshnessRow(state = state)
    }

    val footer: (@Composable () -> Unit)? =
        if (total > 0) {
            {
                EntriesTableFooter(
                    page = page,
                    pageSize = pageSize,
                    total = total,
                    onPageChange = { page = it },
                    onPageSizeChange = {
                        pageSize = it
                        page = 1
                    },
                )
            }
        } else {
            null
        }

    DataTable(
        columns = entriesColumns(onInspect = onInspect),
        rows = projected,
        keyOf = { it.entry.id },
        sortState = sort,
        onSortChange = { key ->
            sort = sort.toggledBy(key)
            page = 1
        },
        emptyText = stringResource(R.string.translation_admin_dlq_table_empty),
        footer = footer,
    )
}

/** Builds the eight DLQ columns — headers from the i18n catalog, four sortable (web `sortable: true`). */
@Composable
private fun entriesColumns(onInspect: (DLQEntrySummary) -> Unit): List<TableColumn<EntriesRow>> {
    val yes = stringResource(R.string.translation_common_yes)
    val no = stringResource(R.string.translation_common_no)
    val inspect = stringResource(R.string.translation_admin_dlq_actions_inspect)
    return listOf(
        TableColumn(
            key = EntriesColumnKey.ARRIVED,
            header = stringResource(R.string.translation_admin_dlq_cols_arrived),
            weight = ARRIVED_WEIGHT,
            sortable = true,
        ) { BodyText(it.cells.arrived, maxLines = 1) },
        TableColumn(
            key = EntriesColumnKey.REASON,
            header = stringResource(R.string.translation_admin_dlq_cols_reason),
            weight = REASON_WEIGHT,
            sortable = true,
        ) { CodeText(it.cells.reason) },
        TableColumn(
            key = EntriesColumnKey.VIN,
            header = stringResource(R.string.translation_admin_dlq_cols_vin),
            weight = VIN_WEIGHT,
            sortable = true,
        ) { CodeText(it.cells.vin) },
        TableColumn(
            key = EntriesColumnKey.SOURCE_TOPIC,
            header = stringResource(R.string.translation_admin_dlq_cols_topic),
            weight = TOPIC_WEIGHT,
        ) { CodeText(it.cells.sourceTopic) },
        TableColumn(
            key = EntriesColumnKey.REDELIVERIES,
            header = stringResource(R.string.translation_admin_dlq_cols_redeliveries),
            weight = REDELIVERIES_WEIGHT,
            alignEnd = true,
        ) { BodyText(it.cells.redeliveries, maxLines = 1) },
        TableColumn(
            key = EntriesColumnKey.PAYLOAD_SIZE,
            header = stringResource(R.string.translation_admin_dlq_cols_size),
            weight = PAYLOAD_WEIGHT,
            sortable = true,
            alignEnd = true,
        ) { Caption(it.cells.payload) },
        TableColumn(
            key = EntriesColumnKey.REPLAYABLE,
            header = stringResource(R.string.translation_admin_dlq_cols_replayable),
            weight = REPLAYABLE_WEIGHT,
        ) { ReplayableBadge(replayable = it.entry.replayable, yes = yes, no = no) },
        TableColumn(
            key = EntriesColumnKey.ACTIONS,
            header = stringResource(R.string.translation_admin_dlq_cols_actions),
            weight = ACTIONS_WEIGHT,
        ) { row ->
            Button(
                label = inspect,
                onClick = { onInspect(row.entry) },
                variant = ButtonVariant.Secondary,
                size = ButtonSize.Sm,
            )
        },
    )
}

/** Replayable cell — web `Badge variant={replayable ? 'success' : 'neutral'}` showing Yes / No. */
@Composable
private fun ReplayableBadge(
    replayable: Boolean,
    yes: String,
    no: String,
) {
    if (replayable) {
        Badge(text = yes, variant = BadgeVariant.Success)
    } else {
        Badge(text = no, variant = BadgeVariant.Neutral)
    }
}

/** Pagination + page-size selector composed into the table footer (web `pagination` config). */
@Composable
private fun EntriesTableFooter(
    page: Int,
    pageSize: Int,
    total: Int,
    onPageChange: (Int) -> Unit,
    onPageSizeChange: (Int) -> Unit,
) {
    val context = LocalContext.current
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Pagination(
            page = page,
            pageSize = pageSize,
            total = total,
            onPageChange = onPageChange,
            firstLabel = stringResource(R.string.translation_pagination_first),
            previousLabel = stringResource(R.string.translation_pagination_previous),
            nextLabel = stringResource(R.string.translation_pagination_next),
            lastLabel = stringResource(R.string.translation_pagination_last),
            showingText = { start, end, count ->
                context.getString(R.string.translation_pagination_showing, start, end, count)
            },
        )
        EntriesPageSizeSelect(pageSize = pageSize, onPageSizeChange = onPageSizeChange)
    }
}

/** Page-size dropdown — web `pageSizeOptions: [25, 50, 100]`, labelled via the pagination i18n keys. */
@Composable
private fun EntriesPageSizeSelect(
    pageSize: Int,
    onPageSizeChange: (Int) -> Unit,
) {
    val perPage = stringResource(R.string.translation_pagination_perPage)
    val options =
        remember(perPage) {
            ENTRIES_PAGE_SIZE_OPTIONS.map { size -> SelectOption(value = size.toString(), label = perPage.format(size)) }
        }
    Select(
        options = options,
        selectedValue = pageSize.toString(),
        onSelect = { onPageSizeChange(it.toIntOrNull() ?: ENTRIES_DEFAULT_PAGE_SIZE) },
        label = stringResource(R.string.translation_pagination_pageSize),
        modifier = Modifier.width(PAGE_SIZE_SELECT_WIDTH),
    )
}

/** Freshness chip row — surfaces refreshing/stale/offline above the cached table (ADR-013 honesty). */
@Composable
private fun EntriesFreshnessRow(state: UiState<List<DLQEntrySummary>>) {
    val formatAge = rememberEntriesFreshnessFormatter()
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        horizontalArrangement = Arrangement.End,
    ) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = formatAge,
        )
    }
}

/** First-load skeleton chrome — a shimmering table so the panel is never blank while loading (web parity). */
@Composable
private fun EntriesTableLoading() {
    val label = stringResource(R.string.translation_admin_dlq_table_loading)
    Column(modifier = Modifier.fillMaxWidth().semantics { contentDescription = label }) {
        TableSkeleton(rows = SKELETON_ROWS, columns = SKELETON_COLUMNS)
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent, strings from the catalog. */
@Composable
private fun EntriesTableError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Localized relative-age formatter for the freshness chip (`translation_freshness_*`), render-only. */
@Composable
private fun rememberEntriesFreshnessFormatter(): (FreshnessAge) -> String {
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

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_ROWS =
    listOf(
        DLQEntrySummary(
            id = 1,
            arrivedAt = "2026-04-04T14:30:00Z",
            parsedReason = "decode_error",
            parsedVin = "5YJ3E1EA1KF000001",
            parsedSourceTopic = "telemetry/5YJ.../v/Soc",
            parsedRedeliveries = 2,
            replayable = true,
            rawPayloadSize = 1536,
        ),
        DLQEntrySummary(
            id = 2,
            arrivedAt = "2026-04-04T13:00:00Z",
            parsedReason = "unknown_enum",
            parsedVin = null,
            parsedSourceTopic = null,
            parsedRedeliveries = null,
            replayable = false,
            rawPayloadSize = 2_200_000,
        ),
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun EntriesTableLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        EntriesTableContent(
            state = UiState(UiPhase.Loading),
            onInspect = {},
            onRetry = {},
            locale = Locale.US,
            zoneId = ZoneOffset.UTC,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun EntriesTableErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        EntriesTableContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onInspect = {},
            onRetry = {},
            locale = Locale.US,
            zoneId = ZoneOffset.UTC,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun EntriesTableEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        EntriesTableContent(
            state = UiState(UiPhase.Empty, data = emptyList()),
            onInspect = {},
            onRetry = {},
            locale = Locale.US,
            zoneId = ZoneOffset.UTC,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun EntriesTableContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        EntriesTableContent(
            state = UiState(UiPhase.Content, data = PREVIEW_ROWS),
            onInspect = {},
            onRetry = {},
            locale = Locale.US,
            zoneId = ZoneOffset.UTC,
        )
    }
}

@Preview(name = "Offline (stale)", showBackground = true)
@Composable
private fun EntriesTableOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        EntriesTableContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_ROWS,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onInspect = {},
            onRetry = {},
            locale = Locale.US,
            zoneId = ZoneOffset.UTC,
        )
    }
}
