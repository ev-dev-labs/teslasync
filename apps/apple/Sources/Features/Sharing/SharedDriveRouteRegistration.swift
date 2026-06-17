import SwiftUI

/// Navigation registration for the public **Shared Drive** report (web route `/s/:token`). The web
/// app mounts this token-bearing, pre-auth route before its auth shell; the native shell models it
/// as a typed `NavigationDestination` value — a host stack adopts `.sharedDriveDestination()` and
/// pushes a `SharedDriveLink(token:)` to open one shared report, so the page is reachable +
/// deep-linkable on the macOS/iPad detail column and the iPhone stack without widening the
/// value-less `AppRoute` enum. Mirrors the sibling token/id-bearing `TripReplayRouteRegistration` /
/// `DriveDetailRouteRegistration` shape (the `@Observable` model is built inside the main-actor view
/// builder, keeping the escaping destination/data-source closures free of business logic). The
/// `SharedDriveLink` value + the `/s/:token` parser live in `SharedDriveDeepLink` (SwiftUI-free).
public extension View {
    /// Registers `SharedDrivePage` as the `NavigationDestination` for a `SharedDriveLink`, so any
    /// host stack can deep-link into one public shared report.
    func sharedDriveDestination(
        dataSource: @escaping @Sendable () -> any SharedDriveDataSource = { SampleSharedDriveDataSource() },
        onHome: @escaping () -> Void = {}
    ) -> some View {
        navigationDestination(for: SharedDriveLink.self) { link in
            SharedDrivePage(
                model: SharedDrivePageModel(token: link.token, dataSource: dataSource()),
                onHome: onHome
            )
        }
    }
}

/// Factory namespace mirroring the routed pages' `…RouteRegistration` shape, for hosts that want a
/// ready-built screen without constructing the model, plus convenience forwarders to the
/// `SharedDriveDeepLink` parser for resolving the web `/s/:token` path.
public enum SharedDriveRouteRegistration {
    /// Builds the screen for a share token with the given data source (default = sample).
    @MainActor
    public static func make(
        token: String,
        dataSource: any SharedDriveDataSource = SampleSharedDriveDataSource(),
        onHome: @escaping () -> Void = {}
    ) -> SharedDrivePage {
        SharedDrivePage(model: SharedDrivePageModel(token: token, dataSource: dataSource), onHome: onHome)
    }

    /// Resolves the web public route `/s/:token` to a `SharedDriveLink` (forwards to
    /// `SharedDriveDeepLink`).
    public static func link(forPath rawPath: String) -> SharedDriveLink? {
        SharedDriveDeepLink.link(forPath: rawPath)
    }

    /// Resolves a custom-scheme / universal link to a `SharedDriveLink` (forwards to
    /// `SharedDriveDeepLink`).
    public static func link(for url: URL) -> SharedDriveLink? {
        SharedDriveDeepLink.link(for: url)
    }
}
