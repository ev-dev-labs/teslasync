import SwiftUI

/// Registers the native Secret Rotation surface for the `.secretRotation` route so the
/// app shell's route host renders it (web `/admin/secret-rotation`). Mirrors
/// `SchemaDriftRouteRegistration` / `DiskForecastRouteRegistration`: the `@Observable`
/// model is built on the main actor here and captured, so the escaping registry closure
/// never constructs an isolated type.
///
/// The web route is the admin sub-path `/admin/secret-rotation`, which `AppRouteParser`
/// resolves to this dedicated route via a path alias (and the System-group sidebar
/// entry), keeping the page reachable + deep-linkable without displacing the sibling
/// Disk Forecast page that hosts on `.admin`.
public enum SecretRotationRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any SecretRotationDataSource = SampleSecretRotationDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = SecretRotationPageModel(dataSource: dataSource)
        registry.register(.secretRotation) {
            SecretRotationPage(model: model)
        }
        return registry
    }
}
