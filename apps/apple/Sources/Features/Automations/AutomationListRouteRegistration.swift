import SwiftUI

/// Registers the native Automations bulk list for the `.automationsList` route so the app shell's
/// route host renders it (web `/automations/list`, reachable via its `pathSegment` and the
/// `/automations/list` deep-link alias). Mirrors the sibling `*RouteRegistration` enums: the
/// `@Observable` model is built on the main actor here and captured, so the escaping registry
/// closure never constructs an isolated type.
///
/// The web name link navigates to the automation editor (`/automations/{id}`) and the empty-state
/// CTA to the builder (`/automations/new`); both are separate parity units, so this surfaces them
/// as the injected `onNavigate` shell hook (default = no-op) — sending the user to the `.automations`
/// hub that owns those builder routes — rather than reaching into them here.
public enum AutomationListRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        dataSource: any AutomationListDataSource = SampleAutomationListDataSource(),
        onNavigate: @escaping (AppRoute) -> Void = { _ in }
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = AutomationListPageModel(dataSource: dataSource)
        registry.register(.automationsList) {
            AutomationListPage(
                model: model,
                onOpenBuilder: { onNavigate(.automations) },
                onOpenAutomation: { _ in onNavigate(.automations) }
            )
        }
        return registry
    }
}
