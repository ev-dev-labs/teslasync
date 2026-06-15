import SwiftUI

/// Registers the native Developer Tools surface for the `.devTools` route so the app
/// shell's route host renders it (web `/dev-tools`). Mirrors the peer admin route
/// registrations: the `@Observable` model is built on the main actor here and captured,
/// so the escaping registry closure never constructs an isolated type.
public enum DevToolsRouteRegistration {
    @MainActor
    public static func registry(base: AppRouteHostRegistry = AppRouteHostRegistry()) -> AppRouteHostRegistry {
        var registry = base
        let model = DevToolsPageModel()
        registry.register(.devTools) {
            DevToolsPage(model: model)
        }
        return registry
    }
}
