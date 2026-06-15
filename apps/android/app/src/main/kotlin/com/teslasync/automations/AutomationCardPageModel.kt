// Framework-free registration + diagnostics for the AutomationCard page surface (P3/A7) — the thin page-layer
// wrapper over the shared AutomationCard feature view (com/teslasync/feature-views/AutomationCard, package
// io.teslasync.android.featureviews.automationcard). The web source
// (web/src/features/automations/pages/AutomationCard.tsx) is an unrouted, purely presentational card the
// Automations list renders per row; this layer adds the page-prompt's `@Composable screen + ViewModel` seam
// around that one shared surface (DRY, ADR-006) without re-implementing any of its rendering.
//
// Only logic-free declarations live here (the surface identity + the PII-safe `view.opened` recorder), so they
// are exercised by the off-device JVM gate without Compose/Android. `InvalidPackageDeclaration` is suppressed:
// the mandated surface directory (com/teslasync/automations — the page prompt's allowed-files path) diverges
// from the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling page surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.automations

import io.teslasync.shared.core.diagnostics.Logger

/** Stable diagnostics + registry identifiers for the AutomationCard page surface (P1/S11). */
object AutomationCardPageRegistration {
    /** Stable surface id. */
    const val ID: String = "automation-card-page"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "AutomationCardPage"
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [AutomationCardPageRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-testable with a recording [Logger]; the page composable calls it
 * from its first-composition effect. Carries no automation name, schedule, or vehicle, so a diagnostics line can
 * never leak what a user has configured.
 */
fun recordAutomationCardPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to AutomationCardPageRegistration.SLUG))
}
