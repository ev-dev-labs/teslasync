import SwiftUI

/// Registers the native Statistics surface for the `.analytics` route so the app shell's route
/// host renders it. The web route `/statistics` resolves to `.analytics` through
/// `AppRouteParser.aliases` (`"/statistics": .analytics`), so registering here makes the page
/// reachable + deep-linkable without a new route case. Mirrors the sibling `*RouteRegistration`
/// enums: the `@Observable` model is built on the main actor here and captured, so the escaping
/// registry closure never constructs an isolated type.
public enum StatisticsRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any StatisticsDataSource = SampleStatisticsDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = StatisticsPageModel(dataSource: dataSource)
        registry.register(.analytics) {
            StatisticsPage(model: model)
        }
        return registry
    }
}
