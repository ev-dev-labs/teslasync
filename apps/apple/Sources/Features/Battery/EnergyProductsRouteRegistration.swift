import SwiftUI

/// Registers the native Energy Products surface for the `.energyProducts` route so the app shell's
/// route host renders it. The web route `/energy-products` resolves to `.energyProducts`
/// automatically through `AppRouteParser` (the route's `pathSegment` is `energy-products`), so
/// registering here makes the page reachable + deep-linkable. Mirrors the sibling
/// `*RouteRegistration` enums: the `@Observable` model is built on the main actor here and
/// captured, so the escaping registry closure never constructs an isolated type.
public enum EnergyProductsRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any EnergyProductsDataSource = SampleEnergyProductsDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = EnergyProductsPageModel(dataSource: dataSource)
        registry.register(.energyProducts) {
            EnergyProductsPage(model: model)
        }
        return registry
    }
}
