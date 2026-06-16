import SwiftUI

/// Registers the native Charging Patterns surface for the `.chargingHeatmap` route so the app
/// shell's route host renders it. The web route `/charging-heatmap` resolves to
/// `.chargingHeatmap` automatically through `AppRouteParser` (the route's `pathSegment` is
/// `charging-heatmap`), so registering here makes the page reachable + deep-linkable. Mirrors
/// the sibling `*RouteRegistration` enums: the `@Observable` model is built on the main actor
/// here and captured, so the escaping registry closure never constructs an isolated type.
public enum ChargingHeatmapRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any ChargingHeatmapDataSource = SampleChargingHeatmapDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = ChargingHeatmapPageModel(dataSource: dataSource)
        registry.register(.chargingHeatmap) {
            ChargingHeatmapPage(model: model)
        }
        return registry
    }
}
