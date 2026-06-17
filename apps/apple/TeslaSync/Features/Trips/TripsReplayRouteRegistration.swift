import SwiftUI

/// Navigation registration for the Trips `TripsReplayPage` parity unit. The web route
/// `/drives/:id/replay` is modeled natively as a typed `NavigationDestination` value: a host stack
/// adopts `.tripsReplayDestination()` and pushes a `TripsReplayLink(driveID:)` to open one drive's
/// replay, so the page is reachable + deep-linkable on the macOS / iPad detail column and the
/// iPhone stack (ADR-002/006). The `@Observable` model is built inside the main-actor view builder,
/// keeping the escaping destination / data-source closures free of business logic (ADR-004).
public struct TripsReplayLink: Hashable, Sendable {
    public let driveID: Int64

    public init(driveID: Int64) {
        self.driveID = driveID
    }
}

public extension View {
    /// Registers `TripsReplayPage` as the `NavigationDestination` for a `TripsReplayLink`, so any
    /// host stack can deep-link into one drive's replay (web `/drives/:id/replay`).
    func tripsReplayDestination(
        dataSource: @escaping @Sendable () -> any TripsReplayDataSource = { SampleTripsReplayDataSource() }
    ) -> some View {
        navigationDestination(for: TripsReplayLink.self) { link in
            TripsReplayPage(driveID: link.driveID, dataSource: dataSource())
        }
    }
}

/// Factory mirroring the routed pages' `…RouteRegistration` shape, for hosts that want a ready-built
/// screen (e.g., a drive's "View Replay" link target) without constructing the model.
public enum TripsReplayRouteRegistration {
    /// Builds the replay screen for a drive id with the given data source (default = sample).
    @MainActor
    public static func make(
        driveID: Int64,
        dataSource: any TripsReplayDataSource = SampleTripsReplayDataSource()
    ) -> TripsReplayPage {
        TripsReplayPage(driveID: driveID, dataSource: dataSource)
    }
}
