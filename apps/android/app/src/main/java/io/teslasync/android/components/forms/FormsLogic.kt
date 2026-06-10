package io.teslasync.android.components.forms

import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.UiDensity
import java.util.Locale
import kotlin.math.abs

/*
 * Framework-free logic backing the forms layer (combobox filtering, multi-select toggling, tag
 * parsing, active-filter chip overflow, date-preset ranges, numeric/currency parsing + formatting,
 * range normalization, vehicle-selection hydration/payload, tree-select expansion/selection,
 * search debounce/history, sort + density toggles, export formats). Extracted so the behavior is
 * covered by fast JVM unit tests in the `:android:testDebugUnitTest` gate. Mirrors the other
 * layers' `*Logic.kt` split.
 */

// ── Combobox ──────────────────────────────────────────────────────────────────

/** One combobox/select option: a stable [value], a display [label], and an [enabled] flag. */
data class ComboOption(
    val value: String,
    val label: String,
    val enabled: Boolean = true,
)

/** Case-insensitive label filter; a blank [query] returns all options unchanged. */
fun filterComboOptions(
    options: List<ComboOption>,
    query: String,
): List<ComboOption> {
    val q = query.trim()
    return if (q.isEmpty()) options else options.filter { it.label.contains(q, ignoreCase = true) }
}

/** Display label for a selected [value], or null when no option matches. */
fun comboLabelFor(
    options: List<ComboOption>,
    value: String?,
): String? = options.firstOrNull { it.value == value }?.label

// ── Multi-select toggling ──────────────────────────────────────────────────────

/** Adds [value] if absent, removes it if present (set membership toggle). */
fun toggleSelection(
    selected: Set<String>,
    value: String,
): Set<String> = if (value in selected) selected - value else selected + value

// ── Tag input ───────────────────────────────────────────────────────────────

/** Default separators that commit a tag (comma + newline). */
val DEFAULT_TAG_SEPARATORS = setOf(',', '\n')

/** Splits [raw] on [separators], trimming each token and dropping blanks. */
fun parseTags(
    raw: String,
    separators: Set<Char> = DEFAULT_TAG_SEPARATORS,
): List<String> {
    var normalized = raw
    separators.forEach { separator -> normalized = normalized.replace(separator, TAG_DELIMITER) }
    return normalized
        .split(TAG_DELIMITER)
        .map { it.trim() }
        .filter { it.isNotEmpty() }
}

/** Appends parsed tags from [raw] to [existing], skipping duplicates unless [allowDuplicates]. */
fun addTags(
    existing: List<String>,
    raw: String,
    separators: Set<Char> = DEFAULT_TAG_SEPARATORS,
    allowDuplicates: Boolean = false,
): List<String> {
    val out = existing.toMutableList()
    parseTags(raw, separators).forEach { tag ->
        if (allowDuplicates || tag !in out) out.add(tag)
    }
    return out
}

/** Removes the tag at [index] (no-op when out of bounds). */
fun removeTagAt(
    tags: List<String>,
    index: Int,
): List<String> = if (index in tags.indices) tags.filterIndexed { i, _ -> i != index } else tags

/** Removes the last tag — backs the Backspace-on-empty-input affordance. */
fun removeLastTag(tags: List<String>): List<String> = if (tags.isEmpty()) tags else tags.dropLast(1)

// ── Active-filter chip overflow ───────────────────────────────────────────────

/** How many chips render inline vs collapse into a "+N more" bucket. */
data class ChipSplit(
    val visible: Int,
    val overflow: Int,
)

/**
 * Splits [total] chips against [maxVisible], reserving one visible slot for the "+N more" trigger
 * when an overflow bucket is needed (mirrors web `ActiveFilterChips`).
 */
fun chipSplit(
    total: Int,
    maxVisible: Int,
): ChipSplit =
    when {
        maxVisible <= 0 -> ChipSplit(0, total)
        total <= maxVisible -> ChipSplit(total, 0)
        else -> ChipSplit(maxVisible - 1, total - (maxVisible - 1))
    }

// ── Date presets ──────────────────────────────────────────────────────────────

/** Inclusive day-range expressed in epoch-days (timezone-free, deterministic for tests). */
data class DateRange(
    val startEpochDay: Long,
    val endEpochDay: Long,
)

/** Quick date-range presets (rolling windows ending today). */
enum class DatePreset { Today, Last7Days, Last30Days, Last90Days, LastYear }

/** Resolves a [preset] to an inclusive [DateRange] relative to [todayEpochDay]. */
fun resolveDatePreset(
    preset: DatePreset,
    todayEpochDay: Long,
): DateRange =
    when (preset) {
        DatePreset.Today -> DateRange(todayEpochDay, todayEpochDay)
        DatePreset.Last7Days -> DateRange(todayEpochDay - DAYS_WEEK, todayEpochDay)
        DatePreset.Last30Days -> DateRange(todayEpochDay - DAYS_MONTH, todayEpochDay)
        DatePreset.Last90Days -> DateRange(todayEpochDay - DAYS_QUARTER, todayEpochDay)
        DatePreset.LastYear -> DateRange(todayEpochDay - DAYS_YEAR, todayEpochDay)
    }

/** Human-readable label for a [DatePreset]. */
fun datePresetLabel(preset: DatePreset): String =
    when (preset) {
        DatePreset.Today -> "Today"
        DatePreset.Last7Days -> "Last 7 days"
        DatePreset.Last30Days -> "Last 30 days"
        DatePreset.Last90Days -> "Last 90 days"
        DatePreset.LastYear -> "Last year"
    }

// ── Range picker / numeric range ──────────────────────────────────────────────

/** A min/max numeric range; either bound may be open (null). */
data class NumericRange(
    val min: Double?,
    val max: Double?,
)

/** Swaps the bounds when both are present and inverted, so `min <= max` always holds. */
fun normalizeNumericRange(
    min: Double?,
    max: Double?,
): NumericRange = if (min != null && max != null && min > max) NumericRange(max, min) else NumericRange(min, max)

/** Whether a range is valid (an open bound is always valid). */
fun isNumericRangeValid(
    min: Double?,
    max: Double?,
): Boolean = min == null || max == null || min <= max

// ── Numeric + currency parsing / formatting (UnitInput / CurrencyInput) ───────

/**
 * Parses free text into a number, tolerating unit symbols, currency signs, and grouping commas
 * ("60 mph", "$1.50", "1,234.56", "20°F"). Returns null when no number can be read.
 */
fun parseNumeric(text: String): Double? {
    val withoutGroups = text.trim().replace(",", "")
    val filtered = withoutGroups.filter { it.isDigit() || it == '.' || it == '-' }
    return runCatching { java.lang.Double.valueOf(filtered) }.getOrNull()
}

/** Parses currency text, treating accounting parentheses as negative ("($1.50)" → -1.5). */
fun parseCurrency(text: String): Double? {
    val negative = text.contains('(') && text.contains(')')
    val magnitude = parseNumeric(text.replace("(", "").replace(")", ""))
    return magnitude?.let { if (negative) -abs(it) else it }
}

/** Formats [value] with a fixed number of [decimals]; null → empty string. */
fun formatNumeric(
    value: Double?,
    decimals: Int = 2,
): String = value?.let { String.format(Locale.US, "%.${decimals.coerceAtLeast(0)}f", it) } ?: ""

// ── Vehicle multi-select ──────────────────────────────────────────────────────

/** A vehicle filter selection; [allSelected] is true when every available vehicle is chosen. */
data class VehicleSelection(
    val ids: Set<Long>,
    val allSelected: Boolean,
)

/**
 * Hydrates a [VehicleSelection] from a persisted list. A null [selectedIds] means "all vehicles";
 * otherwise the stored ids are intersected with [allIds] to drop stale entries.
 */
fun hydrateVehicleSelection(
    allIds: List<Long>,
    selectedIds: List<Long>?,
): VehicleSelection =
    if (selectedIds == null) {
        VehicleSelection(allIds.toSet(), allIds.isNotEmpty())
    } else {
        val ids = selectedIds.toSet().intersect(allIds.toSet())
        VehicleSelection(ids, ids.isNotEmpty() && ids.size == allIds.size)
    }

/**
 * Builds the persisted payload from a [selection]: null when everything is selected (the compact
 * "all" sentinel), otherwise the explicit id list.
 */
fun buildVehiclePayload(
    selection: VehicleSelection,
    allIds: List<Long>,
): List<Long>? =
    if (selection.allSelected || (allIds.isNotEmpty() && selection.ids.size == allIds.size)) {
        null
    } else {
        selection.ids.toList()
    }

/** Toggles one vehicle [id] in/out of the [selection], recomputing the all-selected flag. */
fun toggleVehicle(
    selection: VehicleSelection,
    id: Long,
    allIds: List<Long>,
): VehicleSelection {
    val ids = if (id in selection.ids) selection.ids - id else selection.ids + id
    return VehicleSelection(ids, ids.isNotEmpty() && ids.size == allIds.size)
}

// ── Tree select ───────────────────────────────────────────────────────────────

/** A selectable leaf in a [TreeGroup]. */
data class TreeLeaf(
    val value: String,
    val label: String,
)

/** A collapsible group of [leaves]. */
data class TreeGroup(
    val id: String,
    val label: String,
    val leaves: List<TreeLeaf>,
)

/** Toggles a group's expanded state. */
fun toggleExpanded(
    expanded: Set<String>,
    groupId: String,
): Set<String> = if (groupId in expanded) expanded - groupId else expanded + groupId

/** The leaf values belonging to [group]. */
fun groupLeafValues(group: TreeGroup): Set<String> = group.leaves.map { it.value }.toSet()

/** Whether every leaf of [group] is selected. */
fun isGroupFullySelected(
    group: TreeGroup,
    selected: Set<String>,
): Boolean = group.leaves.isNotEmpty() && group.leaves.all { it.value in selected }

/** Whether some but not all of [group]'s leaves are selected (tri-state checkbox). */
fun isGroupPartiallySelected(
    group: TreeGroup,
    selected: Set<String>,
): Boolean = group.leaves.any { it.value in selected } && !isGroupFullySelected(group, selected)

/** Selecting a fully-selected group clears it; otherwise selects all its leaves. */
fun toggleGroupSelection(
    selected: Set<String>,
    group: TreeGroup,
): Set<String> =
    if (isGroupFullySelected(group, selected)) {
        selected - groupLeafValues(group)
    } else {
        selected + groupLeafValues(group)
    }

// ── Search input (debounce + history) ─────────────────────────────────────────

/** Minimum trimmed length before a query is recorded in history (mirrors web `MIN_QUERY_LEN`). */
const val MIN_QUERY_LEN = 2

/** Whether the debounced local text differs from the committed value and should be emitted. */
fun shouldEmitSearch(
    local: String,
    committed: String,
): Boolean = local != committed

/** Whether [query] is long enough (after trimming) to record in search history. */
fun meetsMinQuery(query: String): Boolean = query.trim().length >= MIN_QUERY_LEN

/** Whether the recent-searches dropdown should be visible. */
fun searchHistoryVisible(
    hasScope: Boolean,
    focused: Boolean,
    query: String,
    entryCount: Int,
): Boolean = hasScope && focused && query.isEmpty() && entryCount > 0

/** Clamps a listbox active index into `[-1, size)` (-1 = no active option). */
fun clampActiveIndex(
    index: Int,
    size: Int,
): Int = if (size <= 0) -1 else index.coerceIn(-1, size - 1)

/** Moves the active index down (ArrowDown), clamped to the last option. */
fun nextActiveIndex(
    index: Int,
    size: Int,
): Int = clampActiveIndex(index + 1, size)

/** Moves the active index up (ArrowUp), clamped to -1. */
fun prevActiveIndex(
    index: Int,
    size: Int,
): Int = clampActiveIndex(index - 1, size)

// ── Sort + density toggles ─────────────────────────────────────────────────────

/** Flips a [SortDirection] (asc ⇄ desc) for the direction toggle. */
fun flipSortDirection(direction: SortDirection): SortDirection =
    if (direction == SortDirection.Asc) SortDirection.Desc else SortDirection.Asc

/** Cycles density Compact → Comfortable → Spacious → Compact. */
fun nextDensity(current: UiDensity): UiDensity =
    when (current) {
        UiDensity.Compact -> UiDensity.Comfortable
        UiDensity.Comfortable -> UiDensity.Spacious
        UiDensity.Spacious -> UiDensity.Compact
    }

/** Human-readable label for a [UiDensity]. */
fun densityLabel(density: UiDensity): String =
    when (density) {
        UiDensity.Compact -> "Compact"
        UiDensity.Comfortable -> "Comfortable"
        UiDensity.Spacious -> "Spacious"
    }

// ── List export ────────────────────────────────────────────────────────────────

/** File formats offered by [io.teslasync.android.components.forms.ListExportMenu]. */
enum class ExportFormat { Csv, Json, Xlsx, Pdf }

/** Human-readable label for an [ExportFormat]. */
fun exportFormatLabel(format: ExportFormat): String =
    when (format) {
        ExportFormat.Csv -> "CSV"
        ExportFormat.Json -> "JSON"
        ExportFormat.Xlsx -> "Excel"
        ExportFormat.Pdf -> "PDF"
    }

/** File extension (without dot) for an [ExportFormat]. */
fun exportFileExtension(format: ExportFormat): String =
    when (format) {
        ExportFormat.Csv -> "csv"
        ExportFormat.Json -> "json"
        ExportFormat.Xlsx -> "xlsx"
        ExportFormat.Pdf -> "pdf"
    }

private const val DAYS_WEEK = 6L
private const val DAYS_MONTH = 29L
private const val DAYS_QUARTER = 89L
private const val DAYS_YEAR = 364L
private const val TAG_DELIMITER = '\u0000'
