import SwiftUI

/// Registers the native Mileage surface for the `.mileage` route so the app shell's route host
/// renders it. The web route `/mileage` resolves to `.mileage` directly through the path segment
/// (`AppRouteParser` matches `pathSegment == "mileage"`), so registering here makes the page
/// reachable + deep-linkable and surfaces it in the Insights sidebar group. Mirrors the sibling
/// `*RouteRegistration` enums: the `@Observable` model is built on the main actor here and captured,
/// so the escaping registry closure never constructs an isolated type.
public enum MileageRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any MileageDataSource = SampleMileageDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = MileagePageModel(dataSource: dataSource)
        registry.register(.mileage) {
            MileagePage(model: model)
        }
        return registry
    }
}
