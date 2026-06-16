import SwiftUI

/// Navigation registration for the `TripReplayPage` parity unit (web route unrouted; reached from a
/// drive by id, like the web "View Replay" affordance on the drive detail / list). The native shell
/// models that as a typed `NavigationDestination` value — a host stack adopts
/// `.tripReplayDestination()` and pushes a `TripReplayLink(driveID:)` to open one drive's replay, so
/// the page is reachable + deep-linkable on the macOS/iPad detail column and the iPhone stack
/// without widening the value-less `AppRoute` enum. Mirrors the sibling
/// `DriveDetailRouteRegistration` shape (the `@Observable` model is built inside the main-actor view
/// builder, keeping the escaping destination/data-source closures free of business logic).
public struct TripReplayLink: Hashable, Sendable {
    public let driveID: Int64

    public init(driveID: Int64) {
        self.driveID = driveID
    }
}

public extension View {
    /// Registers `TripReplayPage` as the `NavigationDestination` for a `TripReplayLink`, so any host
    /// stack can deep-link into one drive's replay.
    func tripReplayDestination(
        dataSource: @escaping @Sendable () -> any TripReplayDataSource = { SampleTripReplayDataSource() }
    ) -> some View {
        navigationDestination(for: TripReplayLink.self) { link in
            TripReplayPage(
                model: TripReplayPageModel(driveID: link.driveID, dataSource: dataSource())
            )
        }
    }
}

/// Factory namespace mirroring the routed pages' `…RouteRegistration` shape, for hosts that want a
/// ready-built screen (e.g., the macOS detail column or a drive's "View Replay" link target) without
/// constructing the model.
public enum TripReplayRouteRegistration {
    /// Builds the replay screen for a drive id with the given data source (default = sample).
    @MainActor
    public static func make(
        driveID: Int64,
        dataSource: any TripReplayDataSource = SampleTripReplayDataSource()
    ) -> TripReplayPage {
        TripReplayPage(model: TripReplayPageModel(driveID: driveID, dataSource: dataSource))
    }
}
