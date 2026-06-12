// Pure, framework-free model + projection for the WidgetPicker feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/dashboard/components/WidgetPicker.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer (the same split the sibling AddWidgetButton surface documents).
//
// WidgetPicker is the dashboard's widget-catalogue drawer. The web component takes `open`, `onClose`,
// `onAddWidgets`, `onApplyPreset`, and `activeWidgetIds` as props from the Dashboard page, and renders a
// searchable, category-filtered catalogue over the static widget registry plus a set of layout presets. Its
// only data source is `useTranslation` (mapped natively to the generated i18n catalog, P1/S10) — there is no
// query, fetch, or remote state, so — exactly as the sibling presentational ports document — the
// loading / error / stale / offline states do not exist on this surface; the owning Dashboard page owns the
// dashboard query. The state-specific branches the web source itself defines are reproduced in full here and
// in [WidgetPicker]: the empty "no widgets match" result, the conditional Recently-Added / Presets sections,
// the searching-vs-grouped body, the per-widget already-added state, and the session footer.
//
// The widget catalogue (names, descriptions, category labels, default grid sizes) and the layout presets are
// DATA, ported verbatim from web .../widgets/registry/*.ts and .../hooks/useDashboardLayout.ts, which hardcode
// them in TypeScript and do NOT route them through i18n. Localizing them here would drift from the source and
// has no catalog keys, so they live as data in [WidgetPickerCatalog]; every translatable chrome string
// resolves through P1/S10 `stringResource` in the composable.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/WidgetPicker — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and PascalCase segments are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling feature-view surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.widgetpicker

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Widget categories — a 1:1 port of the web `WidgetCategory` union, declared in registry order so the filter
 * pills and the grouped catalogue render in the same order as the web source. [token] is the lowercase string
 * the web union uses (e.g. `'battery'`); the picker's search matches against it (web
 * `w.category.toLowerCase().includes(query)`). [label] is the human-readable group/pill title (web
 * `CATEGORY_LABELS`); it is catalogue data, not translatable chrome.
 */
enum class WidgetCategory(
    val token: String,
    val label: String,
) {
    Vehicle("vehicle", "Vehicle"),
    Battery("battery", "Battery & Range"),
    Energy("energy", "Energy"),
    Driving("driving", "Driving"),
    Charging("charging", "Charging"),
    Climate("climate", "Climate"),
    Tires("tires", "Tires"),
    Security("security", "Security"),
    Commands("commands", "Commands"),
    Media("media", "Media"),
    Telemetry("telemetry", "Telemetry"),
    Analytics("analytics", "Analytics"),
    Alerts("alerts", "Alerts"),
    Automations("automations", "Automations"),
    System("system", "System"),
    Maps("maps", "Maps"),
}

/**
 * A catalogue widget — the ported subset of the web `WidgetDef` the picker actually renders (the lazy
 * component, icon vector, and min/max sizes the web def also carries are not needed to render a catalogue
 * card). [cols] and [rows] are the default grid footprint shown as the "{cols}×{rows} grid" descriptor.
 */
data class PickerWidget(
    val id: String,
    val name: String,
    val description: String,
    val category: WidgetCategory,
    val cols: Int,
    val rows: Int,
)

/**
 * A layout preset — ported from web `DASHBOARD_PRESETS`. The picker renders [name] and the widget count
 * ([widgetCount]) and calls back with [id] when applied (web `onApplyPreset(preset.id)`).
 */
data class WidgetPreset(
    val id: String,
    val name: String,
    val widgetIds: List<String>,
) {
    /** Number of widgets the preset seeds — the web `preset.widgets.length`. */
    val widgetCount: Int get() = widgetIds.size
}

/**
 * The picker's client-side inputs, mirroring the web component's `useState` cells and props. Feeding these
 * to [WidgetPickerProjection.project] yields the render-ready [WidgetPickerView].
 *
 * @property search raw search text (web `search`).
 * @property categoryFilter selected category, or `null` for "All" (web `categoryFilter: WidgetCategory|'all'`).
 * @property activeWidgetIds ids already on the dashboard — rendered as "Added" and excluded from add-all
 *   (web `activeWidgetIds`).
 * @property recentlyAddedIds persisted most-recent-first ids (web localStorage `recentlyAddedIds`).
 * @property addedThisSessionIds ids added since the drawer opened — drives the footer count
 *   (web `addedThisSessionIds`).
 */
data class WidgetPickerInput(
    val search: String = "",
    val categoryFilter: WidgetCategory? = null,
    val activeWidgetIds: Set<String> = emptySet(),
    val recentlyAddedIds: List<String> = emptyList(),
    val addedThisSessionIds: Set<String> = emptySet(),
)

/** A category group in the unsearched catalogue: its widgets plus how many are still addable. */
data class WidgetGroup(
    val category: WidgetCategory,
    val widgets: List<PickerWidget>,
    val addableCount: Int,
)

/**
 * The catalogue body — mutually exclusive, mirroring the web `query ? (results | empty) : grouped` branch.
 *  - [Grouped] — not searching: widgets grouped by category (web grouped render).
 *  - [Results] — searching with ≥1 match: the flat result list ([addableCount] drives "Add all {n}",
 *    [showAddAll] mirrors the web `filteredWidgets.length > 1` gate on the results header).
 *  - [Empty] — searching with no match: the web "No widgets match" message.
 */
sealed interface WidgetPickerBody {
    data class Grouped(
        val groups: List<WidgetGroup>,
    ) : WidgetPickerBody

    data class Results(
        val widgets: List<PickerWidget>,
        val addableCount: Int,
        val showAddAll: Boolean,
    ) : WidgetPickerBody

    data object Empty : WidgetPickerBody
}

/**
 * The fully-derived, render-ready view — the native analogue of every memoized value the web component
 * computes before returning JSX. Pure data (no Compose types) so [WidgetPickerProjection.project] is covered
 * end-to-end by the off-device unit gate.
 *
 * @property rawQuery trimmed, original-case query — for the "results for "{q}"" / "no match" copy.
 * @property query normalized (trimmed + lowercased) query — for filtering and highlighting.
 * @property isSearching whether a query is active (web `Boolean(query)`).
 * @property availableCount widgets matching the current query + category — the "{n} widgets available" count.
 * @property availableCategories categories present in the catalogue, in registry order (the filter pills).
 * @property recentlyAdded recently-added widgets still addable, capped — empty while searching/filtering.
 * @property showPresets whether the Layout Presets section shows (web `!query && categoryFilter === 'all'`).
 * @property presets the layout presets (web `DASHBOARD_PRESETS`).
 * @property body the catalogue body branch.
 * @property addedThisSessionCount widgets added since open — drives the footer (web `addedThisSessionCount`).
 */
data class WidgetPickerView(
    val rawQuery: String,
    val query: String,
    val isSearching: Boolean,
    val availableCount: Int,
    val availableCategories: List<WidgetCategory>,
    val recentlyAdded: List<PickerWidget>,
    val showPresets: Boolean,
    val presets: List<WidgetPreset>,
    val body: WidgetPickerBody,
    val addedThisSessionCount: Int,
)

/**
 * A search match split into the text before / inside / after the matched span — the native analogue of the
 * web `highlightMatch`, which wraps the matched substring in a colored span. [match] is empty when the query
 * is empty or absent, in which case the whole string is [before] and the renderer draws no highlight.
 */
data class HighlightSpans(
    val before: String,
    val match: String,
    val after: String,
)

/**
 * Pure projection from the picker's [WidgetPickerInput] to its render-ready [WidgetPickerView] — a faithful
 * port of every derivation the web component performs (filtering, grouping, recently-added, add-all counts).
 * Side-effect-free, so it is fully covered by the off-device unit gate. The composable holds the mutable UI
 * state and persistence; this object owns the logic.
 */
object WidgetPickerProjection {
    /** Most-recent-first cap for the Recently-Added section (web `RECENTLY_ADDED_MAX`). */
    const val RECENTLY_ADDED_MAX: Int = 8

    /** Normalizes search text the way the web does before filtering/highlighting: trim then lowercase. */
    fun normalizeQuery(search: String): String = search.trim().lowercase()

    /**
     * Widgets matching [search] within [categoryFilter] (`null` = All) — the web `filteredWidgets`. With no
     * query, returns the category pool unfiltered; otherwise matches name, description, or category token
     * (all case-insensitive), exactly as the web `pool.filter(...)` does.
     */
    fun filteredWidgets(
        search: String,
        categoryFilter: WidgetCategory?,
        catalog: List<PickerWidget> = widgetCatalog,
    ): List<PickerWidget> {
        val pool = if (categoryFilter == null) catalog else catalog.filter { it.category == categoryFilter }
        val query = normalizeQuery(search)
        if (query.isEmpty()) return pool
        return pool.filter { widget ->
            widget.name.lowercase().contains(query) ||
                widget.description.lowercase().contains(query) ||
                widget.category.token.contains(query)
        }
    }

    /**
     * Widgets within [categoryFilter] grouped by category in registry order — the web `grouped`/`groupedEntries`
     * used for the unsearched catalogue. Each group carries its still-addable count for the "Add all {n}" action.
     */
    fun groupedByCategory(
        categoryFilter: WidgetCategory?,
        activeWidgetIds: Set<String>,
        catalog: List<PickerWidget> = widgetCatalog,
    ): List<WidgetGroup> {
        val pool = if (categoryFilter == null) catalog else catalog.filter { it.category == categoryFilter }
        return pool
            .groupBy { it.category }
            .map { (category, widgets) ->
                WidgetGroup(
                    category = category,
                    widgets = widgets,
                    addableCount = widgets.count { it.id !in activeWidgetIds },
                )
            }
    }

    /** Distinct categories present in the catalogue, in first-appearance (registry) order — the filter pills. */
    fun availableCategories(catalog: List<PickerWidget> = widgetCatalog): List<WidgetCategory> = catalog.map { it.category }.distinct()

    /**
     * Recently-added widgets still worth showing — the web `recentlyAddedVisible`. Hidden entirely while
     * searching or filtering by category; otherwise maps the persisted ids to known widgets, drops any already
     * on the dashboard, and caps at [RECENTLY_ADDED_MAX], preserving most-recent-first order.
     */
    fun recentlyAddedVisible(
        recentlyAddedIds: List<String>,
        activeWidgetIds: Set<String>,
        search: String,
        categoryFilter: WidgetCategory?,
        catalog: List<PickerWidget> = widgetCatalog,
    ): List<PickerWidget> {
        if (normalizeQuery(search).isNotEmpty() || categoryFilter != null) return emptyList()
        val byId = catalog.associateBy { it.id }
        return recentlyAddedIds
            .mapNotNull { byId[it] }
            .filter { it.id !in activeWidgetIds }
            .take(RECENTLY_ADDED_MAX)
    }

    /**
     * The ids that would actually be added from [requestedIds] — the web `handleAddMany` filter: de-duplicated
     * (preserving order), excluding ids already active or unknown to the catalogue.
     */
    fun addableIds(
        requestedIds: List<String>,
        activeWidgetIds: Set<String>,
        catalog: List<PickerWidget> = widgetCatalog,
    ): List<String> {
        val known = catalog.mapTo(HashSet()) { it.id }
        val seen = HashSet<String>()
        return requestedIds.filter { id ->
            if (id in seen || id in activeWidgetIds || id !in known) {
                false
            } else {
                seen.add(id)
                true
            }
        }
    }

    /**
     * The next persisted recently-added list after [addedIds] are added — the web
     * `[...added, ...prev without added].slice(0, MAX)`: newest first, de-duplicated, capped.
     */
    fun nextRecentlyAdded(
        current: List<String>,
        addedIds: List<String>,
    ): List<String> = (addedIds + current.filter { it !in addedIds }).take(RECENTLY_ADDED_MAX)

    /**
     * The single addable widget for the search box's Enter shortcut, or `null` — the web `handleKeyDown`
     * behavior: when a query is active and exactly one matching widget is still addable, Enter adds it.
     */
    fun singleAddableForEnter(
        search: String,
        categoryFilter: WidgetCategory?,
        activeWidgetIds: Set<String>,
        catalog: List<PickerWidget> = widgetCatalog,
    ): PickerWidget? {
        if (normalizeQuery(search).isEmpty()) return null
        val addable = filteredWidgets(search, categoryFilter, catalog).filter { it.id !in activeWidgetIds }
        return addable.singleOrNull()
    }

    /** The "{cols}×{rows} grid" footprint descriptor shown on each card (web `{cols}×{rows} grid`). */
    fun sizeLabel(widget: PickerWidget): String = "${widget.cols}×${widget.rows} grid"

    /**
     * Splits [text] around the first case-insensitive occurrence of the normalized [query] — the web
     * `highlightMatch`. With an empty query or no match, the whole string is returned as [HighlightSpans.before]
     * with an empty [HighlightSpans.match].
     */
    fun highlight(
        text: String,
        query: String,
    ): HighlightSpans {
        val idx = if (query.isEmpty()) -1 else text.lowercase().indexOf(query)
        if (idx < 0) return HighlightSpans(text, "", "")
        val end = idx + query.length
        return HighlightSpans(text.substring(0, idx), text.substring(idx, end), text.substring(end))
    }

    /**
     * Derives the complete render-ready [WidgetPickerView] for [input] — the one entry point the composable
     * calls, bundling every web derivation so the render layer stays declarative.
     */
    fun project(
        input: WidgetPickerInput,
        catalog: List<PickerWidget> = widgetCatalog,
        presets: List<WidgetPreset> = widgetPresets,
    ): WidgetPickerView {
        val rawQuery = input.search.trim()
        val query = rawQuery.lowercase()
        val isSearching = query.isNotEmpty()
        val filtered = filteredWidgets(input.search, input.categoryFilter, catalog)
        val body =
            if (isSearching) {
                if (filtered.isEmpty()) {
                    WidgetPickerBody.Empty
                } else {
                    WidgetPickerBody.Results(
                        widgets = filtered,
                        addableCount = filtered.count { it.id !in input.activeWidgetIds },
                        showAddAll = filtered.size > 1,
                    )
                }
            } else {
                WidgetPickerBody.Grouped(groupedByCategory(input.categoryFilter, input.activeWidgetIds, catalog))
            }
        return WidgetPickerView(
            rawQuery = rawQuery,
            query = query,
            isSearching = isSearching,
            availableCount = filtered.size,
            availableCategories = availableCategories(catalog),
            recentlyAdded =
                recentlyAddedVisible(
                    input.recentlyAddedIds,
                    input.activeWidgetIds,
                    input.search,
                    input.categoryFilter,
                    catalog,
                ),
            showPresets = !isSearching && input.categoryFilter == null,
            presets = presets,
            body = body,
            addedThisSessionCount = input.addedThisSessionIds.size,
        )
    }
}

/**
 * Persistence seam for the Recently-Added ids — the native analogue of the web `loadRecentlyAdded` /
 * `saveRecentlyAdded` localStorage pair. The owning Dashboard page injects a durable (DataStore-backed)
 * implementation; the composable defaults to [InMemoryWidgetPickerRecentStore] so the surface is fully
 * functional and testable without a platform storage dependency.
 */
interface WidgetPickerRecentStore {
    /** Most-recent-first ids persisted from prior sessions (web `loadRecentlyAdded`). */
    fun load(): List<String>

    /** Persists the capped, de-duplicated most-recent-first ids (web `saveRecentlyAdded`). */
    fun save(ids: List<String>)
}

/** Session-scoped [WidgetPickerRecentStore] — the default when the host injects no durable store. */
class InMemoryWidgetPickerRecentStore(
    initial: List<String> = emptyList(),
) : WidgetPickerRecentStore {
    private var ids: List<String> = initial

    override fun load(): List<String> = ids

    override fun save(ids: List<String>) {
        this.ids = ids
    }
}

/** Stable identifiers for the surface (P1/S11 diagnostics + the UI-test tags). */
object WidgetPickerRegistration {
    /** Stable surface id. */
    const val ID: String = "widget-picker"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "WidgetPicker"

    /** Test tag on the drawer container. */
    const val SHEET_TEST_TAG: String = "dashboard-widget-picker"

    /** Test tag on the search field. */
    const val SEARCH_TEST_TAG: String = "dashboard-widget-picker-search"

    /** Prefix for a per-widget card test tag (`<prefix><widgetId>`). */
    const val WIDGET_TAG_PREFIX: String = "dashboard-widget-picker-card-"
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface slug — never the search
 * text, the active widget ids, or any callback — so a diagnostics line can never leak what the operator was
 * doing.
 */
object WidgetPickerDiagnostics {
    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-open effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to WidgetPickerRegistration.SLUG))
    }
}
