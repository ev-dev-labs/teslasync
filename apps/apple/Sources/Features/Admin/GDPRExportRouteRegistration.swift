import SwiftUI

/// Registers the native GDPR Export surface so the app shell's route host renders it
/// (web `/admin/gdpr-exports`). Mirrors `DiskForecastRouteRegistration` /
/// `AuditLogRouteRegistration`: the `@Observable` model is built on the main actor here
/// and captured, so the escaping registry closure never constructs an isolated type.
///
/// The page binds to the dedicated `.gdprExport` route (`AppRouteParser` also aliases
/// the web sub-path `/admin/gdpr-exports` to it, mirroring `/admin/audit-log` →
/// `.auditLog`). The model is seeded with the sample artifact id so the populated state
/// renders out of the box until the KMP-backed `GDPRExportDataSource` is injected at
/// composition time.
public enum GDPRExportRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any GDPRExportDataSource = SampleGDPRExportDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = GDPRExportPageModel(
            dataSource: dataSource,
            initialID: SampleGDPRExportDataSource.sampleID
        )
        registry.register(.gdprExport) {
            GDPRExportPage(model: model)
        }
        return registry
    }
}
