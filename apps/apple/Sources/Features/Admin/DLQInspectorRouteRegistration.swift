import SwiftUI

/// Registers the native DLQ Inspector surface for the `.dlqInspector` route so the app
/// shell's route host renders it (web `/admin/dlq`). Mirrors `FeatureFlagsRouteRegistration`
/// / `AuditLogRouteRegistration`: the `@Observable` model is built on the main actor here
/// and captured, so the escaping registry closure never constructs an isolated type.
///
/// The web route is the admin sub-path `/admin/dlq`, which `AppRouteParser` resolves to this
/// dedicated route via a path alias (and the System-group sidebar entry), keeping the page
/// reachable + deep-linkable without displacing the sibling admin pages.
public enum DLQInspectorRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any DLQInspectorDataSource = SampleDLQInspectorDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = DLQInspectorPageModel(dataSource: dataSource)
        registry.register(.dlqInspector) {
            DLQInspectorPage(model: model)
        }
        return registry
    }
}
