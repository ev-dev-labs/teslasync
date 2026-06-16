// Framework-free registration + diagnostics for the TriggerConfigurator page surface (P3/A7) — the thin
// page-layer wrapper over the shared TriggerConfigurator feature view (com/teslasync/feature-views/TriggerConfigurator,
// package io.teslasync.android.featureviews.triggerconfigurator). The web source
// (web/src/features/automations/pages/TriggerConfigurator.tsx) is an unrouted, controlled sub-component the
// Automation builder embeds (props: trigger + onChange; one data hook, useGeofences); this layer adds the
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

/** Stable diagnostics + registry identifiers for the TriggerConfigurator page surface (P1/S11). */
object TriggerConfiguratorPageRegistration {
    /** Stable surface id. */
    const val ID: String = "trigger-configurator-page"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "TriggerConfiguratorPage"
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [TriggerConfiguratorPageRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-testable with a recording [Logger]; the page composable calls
 * it from its first-composition effect. Carries no geofence names, ids, signal values, or cron strings, so a
 * diagnostics line can never leak what a user has configured.
 */
fun recordTriggerConfiguratorPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to TriggerConfiguratorPageRegistration.SLUG))
}
