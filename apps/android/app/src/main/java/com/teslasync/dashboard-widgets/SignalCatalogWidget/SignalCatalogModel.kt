// Pure, framework-free model + projection for the Signal Catalog dashboard widget — the native analogue
// of everything the web component computes (the `observationCounts`, `filtered`, and `grouped` `useMemo`s
// plus the `isCompact` size branch) before it returns JSX
// (web/src/features/dashboard/widgets/SignalCatalogWidget.tsx). No Compose, no Android framework, no HTTP:
// every type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer. The catalog carries no unit-bearing display values this layer converts —
// signal names, the catalog's own `unit` symbol string and integer observation counts pass through as the
// backend serves them; any number grouping is a locale formatting concern applied here at the projection.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/SignalCatalogWidget — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling MotorHistory / LiveSignals widgets
// do. `MatchingDeclarationName` is suppressed for the co-located types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.signalcatalog

import io.teslasync.shared.core.presentation.telemetry.SignalCatalogEntry
import io.teslasync.shared.core.presentation.telemetry.SignalObservation
import java.text.NumberFormat
import java.util.Locale

/**
 * The widget's grid footprint (columns × rows). Mirrors the web `WidgetProps.size` plus the
 * `isCompact = size.cols <= 1` branch in the web source: a single column drops the title, the search box
 * and the grouped list and shows only the total signal count over a "signals available" caption.
 */
data class SignalCatalogSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `isCompact = size.cols <= 1`): the count-only layout. */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_COLS

    companion object {
        private const val COMPACT_MAX_COLS = 1

        /** Registry default footprint (2×4). */
        val Default: SignalCatalogSize = SignalCatalogSize(cols = 2, rows = 4)

        /** Registry minimum footprint (2×4). */
        val MinSize: SignalCatalogSize = SignalCatalogSize(cols = 2, rows = 4)

        /** Registry maximum footprint (4×40). */
        val MaxSize: SignalCatalogSize = SignalCatalogSize(cols = 4, rows = 40)

        /** True when [size] falls within the inclusive min/max footprint constraints. */
        fun withinBounds(size: SignalCatalogSize): Boolean =
            size.cols in MinSize.cols..MaxSize.cols && size.rows in MinSize.rows..MaxSize.rows

        /** Clamp [size] into the supported min/max footprint. */
        fun clamp(size: SignalCatalogSize): SignalCatalogSize =
            SignalCatalogSize(
                cols = size.cols.coerceIn(MinSize.cols, MaxSize.cols),
                rows = size.rows.coerceIn(MinSize.rows, MaxSize.rows),
            )
    }
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/telemetry.ts (`signal-catalog`). A dashboard grid host binds
 * this surface with the same [ID] and honours the same min/max footprint, so the native + web grids stay in
 * lockstep.
 */
object SignalCatalogRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "signal-catalog"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "telemetry"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "SignalCatalogWidget"

    /** Registry display name (registry metadata; the body title resolves from i18n). */
    const val NAME: String = "Signal Catalog"

    /** Registry description copy (registry metadata; not rendered in the widget body). */
    const val DESCRIPTION: String = "Browse all available telemetry signals with categories and observation counts"

    /** Default footprint: 2 columns × 4 rows. */
    val defaultSize: SignalCatalogSize get() = SignalCatalogSize.Default

    /** Minimum footprint: 2 columns × 4 rows. */
    val minSize: SignalCatalogSize get() = SignalCatalogSize.MinSize

    /** Maximum footprint: 4 columns × 40 rows. */
    val maxSize: SignalCatalogSize get() = SignalCatalogSize.MaxSize

    /** True when [size] falls within the supported footprint constraints. */
    fun withinBounds(size: SignalCatalogSize): Boolean = SignalCatalogSize.withinBounds(size)

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: SignalCatalogSize): SignalCatalogSize = SignalCatalogSize.clamp(size)
}

/**
 * The parsed payload backing the widget: the full [entries] catalog (web `catalog ?? []`) plus the
 * per-signal [observationCounts] derived from the active vehicle's observations (web `observationCounts`
 * memo). Kept un-grouped here so the search filter + category grouping + count formatting live in the pure
 * [SignalCatalogProjection], driven by the interactive search query at the render boundary.
 */
data class SignalCatalogSnapshot(
    val entries: List<SignalCatalogEntry>,
    val observationCounts: Map<String, Int>,
) {
    /** Total catalog size (web `entries.length`) — the figure the compact layout shows. */
    val signalCount: Int get() = entries.size

    /** True when the catalog carried no entries (web `entries.length === 0` ⇒ "No signals in catalog"). */
    val isEmpty: Boolean get() = entries.isEmpty()

    companion object {
        /** The empty payload (no catalog resolved) — drives the empty state. */
        val EMPTY: SignalCatalogSnapshot = SignalCatalogSnapshot(emptyList(), emptyMap())
    }
}

/**
 * One projected, render-ready catalog row — the native analogue of a web list item: the [name] (rendered
 * monospaced), the optional [unit] chip (web `sig.unit && <Badge>` — only when non-blank), the integer
 * [observationCount] and its locale-formatted [observationCountLabel] (web `fmtInt(... ?? 0)`).
 */
data class SignalCatalogRow(
    val name: String,
    val unit: String?,
    val observationCount: Int,
    val observationCountLabel: String,
)

/**
 * One category group of catalog rows — the native analogue of a web `grouped` entry: a [category] label
 * (the signal's `source_module`, or the localized "Uncategorized" fallback) over its ordered [rows].
 */
data class SignalCatalogGroup(
    val category: String,
    val rows: List<SignalCatalogRow>,
) {
    /** Row count shown beside the category header (web `({signals.length})`). */
    val size: Int get() = rows.size
}

/**
 * The fully projected, render-ready view of one catalog payload for one footprint + search query — the
 * native analogue of everything the web component computes via `useMemo` (`observationCounts`, `filtered`,
 * `grouped`) before returning JSX. Pure data so the projection is unit-tested without a Compose host.
 *
 * @property signalCount the total catalog size (the compact layout's figure).
 * @property signalCountLabel [signalCount] formatted with locale grouping (web `fmtInt`).
 * @property hasEntries whether the catalog had any entries (false ⇒ "No signals in catalog").
 * @property hasResults whether the search left any matches (false ⇒ "No matching signals").
 * @property groups the matching rows grouped by category, sorted alphabetically (web `grouped`).
 */
data class SignalCatalogDisplay(
    val isCompact: Boolean,
    val signalCount: Int,
    val signalCountLabel: String,
    val hasEntries: Boolean,
    val hasResults: Boolean,
    val groups: List<SignalCatalogGroup>,
)

/**
 * Pure projection from a parsed [SignalCatalogSnapshot] + search query to the display model — the native
 * port of the `observationCounts` / `filtered` / `grouped` `useMemo`s in the web source. The category
 * grouping is sorted case-insensitively (the web `localeCompare`), row order within a category is preserved
 * from the catalog (web push order), and every label is supplied already-localized.
 */
object SignalCatalogProjection {
    /**
     * Tally how many observations each signal has — the native port of the web `observationCounts` memo
     * (`counts.set(obs.signal_name, (counts.get(...) ?? 0) + 1)`). Insertion order is preserved so the map
     * is deterministic for tests.
     */
    fun buildObservationCounts(observations: List<SignalObservation>): Map<String, Int> {
        val counts = LinkedHashMap<String, Int>()
        for (obs in observations) {
            counts[obs.signalName] = (counts[obs.signalName] ?: 0) + 1
        }
        return counts
    }

    /**
     * Filter the catalog by the search [query] — the verbatim port of the web `filtered` memo: a blank
     * query returns every entry, otherwise an entry matches when its name, description or source module
     * contains the lower-cased query.
     */
    fun filterEntries(
        entries: List<SignalCatalogEntry>,
        query: String,
    ): List<SignalCatalogEntry> {
        val trimmed = query.trim()
        if (trimmed.isEmpty()) return entries
        val needle = trimmed.lowercase()
        return entries.filter { entry ->
            entry.name.lowercase().contains(needle) ||
                entry.description
                    .orEmpty()
                    .lowercase()
                    .contains(needle) ||
                entry.sourceModule.lowercase().contains(needle)
        }
    }

    /**
     * Group [entries] by category and sort the categories alphabetically — the native port of the web
     * `grouped` memo: each entry's `source_module` (or [uncategorizedLabel] when blank) keys a group, rows
     * preserve catalog order, and the categories are ordered case-insensitively (web `a.localeCompare(b)`).
     * Each row's observation count is read from [counts] (web `observationCounts.get(sig.name) ?? 0`).
     */
    fun group(
        entries: List<SignalCatalogEntry>,
        counts: Map<String, Int>,
        uncategorizedLabel: String,
        locale: Locale = Locale.getDefault(),
    ): List<SignalCatalogGroup> {
        val map = LinkedHashMap<String, MutableList<SignalCatalogRow>>()
        for (entry in entries) {
            val category = entry.sourceModule.ifBlank { uncategorizedLabel }
            val count = counts[entry.name] ?: 0
            val row =
                SignalCatalogRow(
                    name = entry.name,
                    unit = entry.unit?.takeIf { it.isNotBlank() },
                    observationCount = count,
                    observationCountLabel = formatCount(count, locale),
                )
            map.getOrPut(category) { mutableListOf() }.add(row)
        }
        return map.entries
            .map { SignalCatalogGroup(category = it.key, rows = it.value) }
            .sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.category })
    }

    /**
     * Project [snapshot] for [size] under the current search [query], using the localized
     * [uncategorizedLabel] for blank-module entries and [locale] for number grouping. Computes the total
     * count (the compact figure), the filtered/grouped rows and the has-entries / has-results gates the
     * composable switches on.
     */
    fun project(
        snapshot: SignalCatalogSnapshot,
        size: SignalCatalogSize,
        query: String,
        uncategorizedLabel: String,
        locale: Locale = Locale.getDefault(),
    ): SignalCatalogDisplay {
        val filtered = filterEntries(snapshot.entries, query)
        val groups = group(filtered, snapshot.observationCounts, uncategorizedLabel, locale)
        return SignalCatalogDisplay(
            isCompact = size.isCompact,
            signalCount = snapshot.signalCount,
            signalCountLabel = formatCount(snapshot.signalCount, locale),
            hasEntries = snapshot.entries.isNotEmpty(),
            hasResults = filtered.isNotEmpty(),
            groups = groups,
        )
    }
}

/** Locale-grouped integer formatting for the counts — the native analogue of the web `fmtInt`. */
private fun formatCount(
    count: Int,
    locale: Locale,
): String = NumberFormat.getIntegerInstance(locale).format(count.toLong())
