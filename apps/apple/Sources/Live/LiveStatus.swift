import Foundation

/// A non-generic, `Sendable` snapshot of a live surface's connection + freshness,
/// vended by `LiveDataStore.status`. Lets status/stale/state UI and tests reason
/// about a live surface without the store's `Value`/`Event` generics.
public struct LiveStatus: Equatable, Sendable {
    public let phase: LiveConnectionState
    public let presentation: LivePresentation
    /// Whether the store currently holds (or is establishing) a connection.
    public let isActive: Bool
    /// Whether visible data is older than the freshness window.
    public let isStale: Bool
    /// Whether the stream failed with nothing usable behind it.
    public let hasError: Bool

    public init(
        phase: LiveConnectionState,
        presentation: LivePresentation,
        isActive: Bool,
        isStale: Bool,
        hasError: Bool
    ) {
        self.phase = phase
        self.presentation = presentation
        self.isActive = isActive
        self.isStale = isStale
        self.hasError = hasError
    }

    /// Live = an open stream showing fresh data. Drives the green "live" badge.
    public var isLive: Bool {
        phase == .open && !isStale
    }

    /// Whether the connection is mid-(re)connect — drives the amber badge.
    public var isConnecting: Bool {
        phase == .connecting || phase == .reconnecting
    }

    /// Whether a manual reconnect affordance should be offered (offline/closed
    /// while the surface is meant to be live, or a hard error).
    public var canReconnect: Bool {
        hasError || (!isActive && phase == .closed) || phase == .closed
    }
}
