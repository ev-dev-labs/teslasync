//
//  SignalGapDetectorRouteRegistration.swift
//  TeslaSync — P4-APPLE · P7 · page:telemetry/SignalGapDetector (Apple)
//
//  Registers the native SignalGapDetector surface so the app shell's route host renders it
//  (web `/signal-gaps`). Mirrors the sibling registrations (e.g. `LiveSignalInspectorRouteRegistration`):
//  the `@Observable` model is built on the main actor here and captured, so the escaping registry
//  closure never constructs an isolated type.
//
//  Route hosting: the web page lives at the standalone `/signal-gaps` route and is the telemetry /
//  signals workspace's gap view (its web source notes it "stays in sync with the catalog rendered in
//  the unified `/signals` workspace"). The `.telemetry` AppRoute — already aliased from `/signals`
//  and previously unregistered — is its native home; `AppRouteParser` gains a `/signal-gaps → .telemetry`
//  alias so the web deep link resolves. No new AppRoute case is added (so the sidebar / tab / deep-link
//  enumerations are unchanged), matching how the sibling AnomalyDashboard page reused `.diagnostics`.
//

import SwiftUI

public enum SignalGapDetectorRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        vehicleSource: any SignalGapDetectorVehicleSource = SampleSignalGapDetectorVehicleSource(),
        catalogProvider: any SignalGapDetectorCatalogProviding = SampleSignalGapDetectorCatalogProvider()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = SignalGapDetectorPageModel(
            vehicleSource: vehicleSource,
            catalogProvider: catalogProvider
        )
        registry.register(.telemetry) {
            SignalGapDetectorPage(model: model)
        }
        return registry
    }
}
