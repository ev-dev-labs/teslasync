import Foundation

/// Typed navigation value for the public Shared Drive report (web route `/s/:token`). Pure Swift
/// (no SwiftUI), so the deep-link parser is unit-testable in isolation.
public struct SharedDriveLink: Hashable, Sendable {
    public let token: String

    public init(token: String) {
        self.token = token
    }
}

/// Resolves the web public route `/s/:token` (path or custom-scheme/universal-link URL) into a
/// `SharedDriveLink`. Pure + unit-tested — mirrors `AppRouteParser`'s parsing role for the one
/// token-bearing public route the value-less `AppRoute` enum can't express.
public enum SharedDriveDeepLink {
    /// Resolves `/s/:token` (with optional leading / trailing slash) to a `SharedDriveLink`.
    /// Returns `nil` for any other path or an empty token.
    public static func link(forPath rawPath: String) -> SharedDriveLink? {
        let segments = rawPath
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .split(separator: "/")
            .map(String.init)
        guard segments.count == 2, segments[0].lowercased() == "s" else { return nil }
        let token = segments[1]
        return token.isEmpty ? nil : SharedDriveLink(token: token)
    }

    /// Resolves a custom-scheme (`teslasync://s/<token>`) or universal link to a `SharedDriveLink`.
    public static func link(for url: URL) -> SharedDriveLink? {
        if let host = url.host?.lowercased(), host == "s" {
            let token = url.path.split(separator: "/").map(String.init).first
            if let token, !token.isEmpty {
                return SharedDriveLink(token: token)
            }
        }
        return link(forPath: url.path)
    }
}
