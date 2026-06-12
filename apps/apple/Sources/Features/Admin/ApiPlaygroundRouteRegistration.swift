import SwiftUI

/// Registers the native API Playground surface for the `.apiPlayground` route so the
/// app shell's route host renders it (web `/api-playground`). Mirrors
/// `SettingsRouteRegistration`: the `@Observable` model is built on the main actor here
/// and captured, so the escaping registry closure never constructs an isolated type.
public enum ApiPlaygroundRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        catalog: any ApiEndpointCatalogProviding = StaticApiEndpointCatalog()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = ApiPlaygroundPageModel(catalog: catalog)
        registry.register(.apiPlayground) {
            ApiPlaygroundPage(model: model)
        }
        return registry
    }
}
