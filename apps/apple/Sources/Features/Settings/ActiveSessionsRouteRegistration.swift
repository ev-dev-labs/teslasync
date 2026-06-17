import SwiftUI

/// Registers the native Active Sessions surface for the `.accountSessions` route so the
/// app shell's route host renders it (web `/account/sessions`). Mirrors
/// `ApiPlaygroundRouteRegistration` / `AuditLogRouteRegistration`: the `@Observable`
/// model is built on the main actor here and captured, so the escaping registry closure
/// never constructs an isolated type.
///
/// The web route lives under the new "Account" side-nav category; `AppRouteParser`
/// resolves the `/account/sessions` path to this dedicated route (and the Account-group
/// sidebar entry), keeping the page reachable + deep-linkable.
public enum ActiveSessionsRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any ActiveSessionsDataSource = SampleActiveSessionsDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = ActiveSessionsPageModel(dataSource: dataSource)
        registry.register(.accountSessions) {
            ActiveSessionsPage(model: model)
        }
        return registry
    }
}
