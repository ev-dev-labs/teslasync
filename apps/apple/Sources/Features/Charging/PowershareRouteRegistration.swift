import SwiftUI

/// Registers the native Powershare surface for the `.powershare` route so the app shell's
/// route host renders it. The web route `/powershare` resolves to `.powershare`
/// automatically through `AppRouteParser` (the route's `pathSegment` is `powershare`), so
/// registering here makes the page reachable + deep-linkable. Mirrors the sibling
/// `*RouteRegistration` enums: the `@Observable` model is built on the main actor here and
/// captured, so the escaping registry closure never constructs an isolated type.
public enum PowershareRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any PowershareDataSource = SamplePowershareDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = PowersharePageModel(dataSource: dataSource)
        registry.register(.powershare) {
            PowersharePage(model: model)
        }
        return registry
    }
}
