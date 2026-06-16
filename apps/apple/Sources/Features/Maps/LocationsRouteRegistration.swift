import SwiftUI

/// Registers the native Locations surface for the `.locations` route so the app shell's route host
/// renders it. The web route `/locations` resolves to `.locations` directly through the path segment
/// (`AppRouteParser` matches `pathSegment == "locations"`), so registering here makes the page
/// reachable + deep-linkable and surfaces it in the Vehicle sidebar group. Mirrors the sibling
/// `*RouteRegistration` enums: the `@Observable` model is built on the main actor here and captured,
/// so the escaping registry closure never constructs an isolated type. `onViewDrives` wires the
/// empty-state CTA (web `actionTo={{ to: '/drives' }}`) to the Driving surface.
public enum LocationsRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any LocationsDataSource = SampleLocationsDataSource(),
        onViewDrives: @escaping () -> Void = {}
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = LocationsPageModel(dataSource: dataSource)
        registry.register(.locations) {
            LocationsPage(model: model, onViewDrives: onViewDrives)
        }
        return registry
    }
}
