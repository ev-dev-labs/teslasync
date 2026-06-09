//
//  SafetyHistoryWidget.Stats.swift
//  TeslaSync — P4 dashboard widget · 0084 · SafetyHistoryWidget (Apple)
//
//  The pure stats + layout + support seam, split from the adapter to keep each file
//  focused. Reproduces the web `stats` useMemo (30-day total, most-common bucket with
//  stable ties, 30-vs-prior-30-day trend), the size-derived compact gate + feed cap
//  (web `isCompact = size.cols <= 1`, `maxItems={10}`), the relative-time formatter,
//  and the VoiceOver summaries. All pure + dependency-free so they can be unit-tested
//  without a store, a bundle, or a rendered view.
//

import Foundation

// MARK: - Stats (web `stats` useMemo: 30-day total / most common / trend)

/// The 30-day-over-30-day trend direction (web `trend` glyph). `.flat` is the web
/// `→` (equal counts); `.none` is the web `—` (no prior-window data to compare).
public enum SafetyTrend: Sendable, Equatable {
    case up
    case down
    case flat
    case none

    /// Web `trend` glyph rendered as the "Trend" stat value.
    public var glyph: String {
        switch self {
        case .up: "↑"
        case .down: "↓"
        case .flat: "→"
        case .none: "—"
        }
    }
}

/// The three-up summary the wide layout shows above the feed (web `stats`): the
/// 30-day event total, the localized most-common type label, and the trend.
public struct SafetyStats: Equatable, Sendable {
    public let totalEvents: Int
    public let mostCommon: String
    public let trend: SafetyTrend

    public init(totalEvents: Int, mostCommon: String, trend: SafetyTrend) {
        self.totalEvents = totalEvents
        self.mostCommon = mostCommon
        self.trend = trend
    }
}

/// Builds the `SafetyStats` summary from the cached events — the native port of the
/// web `stats` `useMemo`: the 30-day total, the most-common bucket (stable ties),
/// and the 30-vs-prior-30-day trend. `now` is injectable for deterministic tests.
public enum SafetyStatsBuilder {
    private static let thirtyDays: TimeInterval = 30 * 24 * 60 * 60

    public static func build(
        events: [SafetyEventInput],
        now: Date = Date(),
        localize: (String, String) -> String
    ) -> SafetyStats {
        let thirtyDaysAgo = now.addingTimeInterval(-thirtyDays)
        let sixtyDaysAgo = now.addingTimeInterval(-2 * thirtyDays)

        let recent = events.filter { event in
            guard let timestamp = event.createdAt else { return false }
            return timestamp >= thirtyDaysAgo
        }
        let prior = events.filter { event in
            guard let timestamp = event.createdAt else { return false }
            return timestamp >= sixtyDaysAgo && timestamp < thirtyDaysAgo
        }

        let mostCommon = mostCommonLabel(in: recent, localize: localize)
        let trend = trend(recentCount: recent.count, priorCount: prior.count)
        return SafetyStats(totalEvents: recent.count, mostCommon: mostCommon, trend: trend)
    }

    /// Web `typeCounts` + `Object.entries(...).sort((a, b) => b[1] - a[1])[0]`: the
    /// most frequent bucket, ties broken by first-encounter order (stable), mapped
    /// through `typeLabels`. `—` when there are no recent events.
    static func mostCommonLabel(
        in recent: [SafetyEventInput],
        localize: (String, String) -> String
    ) -> String {
        var order: [String] = []
        var counts: [String: Int] = [:]
        for event in recent {
            let slug = SafetyEventCatalog.typeSlug(for: SafetyEventCatalog.derive(from: event))
            if counts[slug] == nil { order.append(slug) }
            counts[slug, default: 0] += 1
        }
        let ranked = order.enumerated().sorted { lhs, rhs in
            let leftCount = counts[lhs.element] ?? 0
            let rightCount = counts[rhs.element] ?? 0
            if leftCount != rightCount { return leftCount > rightCount }
            return lhs.offset < rhs.offset
        }
        guard let topSlug = ranked.first?.element else { return "—" }
        return SafetyEventCatalog.typeLabel(forSlug: topSlug, localize: localize)
    }

    /// Web trend ladder: `↑` when recent rose over a non-empty prior window, `↓` when
    /// it fell, `→` when equal, and `—` when there is no prior-window data.
    static func trend(recentCount: Int, priorCount: Int) -> SafetyTrend {
        guard priorCount > 0 else { return .none }
        if recentCount > priorCount { return .up }
        if recentCount < priorCount { return .down }
        return .flat
    }

    /// The localized sublabel under the "Trend" stat (web ternary): `↑` → Increasing,
    /// `↓` → Decreasing, and both `→`/`—` → Stable.
    public static func trendSublabel(_ trend: SafetyTrend, localize: (String, String) -> String) -> String {
        switch trend {
        case .up: localize("widget.trendUp", "Increasing")
        case .down: localize("widget.trendDown", "Decreasing")
        case .flat, .none: localize("widget.trendFlat", "Stable")
        }
    }
}

// MARK: - Size-derived layout (web `isCompact` / feed `maxItems`)

/// The pure size → layout rules the view applies, kept testable + separate from the
/// (size-agnostic) model. Mirrors the web `isCompact = size.cols <= 1` and the wide
/// feed's `maxItems={10}`.
public enum SafetyLayout {
    /// Web `WidgetEventFeed maxItems={10}` for the wide layout's feed.
    public static let feedMaxItems = 10

    /// Web `isCompact = size.cols <= 1` — the single-line summary layout. The registry
    /// `minSize` (cols ≥ 2) means the grid clamps above this, so production renders the
    /// wide layout; the branch is preserved for full web parity.
    public static func isCompact(for size: DashboardWidgetSize) -> Bool {
        size.cols <= 1
    }
}

// MARK: - Relative time (web `formatRelativeTime`)

/// Locale-aware relative timestamp for a feed row (web `formatRelativeTime`'s "Just
/// now / Nm ago / Nh ago" intent), delegated to the OS so it's localized without
/// hardcoded English. `now` is injectable for deterministic tests.
public enum SafetyRelativeTime {
    public static func string(for date: Date, relativeTo now: Date = Date()) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: now)
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver strings for the surface. Pure + public so the spoken content
/// can be unit-tested without rendering the view.
public enum SafetyHistoryAccessibility {
    /// The spoken label for a feed row: title plus subtitle when meaningful.
    public static func eventSummary(for item: SafetyFeedItem) -> String {
        guard item.subtitle != "—", !item.subtitle.isEmpty else { return item.title }
        return "\(item.title). \(item.subtitle)"
    }

    /// The spoken label for the compact single-line summary (web `CompactView`).
    public static func compactSummary(
        stats: SafetyStats,
        localize: (String, String) -> String
    ) -> String {
        guard stats.totalEvents > 0 else {
            return localize("widget.noSafetyEvents", "No safety events")
        }
        let events = localize("widget.safetyEvents", "events")
        let window = localize("widget.safety30dWindow", "(30d)")
        let trend = SafetyStatsBuilder.trendSublabel(stats.trend, localize: localize)
        return "\(stats.totalEvents.formatted()) \(events) \(window). \(stats.mostCommon). \(trend)"
    }
}
