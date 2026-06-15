import SwiftUI

/// Registers the native Ingest X-Ray surface for the `.ingestXRay` route so the app shell's route
/// host renders it (web `/admin/ingest-xray`). Mirrors `DLQInspectorRouteRegistration` /
/// `FeatureFlagsRouteRegistration`: the `@Observable` model is built on the main actor here and
/// captured, so the escaping registry closure never constructs an isolated type.
///
/// `AppRouteParser` resolves the web admin sub-path `/admin/ingest-xray` to this dedicated route
/// via a path alias, keeping the page reachable + deep-linkable alongside its sibling admin pages.
public enum IngestXRayRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any IngestXRayDataSource = SampleIngestXRayDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = IngestXRayPageModel(dataSource: dataSource)
        registry.register(.ingestXRay) {
            IngestXRayPage(model: model)
        }
        return registry
    }
}
