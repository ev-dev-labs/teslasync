import SwiftUI

/// Registers the native Battery Health surface for the `.batteryHealth` route so the app
/// shell's route host renders it. The web route `/battery` (and the `/battery/health` alias)
/// resolves to `.batteryHealth` through `AppRouteParser` (the route's `pathSegment` is
/// `battery`), so registering here makes the page reachable + deep-linkable. Mirrors the
/// sibling `*RouteRegistration` enums: the `@Observable` model is built on the main actor here
/// and captured, so the escaping registry closure never constructs an isolated type. The
/// `onNavigate` callback threads the quick-links navigation up to the app's route selection.
public enum BatteryHealthRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any BatteryHealthDataSource = SampleBatteryHealthDataSource(),
        onNavigate: @escaping (AppRoute) -> Void = { _ in }
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = BatteryHealthPageModel(dataSource: dataSource)
        registry.register(.batteryHealth) {
            BatteryHealthPage(model: model, onNavigate: onNavigate)
        }
        return registry
    }
}
