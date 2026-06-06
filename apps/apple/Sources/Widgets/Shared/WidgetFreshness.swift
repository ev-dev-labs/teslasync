import Foundation

/// Honest freshness for cached widget data (ADR-013). Widgets show last-known
/// values and flag how old they are; they never silently present stale data as
/// live and never run a background stream. Three states map to the spec's
/// fresh / stale / offline indicators.
public enum WidgetFreshness: String, Equatable, Sendable {
    /// Within the freshness window — safe to show as current.
    case fresh
    /// Older than the freshness window but still useful — flagged, not hidden.
    case stale
    /// No data at all, or so old it should be treated as unknown.
    case offline
}

/// Thresholds that turn an age into a `WidgetFreshness`. Tuned for *cached glance*
/// data (not the live SSE surfaces, which use the 2-minute `LiveStalenessPolicy`):
/// a widget refreshed by the system every few minutes is "fresh" for longer.
public struct WidgetFreshnessPolicy: Equatable, Sendable {
    /// Age at or beyond which data is flagged stale.
    public let staleAfter: TimeInterval
    /// Age at or beyond which data is treated as offline/unknown.
    public let offlineAfter: TimeInterval

    public init(staleAfter: TimeInterval, offlineAfter: TimeInterval) {
        self.staleAfter = staleAfter
        self.offlineAfter = offlineAfter
    }

    /// Default policy: fresh < 5 min, stale 5–60 min, offline ≥ 60 min.
    public static let standard = WidgetFreshnessPolicy(staleAfter: 300, offlineAfter: 3600)

    /// Classifies data last updated at `lastUpdated` as of `now`. A `nil`
    /// `lastUpdated` (nothing cached) is offline.
    public func evaluate(now: Date, lastUpdated: Date?) -> WidgetFreshness {
        guard let lastUpdated else { return .offline }
        let age = max(0, now.timeIntervalSince(lastUpdated))
        if age >= offlineAfter { return .offline }
        if age >= staleAfter { return .stale }
        return .fresh
    }

    /// The first instant at/after `lastUpdated` when the state changes, or `nil`
    /// if `lastUpdated` is `nil`. Lets the timeline schedule an entry exactly when
    /// the widget should visibly flip to stale, then offline.
    public func nextTransition(after lastUpdated: Date?, from current: WidgetFreshness) -> Date? {
        guard let lastUpdated else { return nil }
        switch current {
        case .fresh: return lastUpdated.addingTimeInterval(staleAfter)
        case .stale: return lastUpdated.addingTimeInterval(offlineAfter)
        case .offline: return nil
        }
    }
}
