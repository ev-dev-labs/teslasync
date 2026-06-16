import SwiftUI

/// Navigation registration for the parity unit `RouteEfficiencyPage` (web route `/route-efficiency`).
/// The value-less `AppRoute` enum's `.driving` host is owned by `DriveScorePage`, and the web route is
/// a secondary driving surface, so — mirroring the sibling unrouted `DriveDetailRouteRegistration` — the
/// native shell models it as a typed `NavigationDestination`: a host stack adopts
/// `.routeEfficiencyDestination()` and pushes a `RouteEfficiencyLink` to open it, while the deep-link
/// path resolves through `AppRouteParser` (`"/route-efficiency": .driving`, like `/drive-score`). This
/// keeps the page reachable + deep-linkable on both the macOS/iPad detail column and the iPhone stack
/// without widening the enum. The `@Observable` model is built inside the main-actor view builder, so
/// the escaping destination/data-source closures stay free of business logic.
public struct RouteEfficiencyLink: Hashable, Sendable {
    public init() {}
}

public extension View {
    /// Registers `RouteEfficiencyPage` as the `NavigationDestination` for a `RouteEfficiencyLink`, so
    /// any host stack can deep-link into the route-efficiency surface.
    func routeEfficiencyDestination(
        dataSource: @escaping @Sendable () -> any RouteEfficiencyDataSource = { SampleRouteEfficiencyDataSource() }
    ) -> some View {
        navigationDestination(for: RouteEfficiencyLink.self) { _ in
            RouteEfficiencyPage(model: RouteEfficiencyPageModel(dataSource: dataSource()))
        }
    }
}

/// Factory namespace mirroring the routed pages' `…RouteRegistration` shape, for hosts that want a
/// ready-built screen (e.g., the macOS detail column or a driving-hub link target) without
/// constructing the model.
public enum RouteEfficiencyRouteRegistration {
    /// Builds the screen with the given data source (default = sample).
    @MainActor
    public static func make(
        dataSource: any RouteEfficiencyDataSource = SampleRouteEfficiencyDataSource()
    ) -> RouteEfficiencyPage {
        RouteEfficiencyPage(model: RouteEfficiencyPageModel(dataSource: dataSource))
    }
}
