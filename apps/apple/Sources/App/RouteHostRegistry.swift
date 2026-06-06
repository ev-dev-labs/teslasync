import SwiftUI

/// Registry that the P7 page prompts populate to host their content at a route.
/// The shell renders `view(for:)` or, until a page registers, a pending state —
/// so navigation is real infrastructure, not a fake per-page screen.
public struct AppRouteHostRegistry {
    private var providers: [AppRoute: () -> AnyView] = [:]

    public init() {}

    public mutating func register(_ route: AppRoute, @ViewBuilder _ provider: @escaping () -> some View) {
        providers[route] = { AnyView(provider()) }
    }

    public func view(for route: AppRoute) -> AnyView? {
        providers[route]?()
    }

    public var registeredRoutes: Set<AppRoute> {
        Set(providers.keys)
    }
}

private struct AppRouteHostRegistryKey: EnvironmentKey {
    static let defaultValue = AppRouteHostRegistry()
}

public extension EnvironmentValues {
    /// The route → page-view registry the shell renders from.
    var routeHosts: AppRouteHostRegistry {
        get { self[AppRouteHostRegistryKey.self] }
        set { self[AppRouteHostRegistryKey.self] = newValue }
    }
}
