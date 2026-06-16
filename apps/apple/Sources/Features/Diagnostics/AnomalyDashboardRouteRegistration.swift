import SwiftUI

/// Registers the native Anomaly Detection surface for the `.diagnostics` route so the app shell's
/// route host renders it. The web page lives at `/analytics/anomalies` (aliased from
/// `/anomaly-detection`); both paths resolve to `.diagnostics` through `AppRouteParser.aliases`, so
/// registering here makes the page reachable + deep-linkable without a new route case. Mirrors the
/// sibling `*RouteRegistration` enums: the `@Observable` model is built on the main actor here and
/// captured, so the escaping registry closure never constructs an isolated type.
public enum AnomalyDashboardRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any AnomalyDashboardDataSource = SampleAnomalyDashboardDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = AnomalyDashboardPageModel(dataSource: dataSource)
        registry.register(.diagnostics) {
            AnomalyDashboardPage(model: model)
        }
        return registry
    }
}
