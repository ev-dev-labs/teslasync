import SwiftUI

/// Registers the native Slow Queries surface for the `.slowQueries` route so the app
/// shell's route host renders it (web `/admin/slow-queries`). Mirrors
/// `SchemaDriftRouteRegistration` / `DiskForecastRouteRegistration`: the `@Observable`
/// model is built on the main actor here and captured, so the escaping registry closure
/// never constructs an isolated type.
///
/// The web route is the admin sub-path `/admin/slow-queries`, which `AppRouteParser`
/// resolves to this dedicated route via a path alias (and the System-group sidebar
/// entry), keeping the page reachable + deep-linkable without displacing the sibling Disk
/// Forecast page that hosts on `.admin`.
public enum SlowQueriesRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any SlowQueriesDataSource = SampleSlowQueriesDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = SlowQueriesPageModel(dataSource: dataSource)
        registry.register(.slowQueries) {
            SlowQueriesPage(model: model)
        }
        return registry
    }
}
