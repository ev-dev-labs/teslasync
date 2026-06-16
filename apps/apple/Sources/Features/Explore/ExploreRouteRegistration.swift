import SwiftUI

/// Registers the native Feature Hub for the `.explore` route so the app shell's route host renders
/// it. The web route `/explore` resolves to `.explore` through the canonical path segment
/// (`AppRoute.explore.pathSegment == "explore"`), so registering here makes the page reachable +
/// deep-linkable. Mirrors the sibling `*RouteRegistration` enums: the `@Observable` model is built on
/// the main actor here and captured, so the escaping registry closure never constructs an isolated
/// type. `onNavigate` lets a tapped feature card / recent chip / suggestion drive the shell selection.
public enum ExploreRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any ExploreDataSource = SampleExploreDataSource(),
        onNavigate: @escaping (AppRoute) -> Void = { _ in }
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = ExplorePageModel(dataSource: dataSource)
        registry.register(.explore) {
            ExplorePage(model: model, onNavigate: onNavigate)
        }
        return registry
    }
}
