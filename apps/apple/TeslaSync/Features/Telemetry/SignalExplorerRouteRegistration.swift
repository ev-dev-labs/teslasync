import SwiftUI

/// Navigation registration for the telemetry **Signal Explorer** page. The web route
/// `/signal-explorer` carries no path value, so it is modeled natively as a typed
/// `NavigationDestination` marker: a host stack adopts `.signalExplorerDestination()` and
/// pushes a `SignalExplorerLink()` to open the page, so it is reachable + deep-linkable on the
/// macOS / iPad detail column and the iPhone stack (ADR-002 / ADR-006) without widening the
/// shared `AppRoute` enum. Mirrors the sibling `SharingTripsRouteRegistration` shape (the
/// `@Observable` model is built inside the main-actor view builder, keeping the escaping
/// destination closure free of business logic, ADR-004).
public struct SignalExplorerLink: Hashable, Sendable {
    public init() {}
}

public extension View {
    /// Registers `SignalExplorerPage` as the `NavigationDestination` for a `SignalExplorerLink`,
    /// so any host stack can deep-link into the Signal Explorer page (web `/signal-explorer`).
    func signalExplorerDestination() -> some View {
        navigationDestination(for: SignalExplorerLink.self) { _ in
            SignalExplorerPage()
        }
    }
}

/// Factory namespace mirroring the routed pages' `…RouteRegistration` shape, for hosts that want
/// a ready-built screen without constructing the model, plus a forwarder that resolves the web
/// `/signal-explorer` path to a `SignalExplorerLink`.
public enum SignalExplorerRouteRegistration {
    /// Builds the screen (default model).
    @MainActor
    public static func make(
        model: SignalExplorerPageModel = SignalExplorerPageModel()
    ) -> SignalExplorerPage {
        SignalExplorerPage(model: model)
    }

    /// Resolves the web route `/signal-explorer` (with optional trailing slash / query / casing)
    /// to a `SignalExplorerLink`; any other path returns `nil`.
    public static func link(forPath rawPath: String) -> SignalExplorerLink? {
        let withoutQuery = rawPath.split(separator: "?", maxSplits: 1).first.map(String.init) ?? rawPath
        var normalized = withoutQuery.lowercased()
        while normalized.count > 1, normalized.hasSuffix("/") {
            normalized.removeLast()
        }
        return normalized == "/signal-explorer" ? SignalExplorerLink() : nil
    }
}
