// Pure, framework-free model + ranking projection + diagnostics for the WidgetRankedList widget primitive — the
// native analogue of every decision the web component makes
// (web/src/features/dashboard/widgets/shared/WidgetRankedList.tsx) before Compose paints anything. The ranking
// math (sort, slice, bar percentages) runs off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE behaviour this surface reproduces): a presentational
// "ranked list" shared by many dashboard widgets. It takes a list of `items` ({ id, label, value, formattedValue,
// badge?, barColor? }) and a few display flags (`maxItems`, `compact`, `showBars`, `emptyMessage`, `emptyIcon`).
// It sorts the items by `value` descending, slices to `maxItems ?? (compact ? 3 : 5)`, and — when the slice is
// empty — renders the shared `EmptyState` with the caller's icon + message (default literal "No data available").
// Otherwise it draws one row per visible item: an optional background bar whose width is `value / maxValue`
// (hidden when `compact || !showBars`), the 1-based rank, the truncating label, an optional status badge, and the
// pre-formatted value. It fetches nothing and owns no text of its own beyond that one empty-state default.
//
// Why the generic data-surface states (loading / error / stale / offline) are intentionally absent: this
// primitive performs no query — it is a presentational list whose data is handed to it fully resolved by the
// owning widget. There is nothing here to be loading, to error, to go stale, or to go offline; the emptiness of
// the resolved slice IS the one data-driven branch the web source has, and it is reproduced exactly. Inventing
// the async states would model a dependency the web spec does not have (honesty covenant: no scope narrowing, no
// silent drift). The surface's REAL, fully-reproduced states are therefore: the empty state, and the populated
// permutations (compact/wide × bars-on/off × with/without badges × the value→bar-width scaling). Each is reduced
// here by [widgetRankedListProjection] and asserted off-device, doubling as the per-state snapshot. The owning
// widget that DOES fetch renders its own loading/error/stale/offline states and drops its resolved items in.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/widget-primitives — the P3 prompt's allowed-files path) cannot form a valid Kotlin package (a
// hyphen is illegal in a package identifier), so the package intentionally diverges from the path — exactly as
// the sibling WidgetChartSummary surface does. `MatchingDeclarationName` is suppressed for the co-located
// supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.widgetprimitives.widgetrankedlist

import androidx.compose.ui.graphics.Color
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.shared.core.diagnostics.Logger
import kotlin.math.max

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no item labels, values, or
 * badge text — only this constant identifier — so a diagnostics line can never leak what was ranked.
 */
const val WIDGET_RANKED_LIST_SLUG: String = "WidgetRankedList"

/** Default number of rows shown in non-compact mode (web `maxItems ?? (compact ? 3 : 5)` → the `5`). */
const val RANKED_LIST_DEFAULT_LIMIT: Int = 5

/** Default number of rows shown in compact mode (web `maxItems ?? (compact ? 3 : 5)` → the `3`). */
const val RANKED_LIST_COMPACT_LIMIT: Int = 3

/**
 * Canonical registry metadata for the WidgetRankedList surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`WidgetRankedList`).
 */
object WidgetRankedListRegistration {
    /** Stable surface id (kebab-case), also the test tag the composable stamps on its root. */
    const val ID: String = "widget-ranked-list"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = WIDGET_RANKED_LIST_SLUG
}

/**
 * The semantic status of a ranked item's optional badge — the native mirror of the web
 * `badge.variant: 'success' | 'warning' | 'error' | 'neutral'` union. Mapped to the shared component library's
 * [BadgeVariant] by [toBadgeVariant], reproducing the web `badgeVariantMap` (note `error` → `Danger`).
 */
enum class RankedBadgeVariant { Success, Warning, Error, Neutral }

/**
 * Map a [RankedBadgeVariant] to the shared [BadgeVariant] — the faithful native reproduction of the web
 * `badgeVariantMap` ({ success: 'success', warning: 'warning', error: 'danger', neutral: 'neutral' }). `Error`
 * maps to [BadgeVariant.Danger] because the shared badge names its error tone `Danger`.
 */
fun RankedBadgeVariant.toBadgeVariant(): BadgeVariant =
    when (this) {
        RankedBadgeVariant.Success -> BadgeVariant.Success
        RankedBadgeVariant.Warning -> BadgeVariant.Warning
        RankedBadgeVariant.Error -> BadgeVariant.Danger
        RankedBadgeVariant.Neutral -> BadgeVariant.Neutral
    }

/**
 * The optional trailing status chip on a ranked item — the native mirror of the web `badge` object
 * ({ text, variant }).
 *
 * @param text the chip copy (web `badge.text`); already localized by the caller.
 * @param variant the semantic tone (web `badge.variant`), mapped to the shared badge via [toBadgeVariant].
 */
data class RankedBadge(
    val text: String,
    val variant: RankedBadgeVariant,
)

/**
 * One ranked entry — the native mirror of the web `RankedItem`
 * ({ id, label, value, formattedValue, badge?, barColor? }). The web `value` drives the ranking + bar width; the
 * web `formattedValue` is the already-formatted display string (unit conversion + locale formatting happen at the
 * caller's display boundary, per the SI cutover rules), so this frame never formats a number itself.
 *
 * @param id stable identity for the entry (web `id`; React key) — kept so a caller migrating from web preserves
 *   its row identity. The web union `string | number` is reproduced by stringifying at the call site.
 * @param label the truncating primary text for the row (web `label`).
 * @param value the numeric magnitude that orders the list and scales the bar (web `value`).
 * @param formattedValue the pre-formatted trailing value text (web `formattedValue`).
 * @param badge the optional status chip shown before the value (web `badge`).
 * @param barColor the optional per-item background-bar color override (web `barColor`); a null falls back to the
 *   shared speed accent at the display boundary, mirroring the web `bg-blue-400` default.
 */
data class RankedItem(
    val id: String,
    val label: String,
    val value: Double,
    val formattedValue: String,
    val badge: RankedBadge? = null,
    val barColor: Color? = null,
)

/**
 * Resolve the number of rows to show — the native mirror of the web `maxItems ?? (compact ? 3 : 5)`. An explicit
 * [maxItems] always wins (including `0`, which the web `slice(0, 0)` honours as "show nothing"); otherwise the
 * compact/non-compact defaults apply.
 */
fun rankedListLimit(
    maxItems: Int?,
    compact: Boolean,
): Int = maxItems ?: if (compact) RANKED_LIST_COMPACT_LIMIT else RANKED_LIST_DEFAULT_LIMIT

/**
 * Whether the background bars are suppressed — the native mirror of the web `hideBars = compact || !showBars`.
 * Compact rows never draw a bar; non-compact rows draw one only when [showBars].
 */
fun rankedListBarsHidden(
    compact: Boolean,
    showBars: Boolean,
): Boolean = compact || !showBars

/**
 * One projected, ready-to-render row — the reduced result of the web row map. Pure data so the composable stays a
 * thin render layer over it and every row is asserted off-device (doubling as the per-row snapshot).
 *
 * @param item the source entry whose label / badge / value / color the row paints.
 * @param rank the 1-based display position (web `index + 1`).
 * @param barFraction the background-bar width as a `0f..1f` fraction (web `barPct / 100` = `value / maxValue`),
 *   clamped so a malformed negative value can never produce a negative-width bar. Always computed (the web
 *   computes `barPct` for every row); whether it is actually drawn is the projection-level [barsVisible].
 * @param contentDescription the merged screen-reader label for the whole row ("rank. label, value[, badge]").
 */
data class RankedRow(
    val item: RankedItem,
    val rank: Int,
    val barFraction: Float,
    val contentDescription: String,
)

/**
 * The fully-reduced render plan for the surface — the visible [rows] (already sorted, sliced, and rank-stamped)
 * plus whether their background [barsVisible]. Pure data so the composable renders straight from it.
 *
 * @param rows the visible rows in rank order; empty drives the shared EmptyState (web `visible.length === 0`).
 * @param barsVisible the web `!hideBars` guard — the rows draw their background bar only when this is true.
 */
data class WidgetRankedListProjection(
    val rows: List<RankedRow>,
    val barsVisible: Boolean,
) {
    /** True when there are no visible rows — the web `visible.length === 0` branch that shows the EmptyState. */
    val isEmpty: Boolean
        get() = rows.isEmpty()
}

/**
 * The merged screen-reader label for a single row — "`rank`. `label`, `formattedValue`", with the badge text
 * appended when present. Built from already-localized values + punctuation only (no English copy), so a row reads
 * as one coherent TalkBack announcement instead of four disjoint nodes.
 */
fun rankedRowDescription(
    rank: Int,
    item: RankedItem,
): String {
    val base = "$rank. ${item.label}, ${item.formattedValue}"
    return item.badge?.let { "$base, ${it.text}" } ?: base
}

/**
 * Reduce the web inputs into the [WidgetRankedListProjection] the surface renders — pure, exhaustively covered,
 * and unit-tested off-device. Mirrors the web exactly: sort the [items] by [RankedItem.value] descending (a
 * stable sort, matching `[...items].sort((a, b) => b.value - a.value)`), take the first [rankedListLimit]
 * (clamped at zero so a negative override yields an empty slice like the web `slice(0, n<0)`), then for each
 * visible row compute the bar fraction as `value / maxValue` where `maxValue = reduce(max, 0)` (so an all-zero or
 * all-negative slice yields zero-width bars, exactly as the web `maxValue > 0 ? ... : 0`). The fraction is
 * clamped to `0f..1f` so a stray negative value can never draw a negative-width bar.
 */
fun widgetRankedListProjection(
    items: List<RankedItem>,
    maxItems: Int?,
    compact: Boolean,
    showBars: Boolean,
): WidgetRankedListProjection {
    val limit = rankedListLimit(maxItems, compact).coerceAtLeast(0)
    val visible = items.sortedByDescending { it.value }.take(limit)
    val maxValue = visible.fold(0.0) { acc, item -> max(acc, item.value) }
    val rows =
        visible.mapIndexed { index, item ->
            val fraction = if (maxValue > 0.0) (item.value / maxValue).toFloat().coerceIn(0f, 1f) else 0f
            RankedRow(
                item = item,
                rank = index + 1,
                barFraction = fraction,
                contentDescription = rankedRowDescription(index + 1, item),
            )
        }
    return WidgetRankedListProjection(rows = rows, barsVisible = !rankedListBarsHidden(compact, showBars))
}

/**
 * The PII-safe diagnostic this surface emits (P1/S11). The `view.opened` event carries only the constant surface
 * [SLUG] — no item labels, no values, no badge text — so observability can never leak what was ranked. Kept free
 * of Compose so it is unit-tested with a recording [Logger].
 */
object WidgetRankedListDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = WIDGET_RANKED_LIST_SLUG

    /** The one-shot event emitted once when the surface opens. */
    const val EVENT_VIEW_OPENED: String = "view.opened"

    /** The structured-field key carrying the surface slug on the diagnostic. */
    const val FIELD_SURFACE: String = "surface"

    /**
     * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [SLUG]. Call from the
     * composable's first-composition effect.
     */
    fun recordViewOpened(logger: Logger) {
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to SLUG))
    }
}
