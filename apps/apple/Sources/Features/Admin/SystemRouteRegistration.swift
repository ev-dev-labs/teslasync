import SwiftUI

/// Registers the native System budgets surface for the `.system` route so the app
/// shell's route host renders it (web `SystemPage`, `SYSTEM_PAGE_PATH = /admin/system`,
/// which `AppRouteParser` resolves via the `/system` segment + the `/admin/system`
/// alias). Mirrors the peer admin route registrations: the `@Observable` model is
/// built on the main actor here and captured, so the escaping registry closure never
/// constructs an isolated type.
public enum SystemRouteRegistration {
    @MainActor
    public static func registry(base: AppRouteHostRegistry = AppRouteHostRegistry()) -> AppRouteHostRegistry {
        var registry = base
        let model = SystemPageModel()
        registry.register(.system) {
            SystemPage(model: model)
        }
        return registry
    }
}
