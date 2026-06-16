import SwiftUI

/// Registers the native Quick Stats surface for the `.quickStats` route so the app shell's route
/// host renders it (web `/quick-stats`). The web route `/quick-stats` resolves to `.quickStats`
/// automatically through `AppRouteParser` (the route's `pathSegment` is `quick-stats`), so
/// registering here makes the page reachable + deep-linkable. Mirrors the sibling
/// `*RouteRegistration` enums: the `@Observable` model is built on the main actor here and captured,
/// so the escaping registry closure never constructs an isolated type. The web footer "Open
/// Dashboard" link is wired to the shell via the injected `onOpenDashboard` hook.
public enum QuickStatsRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any QuickStatsPageDataSource = SampleQuickStatsPageDataSource(),
        onOpenDashboard: @escaping () -> Void = {}
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = QuickStatsPageModel(dataSource: dataSource)
        registry.register(.quickStats) {
            QuickStatsPage(model: model, onOpenDashboard: onOpenDashboard)
        }
        return registry
    }
}
