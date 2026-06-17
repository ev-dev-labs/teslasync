import SwiftUI

/// Registers the native System Diagnostic page. The web page is unrouted (admin-only, typically
/// accessed via DevTools menu); this registration pattern maintains consistency with sibling
/// features but the route is not exposed in the main navigation. The `@Observable` model is built
/// on the main actor here and captured, so the escaping registry closure never constructs an
/// isolated type.
public enum DiagnosticRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any DiagnosticDataSource = SampleDiagnosticDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = DiagnosticPageModel(dataSource: dataSource)
        // Note: .systemDiagnostic route would be added to AppRoute if this becomes routable
        // For now, this can be presented modally from admin/devtools menus
        registry.register(.admin) { // To be adjusted when route is added to AppRoute
            DiagnosticPage(model: model)
        }
        return registry
    }
}
