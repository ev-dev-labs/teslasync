import SwiftUI

/// Registers the native Fleet Telemetry Coverage surface for the `.fleetTelemetryCoverage`
/// route so the app shell's route host renders it (web `/admin/telemetry/coverage`).
/// Mirrors `ApiPlaygroundRouteRegistration` / `DiskForecastRouteRegistration`: the
/// `@Observable` model is built on the main actor here and captured, so the escaping
/// registry closure never constructs an isolated type.
///
/// The web route is the admin sub-path `/admin/telemetry/coverage`, which `AppRouteParser`
/// resolves to this dedicated route via a path alias (and the System-group sidebar entry).
/// This keeps the page reachable + deep-linkable without displacing the sibling Disk
/// Forecast page that hosts on `.admin`.
public enum FleetTelemetryCoverageRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any FleetTelemetryCoverageDataSource = SampleFleetTelemetryCoverageDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = FleetTelemetryCoveragePageModel(dataSource: dataSource)
        registry.register(.fleetTelemetryCoverage) {
            FleetTelemetryCoveragePage(model: model)
        }
        return registry
    }
}
