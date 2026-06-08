//
//  PowerOutputChart.Adapter.swift
//  TeslaSync — P4 feature view · 0158 · PowerOutputChart (Apple)
//
//  The testable projection core for the "Power Output History" drivetrain surface — a
//  faithful port of the per-drive peak/regen area chart in
//  features/driving/components/drivetrain-health/PowerOutputChart.tsx (fed by the
//  parent DrivetrainHealthPage `chartData` memo). Everything here is pure and
//  dependency-free (Foundation only) so it unit-tests without a bundle or a rendered
//  view.
//
//  Web parity notes:
//    • The web receives `ChartDataPoint[]` already mapped by the page:
//        date    = formatDateShort(startTs)
//        powerMax = (avgPowerW ?? 0) / 1000     (kW; SI watts ÷ 1000)
//        powerMin = 0                            (regen; SI watts ÷ 1000 in general)
//      sorted ascending by start time and capped to the last 30 drives. This adapter
//      takes the SI-canonical watts (`peakPowerW` / `regenPowerW`) and derives kW only
//      at the chart boundary, mirroring `peak_power_w / 1000` — the on-disk value stays
//      SI (ADR-009 / the frontend SI cutover) and display conversion happens here.
//    • `series(from:)` reproduces the sort-ascending + `slice(-30)` trim, then emits the
//      two overlaid series the web renders: `powerMax` (Peak, web stroke #8b5cf6) and
//      `powerMin` (Regen, web stroke #ef4444). The series ids match the web `dataKey`s so
//      the toggle legend (web `useHiddenSeries`) round-trips the same keys.
//    • The web `if (data.length <= 1) return null` becomes the resolved `.empty` phase —
//      the prompt requires a friendly empty state, never a hidden/blank surface.
//    • `shortLabel` is the web `formatDateShort` ("MMM d"), with the em-dash sentinel for
//      a missing instant.
//

import Foundation

// MARK: - Drive input (the web `ChartDataPoint` fields this surface reads)

/// One drive projected for the power-output chart — the SwiftUI parity of the subset of
/// the web `ChartDataPoint` this component touches. Power is SI watts (the on-disk
/// canonical); kW is derived only at the chart display boundary, matching the web
/// `avgPowerW / 1000`. `peakPowerW` / `regenPowerW` are optional so the web `?? 0`
/// defaults are exercised.
public struct PowerOutputPoint: Sendable, Equatable, Identifiable {
    public var id: Int
    /// The drive's start instant (web `startTs`); the x-label is `formatDateShort`.
    public var date: Date
    /// Peak motor power in watts, SI canonical (web `powerMax`, derived from `avgPowerW`).
    public var peakPowerW: Double?
    /// Regen (minimum) motor power in watts, SI canonical (web `powerMin`).
    public var regenPowerW: Double?

    public init(id: Int, date: Date, peakPowerW: Double?, regenPowerW: Double?) {
        self.id = id
        self.date = date
        self.peakPowerW = peakPowerW
        self.regenPowerW = regenPowerW
    }
}

// MARK: - Series role (web `<Area dataKey>` identity + color intent)

/// The two overlaid traces the web renders. Each case carries the web `dataKey` (the
/// stable toggle id round-tripped by `useHiddenSeries`), the series-name i18n key + the
/// web English fallback, and the export-column key — so the view resolves every label
/// through the P1/S10 facade rather than a hardcoded literal. The SwiftUI color is
/// composed at the view boundary (`PowerOutputStyle`), keeping this projection UI-free.
public enum PowerSeriesRole: String, Sendable, Equatable, CaseIterable, Identifiable {
    /// Peak motor power (web `dataKey="powerMax"`, stroke #8b5cf6 violet).
    case peak
    /// Regenerative (minimum) power (web `dataKey="powerMin"`, stroke #ef4444 red).
    case regen

    public var id: String {
        switch self {
        case .peak: "powerMax"
        case .regen: "powerMin"
        }
    }

    /// The series-name i18n key (web `<Area name={t(...)}>`).
    public var nameKey: String {
        switch self {
        case .peak: "drivetrain.powerMax"
        case .regen: "drivetrain.powerMin"
        }
    }

    /// The web English fallback for the series name (verbatim from the source).
    public var nameFallback: String {
        switch self {
        case .peak: "Peak Power (kW)"
        case .regen: "Regen Power (kW)"
        }
    }

    /// The export-column i18n key (web `dataColumns[].label`).
    public var columnKey: String {
        switch self {
        case .peak: "drivetrain.col.powerMax"
        case .regen: "drivetrain.col.powerMin"
        }
    }

    /// The web English fallback for the export-column header.
    public var columnFallback: String {
        switch self {
        case .peak: "Peak (kW)"
        case .regen: "Regen (kW)"
        }
    }
}

// MARK: - Sample + series (one overlaid area)

/// One sampled point on a series' per-drive curve. `kw` is the plotted display value
/// (kW), mirroring the web `powerMax` / `powerMin`.
public struct PowerSample: Sendable, Equatable, Identifiable {
    public var date: Date
    public var kw: Double

    public var id: Date {
        date
    }

    public init(date: Date, kw: Double) {
        self.date = date
        self.kw = kw
    }
}

/// One overlaid power area for the chart — the native parity of a web `<Area>` plus its
/// role (id / name / color intent). The localized name and SwiftUI color are composed at
/// the view boundary from `role`, keeping this projection free of UI dependencies.
public struct PowerOutputSeries: Sendable, Equatable, Identifiable {
    public var role: PowerSeriesRole
    public var samples: [PowerSample]

    public var id: String {
        role.id
    }

    public init(role: PowerSeriesRole, samples: [PowerSample]) {
        self.role = role
        self.samples = samples
    }

    /// The series' peak (max) plotted power (kW) — a VoiceOver headline value.
    public var maxKw: Double {
        samples.map(\.kw).max() ?? 0
    }

    /// The series' minimum plotted power (kW) — the regen trace's headline value.
    public var minKw: Double {
        samples.map(\.kw).min() ?? 0
    }
}

// MARK: - Render phase + bound load/freshness status

/// What the surface should render. The web component itself only distinguishes
/// content-vs-null (`data.length <= 1` hides it); the loading / error envelope (prompt
/// P4 states) is supplied by the bound source, mirroring the web parent page's
/// `isLoading` / error wiring around `<PowerOutputChart>`.
public enum PowerOutputPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status for the drives query (web `isLoading` / resolved /
/// failure), projected into a phase by `resolvePhase`.
public enum PowerOutputLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner so
/// a cached trend is clearly labeled while reconnecting / offline.
public enum PowerOutputConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Projection core (pure)

/// The dependency-free projection from raw drives to overlaid area series + the render
/// phase. A faithful port of the web page's sort-ascending + `slice(-30)` + per-drive
/// `avgPowerW / 1000` mapping, plus the component's `data.length <= 1` empty rule.
public enum PowerOutputProjection {
    /// The web page `slice(-30)` cap — the last 30 drives in the selected range.
    public static let maxPoints = 30

    /// Watts → kilowatts (web `power_w / 1000`).
    public static func wattsToKw(_ watts: Double?) -> Double {
        (watts ?? 0) / 1000
    }

    /// Sorts the drives ascending by start instant and keeps the last `maxPoints` (web
    /// `.sort(asc).slice(-30)`).
    public static func trimmed(_ points: [PowerOutputPoint]) -> [PowerOutputPoint] {
        let sorted = points.sorted { $0.date < $1.date }
        return sorted.count > maxPoints ? Array(sorted.suffix(maxPoints)) : sorted
    }

    /// Whether the chart has anything renderable — the web `data.length <= 1 → null`
    /// guard, evaluated against the trimmed series the chart would draw.
    public static func hasRenderableData(_ points: [PowerOutputPoint]) -> Bool {
        trimmed(points).count > 1
    }

    /// The two overlaid series (Peak + Regen), each sampled from the trimmed drives with
    /// power converted to kW. The series order matches the web `<Area>` order so the
    /// legend + palette line up.
    public static func series(from points: [PowerOutputPoint]) -> [PowerOutputSeries] {
        let drives = trimmed(points)
        guard drives.count > 1 else { return [] }
        return PowerSeriesRole.allCases.map { role in
            let samples = drives.map { drive in
                let watts = role == .peak ? drive.peakPowerW : drive.regenPowerW
                return PowerSample(date: drive.date, kw: wattsToKw(watts))
            }
            return PowerOutputSeries(role: role, samples: samples)
        }
    }

    /// Resolves the render phase from the bound load status + whether the trimmed data is
    /// renderable (web `data.length <= 1 ? null : chart`).
    public static func resolvePhase(_ status: PowerOutputLoadStatus, hasData: Bool) -> PowerOutputPhase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .loaded:
            hasData ? .content : .empty
        }
    }

    /// The inclusive kW span across the *visible* series, always including the y=0 regen
    /// reference line (web `ReferenceLine y={0}`). `nil` when nothing is visible.
    public static func valueDomain(
        for series: [PowerOutputSeries],
        hidden: Set<String> = []
    ) -> ClosedRange<Double>? {
        let values = series
            .filter { !hidden.contains($0.id) }
            .flatMap { $0.samples.map(\.kw) }
        guard let lower = values.min(), let upper = values.max() else { return nil }
        return Swift.min(lower, 0) ... Swift.max(upper, 0)
    }

    /// The inclusive date span across all series — the chart's x-domain. `nil` when empty.
    public static func dateDomain(for series: [PowerOutputSeries]) -> ClosedRange<Date>? {
        let dates = series.flatMap { $0.samples.map(\.date) }
        guard let lower = dates.min(), let upper = dates.max() else { return nil }
        return lower == upper ? lower ... upper.addingTimeInterval(1) : lower ... upper
    }

    /// The web `formatDateShort(date)` — a locale-aware "MMM d" label, with the em-dash
    /// sentinel for a missing instant (web returns `'—'`).
    public static func shortLabel(
        for date: Date?,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String {
        guard let date else { return "—" }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.setLocalizedDateFormatFromTemplate("MMMd")
        return formatter.string(from: date)
    }

    /// Toggles a series id in the hidden set (legend visibility, web `useHiddenSeries`).
    /// Pure, so the toggle behavior unit-tests without the view.
    public static func toggleHidden(_ hidden: Set<String>, _ seriesID: String) -> Set<String> {
        var next = hidden
        if next.contains(seriesID) { next.remove(seriesID) } else { next.insert(seriesID) }
        return next
    }
}

// MARK: - CSV export (web `ChartContainer` data export)

/// Builds the copy-to-clipboard CSV the web `ChartContainer` exposes via its export menu,
/// using the three web `dataColumns` (Date / Peak (kW) / Regen (kW)). Pure + localizer-
/// injected so it tests bundle-free.
public enum PowerOutputExport {
    /// The CSV string: a localized header row followed by one row per trimmed drive.
    public static func csv(
        from points: [PowerOutputPoint],
        localize: (String, String) -> String,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String {
        let header = [
            localize("drivetrain.col.date", "Date"),
            localize(PowerSeriesRole.peak.columnKey, PowerSeriesRole.peak.columnFallback),
            localize(PowerSeriesRole.regen.columnKey, PowerSeriesRole.regen.columnFallback)
        ]
        var rows = [header.joined(separator: ",")]
        for drive in PowerOutputProjection.trimmed(points) {
            let cells = [
                PowerOutputProjection.shortLabel(for: drive.date, locale: locale, timeZone: timeZone),
                formatKw(PowerOutputProjection.wattsToKw(drive.peakPowerW)),
                formatKw(PowerOutputProjection.wattsToKw(drive.regenPowerW))
            ]
            rows.append(cells.joined(separator: ","))
        }
        return rows.joined(separator: "\n")
    }

    /// A fixed-precision kW string (C-locale, deterministic for export + tests).
    static func formatKw(_ value: Double) -> String {
        String(format: "%.1f", value)
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the
/// dependency-free core so it is reachable from the projection's unit tests.
public enum PowerOutputSurface {
    public static let slug = "PowerOutputChart"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer
/// (`(key, fallback) -> String`) so the summaries are testable without a bundle, exactly
/// like the view's P1/S10 facade.
public enum PowerOutputAccessibility {
    /// The chart-level summary: title + drive count + peak kW + regen kW, noting any
    /// series the user has hidden via the legend.
    public static func chartSummary(
        series: [PowerOutputSeries],
        hidden: Set<String>,
        localize: (String, String) -> String
    ) -> String {
        let title = localize("drivetrain.powerOutput", "Power Output History")
        guard let first = series.first, !first.samples.isEmpty else {
            return "\(title): \(localize("common.noData", "No data available"))"
        }
        let drivesWord = localize("drivetrain.a11y.drives", "drives")
        let unit = localize("drivetrain.unitKw", "kW")
        let peakWord = localize("drivetrain.a11y.peak", "peak")
        let regenWord = localize("drivetrain.a11y.regen", "regen")
        var parts = ["\(title): \(first.samples.count) \(drivesWord)"]
        if let peak = series.first(where: { $0.role == .peak }), !hidden.contains(peak.id) {
            parts.append("\(peakWord) \(formatPower(peak.maxKw)) \(unit)")
        }
        if let regen = series.first(where: { $0.role == .regen }), !hidden.contains(regen.id) {
            parts.append("\(regenWord) \(formatPower(regen.minKw)) \(unit)")
        }
        return parts.joined(separator: ", ")
    }

    /// One series' VoiceOver value: "{name}: peak X kW" / "{name}: min X kW".
    public static func seriesLabel(
        _ series: PowerOutputSeries,
        localize: (String, String) -> String
    ) -> String {
        let name = localize(series.role.nameKey, series.role.nameFallback)
        let unit = localize("drivetrain.unitKw", "kW")
        switch series.role {
        case .peak:
            let peakWord = localize("drivetrain.a11y.peak", "peak")
            return "\(name): \(peakWord) \(formatPower(series.maxKw)) \(unit)"
        case .regen:
            let regenWord = localize("drivetrain.a11y.regen", "regen")
            return "\(name): \(regenWord) \(formatPower(series.minKw)) \(unit)"
        }
    }

    /// A fixed-precision power string (C-locale, deterministic for tests + VoiceOver).
    static func formatPower(_ value: Double) -> String {
        String(format: "%.1f", value)
    }
}
