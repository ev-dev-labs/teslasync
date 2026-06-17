import SwiftUI

/// Registers the native Maintenance surface for the `.maintenance` route so the app shell's route host
/// renders it. The web route `/maintenance` resolves to `.maintenance` directly through the path segment
/// (`AppRouteParser` matches `pathSegment == "maintenance"`), so registering here makes the page
/// reachable + deep-linkable and surfaces it in the Vehicle sidebar group + Explore hub. Mirrors the
/// sibling `*RouteRegistration` enums: the `@Observable` model is built on the main actor here and
/// captured, so the escaping registry closure never constructs an isolated type.
public enum MaintenanceRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any MaintenanceDataSource = SampleMaintenanceDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = MaintenancePageModel(dataSource: dataSource)
        registry.register(.maintenance) {
            MaintenancePage(model: model)
        }
        return registry
    }
}
