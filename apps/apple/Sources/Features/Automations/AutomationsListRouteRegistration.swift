import SwiftUI

/// Registers the native Automations hub for the `.automations` route so the app shell's route
/// host renders it (web `/automations`, reachable directly via the route's `pathSegment`).
/// Mirrors the sibling `*RouteRegistration` enums: the `@Observable` model is built on the main
/// actor here and captured, so the escaping registry closure never constructs an isolated type.
///
/// The web header "Create" action navigates to the typed automation builder
/// (`/automations/new`); that builder is a separate parity unit, so this exposes the navigation
/// as the injected `onCreate` shell hook (default = no-op) rather than reaching into it here.
public enum AutomationsListRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any AutomationsListDataSource = SampleAutomationsListDataSource(),
        onCreate: @escaping () -> Void = {}
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = AutomationsListPageModel(dataSource: dataSource)
        registry.register(.automations) {
            AutomationsListPage(model: model, onCreate: onCreate)
        }
        return registry
    }
}
