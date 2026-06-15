// Framework-free registration + diagnostics for the ConditionBuilder page surface (P3/A7) — the thin
// page-layer wrapper over the shared ConditionBuilder feature view (com/teslasync/feature-views/ConditionBuilder,
// package io.teslasync.android.featureviews.conditionbuilder). The web source
// (web/src/features/automations/pages/ConditionBuilder.tsx) is an unrouted, controlled sub-component the
// Automation builder embeds (props: conditions + onChange; one data hook, useGeofences); this layer adds the
// page-prompt's `@Composable screen + ViewModel` seam around that one shared surface (DRY, ADR-006) without
// re-implementing any of its rendering.
//
// Only logic-free declarations live here (the surface identity + the PII-safe `view.opened` recorder), so they
// are exercised by the off-device JVM gate without Compose/Android. `InvalidPackageDeclaration` is suppressed:
// the mandated surface directory (com/teslasync/automations — the page prompt's allowed-files path) diverges
// from the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling page surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.automations

import io.teslasync.shared.core.diagnostics.Logger

/** Stable diagnostics + registry identifiers for the ConditionBuilder page surface (P1/S11). */
object ConditionBuilderPageRegistration {
    /** Stable surface id. */
    const val ID: String = "condition-builder-page"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ConditionBuilderPage"
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [ConditionBuilderPageRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-testable with a recording [Logger]; the page composable calls
 * it from its first-composition effect. Carries no geofence names, ids, or condition values, so a diagnostics
 * line can never leak what a user has configured.
 */
fun recordConditionBuilderPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to ConditionBuilderPageRegistration.SLUG))
}
