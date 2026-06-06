import Foundation

/// Honest freshness policy for live data (ADR-013). An OPEN stream that has seen
/// no event/heartbeat within `window` is *stale*: last-known values stay visible
/// but are flagged, never hidden or silently dropped. Default window is the
/// shared client's 2-minute contract (`SseConfig.freshnessWindowMillis`).
public struct LiveStalenessPolicy: Equatable, Sendable {
    /// Silence after which visible data is flagged stale.
    public let window: TimeInterval

    public init(window: TimeInterval = 120) {
        self.window = window
    }

    /// The standard 2-minute window.
    public static let standard = LiveStalenessPolicy(window: 120)

    /// Whether data last refreshed at `lastActivityAt` is stale as of `now`,
    /// also honoring an explicit stale `phase` from the shared client. A `nil`
    /// `lastActivityAt` (nothing ever received) is not itself "stale" — that is
    /// the loading/empty concern, not a freshness lapse.
    public func isStale(
        now: Date,
        lastActivityAt: Date?,
        phase: LiveConnectionState
    ) -> Bool {
        if phase == .stale {
            return true
        }
        guard let lastActivityAt else {
            return false
        }
        return now.timeIntervalSince(lastActivityAt) > window
    }

    /// Seconds since the last activity, clamped at 0, or `nil` if never active.
    public func age(now: Date, lastActivityAt: Date?) -> TimeInterval? {
        guard let lastActivityAt else { return nil }
        return max(0, now.timeIntervalSince(lastActivityAt))
    }
}

/// What a live surface should render right now. Derived from the store's snapshot
/// so every page handles loading / empty / error / stale / fresh consistently
/// (the spec's five-state contract), never a blank panel.
public enum LivePresentation: Equatable, Sendable {
    /// No data yet and a connection is being established.
    case loading
    /// Connected/known to have loaded, but there is no content to show.
    case empty
    /// Fresh content is on screen.
    case fresh
    /// Content is on screen but older than the freshness window.
    case stale
    /// No usable content and the stream failed.
    case error

    /// Pure derivation from the snapshot facts. `hasContent` means the merged
    /// value currently has something to show; `hasError` is a terminal failure
    /// with no usable cached content behind it.
    public static func derive(
        hasContent: Bool,
        hasError: Bool,
        isStale: Bool,
        hasConnectedOnce: Bool
    ) -> LivePresentation {
        if hasContent {
            return isStale ? .stale : .fresh
        }
        if hasError {
            return .error
        }
        return hasConnectedOnce ? .empty : .loading
    }

    /// Whether a spinner/skeleton should be shown.
    public var isLoading: Bool {
        self == .loading
    }

    /// Whether the freshness warning (stale banner/indicator) should be shown.
    public var isStale: Bool {
        self == .stale
    }
}
