import SwiftUI

/// Registers the native Audit Log surface for the `.auditLog` route so the app shell's
/// route host renders it (web `/admin/audit-log`). Mirrors `SchemaDriftRouteRegistration`
/// / `DiskForecastRouteRegistration`: the `@Observable` model is built on the main actor
/// here and captured, so the escaping registry closure never constructs an isolated type.
///
/// The web route is the admin sub-path `/admin/audit-log`, which `AppRouteParser`
/// resolves to this dedicated route via a path alias (and the System-group sidebar
/// entry), keeping the page reachable + deep-linkable without displacing the sibling
/// admin pages.
public enum AuditLogRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any AuditLogDataSource = SampleAuditLogDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = AuditLogPageModel(dataSource: dataSource)
        registry.register(.auditLog) {
            AuditLogPage(model: model)
        }
        return registry
    }
}
