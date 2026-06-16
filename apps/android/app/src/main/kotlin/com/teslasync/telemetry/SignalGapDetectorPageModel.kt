// Pure, framework-free metadata + page state + diagnostics for the SignalGapDetectorPage telemetry surface — the
// native analogue of the cross-cutting concerns the web page owns
// (web/src/features/telemetry/pages/SignalGapDetectorPage.tsx, the /signal-gaps wrapper that promotes the
// staleness-aware signal catalog to a first-class route). No Compose, no Android framework, no HTTP lives here, so the
// route id + slug + the no-vehicle resolution are exercised off-device and the composable stays a thin render layer.
//
// The web page renders no data of its own — it reads the global `useSelectedVehicle()` store, sets the page
// title/subtitle, exposes a `<VehicleSelect />` action, and either shows the "select a vehicle" empty state (no
// selection) or embeds the shared `<SignalCatalogPanel vehicleId>` (web disabled-query branch ↔ content branch). So
// this surface carries only its navigation identity, the resolved-selection [SignalGapDetectorPageState], and the one
// PII-safe `view.opened` diagnostic; the embedded SignalCatalogPanel feature view owns the live-signals feed.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/telemetry — the P3 prompt's allowed-files path) cannot form the package the rest of the app's
// `io.teslasync.android.*` namespace uses, so the package intentionally diverges from the path — exactly as the
// sibling notifications/ChannelsPage and driving/RegenEfficiencyPage surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located registration + state + recorder.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.telemetry.signalgapdetector

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical metadata for the SignalGapDetectorPage surface. The web page is a top-level telemetry route, not a
 * draggable dashboard widget, so there is no web registry row to mirror — this object carries the cross-cutting
 * concerns the surface owes: the navigation [ROUTE_ID] / [WEB_PATH] the host wires (already a metadata-only
 * destination at Destinations.kt: `page("signalGaps", "/signal-gaps", NavGroup.Telemetry)`) and the diagnostics
 * [SLUG] emitted with the one-shot `view.opened` event (P1/S11). There is no page size or feed metadata because the
 * page renders no data of its own; the embedded SignalCatalogPanel feature view owns the live-signals feed.
 */
object SignalGapDetectorPageRegistration {
    /** The navigation destination id (Destinations.kt `page("signalGaps", "/signal-gaps", …)`). */
    const val ROUTE_ID: String = "signalGaps"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/signal-gaps"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11); also the `viewModel` key. */
    const val SLUG: String = "SignalGapDetectorPage"
}

/**
 * Immutable page state — the resolved active-vehicle scope (the native analogue of the web `useSelectedVehicle()`
 * value). [vehicleId] is the persisted/self-healed selection, or `null` when none is selected; [hasVehicle] mirrors
 * the web `!vehicleId || vehicleId <= 0` guard that switches between the empty state and the embedded catalog.
 */
data class SignalGapDetectorPageState(
    val vehicleId: Long?,
) {
    /** Whether a usable vehicle is selected (web `vehicleId && vehicleId > 0`). */
    val hasVehicle: Boolean get() = vehicleId != null && vehicleId > 0L

    companion object {
        /** The neutral "no vehicle selected yet" state — drives the empty branch. */
        val EMPTY: SignalGapDetectorPageState = SignalGapDetectorPageState(vehicleId = null)
    }
}

/** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11); carries no vehicle content. */
internal fun recordSignalGapDetectorPageOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to SignalGapDetectorPageRegistration.SLUG))
}

private const val EVENT_VIEW_OPENED = "view.opened"
private const val FIELD_SURFACE = "surface"
