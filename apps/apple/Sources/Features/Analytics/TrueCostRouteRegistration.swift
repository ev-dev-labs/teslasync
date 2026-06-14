import SwiftUI

/// Registers the native True Cost of Ownership surface for the `.tco` route so the app shell's
/// route host renders it. The web routes `/analytics/tco` and `/tco` resolve to `.tco` through
/// `AppRouteParser.aliases`, so registering here makes the page reachable + deep-linkable. Mirrors
/// the sibling analytics `*RouteRegistration` enums: the `@Observable` model is built on the main
/// actor here and captured, so the escaping registry closure never constructs an isolated type.
public enum TrueCostRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any TrueCostDataSource = SampleTrueCostDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = TrueCostPageModel(dataSource: dataSource)
        registry.register(.tco) {
            TrueCostPage(model: model)
        }
        return registry
    }
}
