import SwiftUI

/// Navigation registration for the **unrouted** `AutomationActivityFeed` parity unit.
///
/// The web source is `(unrouted)` — it is a section the `/automations` page (`AutomationsList`,
/// which owns the `.automations` route) renders inline, not a standalone route. So rather than
/// claim a top-level `AppRoute`, this exposes the screen as a typed `NavigationDestination`
/// (a deep-link value) any `NavigationStack` can host: the `AutomationsList` route adopts
/// `.automationActivityFeedDestination()` and pushes an `AutomationActivityFeedLink` to surface
/// the full-screen activity feed. The model is built by the seam's provider (default = local
/// state), keeping the escaping destination closure free of business logic.
public struct AutomationActivityFeedLink: Hashable, Sendable {
    public init() {}
}

public extension View {
    /// Registers the `AutomationActivityFeed` screen as a `NavigationDestination` for an
    /// `AutomationActivityFeedLink` value, so any host stack can deep-link into it.
    func automationActivityFeedDestination(
        provider: @escaping @Sendable () -> AutomationActivityFeedProviding = { DefaultAutomationActivityFeed() }
    ) -> some View {
        navigationDestination(for: AutomationActivityFeedLink.self) { _ in
            AutomationActivityFeedPage(model: AutomationActivityFeedPageModel(provider: provider()))
        }
    }
}

/// Factory namespace mirroring the routed pages' `…RouteRegistration` shape, for hosts that
/// want a ready-built screen (e.g., the macOS detail column) without constructing the model.
public enum AutomationActivityFeedRouteRegistration {
    /// Builds the screen with the given snapshot provider (default = local state).
    @MainActor
    public static func make(
        provider: any AutomationActivityFeedProviding = DefaultAutomationActivityFeed()
    ) -> AutomationActivityFeedPage {
        AutomationActivityFeedPage(model: AutomationActivityFeedPageModel(provider: provider))
    }
}
