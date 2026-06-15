// Framework-free registration + diagnostics for the TeslaChargingSessionsMap page surface (P3/A7) — the thin
// page-layer wrapper over the shared TeslaChargingSessionsMap feature view
// (com/teslasync/feature-views/TeslaChargingSessionsMap, package
// io.teslasync.android.featureviews.teslachargingsessionsmap). The web source
// (web/src/features/charging/pages/TeslaChargingSessionsMap.tsx) is an UNROUTED map the Fleet Charging Sessions
// page embeds; its rows arrive from the parent's `useTeslaChargingSessions` read. This layer adds the page
// prompt's `@Composable screen + ViewModel` seam around that one shared surface (DRY, ADR-006) without
// re-implementing any rendering, projection, or string.
//
// The data seam (`ChargingSessionsSource` + the `ChargingStoreSessionsSource` shared-store binding) and the
// per-marker projection already live in the feature view, so this file deliberately reuses them rather than
// cloning a Source: it carries only the page-layer registry identifier + the PII-safe `view.opened` diagnostic
// the page state holder emits, exactly as the sibling unrouted page wrappers (ConditionBuilder / PresetGallery)
// do. No HTTP, no business logic.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging — the page
// prompt's allowed-files path) diverges from the `io.teslasync.android.*` package the rest of the app uses,
// exactly as the sibling page surfaces (chargingcurve / powershare) do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.charging.teslachargingsessionsmap

import io.teslasync.shared.core.diagnostics.Logger

/** Stable diagnostics + registry identifiers for the TeslaChargingSessionsMap page surface (P1/S11). */
object TeslaChargingSessionsMapPageRegistration {
    /** Stable surface id. */
    const val ID: String = "tesla-charging-sessions-map-page"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11); distinct from the feature view's. */
    const val SLUG: String = "TeslaChargingSessionsMapPage"
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface
 * [TeslaChargingSessionsMapPageRegistration.SLUG] (P1/S11). Kept free of Compose so it is unit-testable with a
 * recording [Logger]; the page composable calls it from its first-composition effect. Carries no site name,
 * coordinate, cost, or vin, so a diagnostics line can never leak where the fleet charges.
 */
fun recordTeslaChargingSessionsMapPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to TeslaChargingSessionsMapPageRegistration.SLUG))
}
