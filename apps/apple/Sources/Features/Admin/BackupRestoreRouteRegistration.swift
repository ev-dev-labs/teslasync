import SwiftUI

/// Registers the native Backup & Restore surface for the `.backupRestore` route so the app
/// shell's route host renders it (web `/backup`). Mirrors `FeatureFlagsRouteRegistration` /
/// `AuditLogRouteRegistration`: the `@Observable` model is built on the main actor here and
/// captured, so the escaping registry closure never constructs an isolated type.
///
/// The web route is the top-level `/backup`, which `AppRouteParser` resolves to this
/// dedicated route via its canonical path segment ("backup"), keeping the page reachable +
/// deep-linkable without displacing the sibling admin pages.
public enum BackupRestoreRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any BackupRestoreDataSource = SampleBackupRestoreDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = BackupRestorePageModel(dataSource: dataSource)
        registry.register(.backupRestore) {
            BackupRestorePage(model: model)
        }
        return registry
    }
}
