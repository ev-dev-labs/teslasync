import SwiftUI

/// Registers the native Climate Control surface for the `.climate` route so the
/// app shell's route host renders it (web `/climate` + `/climate-control`).
/// Mirrors `VehicleCostRouteRegistration`: the `@Observable` model is built on the
/// main actor here and captured, so the escaping registry closure never
/// constructs an isolated type.
///
/// The web mounts `ClimateControlPage` at both `/climate-control` (canonical) and
/// `/climate`; `AppRoute.climate`'s path segment resolves `/climate` directly and
/// `AppRouteParser` aliases `/climate-control` onto it, keeping the page reachable
/// via the Vehicle-group sidebar entry and both deep links.
enum ClimateControlRouteRegistration {
    @MainActor
    static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any ClimateControlDataSource = SampleClimateControlDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = ClimateControlPageModel(dataSource: dataSource)
        registry.register(.climate) {
            ClimateControlPage(model: model)
        }
        return registry
    }
}
