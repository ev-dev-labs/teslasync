// Pure, framework-free model + derivations for the AutomationListPage surface — the native analogue of
// everything the web page computes before it returns JSX
// (web/src/features/automations/pages/AutomationListPage.tsx, the bulk-manage list of every automation). No
// Compose, no Android UI, no HTTP lives here: the list arrives as the shared, already-decoded S8 payload (the
// KMP `AutomationsStore.automations()` ▸ `GET /automations`, a typed `List<Automation>`), so this file owns
// only the client-side derivations the web component does inline: the empty-rows guard (web
// `automations.length === 0`), the per-row description em-dash fallback (web `a.description ?? '—'`), the bulk
// operation that gates behind a confirm (web's `confirm` payload on the delete action), and the one PII-safe
// `view.opened` diagnostic. None of the automation fields is unit-bearing (a name, a description, an execution
// count, an enabled flag), so there is no SI conversion — locale number formatting is applied at the render
// boundary (S5).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/automations — the P3 prompt's allowed-files path) cannot form the package the rest of the
// app's `io.teslasync.android.*` namespace uses, so the package intentionally diverges from the path — exactly
// as the sibling admin surfaces do. `MatchingDeclarationName` is suppressed for the co-located helpers.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.automations.list

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.automations.Automation
import io.teslasync.shared.core.presentation.automations.AutomationBulkOp

/**
 * Canonical metadata for this surface. The web page is a top-level list route, not a draggable dashboard
 * widget, so there is no web registry row to mirror — this object carries the cross-cutting concerns the
 * surface owes: the navigation [ROUTE_ID] / [WEB_PATH] the host wires and the diagnostics [SLUG] emitted with
 * the one-shot `view.opened` event (P1/S11).
 */
object AutomationListPageRegistration {
    /** The navigation destination id (Destinations.kt `page("automationList", "/automations/list", …)`). */
    const val ROUTE_ID: String = "automationList"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/automations/list"

    /** The builder route the empty-state CTA + a row tap target (web `/automations/new` ⁄ `/automations/{id}`). */
    const val BUILDER_PATH: String = "/automations/new"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no automation content. */
    const val SLUG: String = "AutomationListPage"
}

/** Em dash used as the universal "no value" marker, matching the web `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/**
 * Whether the list carries no automations — gates the native Empty phase (web `automations.length === 0`). A
 * list with at least one automation is content (the table), never empty.
 */
val List<Automation>.isEmptyList: Boolean
    get() = isEmpty()

/**
 * The master-checkbox state for the visible rows — the native port of the web `useBulkSelection().masterState`.
 * [None] when no visible id is selected, [All] when every visible id is, [Some] for a partial (indeterminate)
 * selection. An empty visible slice is [None] (web `if (visible.length === 0) return 'none'`).
 */
enum class MasterSelection { None, Some, All }

/**
 * Resolves the [MasterSelection] for [visible] given the current [selected] set — the pure fold the web
 * `masterState(visibleIds)` performs (counts how many visible ids are selected, then maps 0 → none,
 * all → all, else → some). Drives the indeterminate flag on the header checkbox.
 */
fun masterSelection(
    selected: Set<Long>,
    visible: List<Long>,
): MasterSelection {
    if (visible.isEmpty()) return MasterSelection.None
    val hits = visible.count { it in selected }
    return when (hits) {
        0 -> MasterSelection.None
        visible.size -> MasterSelection.All
        else -> MasterSelection.Some
    }
}

/**
 * The description to render for a row, applying the web `a.description ?? '—'` fallback so a missing
 * description collapses to the em-dash rather than a blank cell. A server-sent empty string is preserved
 * verbatim (the web nullish-coalescing only substitutes for null/undefined), so this guards null only.
 */
fun Automation.descriptionOrDash(): String = description ?: EM_DASH

/**
 * Whether a bulk operation must be confirmed before it runs — the native fold of the web action's optional
 * `confirm` payload. Only delete is destructive and irreversible, so only delete routes through the
 * confirmation dialog (web `actions: [enable, disable, delete{ confirm }]`); enable/disable apply immediately.
 */
val AutomationBulkOp.requiresConfirmation: Boolean
    get() = this == AutomationBulkOp.DELETE

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [AutomationListPageRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its
 * first composition. Carries no automation id, name, or description.
 */
fun recordAutomationListPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to AutomationListPageRegistration.SLUG))
}
