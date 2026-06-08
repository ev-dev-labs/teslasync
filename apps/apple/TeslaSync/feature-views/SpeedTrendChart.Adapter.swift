//
//  SpeedTrendChart.Adapter.swift
//  TeslaSync — P4 feature view · 0092 · SpeedTrendChart (Apple)
//
//  Pure (Foundation-only) projection core for the "Charging Speed Trend" surface —
//  the faithful port of the monthly DC-vs-AC average charge-rate line chart in
//  features/charging/components/charging-curve/SpeedTrendChart.tsx (+ helpers.ts
//  `isDcSession` / `avg`). SI peak power → kW via `convertPowerFromSI(w,'kW') ==
//  w/1000`; each month's series is `Math.round(avg * 10) / 10`; the x value is the
//  raw `YYYY-MM` key with a locale "MMM yyyy" label (em dash for an invalid key).
//  Dependency-free so it unit-tests without a bundle or a rendered view.
//

import Foundation

// MARK: - Session input (web `ChargingSession` subset)

/// One charging session, narrowed to the fields the web `SpeedTrendChart`
/// `monthlyTrend` reads. The bound source maps the shared charging query into
/// these so the projection stays dependency-free and testable.
public struct SpeedTrendSession: Sendable, Equatable {
    /// ISO-8601 session start (web `started_at`); the month key is its first 7
    /// characters (`YYYY-MM`).
    public var startedAt: String?
    /// Peak charging power in watts (SI, web `peak_power_w`).
    public var peakPowerW: Double?
    /// Charger type label (web `charger_type`); any non-empty value marks the
    /// session as DC for the web `isDcSession` heuristic.
    public var chargerType: String?

    public init(startedAt: String?, peakPowerW: Double?, chargerType: String?) {
        self.startedAt = startedAt
        self.peakPowerW = peakPowerW
        self.chargerType = chargerType
    }
}

// MARK: - Series (web `dataKey` "dcAvgKw" / "acAvgKw")

/// The two plotted series, mirroring the web `<Line>` keys + names. `order` pins
/// the plot / legend sequence (web DC line before AC line).
public enum SpeedSeries: String, Sendable, Equatable, CaseIterable, Identifiable {
    case dc
    case ac

    public var id: String {
        rawValue
    }

    /// Plot / legend order (web renders the `dcAvgKw` line before `acAvgKw`).
    public var order: Int {
        switch self {
        case .dc: 0
        case .ac: 1
        }
    }

    /// The categorical chart-palette index (web line `stroke={palette[0/1]}`).
    public var colorIndex: Int {
        switch self {
        case .dc: 0
        case .ac: 1
        }
    }

    /// The i18n key for the series' tooltip / line name (web `<Line name>`).
    public var nameKey: String {
        switch self {
        case .dc: "charging.curve.dcAvg"
        case .ac: "charging.curve.acAvg"
        }
    }

    /// The web English fallback for `nameKey`.
    public var nameFallback: String {
        switch self {
        case .dc: "DC Avg"
        case .ac: "AC Avg"
        }
    }

    /// The i18n key for the bottom-legend label (web swatch caption).
    public var legendKey: String {
        switch self {
        case .dc: "charging.curve.dcFast"
        case .ac: "charging.curve.acHome"
        }
    }

    /// The web English fallback for `legendKey`.
    public var legendFallback: String {
        switch self {
        case .dc: "DC Fast"
        case .ac: "AC / Home"
        }
    }
}

// MARK: - Monthly point (web `MonthlySpeed`)

/// One projected month: the raw key, its localized label, and both series'
/// rounded average kW. Drives the x-axis, the selection tooltip, and the
/// per-month VoiceOver value. The SwiftUI parity of the web `MonthlySpeed`.
public struct MonthlySpeedPoint: Sendable, Equatable, Identifiable {
    /// The `YYYY-MM` month key (web `month`, the `<XAxis dataKey>`).
    public var monthKey: String
    /// The locale-aware "MMM yyyy" label (em dash for an unparseable key).
    public var label: String
    /// Average DC charge rate that month in kW, rounded to one decimal (web
    /// `dcAvgKw`). `0` when the month had no DC sessions.
    public var dcAvgKw: Double
    /// Average AC charge rate that month in kW, rounded to one decimal (web
    /// `acAvgKw`). `0` when the month had no AC sessions.
    public var acAvgKw: Double

    public var id: String {
        monthKey
    }

    public init(monthKey: String, label: String, dcAvgKw: Double, acAvgKw: Double) {
        self.monthKey = monthKey
        self.label = label
        self.dcAvgKw = dcAvgKw
        self.acAvgKw = acAvgKw
    }

    /// The kW value for one series (chart / tooltip / a11y).
    public func value(for series: SpeedSeries) -> Double {
        switch series {
        case .dc: dcAvgKw
        case .ac: acAvgKw
        }
    }
}

// MARK: - Chart row (one (month, series) line segment point)

/// One `(month, series)` plot point for the Swift Charts grid. The web declares
/// two `<Line>` elements implicitly across `monthlyTrend`; the native chart plots
/// an explicit row per series per month so a single `ForEach` drives both lines.
public struct SpeedTrendRow: Sendable, Equatable, Identifiable {
    /// The owning month key (`YYYY-MM`) — the chart's x value (stable + sortable).
    public var monthKey: String
    /// The localized short x-axis label (web month, formatted "MMM yyyy").
    public var label: String
    /// Which series this point belongs to.
    public var series: SpeedSeries
    /// The point's value in kW (web line height).
    public var valueKw: Double

    public var id: String {
        "\(monthKey)#\(series.rawValue)"
    }

    public init(monthKey: String, label: String, series: SpeedSeries, valueKw: Double) {
        self.monthKey = monthKey
        self.label = label
        self.series = series
        self.valueKw = valueKw
    }
}

// MARK: - Render phase (web content/empty split, plus the load envelope)

/// What the surface should render. The web source only distinguishes
/// content-vs-empty (`monthlyTrend.length` drives the `ChartContainer` empty
/// overlay); the loading / error envelope around it (prompt P4 states) is
/// supplied by the bound source, mirroring the web parent page's `isLoading` /
/// error wiring on the charging-curve page.
public enum SpeedTrendPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status for the charging query (web `isLoading` /
/// resolved / failure), projected into a phase by `resolvePhase`.
public enum SpeedTrendLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data
/// banner so a cached trend is clearly labeled while reconnecting / offline.
public enum SpeedTrendConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Projection core (pure)

/// The dependency-free projection from raw sessions to chart-ready months + rows
/// + render phase. A faithful port of the web `monthlyTrend` `useMemo`: it groups
/// sessions by `YYYY-MM`, splits DC vs AC with the `isDcSession` heuristic,
/// averages each bucket's kW, rounds to one decimal, sorts ascending by month
/// key, and resolves the content/empty split.
public enum SpeedTrendProjection {
    /// The DC threshold in watts (web `peak_power_w > 20_000`).
    public static let dcPowerThresholdW: Double = 20000

    /// Chronologically ordered monthly points with localized labels. Sorted by
    /// the `YYYY-MM` key (lexicographic == chronological), matching the web
    /// `sort(([a], [b]) => a.localeCompare(b))`.
    public static func monthlyTrend(
        from sessions: [SpeedTrendSession],
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> [MonthlySpeedPoint] {
        guard !sessions.isEmpty else { return [] }

        var dcByMonth: [String: [Double]] = [:]
        var acByMonth: [String: [Double]] = [:]
        var order: [String] = []

        for session in sessions {
            let month = monthKey(from: session.startedAt)
            if dcByMonth[month] == nil {
                dcByMonth[month] = []
                acByMonth[month] = []
                order.append(month)
            }
            let powerKw = (session.peakPowerW ?? 0) / 1000
            if isDcSession(session) {
                dcByMonth[month, default: []].append(powerKw)
            } else {
                acByMonth[month, default: []].append(powerKw)
            }
        }

        return order
            .sorted { $0 < $1 }
            .map { month in
                MonthlySpeedPoint(
                    monthKey: month,
                    label: monthLabel(for: month, locale: locale, timeZone: timeZone),
                    dcAvgKw: roundedTenth(average(dcByMonth[month] ?? [])),
                    acAvgKw: roundedTenth(average(acByMonth[month] ?? []))
                )
            }
    }

    /// The flattened `(month, series)` rows for the Swift Charts grid, in plot
    /// order (web DC line before AC line) within each month.
    public static func chartRows(from points: [MonthlySpeedPoint]) -> [SpeedTrendRow] {
        points.flatMap { point in
            SpeedSeries.allCases
                .sorted { $0.order < $1.order }
                .map { series in
                    SpeedTrendRow(
                        monthKey: point.monthKey,
                        label: point.label,
                        series: series,
                        valueKw: point.value(for: series)
                    )
                }
        }
    }

    /// The web `isDcSession(s)` heuristic: a non-empty `charger_type`, or a peak
    /// power above the DC threshold (`!!(charger_type || (peak_power_w &&
    /// peak_power_w > 20_000))`).
    public static func isDcSession(_ session: SpeedTrendSession) -> Bool {
        let hasChargerType = !(session.chargerType ?? "").isEmpty
        let isHighPower = (session.peakPowerW ?? 0) > dcPowerThresholdW
        return hasChargerType || isHighPower
    }

    /// Resolves the render phase from the bound load status + whether any month
    /// resolved (web `monthlyTrend.length > 0 ? chart : empty overlay`).
    public static func resolvePhase(_ status: SpeedTrendLoadStatus, hasMonths: Bool) -> SpeedTrendPhase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .loaded:
            hasMonths ? .content : .empty
        }
    }

    /// The web `(s.started_at ?? '').slice(0, 7)` — the first 7 characters of the
    /// start timestamp (`YYYY-MM`), or `""` when absent.
    public static func monthKey(from startedAt: String?) -> String {
        String((startedAt ?? "").prefix(7))
    }

    /// A locale-aware "MMM yyyy" label for a `YYYY-MM` key (e.g. "May 2026"),
    /// with the em-dash sentinel for an empty / unparseable key (web `'—'`).
    public static func monthLabel(
        for monthKey: String,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String {
        guard let date = parseMonth(monthKey, timeZone: timeZone) else { return "—" }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.setLocalizedDateFormatFromTemplate("MMMyyyy")
        return formatter.string(from: date)
    }

    /// The most recent month (web array tail) — header summary / a11y.
    public static func latestPoint(_ points: [MonthlySpeedPoint]) -> MonthlySpeedPoint? {
        points.last
    }

    /// The arithmetic mean (web `avg`): `0` for an empty input.
    public static func average(_ values: [Double]) -> Double {
        guard !values.isEmpty else { return 0 }
        return values.reduce(0, +) / Double(values.count)
    }

    /// Rounds to one decimal place (web `Math.round(value * 10) / 10`).
    public static func roundedTenth(_ value: Double) -> Double {
        (value * 10).rounded() / 10
    }

    /// Parses a `YYYY-MM` month key as the first day of that month in `timeZone`.
    /// Returns `nil` for anything malformed.
    private static func parseMonth(_ key: String, timeZone: TimeZone) -> Date? {
        guard key.count == 7 else { return nil }
        let parser = DateFormatter()
        parser.locale = Locale(identifier: "en_US_POSIX")
        parser.timeZone = timeZone
        parser.dateFormat = "yyyy-MM"
        parser.isLenient = false
        return parser.date(from: key)
    }
}

// MARK: - Number formatting (pure, bundle-free)

/// Locale-aware numeric formatting for the kW values, shared by the chart, the
/// tooltip, and the accessibility summaries (bundle-free + unit-testable).
public enum SpeedTrendFormat {
    /// Formats a kW magnitude with up to one fraction digit (e.g. `12.5`, `11`).
    /// Non-finite input renders an em dash (never "nan").
    public static func decimal(_ value: Double, locale: Locale = .current) -> String {
        guard value.isFinite else { return "—" }
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 1
        return formatter.string(from: NSNumber(value: value)) ?? "\(value)"
    }

    /// Formats a kW magnitude with its localized unit (e.g. `12.5 kW`).
    public static func kilowatts(_ value: Double, unit: String, locale: Locale = .current) -> String {
        "\(decimal(value, locale: locale)) \(unit)"
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event (testable).
public enum SpeedTrendSurface {
    public static let slug = "SpeedTrendChart"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings through an injected localizer
/// (`(key, fallback) -> String`) + a `locale`, so they're bundle-free testable.
public enum SpeedTrendAccessibility {
    /// The chart-level summary: title + month count + the latest month's DC / AC
    /// averages, or the no-data fallback when empty.
    public static func chartSummary(
        points: [MonthlySpeedPoint],
        localize: (String, String) -> String,
        locale: Locale = .current
    ) -> String {
        let title = localize("charging.curve.speedTrend", "Charging Speed Trend")
        guard let latest = SpeedTrendProjection.latestPoint(points) else {
            return "\(title): \(localize("common.noData", "No data available"))"
        }
        let months = localize("charging.curve.monthCount", "months")
        let latestWord = localize("charging.curve.latest", "Latest")
        let pointValue = pointLabel(latest, localize: localize, locale: locale)
        return "\(title): \(points.count) \(months). \(latestWord) \(pointValue)"
    }

    /// One month's VoiceOver value: "{label}: DC Avg X kW, AC Avg Y kW".
    public static func pointLabel(
        _ point: MonthlySpeedPoint,
        localize: (String, String) -> String,
        locale: Locale = .current
    ) -> String {
        let unit = localize("charging.curve.kwUnit", "kW")
        let dcName = localize(SpeedSeries.dc.nameKey, SpeedSeries.dc.nameFallback)
        let acName = localize(SpeedSeries.ac.nameKey, SpeedSeries.ac.nameFallback)
        let dcValue = SpeedTrendFormat.kilowatts(point.dcAvgKw, unit: unit, locale: locale)
        let acValue = SpeedTrendFormat.kilowatts(point.acAvgKw, unit: unit, locale: locale)
        return "\(point.label): \(dcName) \(dcValue), \(acName) \(acValue)"
    }
}
