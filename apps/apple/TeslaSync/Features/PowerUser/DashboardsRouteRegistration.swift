import SwiftUI

/// Registers the native Dashboard Composer surface for the `.powerDashboards` route so the app
/// shell's route host renders it (web `/power/dashboards`). Mirrors the sibling
/// `*RouteRegistration` enums: the `@Observable` model is built on the main actor here and
/// captured, so the escaping registry closure never constructs an isolated type.
///
/// `AppRouteParser` aliases `/power/dashboards` → `.powerDashboards`, keeping the page reachable +
/// deep-linkable and surfacing it in the System (power-user tools) sidebar group.
public enum DashboardsRouteRegistration {
    @MainActor
    public static func registry(base: AppRouteHostRegistry = AppRouteHostRegistry()) -> AppRouteHostRegistry {
        var registry = base
        let model = DashboardsPageModel()
        registry.register(.powerDashboards) {
            DashboardsPage(model: model)
        }
        return registry
    }
}
