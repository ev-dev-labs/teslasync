import SwiftUI

/// Registers the native Notifications Audit Log surface for the `.notificationsAudit` route so
/// the app shell's route host renders it (web `/notifications/audit`). Mirrors the sibling
/// `*RouteRegistration` enums: the `@Observable` model is built on the main actor here and
/// captured, so the escaping registry closure never constructs an isolated type.
///
/// `AppRouteParser` aliases `/notifications/audit` → `.notificationsAudit`, keeping the page
/// reachable + deep-linkable and surfacing it in the Operations sidebar group.
public enum NotificationsAuditLogRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any NotificationsAuditLogDataSource = SampleNotificationsAuditLogDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = NotificationsAuditLogPageModel(dataSource: dataSource)
        registry.register(.notificationsAudit) {
            NotificationsAuditLogPage(model: model)
        }
        return registry
    }
}
