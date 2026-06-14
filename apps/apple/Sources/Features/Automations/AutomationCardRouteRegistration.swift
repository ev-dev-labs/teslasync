import SwiftUI

/// Navigation registration for the **unrouted** `AutomationCard` parity unit.
///
/// The web source is `(unrouted)` — it is a card the `/automations` page (`AutomationsList`, which
/// owns the `.automations` route) renders inline, not a standalone route. So rather than claim a
/// top-level `AppRoute`, this exposes the screen as a typed `NavigationDestination` (a deep-link
/// value) any `NavigationStack` can host: the `AutomationsList` route adopts
/// `.automationCardDestination()` and pushes an `AutomationCardLink` to surface a single
/// automation full-screen. The model is built by the seam's provider (default = local state),
/// keeping the escaping destination closure free of business logic.
public struct AutomationCardLink: Hashable, Sendable {
    public init() {}
}

public extension View {
    /// Registers the `AutomationCard` screen as a `NavigationDestination` for an
    /// `AutomationCardLink` value, so any host stack can deep-link into it.
    func automationCardDestination(
        provider: @escaping @Sendable () -> any AutomationCardProviding = { DefaultAutomationCard() }
    ) -> some View {
        navigationDestination(for: AutomationCardLink.self) { _ in
            AutomationCardPage(model: AutomationCardPageModel(provider: provider()))
        }
    }
}

/// Factory namespace mirroring the routed pages' `…RouteRegistration` shape, for hosts that want a
/// ready-built screen (e.g., the macOS detail column) without constructing the model.
public enum AutomationCardRouteRegistration {
    /// Builds the screen with the given snapshot provider (default = local state).
    @MainActor
    public static func make(
        provider: any AutomationCardProviding = DefaultAutomationCard()
    ) -> AutomationCardPage {
        AutomationCardPage(model: AutomationCardPageModel(provider: provider))
    }
}
