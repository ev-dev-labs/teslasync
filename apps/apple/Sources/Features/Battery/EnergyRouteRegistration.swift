import SwiftUI

/// Registers the native Energy surface for the `.energy` route so the app shell's route host
/// renders it. The web route `/energy` resolves to `.energy` automatically through
/// `AppRouteParser` (the route's `pathSegment` is `energy`, and `/battery` / `/battery/health`
/// alias onto it), so registering here makes the page reachable + deep-linkable. Mirrors the
/// sibling `*RouteRegistration` enums: the `@Observable` model is built on the main actor here
/// and captured, so the escaping registry closure never constructs an isolated type.
public enum EnergyRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any EnergyDataSource = SampleEnergyDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = EnergyPageModel(dataSource: dataSource)
        registry.register(.energy) {
            EnergyPage(model: model)
        }
        return registry
    }
}
