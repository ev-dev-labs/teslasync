import SwiftUI

/// Registers the native API Logs surface for the `.apiLogs` route so the app shell's route
/// host renders it (web `/api-logs`). Mirrors `AuditLogRouteRegistration` /
/// `ApiPlaygroundRouteRegistration`: the `@Observable` model is built on the main actor here
/// and captured, so the escaping registry closure never constructs an isolated type.
///
/// The web route is the top-level `/api-logs`; `AppRouteParser` resolves it directly via the
/// `.apiLogs` path segment (and the `/admin/api-logs` alias), keeping the page reachable +
/// deep-linkable alongside the sibling admin pages in the System sidebar group.
public enum ApiLogsRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any ApiLogsDataSource = SampleApiLogsDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = ApiLogsPageModel(dataSource: dataSource)
        registry.register(.apiLogs) {
            ApiLogsPage(model: model)
        }
        return registry
    }
}
