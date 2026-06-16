import SwiftUI

/// Navigation registration for the **detail** parity unit `DriveDetailPage` (web route
/// `/drives/:id`). The web drives list links to a single drive by id; the native shell models
/// that as a typed `NavigationDestination` value — a host stack adopts `.driveDetailDestination()`
/// and pushes a `DriveDetailLink(driveID:)` to open one drive full-screen, so the page is
/// reachable + deep-linkable on both the macOS/iPad detail column and the iPhone stack without
/// widening the value-less `AppRoute` enum. Mirrors the sibling unrouted-detail
/// `ChargingDetailRouteRegistration` shape (the `@Observable` model is built inside the
/// main-actor view builder, keeping the escaping destination/data-source closures free of
/// business logic).
public struct DriveDetailLink: Hashable, Sendable {
    public let driveID: Int64

    public init(driveID: Int64) {
        self.driveID = driveID
    }
}

public extension View {
    /// Registers `DriveDetailPage` as the `NavigationDestination` for a `DriveDetailLink`, so any
    /// host stack can deep-link into one drive.
    func driveDetailDestination(
        dataSource: @escaping @Sendable () -> any DriveDetailDataSource = { SampleDriveDetailDataSource() }
    ) -> some View {
        navigationDestination(for: DriveDetailLink.self) { link in
            DriveDetailPage(
                model: DriveDetailPageModel(driveID: link.driveID, dataSource: dataSource())
            )
        }
    }
}

/// Factory namespace mirroring the routed pages' `…RouteRegistration` shape, for hosts that want
/// a ready-built screen (e.g., the macOS detail column or the drives list's link target) without
/// constructing the model.
public enum DriveDetailRouteRegistration {
    /// Builds the screen for a drive id with the given data source (default = sample).
    @MainActor
    public static func make(
        driveID: Int64,
        dataSource: any DriveDetailDataSource = SampleDriveDetailDataSource()
    ) -> DriveDetailPage {
        DriveDetailPage(model: DriveDetailPageModel(driveID: driveID, dataSource: dataSource))
    }
}
