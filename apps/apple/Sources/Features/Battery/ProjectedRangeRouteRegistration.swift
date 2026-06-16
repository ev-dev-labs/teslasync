import SwiftUI

/// Registers the native Projected-Range surface for the `.projectedRange` route so the app shell's
/// route host renders it. The canonical path `/projected-range` resolves through `AppRouteParser`
/// (the route's `pathSegment` is `projected-range`), and the web alias `/analytics/range` is mapped
/// in `AppRouteParser.aliases`, so the page is reachable + deep-linkable from both. Mirrors the
/// sibling `*RouteRegistration` enums: the `@Observable` model is built on the main actor here and
/// captured, so the escaping registry closure never constructs an isolated type.
public enum ProjectedRangeRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any ProjectedRangeDataSource = SampleProjectedRangeDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = ProjectedRangePageModel(dataSource: dataSource)
        registry.register(.projectedRange) {
            ProjectedRangePage(model: model)
        }
        return registry
    }
}
