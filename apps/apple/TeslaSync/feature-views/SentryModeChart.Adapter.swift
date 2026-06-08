//
//  SentryModeChart.Adapter.swift
//  TeslaSync — P4 feature view · 0047 · SentryModeChart (Apple)
//
//  The testable projection core for the "Sentry Mode Activity" admin surface — the
//  faithful port of the day-bucketed stacked bar chart in
//  features/admin/components/security-access/SentryModeChart.tsx (fed by the web
//  `buildSentryBuckets` helper). Everything here is pure and dependency-free
//  (Foundation only) so it can be unit-tested without a bundle or a rendered view.
//
//  Web parity notes:
//    • `SentryDayBucket` mirrors the web `{ date, sentryOn, sentryOff }` shape.
//    • The chart stacks two series per day (web `<Bar dataKey="sentryOn">` over
//      `<Bar dataKey="sentryOff">`, shared `stackId="sentry"`).
//    • The x-axis label is the web `formatDateShort(date)` ("MMM d") with the
//      em-dash sentinel for an unparseable / empty key.
//    • The web `sentryBuckets.length > 0 ? <chart> : <EmptyState>` split becomes
//      the resolved `.content` vs `.empty` phase.
//

import Foundation

// MARK: - Day bucket (web `SentryDayBucket`)

/// One calendar day's sentry tally — the SwiftUI parity of the web
/// `SentryDayBucket` (`helpers.ts`). `date` is the `YYYY-MM-DD` key the web
/// derives from `createdAt.slice(0, 10)`.
public struct SentryDayBucket: Sendable, Equatable, Identifiable {
    /// The `YYYY-MM-DD` day key (web `date`).
    public var date: String
    /// Events recorded with sentry armed that day (web `sentryOn`).
    public var sentryOn: Int
    /// Events recorded with sentry off that day (web `sentryOff`).
    public var sentryOff: Int

    public var id: String {
        date
    }

    public init(date: String, sentryOn: Int, sentryOff: Int) {
        self.date = date
        self.sentryOn = sentryOn
        self.sentryOff = sentryOff
    }
}

// MARK: - Series (web `dataKey` "sentryOn" / "sentryOff")

/// The two stacked series, mirroring the web `<Bar>` keys + legend names. The
/// `order` pins the stack + legend sequence (web On-over-Off).
public enum SentrySeries: String, Sendable, Equatable, CaseIterable, Identifiable {
    case on
    case off

    public var id: String {
        rawValue
    }

    /// Plot / legend order (web renders the `sentryOn` bar before `sentryOff`).
    public var order: Int {
        switch self {
        case .on: 0
        case .off: 1
        }
    }

    /// The i18n key the legend + tooltip resolve (web `t(key, default)`).
    public var localizationKey: String {
        switch self {
        case .on: "admin.security.chart.sentryOn"
        case .off: "admin.security.chart.sentryOff"
        }
    }

    /// The web English fallback for `localizationKey`.
    public var fallback: String {
        switch self {
        case .on: "Sentry On"
        case .off: "Sentry Off"
        }
    }
}

// MARK: - Chart row (one stacked segment)

/// One stacked segment for the Swift Charts `BarMark` grid: a `(day, series)`
/// pair with its count. The web flattens this implicitly across its two `<Bar>`
/// elements; the native chart plots an explicit row per segment.
public struct SentryChartRow: Sendable, Equatable, Identifiable {
    /// The owning day key (`YYYY-MM-DD`) — the chart's x value (stable + sortable).
    public var dateKey: String
    /// The localized short x-axis label (web `formatDateShort`).
    public var label: String
    /// Which series this segment belongs to.
    public var series: SentrySeries
    /// The segment's value (web bar height).
    public var count: Int

    public var id: String {
        "\(dateKey)#\(series.rawValue)"
    }

    public init(dateKey: String, label: String, series: SentrySeries, count: Int) {
        self.dateKey = dateKey
        self.label = label
        self.series = series
        self.count = count
    }
}

// MARK: - Day projection (a chart column + its tooltip payload)

/// One projected day: the raw key, its localized label, and both series counts.
/// Drives the x-axis, the selection tooltip, and the per-column VoiceOver value.
public struct SentryDayPoint: Sendable, Equatable, Identifiable {
    public var dateKey: String
    public var label: String
    public var sentryOn: Int
    public var sentryOff: Int

    public var id: String {
        dateKey
    }

    /// The column total (both series) — the stacked bar's full height.
    public var total: Int {
        sentryOn + sentryOff
    }

    public init(dateKey: String, label: String, sentryOn: Int, sentryOff: Int) {
        self.dateKey = dateKey
        self.label = label
        self.sentryOn = sentryOn
        self.sentryOff = sentryOff
    }

    /// The count for one series (tooltip / a11y).
    public func count(for series: SentrySeries) -> Int {
        switch series {
        case .on: sentryOn
        case .off: sentryOff
        }
    }
}

// MARK: - Render phase (web content/empty split, plus the load envelope)

/// What the surface should render. The web source only distinguishes
/// content-vs-empty; the loading / error envelope around it (prompt P4 states)
/// is supplied by the bound source, mirroring the web parent page's
/// `isLoading` / error wiring on `SecurityAccessPage`.
public enum SentryModePhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status for the sentry query (web `isLoading` /
/// resolved / failure), projected into a phase by `resolvePhase`.
public enum SentryModeLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data
/// banner so cached columns are clearly labeled while reconnecting / offline.
public enum SentryModeConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Projection core (pure)

/// The dependency-free projection from raw day buckets to chart-ready rows +
/// render phase. A faithful port of the web component's read of the
/// `buildSentryBuckets` output: it re-sorts defensively by day key (the helper
/// already sorts, but the surface must not assume it), formats the short
/// x-label, and resolves the content/empty split.
public enum SentryModeProjection {
    /// Chronologically ordered day points with localized labels. Sorted by the
    /// `YYYY-MM-DD` key (lexicographic == chronological), matching the web
    /// `sort(([a], [b]) => a.localeCompare(b))`.
    public static func dayPoints(
        from buckets: [SentryDayBucket],
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> [SentryDayPoint] {
        buckets
            .sorted { $0.date < $1.date }
            .map { bucket in
                SentryDayPoint(
                    dateKey: bucket.date,
                    label: shortLabel(for: bucket.date, locale: locale, timeZone: timeZone),
                    sentryOn: max(0, bucket.sentryOn),
                    sentryOff: max(0, bucket.sentryOff)
                )
            }
    }

    /// The flattened `(day, series)` rows for the stacked Swift Charts grid, in
    /// plot order (web On bar before Off bar) within each day.
    public static func chartRows(from points: [SentryDayPoint]) -> [SentryChartRow] {
        points.flatMap { point in
            SentrySeries.allCases
                .sorted { $0.order < $1.order }
                .map { series in
                    SentryChartRow(
                        dateKey: point.dateKey,
                        label: point.label,
                        series: series,
                        count: point.count(for: series)
                    )
                }
        }
    }

    /// Resolves the render phase from the bound load status + whether any day
    /// resolved (web `sentryBuckets.length > 0 ? content : empty`).
    public static func resolvePhase(_ status: SentryModeLoadStatus, hasDays: Bool) -> SentryModePhase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .loaded:
            hasDays ? .content : .empty
        }
    }

    /// Sum of the armed series across all days (chart summary / a11y).
    public static func totalOn(_ points: [SentryDayPoint]) -> Int {
        points.reduce(0) { $0 + $1.sentryOn }
    }

    /// Sum of the off series across all days (chart summary / a11y).
    public static func totalOff(_ points: [SentryDayPoint]) -> Int {
        points.reduce(0) { $0 + $1.sentryOff }
    }

    /// The web `formatDateShort(date)` — a locale-aware "MMM d" label, with the
    /// em-dash sentinel for an empty / unparseable key (web returns `'—'`).
    public static func shortLabel(
        for dateKey: String,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String {
        guard let day = parseDay(dateKey, timeZone: timeZone) else { return "—" }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.setLocalizedDateFormatFromTemplate("MMMd")
        return formatter.string(from: day)
    }

    /// Parses a `YYYY-MM-DD` key (the first 10 chars, tolerating a trailing time)
    /// as a wall-clock day in `timeZone`. Returns `nil` for anything malformed.
    private static func parseDay(_ key: String, timeZone: TimeZone) -> Date? {
        guard key.count >= 10 else { return nil }
        let dayKey = String(key.prefix(10))
        let parser = DateFormatter()
        parser.locale = Locale(identifier: "en_US_POSIX")
        parser.timeZone = timeZone
        parser.dateFormat = "yyyy-MM-dd"
        parser.isLenient = false
        return parser.date(from: dayKey)
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the
/// dependency-free core so it is reachable from the projection's unit tests.
public enum SentryModeSurface {
    public static let slug = "SentryModeChart"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected
/// localizer (`(key, fallback) -> String`) so the summaries are testable without
/// a bundle, exactly like the view's P1/S10 facade.
public enum SentryModeAccessibility {
    /// The chart-level summary: title + day count + armed/off totals.
    public static func chartSummary(
        points: [SentryDayPoint],
        localize: (String, String) -> String
    ) -> String {
        let title = localize("admin.security.sentryChart", "Sentry Mode Activity")
        guard !points.isEmpty else {
            return "\(title): \(localize("common.noData", "No data available"))"
        }
        let on = SentryModeProjection.totalOn(points)
        let off = SentryModeProjection.totalOff(points)
        let onLabel = localize(SentrySeries.on.localizationKey, SentrySeries.on.fallback)
        let offLabel = localize(SentrySeries.off.localizationKey, SentrySeries.off.fallback)
        let days = localize("admin.security.chart.dayCount", "days")
        return "\(title): \(points.count) \(days), \(on) \(onLabel), \(off) \(offLabel)"
    }

    /// One column's VoiceOver value: "{label}: Sentry On X, Sentry Off Y".
    public static func columnLabel(
        _ point: SentryDayPoint,
        localize: (String, String) -> String
    ) -> String {
        let onLabel = localize(SentrySeries.on.localizationKey, SentrySeries.on.fallback)
        let offLabel = localize(SentrySeries.off.localizationKey, SentrySeries.off.fallback)
        return "\(point.label): \(onLabel) \(point.sentryOn), \(offLabel) \(point.sentryOff)"
    }
}
