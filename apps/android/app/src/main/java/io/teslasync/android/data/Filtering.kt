package io.teslasync.android.data

/** Sort direction for a list column. */
enum class SortDirection {
    Ascending,
    Descending,
    ;

    fun toggled(): SortDirection = if (this == Ascending) Descending else Ascending
}

/** An active sort: a domain [key] (matching a backend `sort` parameter) and its [direction]. */
data class SortState(
    val key: String,
    val direction: SortDirection = SortDirection.Ascending,
) {
    fun toggled(): SortState = copy(direction = direction.toggled())

    /** Sort by [key]: toggles direction when already sorting by it, else starts ascending on it. */
    fun on(key: String): SortState = if (key == this.key) toggled() else SortState(key)
}

/** An inclusive, optionally-open epoch-millisecond time window (mirrors the web `DateRangeFilter`). */
data class DateRange(
    val startMillis: Long? = null,
    val endMillis: Long? = null,
) {
    /** Whether either bound is set. */
    val isBounded: Boolean get() = startMillis != null || endMillis != null

    /** Whether [epochMillis] falls within the (inclusive, open-ended) window. */
    fun contains(epochMillis: Long): Boolean =
        (startMillis == null || epochMillis >= startMillis) &&
            (endMillis == null || epochMillis <= endMillis)

    companion object {
        /** The fully-open range that matches everything. */
        val Unbounded = DateRange()
    }
}

/**
 * The combined, immutable filter surface a list ViewModel exposes: a free-text [query], an optional
 * [sort], and an optional [range]. Pure transitions return new instances; the render layer binds
 * controls to it and the ViewModel folds it into API request arguments (or a client-side predicate).
 */
data class FilterState(
    val query: String = "",
    val sort: SortState? = null,
    val range: DateRange = DateRange.Unbounded,
) {
    /** Whether any filter is currently constraining the list. */
    val isActive: Boolean get() = query.isNotBlank() || sort != null || range.isBounded

    fun withQuery(value: String): FilterState = copy(query = value)

    fun withSort(value: SortState?): FilterState = copy(sort = value)

    /** Cycles the sort on [key] (start asc -> desc -> asc), preserving any other filters. */
    fun toggleSort(key: String): FilterState = copy(sort = sort?.on(key) ?: SortState(key))

    fun withRange(value: DateRange): FilterState = copy(range = value)

    /** Clears every filter back to the neutral default. */
    fun cleared(): FilterState = FilterState()
}
