import SwiftUI

/// Registers the native Exports surface for the `.exports` route so the app shell's route
/// host renders it (web `/exports`). Mirrors `GDPRExportRouteRegistration` /
/// `AuditLogRouteRegistration`: the `@Observable` model is built on the main actor here
/// and captured, so the escaping registry closure never constructs an isolated type.
///
/// The page binds to the dedicated `.exports` route. `AppRouteParser` already resolves the
/// `/exports` path to it via the route's `pathSegment`, and the Operations-group sidebar
/// entry keeps it reachable + deep-linkable. The model is seeded with the sample data
/// source so the populated state renders out of the box until the KMP-backed
/// `ExportsDataSource` is injected at composition time.
public enum ExportsRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any ExportsDataSource = SampleExportsDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = ExportsPageModel(dataSource: dataSource)
        registry.register(.exports) {
            ExportsPage(model: model)
        }
        return registry
    }
}
