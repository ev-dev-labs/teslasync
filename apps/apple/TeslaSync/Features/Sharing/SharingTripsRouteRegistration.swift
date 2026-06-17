import SwiftUI

/// Navigation registration for the Sharing **Share a trip** page. The web route `/sharing/trips` is
/// value-less, so it is modeled natively as a typed `NavigationDestination` marker: a host stack
/// adopts `.sharingTripsDestination()` and pushes a `SharingTripsLink()` to open the page, so it is
/// reachable + deep-linkable on the macOS / iPad detail column and the iPhone stack (ADR-002/006)
/// without widening the shared `AppRoute` enum. Mirrors the sibling `SharedDriveRouteRegistration`
/// shape (the `@Observable` model is built inside the main-actor view builder, keeping the escaping
/// destination / data-source closures free of business logic, ADR-004).
public struct SharingTripsLink: Hashable, Sendable {
    public init() {}
}

public extension View {
    /// Registers `SharingTripsPage` as the `NavigationDestination` for a `SharingTripsLink`, so any
    /// host stack can deep-link into the "Share a trip" page (web `/sharing/trips`).
    func sharingTripsDestination(
        vehicleID: Int64? = nil,
        dataSource: @escaping @Sendable () -> any SharingTripsDataSource = { SampleSharingTripsDataSource() }
    ) -> some View {
        navigationDestination(for: SharingTripsLink.self) { _ in
            SharingTripsPage(vehicleID: vehicleID, dataSource: dataSource())
        }
    }
}

/// Factory namespace mirroring the routed pages' `…RouteRegistration` shape, for hosts that want a
/// ready-built screen without constructing the model, plus a forwarder that resolves the web
/// `/sharing/trips` path to a `SharingTripsLink`.
public enum SharingTripsRouteRegistration {
    /// Builds the screen for the given vehicle scope + data source (default = sample).
    @MainActor
    public static func make(
        vehicleID: Int64? = nil,
        dataSource: any SharingTripsDataSource = SampleSharingTripsDataSource()
    ) -> SharingTripsPage {
        SharingTripsPage(vehicleID: vehicleID, dataSource: dataSource)
    }

    /// Resolves the web route `/sharing/trips` (with optional trailing slash / query) to a
    /// `SharingTripsLink`; any other path returns `nil`.
    public static func link(forPath rawPath: String) -> SharingTripsLink? {
        let withoutQuery = rawPath.split(separator: "?", maxSplits: 1).first.map(String.init) ?? rawPath
        var normalized = withoutQuery
        while normalized.count > 1, normalized.hasSuffix("/") {
            normalized.removeLast()
        }
        return normalized == "/sharing/trips" ? SharingTripsLink() : nil
    }
}
