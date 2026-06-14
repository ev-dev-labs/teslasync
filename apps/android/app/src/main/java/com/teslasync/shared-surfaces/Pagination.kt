// The native Jetpack Compose + Material 3 Pagination shared surface — a parity port of
// web/src/components/ui/Pagination.tsx. The web surface is the table-pagination bar: a localized
// "Showing {{start}}–{{end}} of {{total}}" summary in an `aria-live="polite"` span, an OPTIONAL "Rows per page"
// `<select>` (only when an `onPageSizeChange` handler is supplied) whose options read "{{count}} / page", and a
// first / previous / page-indicator / next / last button group wrapped in a `<nav>` landmark named "Pagination".
// The first+previous buttons disable at `page <= 1`, the next+last buttons disable at `page >= totalPages`, and
// the centre shows `{page} / {totalPages}` with the localized `aria-label` "Page {{page}} of {{total}}".
//
// This native surface keeps that contract end to end. It reproduces every branch the web source draws — the
// "showing" summary (0 when the dataset is empty, else the 1-based window), the optional page-size selector, the
// four navigation jumps with their bound-aware disabled states, and the page indicator — all derived by the pure
// [paginationProjection] in PaginationModel.kt so the composable stays a thin render layer. The web is
// mobile-first `flex-col` (it only becomes a single justified row at the `sm` breakpoint), so the native bar is a
// [Column]: the summary + selector cluster on top, the navigation cluster aligned to the end below — the
// idiomatic phone layout. Every string resolves through the P1/S10 i18n catalog (the `translation_pagination_*`
// / `translation_a11y_pagination` keys); there is NO English literal in this file. Accessibility mirrors the web
// landmark + live region: the bar carries the "Pagination" name, the summary is a polite live region so paging
// is announced without stealing focus, the indicator exposes its "Page X of Y" spoken name, and each jump is a
// shared [IconButton] with a ≥48 dp touch target and a localized contentDescription.
//
// It performs NO HTTP and binds NO data state holder (the web component fetches nothing; it receives its props
// from the owning list/table screen). See PaginationModel.kt for the honesty rationale and why the generic
// loading / empty / error / stale / offline states do not apply to a presentational control. A one-shot
// PII-safe `view.opened` diagnostic (P1/S11) fires on first composition, carrying only the surface slug — never
// the page, page-size, or total.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/Pagination) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.pagination

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag identifying the pagination bar — used by the instrumented per-state + a11y UI tests. */
const val PAGINATION_TEST_TAG: String = "pagination"

// Compact width for the inline page-size selector — the web `<select>` hugs its "{{count}} / page" content; the
// native Material dropdown anchor needs a fixed footprint so it does not stretch the summary row.
private val PAGE_SIZE_SELECTOR_WIDTH: Dp = 136.dp

/**
 * Pagination bar — the faithful port of the web `Pagination`. Renders the localized "showing" summary, the
 * optional page-size selector, and the first / previous / next / last jumps with their bound-aware disabled
 * states, and records the one-shot `view.opened` diagnostic on first composition. The numbers come from the pure
 * [paginationProjection]; the callbacks report the requested page / size exactly as the web `onPageChange` /
 * `onPageSizeChange` do.
 *
 * @param page the current 1-based page (web `page`).
 * @param pageSize the rows-per-page in effect (web `pageSize`).
 * @param total the total row count across all pages (web `total`).
 * @param onPageChange reports the requested page when a jump is tapped (web `onPageChange`).
 * @param onPageSizeChange reports a new page size; when null the selector is hidden (web optional `onPageSizeChange`).
 * @param pageSizeOptions the offered page sizes (web `pageSizeOptions`, default 25 / 50 / 100).
 * @param logger the sanctioned redacting logger; defaults to the app's data container logger.
 */
@Composable
fun Pagination(
    page: Int,
    pageSize: Int,
    total: Int,
    onPageChange: (Int) -> Unit,
    modifier: Modifier = Modifier,
    onPageSizeChange: ((Int) -> Unit)? = null,
    pageSizeOptions: List<Int> = DEFAULT_PAGE_SIZE_OPTIONS,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { PaginationDiagnostics.recordViewOpened(logger) }
    PaginationBar(
        page = page,
        pageSize = pageSize,
        total = total,
        onPageChange = onPageChange,
        modifier = modifier,
        onPageSizeChange = onPageSizeChange,
        pageSizeOptions = pageSizeOptions,
    )
}

/**
 * Stateless renderer — the unit/UI-test + preview entry point (no diagnostics, no data container). Lays out the
 * mobile-first column: the "showing" summary (a polite live region) with the optional page-size selector on top,
 * and the navigation cluster — first / previous / `page / totalPages` / next / last — aligned to the end below.
 * The whole bar carries the localized "Pagination" landmark name; each jump is disabled at the corresponding
 * bound exactly as the web `disabled` predicates require.
 */
@Composable
fun PaginationBar(
    page: Int,
    pageSize: Int,
    total: Int,
    onPageChange: (Int) -> Unit,
    modifier: Modifier = Modifier,
    onPageSizeChange: ((Int) -> Unit)? = null,
    pageSizeOptions: List<Int> = DEFAULT_PAGE_SIZE_OPTIONS,
) {
    val projection = paginationProjection(page = page, pageSize = pageSize, total = total)

    val navLabel = stringResource(R.string.translation_a11y_pagination)
    val showingText =
        stringResource(R.string.translation_pagination_showing, projection.showingStart, projection.showingEnd, total)
    val currentPageLabel = stringResource(R.string.translation_pagination_currentPage, page, projection.totalPages)

    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .semantics { contentDescription = navLabel }
                .testTag(PAGINATION_TEST_TAG),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Caption(
                text = showingText,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
            if (onPageSizeChange != null) {
                PageSizeSelector(
                    pageSize = pageSize,
                    pageSizeOptions = pageSizeOptions,
                    onPageSizeChange = onPageSizeChange,
                )
            }
        }

        Row(
            modifier = Modifier.align(Alignment.End),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(
                imageVector = TeslaGlyphs.FirstPage,
                contentDescription = stringResource(R.string.translation_pagination_first),
                onClick = { onPageChange(1) },
                enabled = !projection.atStart,
                size = IconSize.Sm,
            )
            IconButton(
                imageVector = TeslaGlyphs.ChevronLeft,
                contentDescription = stringResource(R.string.translation_pagination_previous),
                onClick = { onPageChange(page - 1) },
                enabled = !projection.atStart,
                size = IconSize.Sm,
            )
            Caption(
                text = "$page / ${projection.totalPages}",
                modifier =
                    Modifier
                        .padding(horizontal = Spacing.sm)
                        .semantics { contentDescription = currentPageLabel },
            )
            IconButton(
                imageVector = TeslaGlyphs.ChevronRight,
                contentDescription = stringResource(R.string.translation_pagination_next),
                onClick = { onPageChange(page + 1) },
                enabled = !projection.atEnd,
                size = IconSize.Sm,
            )
            IconButton(
                imageVector = TeslaGlyphs.LastPage,
                contentDescription = stringResource(R.string.translation_pagination_last),
                onClick = { onPageChange(projection.totalPages) },
                enabled = !projection.atEnd,
                size = IconSize.Sm,
            )
        }
    }
}

/**
 * The inline "Rows per page" selector — the native mirror of the web `<select>` shown only when an
 * `onPageSizeChange` handler exists. Built on the shared [Select] atom: each option reads the localized
 * "{{count}} / page", the current [pageSize] is pre-selected, and choosing one reports the parsed size through
 * [onPageSizeChange]. The "Rows per page" string names the control for TalkBack (web spread `aria-label`).
 */
@Composable
private fun PageSizeSelector(
    pageSize: Int,
    pageSizeOptions: List<Int>,
    onPageSizeChange: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val rowsPerPageLabel = stringResource(R.string.translation_pagination_pageSize)
    // Resolve the localized "{{count}} / page" template once, then fill it per option — the labels are built in
    // a plain (non-composable) map, so the i18n word order still comes from the catalog, never hard-coded here.
    val perPageTemplate = stringResource(R.string.translation_pagination_perPage)
    val options =
        pageSizeOptions.map { size ->
            SelectOption(value = size.toString(), label = perPageTemplate.format(size))
        }
    Select(
        options = options,
        selectedValue = pageSize.toString(),
        onSelect = { value -> value.toIntOrNull()?.let(onPageSizeChange) },
        modifier =
            modifier
                .width(PAGE_SIZE_SELECTOR_WIDTH)
                .semantics { contentDescription = rowsPerPageLabel },
        emptyLabel = rowsPerPageLabel,
    )
}

// ── Previews (tooling-only; the sample values are never shipped UI) ───────────────────────────────────────

@Preview(name = "Pagination · middle page (all jumps enabled)", showBackground = true)
@Composable
private fun PaginationMiddlePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PaginationBar(page = 3, pageSize = 25, total = 250, onPageChange = {})
    }
}

@Preview(name = "Pagination · first page (first/prev disabled)", showBackground = true)
@Composable
private fun PaginationFirstPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PaginationBar(page = 1, pageSize = 25, total = 60, onPageChange = {})
    }
}

@Preview(name = "Pagination · empty dataset (showing 0)", showBackground = true)
@Composable
private fun PaginationEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PaginationBar(page = 1, pageSize = 25, total = 0, onPageChange = {})
    }
}

@Preview(name = "Pagination · with page-size selector", showBackground = true)
@Composable
private fun PaginationWithSelectorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PaginationBar(page = 2, pageSize = 50, total = 320, onPageChange = {}, onPageSizeChange = {})
    }
}
