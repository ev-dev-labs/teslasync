import SwiftUI

/// Registers the native Quick Glance surface for the `.glance` route so the app shell's
/// route host renders it (web `/glance`). The web route `/glance` resolves to `.glance`
/// automatically through `AppRouteParser` (the route's `pathSegment` is `glance`), so
/// registering here makes the page reachable + deep-linkable. Mirrors the sibling
/// `*RouteRegistration` enums: the `@Observable` model is built on the main actor here and
/// captured, so the escaping registry closure never constructs an isolated type. The web
/// "Open full app" link is wired to the shell via the injected `onOpenApp` hook.
public enum GlanceRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any GlanceDataSource = SampleGlanceDataSource(),
        onOpenApp: @escaping () -> Void = {}
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = GlancePageModel(dataSource: dataSource)
        registry.register(.glance) {
            GlancePage(model: model, onOpenApp: onOpenApp)
        }
        return registry
    }
}
