import SwiftUI

/// Registers the native Subjects (admin impersonation) surface for the `.users` route so the app
/// shell's route host renders it. Mirrors `SlowQueriesRouteRegistration` /
/// `TeslaOrdersRouteRegistration`: the `@Observable` `UsersPageModel` is built on the main actor
/// here and captured, so the escaping registry closure never constructs an isolated type.
///
/// The web `UsersPage` ships intentionally `(unrouted)` (its route registration is a
/// security-sensitive file the web change deliberately avoided). The native surface still needs a
/// real navigation home, so it maps to the dedicated `.users` `AppRoute` — reachable from the
/// System-group sidebar / "More" list / command palette and deep-linkable via `/users` and the
/// `/admin/users` alias `AppRouteParser` resolves.
///
/// The bound model defaults to a representative local sample (mirroring the sibling Tesla Orders /
/// Slow Queries defaults) so the page renders its populated, actionable state out of the box. It is
/// NOT production telemetry: production composition injects seams over the shared KMP
/// `ImpersonationStore` (web `useImpersonationStatus` + `useImpersonationCandidates`).
public enum UsersRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        model: UsersPageModel? = nil
    ) -> AppRouteHostRegistry {
        var registry = base
        let pageModel = model ?? UsersPageModel.sample()
        registry.register(.users) {
            UsersPage(model: pageModel)
        }
        return registry
    }
}
