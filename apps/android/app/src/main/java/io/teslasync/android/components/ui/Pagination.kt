package io.teslasync.android.components.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Pagination controls mirroring web `components/ui/Pagination`: a "showing X–Y of Z" summary plus
 * first/previous/next/last buttons that disable at the bounds. All arithmetic comes from
 * [PaginationMath]; format the summary in the caller via [showingText] for i18n.
 */
@Composable
fun Pagination(
    page: Int,
    pageSize: Int,
    total: Int,
    onPageChange: (Int) -> Unit,
    firstLabel: String,
    previousLabel: String,
    nextLabel: String,
    lastLabel: String,
    showingText: (start: Int, end: Int, total: Int) -> String,
    modifier: Modifier = Modifier,
) {
    val pages = PaginationMath.pageCount(total, pageSize)
    val window = PaginationMath.window(page, pageSize, total)
    val current = PaginationMath.clampPage(page, total, pageSize)
    val atStart = current <= 1
    val atEnd = current >= pages

    Row(
        modifier = modifier.fillMaxWidth().padding(top = Spacing.sm),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Caption(showingText(if (total > 0) window.start else 0, window.end, total))
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(TeslaGlyphs.FirstPage, firstLabel, { onPageChange(1) }, enabled = !atStart, size = IconSize.Sm)
            IconButton(TeslaGlyphs.ChevronLeft, previousLabel, { onPageChange(current - 1) }, enabled = !atStart, size = IconSize.Sm)
            Caption("$current / $pages", modifier = Modifier.padding(horizontal = Spacing.sm))
            IconButton(TeslaGlyphs.ChevronRight, nextLabel, { onPageChange(current + 1) }, enabled = !atEnd, size = IconSize.Sm)
            IconButton(TeslaGlyphs.LastPage, lastLabel, { onPageChange(pages) }, enabled = !atEnd, size = IconSize.Sm)
        }
    }
}
