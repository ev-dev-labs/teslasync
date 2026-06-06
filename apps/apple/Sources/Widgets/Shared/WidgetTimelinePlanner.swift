import Foundation
import WidgetKit

/// One rendered moment of a widget's timeline: a date, the cached snapshot to draw,
/// and the envelope-level freshness at that date. All six widgets share this entry
/// type — the provider reads the store once and each widget renders its slice.
public struct TeslaSyncWidgetEntry: TimelineEntry, Equatable, Sendable {
    public let date: Date
    public let snapshot: TeslaSyncWidgetSnapshot
    public let freshness: WidgetFreshness

    public init(date: Date, snapshot: TeslaSyncWidgetSnapshot, freshness: WidgetFreshness) {
        self.date = date
        self.snapshot = snapshot
        self.freshness = freshness
    }

    /// Per-datum freshness for one summary's sample time, so a widget can flag its
    /// own value's age independently of the envelope.
    public func freshness(forSampledAt sampledAt: Date?, policy: WidgetFreshnessPolicy = .standard) -> WidgetFreshness {
        policy.evaluate(now: date, lastUpdated: sampledAt)
    }
}

/// Pure timeline construction for the widgets. Given a cached snapshot and the
/// current time, it emits entries that visibly and *honestly* flip fresh → stale →
/// offline as the cache ages (no background streaming), plus a reload date telling
/// WidgetKit when to ask the app for newer data. Fully unit-tested; the provider is
/// a thin shell over this.
public enum WidgetTimelinePlanner {
    /// How often to ask WidgetKit to reload while a charge is in progress.
    static let activeReloadCadence: TimeInterval = 15 * 60
    /// Idle reload cadence.
    static let idleReloadCadence: TimeInterval = 30 * 60

    /// Entries for `snapshot` as of `now`, sorted ascending and de-duplicated.
    public static func entries(
        for snapshot: TeslaSyncWidgetSnapshot,
        now: Date,
        policy: WidgetFreshnessPolicy = .standard
    ) -> [TeslaSyncWidgetEntry] {
        let lastUpdated = snapshot.generatedAt
        var dates: [Date] = [now]

        let staleBoundary = lastUpdated.addingTimeInterval(policy.staleAfter)
        let offlineBoundary = lastUpdated.addingTimeInterval(policy.offlineAfter)
        if staleBoundary > now { dates.append(staleBoundary) }
        if offlineBoundary > now { dates.append(offlineBoundary) }

        let uniqueSorted = Array(Set(dates)).sorted()
        return uniqueSorted.map { date in
            TeslaSyncWidgetEntry(
                date: date,
                snapshot: snapshot,
                freshness: policy.evaluate(now: date, lastUpdated: lastUpdated)
            )
        }
    }

    /// When WidgetKit should request a new timeline. Never in the past: at least one
    /// cadence ahead of `now`, and no later than the moment the cache goes offline.
    public static func reloadDate(
        for snapshot: TeslaSyncWidgetSnapshot,
        now: Date,
        policy: WidgetFreshnessPolicy = .standard
    ) -> Date {
        let cadence = (snapshot.charging?.isActive == true) ? activeReloadCadence : idleReloadCadence
        let cadenceDate = now.addingTimeInterval(cadence)
        let offlineBoundary = snapshot.generatedAt.addingTimeInterval(policy.offlineAfter)
        let target = min(cadenceDate, max(offlineBoundary, now.addingTimeInterval(60)))
        return max(target, now.addingTimeInterval(60))
    }
}
