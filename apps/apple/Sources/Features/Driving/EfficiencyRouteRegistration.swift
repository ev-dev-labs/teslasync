import SwiftUI

/// Registers the native Efficiency surface for the `.efficiency` route so the app shell's route host
/// renders it. The web route `/efficiency` resolves to `.efficiency` directly through the canonical
/// path segment (`AppRoute.efficiency.pathSegment == "efficiency"`), so registering here makes the page
/// reachable + deep-linkable. Mirrors the sibling `*RouteRegistration` enums: the `@Observable` model is
/// built on the main actor here and captured, so the escaping registry closure never constructs an
/// isolated type.
public enum EfficiencyRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any EfficiencyDataSource = SampleEfficiencyDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = EfficiencyPageModel(dataSource: dataSource)
        registry.register(.efficiency) {
            EfficiencyPage(model: model)
        }
        return registry
    }
}
