import SwiftUI

/// Registers the native Security & Access surface for the `.securityAccess` route so the
/// app shell's route host renders it (web `SecurityAccessPage`, route `/security-access`,
/// which `AppRouteParser` resolves via the `security-access` segment + the
/// `/admin/security-access` alias). Mirrors the peer admin route registrations: the
/// `@Observable` model is built on the main actor here and captured, so the escaping
/// registry closure never constructs an isolated type. The model defaults to the sample
/// security source; production injects the live KMP-backed `SecurityAccessDataSource`.
public enum SecurityAccessRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any SecurityAccessDataSource = SampleSecurityAccessDataSource()
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = SecurityAccessPageModel(dataSource: dataSource)
        registry.register(.securityAccess) {
            SecurityAccessPage(model: model)
        }
        return registry
    }
}
