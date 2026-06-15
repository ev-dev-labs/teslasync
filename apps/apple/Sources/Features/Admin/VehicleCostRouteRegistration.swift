import SwiftUI

/// Registers the native Vehicle Cost surface for the `.vehicleCost` route so the app
/// shell's route host renders it (web `/admin/vehicle-cost`). Mirrors
/// `SchemaDriftRouteRegistration` / `SlowQueriesRouteRegistration`: the `@Observable`
/// model is built on the main actor here and captured, so the escaping registry closure
/// never constructs an isolated type.
///
/// The web route is the admin sub-path `/admin/vehicle-cost`, which `AppRouteParser`
/// resolves to this dedicated route via a path alias (and the System-group sidebar entry),
/// keeping the page reachable + deep-linkable without displacing the sibling Disk Forecast
/// page that hosts on `.admin`.
public enum VehicleCostRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any VehicleCostDataSource = SampleVehicleCostDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = VehicleCostPageModel(dataSource: dataSource)
        registry.register(.vehicleCost) {
            VehicleCostPage(model: model)
        }
        return registry
    }
}
