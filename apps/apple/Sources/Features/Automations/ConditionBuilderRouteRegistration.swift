import SwiftUI

/// Navigation registration for the **unrouted** `ConditionBuilder` parity unit.
///
/// The web source is `(unrouted)` — `ConditionBuilder` is a composable section the `/automations`
/// builder page renders inline, not a standalone route. So rather than claim a top-level `AppRoute`
/// (which would hijack a sibling unit's route), this exposes the screen as a typed
/// `NavigationDestination` (a deep-link value) any `NavigationStack` can host: a host adopts
/// `.conditionBuilderDestination()` and pushes a `ConditionBuilderPageLink` to surface the
/// full-screen condition editor. The model is built by the seam's provider (default = local state),
/// keeping the escaping destination closure free of business logic.
public struct ConditionBuilderPageLink: Hashable, Sendable {
    public init() {}
}

public extension View {
    /// Registers the `ConditionBuilder` screen as a `NavigationDestination` for a
    /// `ConditionBuilderPageLink` value, so any host stack can deep-link into it.
    func conditionBuilderDestination(
        provider: @escaping @Sendable () -> any ConditionBuilderPageProviding = { DefaultConditionBuilderPageData() }
    ) -> some View {
        navigationDestination(for: ConditionBuilderPageLink.self) { _ in
            ConditionBuilderPage(model: ConditionBuilderPageModel(provider: provider()))
        }
    }
}

/// Factory namespace mirroring the routed pages' `…RouteRegistration` shape, for hosts that want a
/// ready-built screen (e.g., the macOS detail column) without constructing the model.
public enum ConditionBuilderPageRouteRegistration {
    /// Builds the screen with the given input provider (default = local state).
    @MainActor
    public static func make(
        provider: any ConditionBuilderPageProviding = DefaultConditionBuilderPageData()
    ) -> ConditionBuilderPage {
        ConditionBuilderPage(model: ConditionBuilderPageModel(provider: provider))
    }
}
