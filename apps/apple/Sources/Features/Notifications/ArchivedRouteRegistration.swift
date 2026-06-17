import SwiftUI

/// Registers the native Archived Notifications surface for the `.notificationsArchived` route so
/// the app shell's route host renders it (web `/notifications/archived`). Mirrors the sibling
/// `*RouteRegistration` enums: the `@Observable` model is built on the main actor here and
/// captured, so the escaping registry closure never constructs an isolated type. `onNavigate`
/// drives the page's "Back to inbox" affordance through the shell selection (web `<Link>`).
///
/// `AppRouteParser` aliases `/notifications/archived` → `.notificationsArchived`, keeping the
/// page reachable + deep-linkable and surfacing it in the Operations sidebar group.
public enum ArchivedRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        onNavigate: @escaping (AppRoute) -> Void = { _ in }
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = ArchivedPageModel()
        registry.register(.notificationsArchived) {
            ArchivedPage(model: model, onNavigate: onNavigate)
        }
        return registry
    }
}
