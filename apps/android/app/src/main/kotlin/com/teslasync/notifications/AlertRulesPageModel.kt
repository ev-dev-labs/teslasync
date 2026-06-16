// The framework-free model backing the AlertRulesPage surface (P1/S8) — the native mirror of the web page's
// local state + pure helpers (web/src/features/notifications/pages/AlertRulesPage.tsx). It owns the navigation /
// diagnostics identity ([AlertRulesPageRegistration]), the bulk-selection snapshot ([AlertRulesInteraction], the
// port of the web `useBulkSelection<number>()` set + its `masterState` tri-state), the rename validation rule
// (web `validate` ▸ `alertRules.error.nameTooLong`), and the one PII-safe `view.opened` diagnostic. It carries
// no Compose / Android types so it is unit-testable in isolation; the view-model and the view depend on it.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/notifications)
// diverges from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.notifications.alertrules

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notifications.AlertRule

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `AlertRulesPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("notificationsRules", "/notifications/rules", …)`, so [io.teslasync.android.navigation.PageHosts] binds
 * this surface to that destination (and its `/notifications/rules` deep link) without the nav module depending
 * on it.
 */
object AlertRulesPageRegistration {
    /** The navigation destination id (Destinations.kt `page("notificationsRules", "/notifications/rules", …)`). */
    const val ROUTE_ID: String = "notificationsRules"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/notifications/rules"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no rule id or name. */
    const val SLUG: String = "AlertRulesPage"

    /**
     * The edit-lease key this list view claims (web `const leaseKey = 'alert-rules/list'`). Scoped to the list
     * itself, not per-rule, because the rename / bulk affordances operate across the whole rule set.
     */
    const val EDIT_LEASE_KEY: String = "alert-rules/list"

    /**
     * The destination id the "Open Alert Studio" affordances navigate to (web `to="/notifications/studio"`),
     * resolved to its web path + deep link through [io.teslasync.android.navigation.Destinations].
     */
    const val STUDIO_ROUTE_ID: String = "notificationsStudio"

    /** The web rename guard: `next.length > 120 ? 'Max 120 characters' : null` + the `maxLength={120}` cap. */
    const val NAME_MAX_LENGTH: Int = 120
}

/**
 * Tri-state of the "select all" master checkbox — the port of the web `useBulkSelection.masterState(visibleIds)`
 * (`'all' | 'some' | 'none'`). [Some] renders the indeterminate (mixed) checkbox state.
 */
enum class MasterSelection { None, Some, All }

/**
 * The page's local interaction snapshot — the port of the web `useBulkSelection<number>()` selected-id set. Held
 * immutably so every render is a pure function of it; the view-model swaps a new copy on each selection change.
 *
 * @property selectedIds the ids of the currently bulk-selected rules (web `sel.selectedIds`).
 */
data class AlertRulesInteraction(
    val selectedIds: Set<Long> = emptySet(),
) {
    /** Whether [id] is currently selected (web `sel.isSelected(id)`). */
    fun isSelected(id: Long): Boolean = selectedIds.contains(id)

    /**
     * The master-checkbox tri-state over [visibleIds] (web `sel.masterState(visibleIds)`): [MasterSelection.All]
     * when every visible row is selected (and at least one exists), [MasterSelection.None] when none is, else
     * [MasterSelection.Some].
     */
    fun masterState(visibleIds: List<Long>): MasterSelection {
        if (visibleIds.isEmpty()) return MasterSelection.None
        val selectedVisible = visibleIds.count { selectedIds.contains(it) }
        return when (selectedVisible) {
            0 -> MasterSelection.None
            visibleIds.size -> MasterSelection.All
            else -> MasterSelection.Some
        }
    }

    /** The selected-id set intersected with [visibleIds] (web `useBulkSelection` clamps to the visible set). */
    fun selectedAmong(visibleIds: List<Long>): List<Long> = visibleIds.filter { selectedIds.contains(it) }
}

/**
 * The stable per-rule ids of a rules list, in order — the web `visibleIds = rules.map(r => r.id)`. A pure helper
 * so the view-model and the master-toggle share one definition of "what is visible".
 */
fun visibleRuleIds(rules: List<AlertRule>): List<Long> = rules.map { it.id }

/**
 * Validates a candidate rule name, returning the localized error key's resolved message via [tooLongMessage]
 * when it exceeds [AlertRulesPageRegistration.NAME_MAX_LENGTH], else null — the exact port of the web
 * `validate={(next) => next.length > 120 ? t('alertRules.error.nameTooLong') : null}`. Pure (the caller supplies
 * the already-localized message) so it is locale-stable and unit-testable.
 */
fun validateRuleName(
    next: String,
    tooLongMessage: String,
): String? = if (next.length > AlertRulesPageRegistration.NAME_MAX_LENGTH) tooLongMessage else null

// ── Diagnostics (P1/S11) ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [AlertRulesPageRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first
 * composition. Carries no rule id, rule name, or signal name.
 */
fun recordAlertRulesPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to AlertRulesPageRegistration.SLUG))
}
