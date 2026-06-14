import SwiftUI

/// Registers the native Feature Flags surface for the `.featureFlags` route so the app
/// shell's route host renders it (web `/admin/flags`). Mirrors
/// `AuditLogRouteRegistration` / `SchemaDriftRouteRegistration`: the `@Observable` model
/// is built on the main actor here and captured, so the escaping registry closure never
/// constructs an isolated type.
///
/// The web route is the admin sub-path `/admin/flags`, which `AppRouteParser` resolves to
/// this dedicated route via a path alias (and the System-group sidebar entry), keeping the
/// page reachable + deep-linkable without displacing the sibling admin pages.
public enum FeatureFlagsRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any FeatureFlagsDataSource = SampleFeatureFlagsDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = FeatureFlagsPageModel(dataSource: dataSource)
        registry.register(.featureFlags) {
            FeatureFlagsPage(model: model)
        }
        return registry
    }
}
