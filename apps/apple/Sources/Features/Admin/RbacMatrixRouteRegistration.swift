import SwiftUI

/// Registers the native RBAC matrix surface for the `.rbacMatrix` route so the app shell's
/// route host renders it. Mirrors `FeatureFlagsRouteRegistration` / `AuditLogRouteRegistration`:
/// the `@Observable` model is built on the main actor here and captured, so the escaping
/// registry closure never constructs an isolated type.
///
/// The web page is `(unrouted)` (reached only via the admin nav tree), so `AppRouteParser`
/// maps the conventional admin sub-path `/admin/rbac` to this dedicated route (System-group
/// sidebar entry), keeping the page reachable + deep-linkable without displacing other admin
/// pages.
public enum RbacMatrixRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any RbacMatrixDataSource = SampleRbacMatrixDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = RbacMatrixPageModel(dataSource: dataSource)
        registry.register(.rbacMatrix) {
            RbacMatrixPage(model: model)
        }
        return registry
    }
}
