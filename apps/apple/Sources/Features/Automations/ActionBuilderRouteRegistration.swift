import SwiftUI

/// Navigation registration for the **unrouted** `ActionBuilder` parity unit.
///
/// The web source is `(unrouted)` — `ActionBuilder` is a composable section the `/automations`
/// builder page renders inline, not a standalone route. So rather than claim a top-level
/// `AppRoute` (which would hijack a sibling unit's route), this exposes the screen as a typed
/// `NavigationDestination` (a deep-link value) any `NavigationStack` can host: a host adopts
/// `.actionBuilderDestination()` and pushes an `ActionBuilderPageLink` to surface the full-screen
/// action editor. The model is built by the seam's provider (default = local state), keeping the
/// escaping destination closure free of business logic.
public struct ActionBuilderPageLink: Hashable, Sendable {
    public init() {}
}

public extension View {
    /// Registers the `ActionBuilder` screen as a `NavigationDestination` for an
    /// `ActionBuilderPageLink` value, so any host stack can deep-link into it.
    func actionBuilderDestination(
        provider: @escaping @Sendable () -> any ActionBuilderPageProviding = { DefaultActionBuilderPageData() }
    ) -> some View {
        navigationDestination(for: ActionBuilderPageLink.self) { _ in
            ActionBuilderPage(model: ActionBuilderPageModel(provider: provider()))
        }
    }
}

/// Factory namespace mirroring the routed pages' `…RouteRegistration` shape, for hosts that want
/// a ready-built screen (e.g., the macOS detail column) without constructing the model.
public enum ActionBuilderPageRouteRegistration {
    /// Builds the screen with the given input provider (default = local state).
    @MainActor
    public static func make(
        provider: any ActionBuilderPageProviding = DefaultActionBuilderPageData()
    ) -> ActionBuilderPage {
        ActionBuilderPage(model: ActionBuilderPageModel(provider: provider))
    }
}
