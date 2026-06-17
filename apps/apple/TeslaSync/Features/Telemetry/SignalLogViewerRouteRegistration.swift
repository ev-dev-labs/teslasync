import SwiftUI

/// Navigation registration for the **Signal Log Viewer** page. The web route `/signal-log` is a
/// standalone, value-less leaf, so it is modeled natively as a typed `NavigationDestination` marker:
/// a host stack adopts `.signalLogViewerDestination()` and pushes a `SignalLogViewerLink()` to open
/// the page, so it is reachable + deep-linkable on the macOS / iPad detail column and the iPhone
/// stack (ADR-002 / ADR-006) without widening the shared `AppRoute` enum. Mirrors the sibling
/// `SharingTripsRouteRegistration` shape (the `@Observable` model is built inside the main-actor view
/// builder, keeping the escaping destination / data-source closures free of business logic, ADR-004).
public struct SignalLogViewerLink: Hashable, Sendable {
    public init() {}
}

public extension View {
    /// Registers `SignalLogViewerPage` as the `NavigationDestination` for a `SignalLogViewerLink`, so
    /// any host stack can deep-link into the Signal Log Viewer (web `/signal-log`).
    func signalLogViewerDestination(
        vehicleID: Int64 = 1,
        dataSource: @escaping @Sendable () -> any SignalLogViewerDataSource = { SampleSignalLogViewerDataSource() }
    ) -> some View {
        navigationDestination(for: SignalLogViewerLink.self) { _ in
            SignalLogViewerPage(vehicleID: vehicleID, dataSource: dataSource())
        }
    }
}

/// Factory namespace mirroring the routed pages' `…RouteRegistration` shape, for hosts that want a
/// ready-built screen without constructing the model, plus a forwarder that resolves the web
/// `/signal-log` path to a `SignalLogViewerLink`.
public enum SignalLogViewerRouteRegistration {
    /// Builds the screen for the given vehicle scope + data source (default = sample).
    @MainActor
    public static func make(
        vehicleID: Int64 = 1,
        dataSource: any SignalLogViewerDataSource = SampleSignalLogViewerDataSource()
    ) -> SignalLogViewerPage {
        SignalLogViewerPage(vehicleID: vehicleID, dataSource: dataSource)
    }

    /// Resolves the web route `/signal-log` (with optional trailing slash / query) to a
    /// `SignalLogViewerLink`; any other path returns `nil`.
    public static func link(forPath rawPath: String) -> SignalLogViewerLink? {
        let withoutQuery = rawPath.split(separator: "?", maxSplits: 1).first.map(String.init) ?? rawPath
        var normalized = withoutQuery
        while normalized.count > 1, normalized.hasSuffix("/") {
            normalized.removeLast()
        }
        return normalized == "/signal-log" ? SignalLogViewerLink() : nil
    }
}
