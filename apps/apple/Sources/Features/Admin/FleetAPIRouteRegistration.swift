import SwiftUI

/// Registers the native Fleet API surface for the `.fleetAPI` route so the app shell's route
/// host renders it (web `/fleet-api`). Mirrors `FeatureFlagsRouteRegistration` /
/// `ApiPlaygroundRouteRegistration`: the `@Observable` model is built on the main actor here
/// and captured, so the escaping registry closure never constructs an isolated type.
public enum FleetAPIRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any FleetAPIDataSource = SampleFleetAPIDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = FleetAPIPageModel(dataSource: dataSource)
        registry.register(.fleetAPI) {
            FleetAPIPage(model: model)
        }
        return registry
    }
}
