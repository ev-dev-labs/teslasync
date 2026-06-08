//
//  StatChartSlide.Projection.swift
//  TeslaSync — P4 feature view · 0067 · StatChartSlide (Apple)
//
//  The cached→projection adapter (a faithful port of the web source's `chartData`
//  memo + the headline number formatting) plus the per-state presentation resolver.
//  Pure value logic — no SwiftUI, no networking — so every render branch is
//  unit-testable. Mirrors features/analytics/components/review/StatChartSlide.tsx.
//

import Foundation

// MARK: - Number formatting (ported from web lib/numberFormat.ts `fmtNumber`)

/// Locale-aware number formatting that mirrors the web `fmtNumber`
/// (`Number.toLocaleString` with fixed min/max fraction digits). The web slide uses
/// the default precision 0 for `total_drives` (an integer count) and precision 1 for
/// `avg_drives_per_week`; both are reproduced verbatim for cross-platform parity.
public enum StatChartSlideFormat {
    /// `safeNumber` from numberFormat.ts: non-finite inputs collapse to 0.
    static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// `fmtNumber(v, decimals, locale)` — fixed fraction digits, grouped, rounding
    /// half away from zero to match `toLocaleString`'s default `halfExpand`.
    public static func number(_ value: Double, decimals: Int, localeIdentifier: String = "en_US") -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = max(0, decimals)
        formatter.maximumFractionDigits = max(0, decimals)
        formatter.roundingMode = .halfUp
        let safe = safeNumber(value)
        return formatter.string(from: NSNumber(value: safe)) ?? String(format: "%.\(max(0, decimals))f", safe)
    }

    /// `fmtInt(v)` — `fmtNumber(v, 0)`.
    public static func integer(_ value: Int, localeIdentifier: String = "en_US") -> String {
        number(Double(value), decimals: 0, localeIdentifier: localeIdentifier)
    }
}

// MARK: - Month labels (web `MONTH_LABELS[m.month - 1] ?? `M${m.month}``)

/// Resolves the abbreviated x-axis label for a 1-based month index, reproducing the
/// web `MONTH_LABELS[m.month - 1] ?? `M${m.month}`` fallback. Locale-aware standalone
/// symbols (en_US → "Jan"…"Dec") match the web's hardcoded English array while
/// staying internationalised; an out-of-range month falls back to `M{n}` exactly
/// like the web source.
public enum StatChartSlideMonthLabel {
    public static func label(for month: Int, localeIdentifier: String = "en_US") -> String {
        let index = month - 1
        let symbols = shortMonthSymbols(localeIdentifier: localeIdentifier)
        guard index >= 0, index < symbols.count else { return "M\(month)" }
        return symbols[index]
    }

    private static func shortMonthSymbols(localeIdentifier: String) -> [String] {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        return formatter.shortStandaloneMonthSymbols ?? formatter.shortMonthSymbols ?? []
    }
}

// MARK: - Projection output value types

/// One chart bar: a 1-based month, its abbreviated label, and the drive count. Pure
/// value type so the `chartData` mapping is unit-tested. `id` is the month so the
/// x-domain stays chronological (web maps `monthly_stats` in order).
public struct StatChartSlideBar: Identifiable, Equatable, Sendable {
    public let id: Int
    public let month: Int
    public let label: String
    public let drives: Int

    public init(month: Int, label: String, drives: Int) {
        id = month
        self.month = month
        self.label = label
        self.drives = drives
    }
}

/// The fully-resolved render model for the content slide: the chart bars plus the
/// pre-formatted headline (total drives big number + average-per-week caption).
public struct StatChartSlideProjection: Equatable, Sendable {
    public let bars: [StatChartSlideBar]
    public let totalDrives: Int
    public let totalDrivesText: String
    public let avgPerWeekText: String

    public init(bars: [StatChartSlideBar], totalDrives: Int, totalDrivesText: String, avgPerWeekText: String) {
        self.bars = bars
        self.totalDrives = totalDrives
        self.totalDrivesText = totalDrivesText
        self.avgPerWeekText = avgPerWeekText
    }

    /// The largest bar value, used to scale the y-domain (`0` when there are no bars).
    public var maxDrives: Int {
        bars.map(\.drives).max() ?? 0
    }
}

// MARK: - Projection build (cached → projection)

public extension StatChartSlideProjection {
    /// Builds the projection from the cached recap, reproducing the web `chartData`
    /// memo (one bar per `monthly_stats` entry, labelled `MONTH_LABELS[month-1]`),
    /// the `AnimatedNumber` total (`fmtNumber(total_drives, 0)`), and the average
    /// caption (`fmtNumber(avg_drives_per_week, 1)` interpolated into the sentence).
    static func make(
        from data: StatChartSlideData,
        locale: Locale = .current
    ) -> StatChartSlideProjection {
        let localeID = locale.identifier
        let bars = data.monthlyStats.map { stat in
            StatChartSlideBar(
                month: stat.month,
                label: StatChartSlideMonthLabel.label(for: stat.month, localeIdentifier: localeID),
                drives: stat.drives
            )
        }
        let totalDrivesText = StatChartSlideFormat.integer(data.totalDrives, localeIdentifier: localeID)
        let avgText = StatChartSlideFormat.number(data.avgDrivesPerWeek, decimals: 1, localeIdentifier: localeID)
        let avgPerWeek = StatChartSlideStrings.format(
            "yearReview.avgPerWeek",
            "{{count}} drives per week on average",
            ["count": avgText]
        )
        return StatChartSlideProjection(
            bars: bars,
            totalDrives: data.totalDrives,
            totalDrivesText: totalDrivesText,
            avgPerWeekText: avgPerWeek
        )
    }
}

// MARK: - Freshness + presentation (every state)

/// Freshness chrome shown in the corner chip (web freshness indicator). The web leaf
/// has no freshness UI; this is the native chrome the P4 auto-refreshing-surface
/// contract requires, layered so cached values stay visible.
public enum StatChartSlideFreshness: Equatable, Sendable {
    case live
    case stale
    case offline
}

/// The mutually-exclusive surface for the current data state — exhaustive so each
/// branch is unit-tested (loading / empty / offline-no-data / error / content). The
/// web slide only ever renders content (the parent owns loading / error / empty);
/// this superset adds the prompt's required chrome while keeping cached recaps on
/// screen behind a refresh or transient failure.
public enum StatChartSlidePresentation: Equatable, Sendable {
    case loading
    case empty
    case offlineNoData
    case error(retryable: Bool)
    case content(StatChartSlideProjection, freshness: StatChartSlideFreshness, refreshing: Bool)
}

public extension StatChartSlidePresentation {
    /// Pure mapping from the cache-then-network load state (ADR-013) to a render-ready
    /// presentation. Keeps any cached recap visible behind a refresh / error; an empty
    /// resolved recap becomes the friendly empty state.
    static func resolve(
        state: StatChartSlideLoadState<StatChartSlideData>,
        locale: Locale = .current
    ) -> StatChartSlidePresentation {
        func project(_ data: StatChartSlideData) -> StatChartSlideProjection {
            StatChartSlideProjection.make(from: data, locale: locale)
        }

        switch state {
        case .idle:
            return .loading
        case let .loading(cached, stale):
            guard let cached, !cached.isEmpty else { return .loading }
            return .content(project(cached), freshness: stale ? .stale : .live, refreshing: true)
        case let .loaded(data, stale):
            return data.isEmpty
                ? .empty
                : .content(project(data), freshness: stale ? .stale : .live, refreshing: false)
        case .empty:
            return .empty
        case let .failed(error, cached, stale):
            return resolveFailure(error, cached: cached, stale: stale, project: project)
        }
    }

    private static func resolveFailure(
        _ error: StatChartSlideError,
        cached: StatChartSlideData?,
        stale: Bool,
        project: (StatChartSlideData) -> StatChartSlideProjection
    ) -> StatChartSlidePresentation {
        if error == .offline {
            guard let cached, !cached.isEmpty else { return .offlineNoData }
            return .content(project(cached), freshness: .offline, refreshing: false)
        }
        if let cached, !cached.isEmpty {
            return .content(project(cached), freshness: stale ? .stale : .live, refreshing: false)
        }
        return .error(retryable: error.isRetryable)
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the VoiceOver content spoken for the slide. Pure + public so the a11y
/// summary can be unit-tested without rendering the view.
public enum StatChartSlideAccessibility {
    /// The headline VoiceOver phrase: "{total} drives. {avg caption}", e.g.
    /// "1,284 drives. 24.7 drives per week on average".
    public static func headlineSummary(for projection: StatChartSlideProjection) -> String {
        let drives = StatChartSlideStrings.string("yearReview.drives", "drives")
        return "\(projection.totalDrivesText) \(drives). \(projection.avgPerWeekText)"
    }

    /// The per-bar VoiceOver value: "{month}: {count} drives" (web bar tooltip).
    public static func barValue(for bar: StatChartSlideBar, localeIdentifier: String = "en_US") -> String {
        let count = StatChartSlideFormat.integer(bar.drives, localeIdentifier: localeIdentifier)
        return StatChartSlideStrings.format(
            "yearReview.statChart.barA11y",
            "{{month}}: {{count}} drives",
            ["month": bar.label, "count": count]
        )
    }
}
