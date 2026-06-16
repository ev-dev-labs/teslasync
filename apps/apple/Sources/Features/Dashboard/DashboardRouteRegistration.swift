import SwiftUI

/// Registers the native Command Center for the `.dashboard` route so the app shell's route host
/// renders it (web `/`). The web root path `/` resolves to `.dashboard` automatically through
/// `AppRouteParser` (the `"/"` alias), so registering here makes the page reachable +
/// deep-linkable. Mirrors the sibling `*RouteRegistration` enums: the `@Observable` model is
/// built on the main actor here and captured, so the escaping registry closure never constructs
/// an isolated type. The widget drill-through, onboarding connect link, theme picker, and print
/// snapshot are wired to the shell via the injected hooks.
public enum DashboardRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any DashboardDataSource = SampleDashboardDataSource(),
        onNavigate: @escaping (AppRoute) -> Void = { _ in },
        onPrint: @escaping () -> Void = {},
        onOpenThemePicker: @escaping () -> Void = {}
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = DashboardPageModel(dataSource: dataSource)
        registry.register(.dashboard) {
            DashboardPage(
                model: model,
                onNavigate: onNavigate,
                onPrint: onPrint,
                onOpenThemePicker: onOpenThemePicker
            )
        }
        return registry
    }
}
