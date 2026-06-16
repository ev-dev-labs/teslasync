import SwiftUI

/// Navigation registration for the **detail** parity unit `ChargingDetailPage` (web route
/// `/charging/:id`). The web list at `/charging` links to a single session by id; the
/// native shell models that as a typed `NavigationDestination` value — the parent charging
/// list adopts `.chargingDetailDestination()` and pushes a `ChargingDetailLink(sessionID:)`
/// to open one session full-screen, so the page is reachable + deep-linkable on both the
/// macOS/iPad detail column and the iPhone stack without widening the value-less
/// `AppRoute` enum. Mirrors the sibling unrouted-detail `*RouteRegistration` shape (the
/// `@Observable` model is built inside the main-actor view builder, keeping the escaping
/// destination/data-source closures free of business logic).
public struct ChargingDetailLink: Hashable, Sendable {
    public let sessionID: Int64

    public init(sessionID: Int64) {
        self.sessionID = sessionID
    }
}

public extension View {
    /// Registers `ChargingDetailPage` as the `NavigationDestination` for a
    /// `ChargingDetailLink`, so any host stack can deep-link into one charge session.
    func chargingDetailDestination(
        dataSource: @escaping @Sendable () -> any ChargingDetailDataSource = { SampleChargingDetailDataSource() }
    ) -> some View {
        navigationDestination(for: ChargingDetailLink.self) { link in
            ChargingDetailPage(
                model: ChargingDetailPageModel(sessionID: link.sessionID, dataSource: dataSource())
            )
        }
    }
}

/// Factory namespace mirroring the routed pages' `…RouteRegistration` shape, for hosts that
/// want a ready-built screen (e.g., the macOS detail column or the charging list's link
/// target) without constructing the model.
public enum ChargingDetailRouteRegistration {
    /// Builds the screen for a session id with the given data source (default = sample).
    @MainActor
    public static func make(
        sessionID: Int64,
        dataSource: any ChargingDetailDataSource = SampleChargingDetailDataSource()
    ) -> ChargingDetailPage {
        ChargingDetailPage(model: ChargingDetailPageModel(sessionID: sessionID, dataSource: dataSource))
    }
}
