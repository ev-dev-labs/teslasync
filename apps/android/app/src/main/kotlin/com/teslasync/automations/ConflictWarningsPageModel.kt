// Framework-free registration + diagnostics for the ConflictWarnings page surface (P3/A7) — the thin
// page-layer wrapper over the shared ConflictWarnings feature view (com/teslasync/feature-views/ConflictWarnings,
// package io.teslasync.android.featureviews.conflictwarnings). The web source
// (web/src/features/automations/pages/ConflictWarnings.tsx) is an unrouted, purely presentational fragment the
// Automation builder renders inline (prop: `conflicts`); this layer adds the page-prompt's `@Composable screen +
// ViewModel` seam around that one shared surface (DRY, ADR-006) without re-implementing any of its rendering.
//
// Only logic-free declarations live here (the surface identity + the PII-safe `view.opened` recorder), so they
// are exercised by the off-device JVM gate without Compose/Android. The page slug is distinct from the embedded
// feature view's diagnostics slug ("ConflictWarnings") so the page-open and view-render events stay separable,
// exactly as the sibling AutomationCardPage / ConditionBuilderPage surfaces do.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/automations — the
// page prompt's allowed-files path) diverges from the `io.teslasync.android.*` package the rest of the app uses,
// exactly as the sibling page surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.automations

import io.teslasync.shared.core.diagnostics.Logger

/** Stable diagnostics + registry identifiers for the ConflictWarnings page surface (P1/S11). */
object ConflictWarningsPageRegistration {
    /** Stable surface id. */
    const val ID: String = "conflict-warnings-page"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ConflictWarningsPage"
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [ConflictWarningsPageRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-testable with a recording [Logger]; the page composable calls it
 * from its first-composition effect. Carries no automation name, conflict reason, or id, so a diagnostics line
 * can never leak which automations a user has configured or which of them conflict.
 */
fun recordConflictWarningsPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to ConflictWarningsPageRegistration.SLUG))
}
