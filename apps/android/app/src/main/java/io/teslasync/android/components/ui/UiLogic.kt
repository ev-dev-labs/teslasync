package io.teslasync.android.components.ui

/**
 * Framework-free logic backing the interactive primitives (sort, selection, pagination,
 * range/zoom clamping, masking, roving-focus navigation, inline-edit commit). Extracted so
 * the behavior is covered by fast JVM unit tests in the `:android:testDebugUnitTest` gate,
 * independent of the Compose UI layer.
 */

enum class SortDirection { Asc, Desc }

/** Active table sort: a column [key] (null = unsorted) and its [direction]. */
data class SortState(
    val key: String? = null,
    val direction: SortDirection = SortDirection.Desc,
)

/**
 * Click semantics matching the web `useSortToggle`: re-clicking the active column flips the
 * direction; clicking a new column selects it descending-first.
 */
fun SortState.toggledBy(key: String): SortState =
    if (key == this.key) {
        copy(direction = if (direction == SortDirection.Asc) SortDirection.Desc else SortDirection.Asc)
    } else {
        SortState(key, SortDirection.Desc)
    }

/** Adds [key] if absent, removes it if present — the selection/expansion set primitive. */
fun <K> Set<K>.togglePresence(key: K): Set<K> = if (contains(key)) this - key else this + key

/** 1-based inclusive page window. [start]==[end]==0 means "no rows". */
data class PageWindow(
    val start: Int,
    val end: Int,
)

/** Pagination arithmetic shared by [Pagination] and [DataTable]. */
object PaginationMath {
    fun pageCount(
        total: Int,
        pageSize: Int,
    ): Int {
        if (pageSize <= 0) return 1
        return maxOf(1, (total + pageSize - 1) / pageSize)
    }

    fun clampPage(
        page: Int,
        total: Int,
        pageSize: Int,
    ): Int = page.coerceIn(1, pageCount(total, pageSize))

    fun window(
        page: Int,
        pageSize: Int,
        total: Int,
    ): PageWindow {
        if (total <= 0 || pageSize <= 0) return PageWindow(0, 0)
        val current = clampPage(page, total, pageSize)
        val start = (current - 1) * pageSize + 1
        return PageWindow(start, minOf(current * pageSize, total))
    }

    /** Zero-based slice bounds for [List.subList]: `[from, to)`, clamped to [total]. */
    fun sliceBounds(
        page: Int,
        pageSize: Int,
        total: Int,
    ): IntRange {
        if (total <= 0 || pageSize <= 0) return IntRange(0, 0)
        val current = clampPage(page, total, pageSize)
        val from = (current - 1) * pageSize
        return from until minOf(from + pageSize, total)
    }
}

/** Clamp a zoom factor into `[min, max]`. */
fun clampZoom(
    value: Float,
    min: Float,
    max: Float,
): Float = value.coerceIn(min, max)

/** Apply a zoom [delta] then clamp — backs the Lightbox +/- controls. */
fun stepZoom(
    value: Float,
    delta: Float,
    min: Float,
    max: Float,
): Float = (value + delta).coerceIn(min, max)

/** Sort a `[low, high]` pair so `low <= high` (range-slider thumb swap). */
fun normalizeRange(
    low: Float,
    high: Float,
): Pair<Float, Float> = if (low <= high) low to high else high to low

/** Clamp a single value into `[min, max]`. */
fun clampToBounds(
    value: Float,
    min: Float,
    max: Float,
): Float = value.coerceIn(min, max)

/**
 * Index of the next enabled item when moving [delta] (±1) from [from] with wraparound.
 * [enabled] flags each item; returns -1 when none are enabled. Backs roving focus in
 * [Tabs] and [ContextMenu].
 */
fun nextEnabledIndex(
    enabled: List<Boolean>,
    from: Int,
    delta: Int,
): Int {
    val n = enabled.size
    if (n == 0 || enabled.none { it }) return -1
    var idx = from
    var result = from
    var steps = 0
    while (steps < n) {
        idx = ((idx + delta) % n + n) % n
        if (enabled[idx]) {
            result = idx
            break
        }
        steps++
    }
    return result
}

/** Outcome of attempting to commit an [EditableText] draft. */
enum class CommitOutcome { NoOp, Invalid, Commit }

/**
 * Decide what an inline-edit commit should do, matching the web `commitDraft` guards: a draft
 * equal to the current value (after trim) is a [NoOp]; an empty or validator-rejected draft is
 * [Invalid]; otherwise [Commit]. [validate] returns null when valid, else an error message.
 */
fun decideCommit(
    draft: String,
    current: String,
    validate: (String) -> String?,
): CommitOutcome {
    val next = draft.trim()
    return when {
        next == current.trim() -> CommitOutcome.NoOp
        next.isEmpty() -> CommitOutcome.Invalid
        validate(next) != null -> CommitOutcome.Invalid
        else -> CommitOutcome.Commit
    }
}

/** Masking strategy for [MaskedValue]; [defaultShowLast] is the visible-suffix length. */
enum class MaskVariant(
    val defaultShowLast: Int,
) {
    ApiKey(4),
    Token(4),
    Secret(0),
    Email(0),
    Generic(2),
}

private const val MASK_CHAR = "\u2022"

/** Masks [raw] per [variant], optionally overriding the visible-suffix length with [showLast]. */
fun maskValue(
    raw: String,
    variant: MaskVariant,
    showLast: Int? = null,
): String =
    when {
        raw.isEmpty() -> ""
        variant == MaskVariant.Email -> maskEmail(raw)
        else -> {
            val keep = (showLast ?: variant.defaultShowLast).coerceIn(0, raw.length)
            MASK_CHAR.repeat(raw.length - keep) + raw.takeLast(keep)
        }
    }

private fun maskEmail(raw: String): String {
    val at = raw.indexOf('@')
    if (at <= 0) return MASK_CHAR.repeat(raw.length)
    val local = raw.substring(0, at)
    val domain = raw.substring(at)
    return local.first() + MASK_CHAR.repeat((local.length - 1).coerceAtLeast(1)) + domain
}
