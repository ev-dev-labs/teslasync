// Pure, framework-free model + projection for the SignalCategoryTree feature view — the native analogue of
// everything the web component derives before it hands groups to `TreeSelect`
// (web/src/features/telemetry/components/SignalCategoryTree.tsx + its SignalSparklinePreview child). No
// Compose, no Android framework, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer. Values stay SI exactly as
// the backend serves them (Phase-42); any display formatting is the render boundary's job.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/SignalCategoryTree — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling LiveSignalsTable surface does.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.signalcategorytree

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.signals.SignalDescriptor
import io.teslasync.shared.core.presentation.signals.SignalHistoryResponse
import io.teslasync.shared.core.presentation.signals.SignalKind
import io.teslasync.shared.core.presentation.signals.SignalValue

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, signal name, or
 * value, so a diagnostics line can never leak the vehicle's catalog.
 */
const val SIGNAL_CATEGORY_TREE_SLUG: String = "SignalCategoryTree"

/** Em dash shown for a leaf with too few samples to draw a sparkline (web `'—'`). */
internal const val EM_DASH: String = "\u2014"

/** The trailing window (hours) each leaf's sparkline pulls — web `SPARKLINE_HOURS`. */
const val SPARKLINE_HOURS: Int = 1

/** The max sample count each leaf's sparkline pulls — web `SPARKLINE_LIMIT`. */
const val SPARKLINE_LIMIT: Int = 30

/** Minimum finite samples before a sparkline line is drawn — web `numericSeries.length < 2`. */
const val MIN_SPARKLINE_POINTS: Int = 2

/**
 * Stable category display order — the verbatim port of the web `CATEGORY_ORDER`. Unknown categories sort
 * last (rank == size) and are then tie-broken by their raw id, which matches the web's label tie-break
 * because an unknown category's friendly label is its raw id.
 */
val CATEGORY_ORDER: List<String> =
    listOf(
        "charging",
        "driving",
        "powertrain",
        "climate",
        "location",
        "vehicle_state",
        "safety_security",
        "media",
        "config",
        "prefs",
        "setting_unit",
        "metadata",
    )

/**
 * Friendly labels for the categories that have no matching key in the generated i18n catalog (P1/S10) —
 * the faithful web-port subset of `CATEGORY_LABELS`. The other categories (charging, driving, climate,
 * location, powertrain, media, config, prefs) resolve through real catalog keys at the render boundary and
 * arrive via [SignalCategoryTreeStrings.categoryLabels]; truly-unknown ids fall through to the raw id
 * (web `CATEGORY_LABELS[id] ?? id`).
 */
val FALLBACK_CATEGORY_LABELS: Map<String, String> =
    mapOf(
        "vehicle_state" to "Vehicle State",
        "safety_security" to "Safety & Security",
        "setting_unit" to "Setting Units",
        "metadata" to "Metadata",
    )

/** The display order rank of a category id (web `categoryRank`); unknown ids sort last. */
fun categoryRank(id: String): Int {
    val idx = CATEGORY_ORDER.indexOf(id)
    return if (idx == -1) CATEGORY_ORDER.size else idx
}

/**
 * One selectable signal leaf — the native mirror of a web `TreeLeaf` whose `data` is the descriptor. Only
 * the fields the surface renders are carried: the [name] (the selectable id + monospace label) and the
 * [valueKind] (decides whether the lazy sparkline draws a line or a non-numeric kind chip).
 */
data class SignalLeaf(
    val name: String,
    val valueKind: SignalKind,
)

/**
 * One category group of signal leaves — the native mirror of a web `TreeGroup`. [categoryId] is the raw
 * backend category token (used for ordering, expansion keys and label resolution); [leaves] are sorted by
 * name within the group.
 */
data class SignalCategoryGroup(
    val categoryId: String,
    val leaves: List<SignalLeaf>,
) {
    /** Leaf count shown beside the category header. */
    val size: Int get() = leaves.size
}

/**
 * The fully projected, render-ready catalog — the ordered category [groups] the tree draws. Pure data so
 * the projection is unit-tested without a Compose host.
 */
data class SignalCatalog(
    val groups: List<SignalCategoryGroup>,
) {
    /** True when no signals are available (web `signals.length === 0` ⇒ the empty state). */
    val isEmpty: Boolean get() = groups.isEmpty()

    /** Total leaf count across every group. */
    val totalSignals: Int get() = groups.sumOf { it.size }

    companion object {
        /** The no-signal projection (drives the empty state). */
        val EMPTY: SignalCatalog = SignalCatalog(emptyList())
    }
}

/**
 * The already-localized strings the surface renders. The web `TreeSelect` reads its chrome (search
 * prompt, empty/error copy, aria label) as literals; on Android they arrive through the P1/S10 i18n
 * facade (`stringResource`) at the Compose boundary and are passed in, keeping the projection locale-stable
 * and free of any English literal. [categoryLabels] maps the catalog-keyed category ids to their localized
 * label (the remaining ids fall back to [FALLBACK_CATEGORY_LABELS] then the raw id, exactly as the web map
 * falls back).
 */
data class SignalCategoryTreeStrings(
    val searchHint: String,
    val searchClear: String,
    val catalogLabel: String,
    val emptyMessage: String,
    val noResults: String,
    val loadingLabel: String,
    val categoryLabels: Map<String, String>,
)

/**
 * Pure projection from the available-signal catalog to the render-ready [SignalCatalog] plus the search /
 * selection / expansion / sparkline helpers — the native port of everything `SignalCategoryTree.tsx`
 * computes (the `groups` memo, the `expandedSet` + `isSearching` gating) and the `SignalSparklinePreview`
 * numeric extraction. Side-effect-free so the gate unit-tests every branch off-device.
 */
object SignalCategoryTreeProjection {
    /**
     * Group [signals] by category, sort leaves by name within each group, and order the groups by
     * [categoryRank] then raw id — the verbatim port of the web `groups` memo. An empty input yields
     * [SignalCatalog.EMPTY].
     */
    fun buildCatalog(signals: List<SignalDescriptor>): SignalCatalog {
        if (signals.isEmpty()) return SignalCatalog.EMPTY
        val byCategory = LinkedHashMap<String, MutableList<SignalDescriptor>>()
        for (signal in signals) {
            byCategory.getOrPut(signal.category) { mutableListOf() }.add(signal)
        }
        val groups =
            byCategory
                .map { (category, list) ->
                    SignalCategoryGroup(
                        categoryId = category,
                        leaves =
                            list
                                .sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.name })
                                .map { SignalLeaf(name = it.name, valueKind = it.valueKind) },
                    )
                }.sortedWith(compareBy({ categoryRank(it.categoryId) }, { it.categoryId }))
        return SignalCatalog(groups)
    }

    /**
     * Filter [groups] by the search [query] — leaves whose name contains the lower-cased query survive, and
     * a group with no surviving leaves is dropped. A blank query returns every group unchanged. Mirrors the
     * web `TreeSelect` internal search (which also auto-expands the matching groups; the render layer treats
     * a non-blank query as "all expanded" for the sparkline gate).
     */
    fun filterGroups(
        groups: List<SignalCategoryGroup>,
        query: String,
    ): List<SignalCategoryGroup> {
        val needle = query.trim().lowercase()
        if (needle.isEmpty()) return groups
        return groups.mapNotNull { group ->
            val leaves = group.leaves.filter { it.name.lowercase().contains(needle) }
            if (leaves.isEmpty()) null else group.copy(leaves = leaves)
        }
    }

    /** The raw category id resolved to its friendly label — web `friendlyCategoryLabel`. */
    fun friendlyCategoryLabel(
        categoryId: String,
        keyedLabels: Map<String, String>,
    ): String = keyedLabels[categoryId] ?: FALLBACK_CATEGORY_LABELS[categoryId] ?: categoryId

    /** The leaf names belonging to [group]. */
    fun groupLeafNames(group: SignalCategoryGroup): Set<String> = group.leaves.map { it.name }.toSet()

    /** Whether every leaf of [group] is selected (the tri-state checkbox's "on"). */
    fun isGroupFullySelected(
        group: SignalCategoryGroup,
        selected: Set<String>,
    ): Boolean = group.leaves.isNotEmpty() && group.leaves.all { it.name in selected }

    /** Whether some but not all of [group]'s leaves are selected (the tri-state checkbox's "mixed"). */
    fun isGroupPartiallySelected(
        group: SignalCategoryGroup,
        selected: Set<String>,
    ): Boolean = group.leaves.any { it.name in selected } && !isGroupFullySelected(group, selected)

    /** Selecting a fully-selected group clears its leaves; otherwise selects them all (web group toggle). */
    fun toggleGroupSelection(
        selected: Set<String>,
        group: SignalCategoryGroup,
    ): Set<String> =
        if (isGroupFullySelected(group, selected)) {
            selected - groupLeafNames(group)
        } else {
            selected + groupLeafNames(group)
        }

    /** Adds [name] if absent, removes it if present (leaf set-membership toggle). */
    fun toggleSignal(
        selected: Set<String>,
        name: String,
    ): Set<String> = if (name in selected) selected - name else selected + name

    /** Toggles a group's expanded state. */
    fun toggleExpanded(
        expanded: Set<String>,
        categoryId: String,
    ): Set<String> = if (categoryId in expanded) expanded - categoryId else expanded + categoryId

    /**
     * Whether [kind] draws a sparkline line — the native port of the web `!NON_NUMERIC.has(valueKind)`
     * (NON_NUMERIC = string / time / unknown). Bool collapses to 1/0 so it counts as numeric, mirroring the
     * web `envelopesToNumbers`.
     */
    fun isNumericKind(kind: SignalKind): Boolean =
        when (kind) {
            SignalKind.Bool, SignalKind.Int, SignalKind.Float -> true
            SignalKind.String, SignalKind.Time, SignalKind.Unknown -> false
        }

    /** The compact, lowercase kind token shown in a non-numeric leaf's chip — web `{valueKind}`. */
    fun kindToken(kind: SignalKind): String = kind.name.lowercase()

    /**
     * The finite numeric series for a leaf's sparkline — the native port of the web `envelopesToNumbers`:
     * a numeric value passes through (when finite), a boolean collapses to 1.0/0.0, and anything else is
     * dropped. A `null` history yields an empty series (nothing fetched yet).
     */
    fun historyToPoints(history: SignalHistoryResponse?): List<Double> {
        val data = history?.data ?: return emptyList()
        val out = ArrayList<Double>(data.size)
        for (envelope in data) {
            when (val value = envelope.value) {
                is SignalValue.Num -> if (value.value.isFinite()) out.add(value.value)
                is SignalValue.Bool -> out.add(if (value.value) 1.0 else 0.0)
                else -> Unit
            }
        }
        return out
    }

    /** Whether [points] has enough finite samples to draw a sparkline line (web `>= 2`). */
    fun hasSparkline(points: List<Double>): Boolean = points.size >= MIN_SPARKLINE_POINTS
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [SIGNAL_CATEGORY_TREE_SLUG] (P1/S11).
 * Kept free of Compose so it is unit-tested with a recording [Logger]; the view-model calls it from the
 * composable's first-composition effect.
 */
fun recordSignalCategoryTreeOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to SIGNAL_CATEGORY_TREE_SLUG))
}
