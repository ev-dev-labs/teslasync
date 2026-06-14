import SwiftUI

/// Registers the native API Keys surface for the `.apiKeys` route so the app shell's route
/// host renders it (web `/api-keys`). Mirrors `FeatureFlagsRouteRegistration` /
/// `AuditLogRouteRegistration`: the `@Observable` model is built on the main actor here and
/// captured, so the escaping registry closure never constructs an isolated type.
///
/// The web route `/api-keys` maps 1:1 to `AppRoute.apiKeys` (path segment `api-keys`), so
/// `AppRouteParser` resolves it directly without an alias — the page is reachable +
/// deep-linkable from the System sidebar group.
public enum APIKeysRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any APIKeysDataSource = SampleAPIKeysDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = APIKeysPageModel(dataSource: dataSource)
        registry.register(.apiKeys) {
            APIKeysPage(model: model)
        }
        return registry
    }
}
