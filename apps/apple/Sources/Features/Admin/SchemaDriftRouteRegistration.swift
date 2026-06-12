import SwiftUI

/// Registers the native Schema Drift surface for the `.schemaDrift` route so the app
/// shell's route host renders it (web `/admin/schema-drift`). Mirrors
/// `DiskForecastRouteRegistration` / `FleetTelemetryCoverageRouteRegistration`: the
/// `@Observable` model is built on the main actor here and captured, so the escaping
/// registry closure never constructs an isolated type.
///
/// The web route is the admin sub-path `/admin/schema-drift`, which `AppRouteParser`
/// resolves to this dedicated route via a path alias (and the System-group sidebar
/// entry), keeping the page reachable + deep-linkable without displacing the sibling
/// Disk Forecast page that hosts on `.admin`.
public enum SchemaDriftRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any SchemaDriftDataSource = SampleSchemaDriftDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = SchemaDriftPageModel(dataSource: dataSource)
        registry.register(.schemaDrift) {
            SchemaDriftPage(model: model)
        }
        return registry
    }
}
