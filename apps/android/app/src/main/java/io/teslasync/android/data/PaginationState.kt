package io.teslasync.android.data

/**
 * Immutable, UI-thread-free pagination model for list ViewModels — the Kotlin port of the Windows
 * `PaginationState`. Holds the page / page-size / total invariants and every derived value a paged
 * list needs: the [offset] for the API `limit`/`offset` query, the 1-based "showing X–Y of Z" window,
 * and the prev/next guards.
 *
 * Every instance is normalized: [pageSize] >= 1, [total] >= 0, and [page] clamped to `[1, pageCount]`.
 * Construction is funnelled through [of] (the primary constructor is private) so an instance can never
 * hold un-normalized values; transitions return new normalized instances.
 */
@ConsistentCopyVisibility
data class PaginationState private constructor(
    val page: Int,
    val pageSize: Int,
    val total: Int,
) {
    /** Number of pages; at least 1 even when empty. Integer ceiling division ((n + d - 1) / d). */
    val pageCount: Int get() = maxOf(1, (total + pageSize - 1) / pageSize)

    /** Zero-based offset of the current page's first item (the API `offset` argument). */
    val offset: Int get() = (page - 1) * pageSize

    /** 1-based index of the first visible row (0 when empty). */
    val rangeStart: Int get() = if (total == 0) 0 else offset + 1

    /** 1-based index of the last visible row (0 when empty). */
    val rangeEnd: Int get() = if (total == 0) 0 else minOf(page * pageSize, total)

    /** Whether a previous page exists. */
    val canGoPrevious: Boolean get() = page > 1

    /** Whether a next page exists. */
    val canGoNext: Boolean get() = page < pageCount

    fun withPage(value: Int): PaginationState = of(value, pageSize, total)

    fun withPageSize(value: Int): PaginationState = of(page, value, total)

    fun withTotal(value: Int): PaginationState = of(page, pageSize, value)

    fun first(): PaginationState = withPage(1)

    fun previous(): PaginationState = withPage(page - 1)

    fun next(): PaginationState = withPage(page + 1)

    fun last(): PaginationState = withPage(pageCount)

    /** The slice of [source] for the current page (client-side fallback when the API returns all rows). */
    fun <T> slice(source: List<T>): List<T> {
        if (source.isEmpty()) return emptyList()
        val start = offset.coerceAtMost(source.size)
        val end = (start + pageSize).coerceAtMost(source.size)
        return source.subList(start, end)
    }

    companion object {
        const val DEFAULT_PAGE_SIZE = 25

        /** Builds a normalized [PaginationState], clamping [pageSize] >= 1, [total] >= 0, [page] into range. */
        fun of(
            page: Int = 1,
            pageSize: Int = DEFAULT_PAGE_SIZE,
            total: Int = 0,
        ): PaginationState {
            val size = pageSize.coerceAtLeast(1)
            val count = total.coerceAtLeast(0)
            val pages = maxOf(1, (count + size - 1) / size)
            return PaginationState(page.coerceIn(1, pages), size, count)
        }
    }
}
