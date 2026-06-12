import SwiftUI

/// Registers the native Live Signal Inspector surface for the `.liveSignals` route so the
/// app shell's route host renders it (web `/admin/live-signals`). Mirrors
/// `ApiPlaygroundRouteRegistration` / `FleetTelemetryCoverageRouteRegistration`: the
/// `@Observable` model is built on the main actor here and captured, so the escaping
/// registry closure never constructs an isolated type.
///
/// The web route is the admin sub-path `/admin/live-signals`, which `AppRouteParser`
/// resolves to this dedicated route via a path alias (and the System-group sidebar entry),
/// keeping the page reachable + deep-linkable without displacing the sibling Disk Forecast
/// page that hosts on `.admin`.
public enum LiveSignalInspectorRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        vehicleSource: any LiveSignalInspectorVehicleSource = SampleLiveSignalInspectorVehicleSource(),
        liveSignalsFactory: any LiveSignalInspectorLiveSignalsFactory = SampleLiveSignalInspectorLiveSignalsFactory()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = LiveSignalInspectorPageModel(
            vehicleSource: vehicleSource,
            liveSignalsFactory: liveSignalsFactory
        )
        registry.register(.liveSignals) {
            LiveSignalInspectorPage(model: model)
        }
        return registry
    }
}
