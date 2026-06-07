import Foundation

/// Persists the user's recently-visited routes (most-recent first) in the App
/// Group, so Handoff/Spotlight/continuation can offer "recent pages" and the app
/// can restore context. Capped and de-duplicated.
///
/// Privacy: recording is gated by the user's "record recent activity" preference —
/// `record(_:enabled:)` is a no-op when disabled, and `clear()` drops the history.
/// Only route segments are stored; never PII.
public struct RecentRoutesStore: @unchecked Sendable {
    private let defaults: UserDefaults
    private let key = "io.teslasync.recentRoutes"
    private let maxCount: Int

    public init(maxCount: Int = 8, appGroupIdentifier: String = WidgetAppGroup.identifier) {
        self.maxCount = max(1, maxCount)
        defaults = UserDefaults(suiteName: appGroupIdentifier) ?? .standard
    }

    public init(maxCount: Int = 8, defaults: UserDefaults) {
        self.maxCount = max(1, maxCount)
        self.defaults = defaults
    }

    /// The recent routes, most-recent first.
    public var recents: [AppRoute] {
        let segments = defaults.array(forKey: key) as? [String] ?? []
        return segments.compactMap { AppRouteParser.parse(path: "/" + $0) }
    }

    /// Records a visit to `route` (moves it to the front, de-duplicated, capped).
    /// No-op when `enabled` is false so the privacy preference is honored.
    public func record(_ route: AppRoute, enabled: Bool = true) {
        guard enabled else { return }
        var segments = defaults.array(forKey: key) as? [String] ?? []
        segments.removeAll { $0 == route.pathSegment }
        segments.insert(route.pathSegment, at: 0)
        if segments.count > maxCount {
            segments = Array(segments.prefix(maxCount))
        }
        defaults.set(segments, forKey: key)
    }

    /// Clears the recent-routes history.
    public func clear() {
        defaults.removeObject(forKey: key)
    }
}
