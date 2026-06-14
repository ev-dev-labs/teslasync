import SwiftUI

/// Registers the native Battery Degradation surface for the `.batteryDegradation` route
/// so the app shell's route host renders it. The web route `/battery-degradation`
/// resolves to `.batteryDegradation` automatically through `AppRouteParser` (the
/// route's `pathSegment` is `battery-degradation`), so registering here makes the page
/// reachable + deep-linkable. Mirrors the sibling `*RouteRegistration` enums: the
/// `@Observable` model is built on the main actor here and captured, so the escaping
/// registry closure never constructs an isolated type.
public enum BatteryDegradationRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any BatteryDegradationDataSource = SampleBatteryDegradationDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = BatteryDegradationPageModel(dataSource: dataSource)
        registry.register(.batteryDegradation) {
            BatteryDegradationPage(model: model)
        }
        return registry
    }
}
