// Pure, framework-free model + projection for the WidgetCatalogueDialog surface — the native analogue of
// everything the web component derives before it returns JSX
// (web/src/features/dashboard/components/WidgetCatalogueDialog.tsx). No Compose, no Android, no HTTP: every
// declaration here is exercised off-device by the :android:testReleaseUnitTest gate, so the composable stays a
// thin render layer over these pure functions (the same split the sibling FeedbackModal surface documents).
//
// The web component is a discoverable, category-grouped widget picker dialog over the static widget registry.
// Its only data source is `useTranslation` (mapped natively to the generated i18n catalog, P1/S10) — there is
// no query, fetch, or remote state. So — exactly as the sibling presentational ports document — the
// loading / error / stale / offline states do NOT exist on this surface; the owning Dashboard page owns the
// dashboard query. The state-specific branches the web source itself defines are reproduced in full here and
// in the composable: the grouped catalogue, the search-filtered subset, the "no widgets match" empty result,
// and the per-widget already-added state.
//
// DATA REUSE (mirrors the web): the web dialog imports the shared `WIDGET_REGISTRY` rather than re-authoring it
// (`import { WIDGET_REGISTRY } from '../widgets/registry'`). The native registry was already ported verbatim as
// [widgetCatalog] (118 widgets across 16 categories) for the sibling WidgetPicker surface, so this dialog
// consumes the same [widgetCatalog] / [PickerWidget] / [WidgetCategory] — the faithful, drift-free port of the
// web's single-registry architecture. The category ORDER, EMOJI, and i18n keys below are this dialog's own
// (web `CATEGORY_ORDER` / `CATEGORY_EMOJI` / `dashboard.catalogue.category.*`), which differ from the picker
// (notably Charging precedes Driving here), so they live as this surface's data.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/modals-dialogs — the P3 prompt's allowed-files path) cannot form a valid Kotlin package (a
// hyphen is illegal in a package identifier), so the package intentionally diverges from the path — exactly as
// the sibling modal surfaces do. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.widgetcataloguedialog

import io.teslasync.android.featureviews.widgetpicker.PickerWidget
import io.teslasync.android.featureviews.widgetpicker.WidgetCategory
import io.teslasync.android.featureviews.widgetpicker.widgetCatalog
import io.teslasync.shared.core.diagnostics.Logger

/** Stable identifiers for the surface (P1/S11 diagnostics + the UI-test tags). */
object WidgetCatalogueDialogRegistration {
    /** Stable surface id. */
    const val ID: String = "widget-catalogue-dialog"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "WidgetCatalogueDialog"

    /** Test tag on the dialog body container. */
    const val DIALOG_TEST_TAG: String = "widget-catalogue-dialog"

    /** Test tag on the search field (web `data-testid="widget-catalogue-search"`). */
    const val SEARCH_TEST_TAG: String = "widget-catalogue-search"

    /** Test tag on the live result-count line (web `data-testid="widget-catalogue-result-count"`). */
    const val RESULT_COUNT_TEST_TAG: String = "widget-catalogue-result-count"

    /** Test tag on the empty-result panel (web `data-testid="widget-catalogue-empty"`). */
    const val EMPTY_TEST_TAG: String = "widget-catalogue-empty"

    /** Test tag on the clear-search action (web `data-testid="widget-catalogue-clear-search"`). */
    const val CLEAR_SEARCH_TEST_TAG: String = "widget-catalogue-clear-search"

    /** Prefix for a per-category section test tag (web `widget-catalogue-category-{category}`). */
    const val CATEGORY_TAG_PREFIX: String = "widget-catalogue-category-"

    /** Prefix for a per-widget entry test tag (web `widget-catalogue-entry-{widgetId}`). */
    const val ENTRY_TAG_PREFIX: String = "widget-catalogue-entry-"
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface slug — never the search
 * text, the active widget ids, or any callback — so a diagnostics line can never leak what the operator was
 * doing. Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from its
 * first-composition effect.
 */
object WidgetCatalogueDialogDiagnostics {
    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-open effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to WidgetCatalogueDialogRegistration.SLUG))
    }
}

/**
 * The category render order — a 1:1 port of the web `CATEGORY_ORDER`. Note this differs from the registry /
 * picker order: here Charging precedes Driving. The grouped catalogue and the filtered subset both render in
 * this order; any registry category missing from this list is appended afterwards so nothing is ever hidden
 * (web's defensive trailing loop).
 */
val CATEGORY_ORDER: List<WidgetCategory> =
    listOf(
        WidgetCategory.Vehicle,
        WidgetCategory.Battery,
        WidgetCategory.Energy,
        WidgetCategory.Charging,
        WidgetCategory.Driving,
        WidgetCategory.Climate,
        WidgetCategory.Tires,
        WidgetCategory.Security,
        WidgetCategory.Commands,
        WidgetCategory.Media,
        WidgetCategory.Telemetry,
        WidgetCategory.Analytics,
        WidgetCategory.Alerts,
        WidgetCategory.Automations,
        WidgetCategory.System,
        WidgetCategory.Maps,
    )

/**
 * The decorative category glyph shown in each section header — a verbatim port of the web `CATEGORY_EMOJI`. It
 * is rendered aria-hidden (the translated category label carries the meaning), so it is presentation data, not
 * a translatable string.
 */
@Suppress("CyclomaticComplexMethod") // A flat, exhaustive 1:1 category->emoji mapping, not branching logic.
fun categoryEmoji(category: WidgetCategory): String =
    when (category) {
        WidgetCategory.Vehicle -> "\uD83D\uDE97" // 🚗
        WidgetCategory.Battery -> "\uD83D\uDD0B" // 🔋
        WidgetCategory.Energy -> "\u26A1" // ⚡
        WidgetCategory.Driving -> "\uD83D\uDEE3" // 🛣
        WidgetCategory.Charging -> "\uD83D\uDD0C" // 🔌
        WidgetCategory.Climate -> "\uD83C\uDF21" // 🌡
        WidgetCategory.Tires -> "\uD83D\uDEDE" // 🛞
        WidgetCategory.Security -> "\uD83D\uDEE1" // 🛡
        WidgetCategory.Commands -> "\uD83C\uDF9B" // 🎛
        WidgetCategory.Media -> "\uD83C\uDFB5" // 🎵
        WidgetCategory.Telemetry -> "\uD83D\uDCE1" // 📡
        WidgetCategory.Analytics -> "\uD83D\uDCCA" // 📊
        WidgetCategory.Alerts -> "\uD83D\uDD14" // 🔔
        WidgetCategory.Automations -> "\uD83E\uDD16" // 🤖
        WidgetCategory.System -> "\u2699" // ⚙
        WidgetCategory.Maps -> "\uD83D\uDDFA" // 🗺
    }

/**
 * The English category labels (web `CATEGORY_FALLBACK_LABELS`), used as the projection's default when the
 * Compose boundary injects no translated labels (tests/previews) and as the i18n default value. In production
 * the composable resolves the localized label per category (web `dashboard.catalogue.category.{cat}`) and
 * passes it in via [WidgetCatalogueInput.categoryLabels].
 */
val DEFAULT_CATEGORY_LABELS: Map<WidgetCategory, String> = WidgetCategory.entries.associateWith { it.label }

/** A category section in the rendered catalogue: the category and the widgets that fall under it. */
data class WidgetCatalogueGroup(
    val category: WidgetCategory,
    val widgets: List<PickerWidget>,
)

/**
 * The catalogue body — mutually exclusive, mirroring the web `(isFiltering && visibleCount === 0) ? empty :
 * sections` branch.
 *  - [Sections] — the grouped catalogue (all groups when not searching, the matching subset when searching).
 *  - [Empty] — searching with no match: the web "No widgets match your search" panel.
 */
sealed interface WidgetCatalogueBody {
    data class Sections(
        val groups: List<WidgetCatalogueGroup>,
    ) : WidgetCatalogueBody

    data object Empty : WidgetCatalogueBody
}

/**
 * The fully-derived, render-ready view — the native analogue of every memoized value the web component computes
 * before returning JSX. Pure data (no Compose types) so [WidgetCatalogueProjection.project] is covered
 * end-to-end by the off-device unit gate.
 *
 * @property isFiltering whether a non-blank query is active (web `isFiltering`).
 * @property totalCount the full registry size — the subtitle/result-count denominator (web `totalCount`).
 * @property addedCount how many distinct widgets are already on the dashboard (web `addedCount`).
 * @property visibleCount widgets matching the current query — shown in the live result-count (web `visibleCount`).
 * @property body the catalogue body branch (sections or the empty result).
 */
data class WidgetCatalogueView(
    val isFiltering: Boolean,
    val totalCount: Int,
    val addedCount: Int,
    val visibleCount: Int,
    val body: WidgetCatalogueBody,
)

/**
 * The dialog's client-side inputs, mirroring the web component's `useState` query plus its props. Feeding these
 * to [WidgetCatalogueProjection.project] yields the render-ready [WidgetCatalogueView].
 *
 * @property query the raw search text (web `query`).
 * @property activeWidgetIds ids already on the dashboard — rendered as "Added", excluded from re-adding, and
 *   counted into the subtitle (web `activeWidgetIds`).
 * @property categoryLabels the localized category labels the search matches against (web's translated
 *   category label `categoryHit`); defaults to the English [DEFAULT_CATEGORY_LABELS].
 */
data class WidgetCatalogueInput(
    val query: String = "",
    val activeWidgetIds: Set<String> = emptySet(),
    val categoryLabels: Map<WidgetCategory, String> = DEFAULT_CATEGORY_LABELS,
)

/**
 * Pure projection from the dialog's [WidgetCatalogueInput] to its render-ready [WidgetCatalogueView] — a
 * faithful port of every derivation the web component performs (grouping in `CATEGORY_ORDER`, the
 * name/description/id plus translated-category-label search, the visible-count, and the empty-result branch).
 * Side-effect-free, so it is fully covered by the off-device unit gate. The composable holds the mutable query
 * state; this object owns the logic.
 */
object WidgetCatalogueProjection {
    /** Normalizes the search text the way the web does before filtering: trim then lowercase. */
    fun normalizeQuery(query: String): String = query.trim().lowercase()

    /**
     * The catalogue grouped by category in [order], then any leftover registry categories appended — the web
     * `groupedEntries` (its ordered buckets plus the defensive trailing loop). Empty groups are dropped.
     */
    fun orderedGroups(
        catalog: List<PickerWidget> = widgetCatalog,
        order: List<WidgetCategory> = CATEGORY_ORDER,
    ): List<WidgetCatalogueGroup> {
        val buckets = catalog.groupBy { it.category }
        val ordered = order.mapNotNull { category -> buckets[category]?.let { WidgetCatalogueGroup(category, it) } }
        val leftovers =
            buckets
                .filterKeys { it !in order }
                .map { (category, widgets) -> WidgetCatalogueGroup(category, widgets) }
        return ordered + leftovers
    }

    /**
     * Filters [groups] by the normalized [query] — the web `filteredEntries`. A category whose localized label
     * (from [categoryLabels]) contains the query keeps all of its widgets (web `categoryHit`); otherwise each
     * widget matches on its name, description, or id. Groups with no surviving widgets are dropped.
     */
    fun filterGroups(
        groups: List<WidgetCatalogueGroup>,
        query: String,
        categoryLabels: Map<WidgetCategory, String> = DEFAULT_CATEGORY_LABELS,
    ): List<WidgetCatalogueGroup> {
        if (query.isEmpty()) return groups
        return groups.mapNotNull { group ->
            val label = (categoryLabels[group.category] ?: group.category.label).lowercase()
            val categoryHit = label.contains(query)
            val matches =
                group.widgets.filter { widget ->
                    categoryHit ||
                        "${widget.name} ${widget.description} ${widget.id}".lowercase().contains(query)
                }
            if (matches.isEmpty()) null else WidgetCatalogueGroup(group.category, matches)
        }
    }

    /**
     * Derives the complete render-ready [WidgetCatalogueView] for [input] — the one entry point the composable
     * calls, bundling every web derivation so the render layer stays declarative.
     */
    fun project(
        input: WidgetCatalogueInput,
        catalog: List<PickerWidget> = widgetCatalog,
        order: List<WidgetCategory> = CATEGORY_ORDER,
    ): WidgetCatalogueView {
        val query = normalizeQuery(input.query)
        val isFiltering = query.isNotEmpty()
        val grouped = orderedGroups(catalog, order)
        val visibleGroups = if (isFiltering) filterGroups(grouped, query, input.categoryLabels) else grouped
        val visibleCount = visibleGroups.sumOf { it.widgets.size }
        val body =
            if (isFiltering && visibleCount == 0) {
                WidgetCatalogueBody.Empty
            } else {
                WidgetCatalogueBody.Sections(visibleGroups)
            }
        return WidgetCatalogueView(
            isFiltering = isFiltering,
            totalCount = catalog.size,
            addedCount = input.activeWidgetIds.size,
            visibleCount = visibleCount,
            body = body,
        )
    }
}
