import SwiftUI

/// Registers the native first-run Onboarding page for the `.onboarding` route so the app shell's
/// route host renders it (web `/onboarding`) and it is reachable as a deep link. Mirrors the
/// sibling `*RouteRegistration` enums: the `@Observable` model is built on the main actor here and
/// captured, so the escaping registry closure never constructs an isolated type. The checklist's
/// route pushes (the Tesla-account step + the "Tesla account page" help link → Settings, the
/// skip/continue → dashboard) are wired to the shell via the injected `onNavigate` hook.
public enum OnboardingRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any OnboardingDataSource = SampleOnboardingDataSource(),
        onNavigate: @escaping (AppRoute) -> Void = { _ in }
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = OnboardingPageModel(dataSource: dataSource)
        registry.register(.onboarding) {
            OnboardingPage(model: model, onNavigate: onNavigate)
        }
        return registry
    }
}
