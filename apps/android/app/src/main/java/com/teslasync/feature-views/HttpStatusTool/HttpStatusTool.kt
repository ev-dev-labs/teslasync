// The native Jetpack Compose + Material 3 HttpStatusTool feature view — a parity port of
// web/src/features/admin/components/devtools/tools/HttpStatusTool.tsx. It reproduces the web composition:
// a `ToolCard` (amber Network icon + `Http Status` title/description) wrapping a search box over a
// sortable, paginated `DataTable` of the static `HTTP_CODES` reference (code Badge + reason phrase +
// description), narrowing to a friendly empty state when the filter clears the list. All data flows
// through the shared [HttpStatusToolViewModel] (P1/S8); the view performs no HTTP (ADR-002). Every UI
// string resolves through the i18n boundary — the pagination / common labels via `R.string`, the six
// tool-specific keys (`Http Status`, `Http Status Desc`, `Search Codes`, `Status Code`, `Status Text`,
// `Status Desc`) via i18next key-as-fallback (see [labelFor]) because they are absent from the P1/S10
// catalog upstream, exactly as the web renders them — and every interactive element carries an
// accessibility label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/HttpStatusTool) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless content + helpers + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.httpstatus

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.Pagination
import io.teslasync.android.components.ui.PaginationMath
import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.SortState
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.components.ui.toggledBy
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.toolcard.ToolCardContent
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing

private val SEARCH_MAX_WIDTH = 420.dp
private val BODY_MIN_HEIGHT = 120.dp
private val SEARCH_SKELETON_HEIGHT = 48.dp
private val ROW_SKELETON_HEIGHT = 16.dp
private const val SKELETON_ROW_COUNT = 6
private const val SEARCH_SKELETON_FRACTION = 0.9f
private const val PAGE_SIZE = 25
private const val CODE_COLUMN_WEIGHT = 1f
private const val TEXT_COLUMN_WEIGHT = 1.6f
private const val DESC_COLUMN_WEIGHT = 2.4f
private const val TOOL_ACCENT = "amber"
private const val PREVIEW_NOW = 1_780_000_000_000L

// The web `t(...)` keys. Verified absent from the P1/S10 catalog at authoring time, so each renders via
// i18next key-as-fallback through [labelFor] (the web renders the key text itself).
private const val KEY_TITLE = "Http Status"
private const val KEY_DESC = "Http Status Desc"
private const val KEY_SEARCH = "Search Codes"
private const val KEY_STATUS_CODE = "Status Code"
private const val KEY_STATUS_TEXT = "Status Text"
private const val KEY_STATUS_DESC = "Status Desc"

/** Persists the hoisted [SortState] across config change / process death as a `[key, direction]` list. */
private val sortStateSaver =
    listSaver<SortState, String>(
        save = { listOf(it.key ?: "", it.direction.name) },
        restore = { saved -> SortState(saved[0].ifEmpty { null }, SortDirection.valueOf(saved[1])) },
    )

/**
 * Stateful entry point. Collects the shared [HttpStatusToolViewModel] state, records the one-shot
 * `view.opened` diagnostic, and renders the surface. A host supplies the view-model, wired via
 * [HttpStatusToolViewModel.factory].
 *
 * @param viewModel the state holder bound to the shared HTTP-status-catalog feed.
 */
@Composable
fun HttpStatusTool(
    viewModel: HttpStatusToolViewModel,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(viewModel) { viewModel.onAppear() }
    HttpStatusToolContent(
        state = state,
        modifier = modifier,
        onRefresh = viewModel::refresh,
        onRetry = viewModel::retry,
    )
}

/**
 * Stateless HttpStatusTool surface — the amber [ToolCardContent] header over every rendered state: the
 * loading skeleton chrome, a hard error + retry, and the content body (search + sortable/paginated table),
 * which itself narrows to the friendly empty state. Stale / non-error data auto-refreshes once (web
 * TanStack stale refetch). Hoisted out of the ViewModel so each state is preview- and screenshot-testable
 * with hand-built [UiState] inputs.
 */
@Composable
fun HttpStatusToolContent(
    state: UiState<HttpStatusSnapshot>,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit = {},
    onRetry: () -> Unit = {},
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    ToolCardContent(
        icon = HttpStatusToolGlyphs.Network,
        color = TOOL_ACCENT,
        title = labelFor(KEY_TITLE),
        description = labelFor(KEY_DESC),
        modifier = modifier,
    ) {
        when {
            state.isLoading -> HttpStatusLoading()
            state.isError -> HttpStatusError(state = state, onRetry = onRetry)
            else -> HttpStatusBody(state = state, onRefresh = onRefresh)
        }
    }
}

/** Content body — the freshness chip (stale/offline only), the search box, and the filtered table. */
@Composable
private fun HttpStatusBody(
    state: UiState<HttpStatusSnapshot>,
    onRefresh: () -> Unit,
) {
    val searchLabel = labelFor(KEY_SEARCH)
    val noResults = stringResource(R.string.translation_common_noData)
    val rows = state.data?.codes ?: emptyList()

    var search by rememberSaveable { mutableStateOf("") }
    var sort by rememberSaveable(stateSaver = sortStateSaver) { mutableStateOf(SortState()) }
    var page by rememberSaveable { mutableIntStateOf(1) }

    val display = HttpStatusProjection.filter(rows, search)
    val sorted = HttpStatusProjection.sorted(display.codes, sort)

    LaunchedEffect(search, sort) { page = 1 }

    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        if (state.stale || state.hasError || state.refreshing) {
            HttpStatusFreshness(state = state, onRefresh = onRefresh)
        }
        Input(
            value = search,
            onValueChange = { search = it },
            modifier = Modifier.widthIn(max = SEARCH_MAX_WIDTH),
            label = searchLabel,
            leadingIcon = HttpStatusToolGlyphs.Network,
        )
        if (!display.hasResults) {
            HttpStatusEmpty(message = noResults)
        } else {
            HttpStatusTable(
                rows = sorted,
                sort = sort,
                page = page,
                onSortChange = { sort = sort.toggledBy(it) },
                onPageChange = { page = it },
            )
        }
    }
}

/** The sortable, paginated reference table — the web `DataTable` (compact, sortable code, pagination). */
@Composable
private fun HttpStatusTable(
    rows: List<HttpStatusCode>,
    sort: SortState,
    page: Int,
    onSortChange: (String) -> Unit,
    onPageChange: (Int) -> Unit,
) {
    val total = rows.size
    val bounds = PaginationMath.sliceBounds(page, PAGE_SIZE, total)
    val pageRows = if (total == 0) emptyList() else rows.subList(bounds.first, bounds.last + 1)
    DataTable(
        columns = httpStatusColumns(),
        rows = pageRows,
        keyOf = { it.code },
        sortState = sort,
        onSortChange = onSortChange,
        footer = { HttpStatusPagination(page = page, total = total, onPageChange = onPageChange) },
    )
}

/** The three web columns: code Badge (sortable), reason phrase, and description. */
@Composable
private fun httpStatusColumns(): List<TableColumn<HttpStatusCode>> {
    val codeHeader = labelFor(KEY_STATUS_CODE)
    val textHeader = labelFor(KEY_STATUS_TEXT)
    val descHeader = labelFor(KEY_STATUS_DESC)
    return listOf(
        TableColumn(
            key = HttpStatusColumns.CODE,
            header = codeHeader,
            weight = CODE_COLUMN_WEIGHT,
            sortable = true,
            cell = { row -> Badge(text = row.code.toString(), variant = badgeVariant(row.statusClass)) },
        ),
        TableColumn(
            key = HttpStatusColumns.TEXT,
            header = textHeader,
            weight = TEXT_COLUMN_WEIGHT,
            cell = { row -> BodyText(row.text) },
        ),
        TableColumn(
            key = HttpStatusColumns.DESC,
            header = descHeader,
            weight = DESC_COLUMN_WEIGHT,
            cell = { row -> Caption(row.desc) },
        ),
    )
}

/** The table footer pagination bar — the web `DataTable` pagination (catalog default page size). */
@Composable
private fun HttpStatusPagination(
    page: Int,
    total: Int,
    onPageChange: (Int) -> Unit,
) {
    val context = LocalContext.current
    Pagination(
        page = page,
        pageSize = PAGE_SIZE,
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
}

/** The stale / offline freshness chip + refresh control, shown only over a degraded cached catalog. */
@Composable
private fun HttpStatusFreshness(
    state: UiState<HttpStatusSnapshot>,
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

/** The empty surface — the web "no matching rows" branch (search-empty or empty catalog). */
@Composable
private fun HttpStatusEmpty(
    message: String,
    modifier: Modifier = Modifier,
) {
    EmptyState(
        message = message,
        icon = HttpStatusToolGlyphs.Network,
        modifier = modifier.fillMaxWidth().heightIn(min = BODY_MIN_HEIGHT),
    )
}

/** Loading skeleton chrome — a shimmering search bar over a few shimmering table rows. */
@Composable
private fun HttpStatusLoading(modifier: Modifier = Modifier) {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Skeleton(widthFraction = SEARCH_SKELETON_FRACTION, height = SEARCH_SKELETON_HEIGHT, rounded = true)
        repeat(SKELETON_ROW_COUNT) {
            Skeleton(height = ROW_SKELETON_HEIGHT)
        }
    }
}

/** Hard-error surface — the [QueryError] retry affordance (web `QueryError` equivalent). */
@Composable
private fun HttpStatusError(
    state: UiState<HttpStatusSnapshot>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier.fillMaxWidth().heightIn(min = BODY_MIN_HEIGHT).padding(Spacing.md),
        contentAlignment = Alignment.Center,
    ) {
        QueryError(
            kind = queryErrorKindFor(state),
            resourceName = labelFor(KEY_TITLE),
            onRetry = onRetry,
        )
    }
}

/** Maps a status class to the shared [BadgeVariant] (web Badge `variant`). */
private fun badgeVariant(statusClass: HttpStatusClass): BadgeVariant =
    when (statusClass) {
        HttpStatusClass.Success -> BadgeVariant.Success
        HttpStatusClass.Info -> BadgeVariant.Info
        HttpStatusClass.Warning -> BadgeVariant.Warning
        HttpStatusClass.Danger -> BadgeVariant.Danger
    }

/**
 * Resolves a web i18n key for display. Every key this surface draws (`Http Status`, `Http Status Desc`,
 * `Search Codes`, `Status Code`, `Status Text`, `Status Desc`) was verified absent from the P1/S10 catalog
 * at authoring time, so this reproduces i18next's key-as-fallback — the web renders the key text itself —
 * keeping the native surface at parity. Route a key through `stringResource` here once a catalog entry
 * exists.
 */
private fun labelFor(key: String): String = key

/** Folds a hard failure onto a [QueryErrorKind] (network/timeout → offline, circuit-open → waiting). */
private fun queryErrorKindFor(state: UiState<*>): QueryErrorKind =
    classifyQueryError(
        status = state.httpStatus,
        online = state.errorKind != ErrorKind.Network && state.errorKind != ErrorKind.Timeout,
        transientWaiting = state.errorKind == ErrorKind.CircuitOpen,
    )

// ── Previews — one per rendered state (content / empty / loading / error / offline) ─────────────────────

@Preview(name = "HttpStatus · content", showBackground = true)
@Composable
private fun HttpStatusContentPreview() {
    TeslaSyncTheme {
        HttpStatusToolContent(
            state = UiState(phase = UiPhase.Content, data = HttpStatusCatalog.snapshot, fetchedAt = PREVIEW_NOW),
        )
    }
}

@Preview(name = "HttpStatus · empty", showBackground = true)
@Composable
private fun HttpStatusEmptyPreview() {
    TeslaSyncTheme {
        HttpStatusToolContent(
            state = UiState(phase = UiPhase.Empty, data = HttpStatusSnapshot.EMPTY, fetchedAt = PREVIEW_NOW),
        )
    }
}

@Preview(name = "HttpStatus · loading", showBackground = true)
@Composable
private fun HttpStatusLoadingPreview() {
    TeslaSyncTheme {
        HttpStatusToolContent(state = UiState.loading())
    }
}

@Preview(name = "HttpStatus · error", showBackground = true)
@Composable
private fun HttpStatusErrorPreview() {
    TeslaSyncTheme {
        HttpStatusToolContent(state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network))
    }
}

@Preview(name = "HttpStatus · offline", showBackground = true)
@Composable
private fun HttpStatusOfflinePreview() {
    TeslaSyncTheme {
        HttpStatusToolContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = HttpStatusCatalog.snapshot,
                    fetchedAt = PREVIEW_NOW,
                    stale = true,
                    errorKind = ErrorKind.Timeout,
                ),
        )
    }
}
