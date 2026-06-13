import SwiftUI

/// Registers the native Battery Cells surface for the `.batteryCells` route so the
/// app shell's route host renders it. The web route `/battery-cells` resolves to
/// `.batteryCells` automatically through `AppRouteParser` (the route's
/// `pathSegment` is `battery-cells`), so registering here makes the page reachable
/// + deep-linkable. Mirrors the sibling `*RouteRegistration` enums: the
/// `@Observable` model is built on the main actor here and captured, so the
/// escaping registry closure never constructs an isolated type.
public enum BatteryCellsRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any BatteryCellsDataSource = SampleBatteryCellsDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = BatteryCellsPageModel(dataSource: dataSource)
        registry.register(.batteryCells) {
            BatteryCellsPage(model: model)
        }
        return registry
    }
}
