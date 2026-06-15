import SwiftUI

/// Registers the native Lifetime Stats surface for the `.lifetimeStats` route so the app shell's
/// route host renders it. The web route `/lifetime-stats` resolves to `.lifetimeStats`
/// automatically through `AppRouteParser` (the route's `pathSegment` is `lifetime-stats`), so
/// registering here makes the page reachable + deep-linkable from the Insights group. Mirrors the
/// sibling analytics `*RouteRegistration` enums: the `@Observable` model is built on the main actor
/// here and captured, so the escaping registry closure never constructs an isolated type.
public enum LifetimeStatsRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any LifetimeStatsDataSource = SampleLifetimeStatsDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = LifetimeStatsPageModel(dataSource: dataSource)
        registry.register(.lifetimeStats) {
            LifetimeStatsPage(model: model)
        }
        return registry
    }
}
