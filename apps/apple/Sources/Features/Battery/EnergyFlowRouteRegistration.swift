import SwiftUI

/// Registers the native Energy-Flow surface for the `.energyFlow` route so the app shell's route
/// host renders it. The web route `/energy-flow` resolves to `.energyFlow` automatically through
/// `AppRouteParser` (the route's `pathSegment` is `energy-flow`), so registering here makes the
/// page reachable + deep-linkable. Mirrors the sibling `*RouteRegistration` enums: the
/// `@Observable` model is built on the main actor here and captured, so the escaping registry
/// closure never constructs an isolated type.
public enum EnergyFlowRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any EnergyFlowDataSource = SampleEnergyFlowDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = EnergyFlowPageModel(dataSource: dataSource)
        registry.register(.energyFlow) {
            EnergyFlowPage(model: model)
        }
        return registry
    }
}
