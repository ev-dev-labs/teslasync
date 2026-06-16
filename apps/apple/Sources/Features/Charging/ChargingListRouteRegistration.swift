import SwiftUI

/// Registers the native Charging Sessions list for the `.charging` route so the app shell's
/// route host renders it. The web route `/charging` resolves to `.charging` automatically
/// through `AppRouteParser` (the route's `pathSegment` is `charging`), so registering here
/// makes the page reachable + deep-linkable, and `.charging` is one of the primary tabs.
/// Mirrors the sibling `*RouteRegistration` enums: the `@Observable` model is built on the
/// main actor here and captured, so the escaping registry closure never constructs an
/// isolated type.
public enum ChargingListRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any ChargingListDataSource = SampleChargingListDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = ChargingListPageModel(dataSource: dataSource)
        registry.register(.charging) {
            ChargingListPage(model: model)
        }
        return registry
    }
}
