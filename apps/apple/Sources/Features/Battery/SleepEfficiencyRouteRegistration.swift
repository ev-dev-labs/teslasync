import SwiftUI

/// Registers the native Sleep Efficiency surface for the `.sleepEfficiency` route so the
/// app shell's route host renders it. The web route `/sleep-efficiency` resolves to
/// `.sleepEfficiency` automatically through `AppRouteParser` (the route's `pathSegment` is
/// `sleep-efficiency`), so registering here makes the page reachable + deep-linkable.
/// Mirrors the sibling `*RouteRegistration` enums: the `@Observable` model is built on the
/// main actor here and captured, so the escaping registry closure never constructs an
/// isolated type.
public enum SleepEfficiencyRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any SleepEfficiencyDataSource = SampleSleepEfficiencyDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = SleepEfficiencyPageModel(dataSource: dataSource)
        registry.register(.sleepEfficiency) {
            SleepEfficiencyPage(model: model)
        }
        return registry
    }
}
