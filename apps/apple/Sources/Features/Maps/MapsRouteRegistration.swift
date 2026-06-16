import SwiftUI

/// Registers the native Map Overview screen for the `.maps` route so the app shell's route host
/// renders it. The web route `/live` resolves to `.maps` (the route's `pathSegment` is `maps`),
/// making the page reachable + deep-linkable, and `.maps` is the `vehicle`-group map entry.
/// Mirrors the sibling `*RouteRegistration` enums: the `@Observable` model is built on the main
/// actor here and captured, so the escaping registry closure never constructs an isolated type.
/// `onQuickLink` lets the host route the quick-links panel to the sibling maps sub-page parity
/// units (navigation-route / geofences / locations).
public enum MapsRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any MapOverviewDataSource = SampleMapOverviewDataSource(),
        onQuickLink: @escaping (MapOverviewQuickLink) -> Void = { _ in }
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = MapOverviewPageModel(dataSource: dataSource)
        registry.register(.maps) {
            MapOverviewPage(model: model, onQuickLink: onQuickLink)
        }
        return registry
    }
}
