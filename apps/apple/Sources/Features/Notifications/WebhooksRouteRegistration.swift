import SwiftUI

/// Registers the native Webhooks surface for the `.notificationsWebhooks` route so the app
/// shell's route host renders it (web `/notifications/webhooks`). Mirrors the sibling
/// `*RouteRegistration` enums: the `@Observable` model is built on the main actor here and
/// captured, so the escaping registry closure never constructs an isolated type.
///
/// `AppRouteParser` aliases `/notifications/webhooks` → `.notificationsWebhooks`, keeping the
/// page reachable + deep-linkable and surfacing it in the Operations sidebar group.
public enum WebhooksRouteRegistration {
    @MainActor
    public static func registry(base: AppRouteHostRegistry = AppRouteHostRegistry()) -> AppRouteHostRegistry {
        var registry = base
        let model = WebhooksPageModel()
        registry.register(.notificationsWebhooks) {
            WebhooksPage(model: model)
        }
        return registry
    }
}
