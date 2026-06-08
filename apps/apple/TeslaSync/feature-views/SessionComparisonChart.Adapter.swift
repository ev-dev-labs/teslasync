//
//  SessionComparisonChart.Adapter.swift
//  TeslaSync — P4 feature view · 0089 · SessionComparisonChart (Apple)
//
//  The testable projection core for the "Session Comparison" charging surface — a
//  faithful port of the overlaid power-vs-SOC line chart in
//  features/charging/components/charging-curve/SessionComparisonChart.tsx (fed by the
//  sibling `helpers.ts` `generateChargingCurve` / `getChargerLabel`). Everything here
//  is pure and dependency-free (Foundation only) so it unit-tests without a bundle or
//  a rendered view.
//
//  Web parity notes:
//    • `ComparisonSession` carries only the `ChargingSession` fields the web reads:
//      id, started_at, start/end SOC, peak_power_w (SI watts), charger_type.
//    • `curve(for:)` reproduces `generateChargingCurve` exactly: the DC taper bands
//      (≤50 flat, 50–80 linear taper to 50 %, >80 steep drop) and the AC flat line,
//      power in kW = peak_power_w / 1000 (the chart's display unit, web Y "Power (kW)").
//    • `series(from:)` reproduces `sessions.slice(0, 10)` + the per-SOC merge rounding
//      (`Math.round(power * 10) / 10`) and assigns each session a palette index.
//    • `shortLabel` is the web `formatDateShort(started_at)` ("MMM d"), with the
//      em-dash sentinel for a missing timestamp (web returns `'—'`).
//    • The web `comparisonSessions.length ? <chart> : <empty merge>` becomes the
//      resolved `.content` vs `.empty` phase.
//

import Foundation

// MARK: - Session input (the web `ChargingSession` fields this surface reads)

/// One charging session projected for the comparison chart — the SwiftUI parity of
/// the subset of `ChargingSession` (api/types.ts) the web component touches. SOC and
/// power are optional so the web `?? 0` / `?? 100` / `?? 11_000` defaults are
/// exercised. `peakPowerW` is SI watts (the on-disk canonical); kW is derived only at
/// the chart display boundary, matching the web `peak_power_w / 1000`.
public struct ComparisonSession: Sendable, Equatable, Identifiable {
    public var id: Int
    /// The session start instant (web `started_at`); the x-label is `formatDateShort`.
    public var startedAt: Date?
    /// Start state-of-charge percent (web `start_soc_pct`, defaulted to 0).
    public var startSocPct: Double?
    /// End state-of-charge percent (web `end_soc_pct`, defaulted to 100).
    public var endSocPct: Double?
    /// Peak charger power in watts, SI canonical (web `peak_power_w`, defaulted 11 kW).
    public var peakPowerW: Double?
    /// Charger type string (web `charger_type`) — drives the DC / AC classification.
    public var chargerType: String?

    public init(
        id: Int,
        startedAt: Date?,
        startSocPct: Double?,
        endSocPct: Double?,
        peakPowerW: Double?,
        chargerType: String?
    ) {
        self.id = id
        self.startedAt = startedAt
        self.startSocPct = startSocPct
        self.endSocPct = endSocPct
        self.peakPowerW = peakPowerW
        self.chargerType = chargerType
    }
}

// MARK: - Curve point (web `CurvePoint` { soc, power })

/// One sampled point on a session's power-vs-SOC curve. `powerKw` is the plotted
/// display value (kW), mirroring the web `CurvePoint.power`.
public struct CurvePoint: Sendable, Equatable, Identifiable {
    public var soc: Double
    public var powerKw: Double

    public var id: Double {
        soc
    }

    public init(soc: Double, powerKw: Double) {
        self.soc = soc
        self.powerKw = powerKw
    }
}

// MARK: - Charger classification (web `getChargerLabel`)

/// The charger family the web `getChargerLabel` derives from `charger_type` /
/// `peak_power_w`. Each case carries the i18n key + the web English fallback so the
/// view resolves the label through the P1/S10 facade rather than a hardcoded literal.
public enum ChargerKind: String, Sendable, Equatable, CaseIterable, Identifiable {
    case supercharger
    case dcFast
    case homeAc

    public var id: String {
        rawValue
    }

    /// The i18n key the label resolves (web helper returns these English strings).
    public var localizationKey: String {
        switch self {
        case .supercharger: "charging.curve.charger.supercharger"
        case .dcFast: "charging.curve.charger.dcFast"
        case .homeAc: "charging.curve.charger.homeAc"
        }
    }

    /// The web English fallback for `localizationKey` (verbatim from `helpers.ts`).
    public var fallback: String {
        switch self {
        case .supercharger: "Supercharger"
        case .dcFast: "DC Fast"
        case .homeAc: "Home / AC"
        }
    }
}

// MARK: - Projected series (one overlaid line)

/// One overlaid power curve for the chart — the native parity of a web `<Line>` plus
/// its palette index + legend label. The localized series name (date + charger) and
/// the SwiftUI color are composed at the view boundary from `dateLabel` / `charger` /
/// `colorIndex`, keeping this projection free of UI dependencies.
public struct ComparisonSeries: Sendable, Equatable, Identifiable {
    /// Stable plot key (web Recharts `dataKey="s{i}"`).
    public var id: String
    /// The session's position in the (sliced) input — the palette index seed.
    public var index: Int
    /// Localized short x-label for the legend (web `formatDateShort(started_at)`).
    public var dateLabel: String
    /// The charger family (web `getChargerLabel`) — localized at the view.
    public var charger: ChargerKind
    /// Palette index (web `palette[i % palette.length]`).
    public var colorIndex: Int
    /// The sampled, display-rounded curve points.
    public var points: [CurvePoint]

    public init(
        id: String,
        index: Int,
        dateLabel: String,
        charger: ChargerKind,
        colorIndex: Int,
        points: [CurvePoint]
    ) {
        self.id = id
        self.index = index
        self.dateLabel = dateLabel
        self.charger = charger
        self.colorIndex = colorIndex
        self.points = points
    }

    /// The series' peak plotted power (kW) — the tooltip / VoiceOver headline value.
    public var peakPowerKw: Double {
        points.map(\.powerKw).max() ?? 0
    }
}

// MARK: - Render phase + bound load/freshness status

/// What the surface should render. The web component itself only distinguishes
/// content-vs-empty (an empty merge yields a bare chart); the loading / error
/// envelope (prompt P4 states) is supplied by the bound source, mirroring the web
/// parent page's `isLoading` / error wiring around `<SessionComparisonChart>`.
public enum ComparisonPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status for the sessions query (web `isLoading` /
/// resolved / failure), projected into a phase by `resolvePhase`.
public enum ComparisonLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data
/// banner so cached curves are clearly labeled while reconnecting / offline.
public enum ComparisonConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Projection core (pure)

/// The dependency-free projection from raw sessions to overlaid curve series + the
/// render phase. A faithful port of the web component's `generateChargingCurve` +
/// `slice(0, 10)` + per-SOC merge rounding.
public enum ComparisonProjection {
    /// The web `sessions.slice(0, 10)` cap.
    public static let maxSessions = 10
    /// The web `peak_power_w ?? 11_000` default (watts).
    public static let defaultPeakPowerW: Double = 11000
    /// The web `peak_power_w > 20_000` DC threshold (watts).
    public static let dcThresholdW: Double = 20000

    /// Whether the session charged on DC (web `isDcSession`): a non-empty
    /// `charger_type` OR a peak above the DC threshold.
    public static func isDc(_ session: ComparisonSession) -> Bool {
        if let type = session.chargerType, !type.isEmpty {
            return true
        }
        if let peak = session.peakPowerW, peak > dcThresholdW {
            return true
        }
        return false
    }

    /// The charger family (web `getChargerLabel`): Tesla → Supercharger, any other
    /// non-empty type or an above-threshold peak → DC Fast, else Home / AC.
    public static func chargerKind(for session: ComparisonSession) -> ChargerKind {
        let type = session.chargerType ?? ""
        if type == "Tesla" || type.lowercased().contains("tesla") {
            return .supercharger
        }
        if !type.isEmpty {
            return .dcFast
        }
        if let peak = session.peakPowerW, peak > dcThresholdW {
            return .dcFast
        }
        return .homeAc
    }

    /// The simulated power-vs-SOC curve (web `generateChargingCurve`): stepping SOC by
    /// 1 from the (defaulted) start to the (defaulted) end, applying the DC taper
    /// bands or the AC flat line, clamped at zero. Power is kW = watts / 1000.
    public static func curve(for session: ComparisonSession) -> [CurvePoint] {
        let startSoc = session.startSocPct ?? 0
        let endSoc = session.endSocPct ?? 100
        let peakPowerKw = (session.peakPowerW ?? defaultPeakPowerW) / 1000
        let dc = isDc(session)

        var points: [CurvePoint] = []
        var soc = startSoc
        while soc <= endSoc {
            let power: Double
            if dc {
                if soc <= 50 {
                    power = peakPowerKw
                } else if soc <= 80 {
                    let taper = 1 - ((soc - 50) / 30) * 0.5
                    power = peakPowerKw * taper
                } else {
                    let drop = 1 - ((soc - 80) / 20) * 0.7
                    power = peakPowerKw * 0.5 * drop
                }
            } else {
                power = peakPowerKw
            }
            points.append(CurvePoint(soc: soc, powerKw: max(power, 0)))
            soc += 1
        }
        return points
    }

    /// The overlaid series for the chart: the first `maxSessions` sessions (web
    /// `slice(0, 10)`), each projected to a curve with display-rounded power (web
    /// merge `Math.round(power * 10) / 10`), a localized short date label, a charger
    /// family, and a wrapping palette index.
    public static func series(
        from sessions: [ComparisonSession],
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> [ComparisonSeries] {
        sessions.prefix(maxSessions).enumerated().map { index, session in
            let rounded = curve(for: session).map { point in
                CurvePoint(soc: point.soc, powerKw: roundTenth(point.powerKw))
            }
            return ComparisonSeries(
                id: "s\(index)",
                index: index,
                dateLabel: shortLabel(for: session.startedAt, locale: locale, timeZone: timeZone),
                charger: chargerKind(for: session),
                colorIndex: index,
                points: rounded
            )
        }
    }

    /// Resolves the render phase from the bound load status + whether any series
    /// projected (web `comparisonSessions.length ? content : empty`).
    public static func resolvePhase(_ status: ComparisonLoadStatus, hasSeries: Bool) -> ComparisonPhase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .loaded:
            hasSeries ? .content : .empty
        }
    }

    /// The inclusive SOC span across all series — the chart's x-domain (web auto
    /// scale). `nil` when no series carries a point.
    public static func socDomain(for series: [ComparisonSeries]) -> ClosedRange<Double>? {
        let socs = series.flatMap { $0.points.map(\.soc) }
        guard let lower = socs.min(), let upper = socs.max() else {
            return nil
        }
        return lower ... upper
    }

    /// The peak plotted power (kW) across all series — the chart's y headroom + the
    /// VoiceOver headline.
    public static func peakPowerKw(of series: [ComparisonSeries]) -> Double {
        series.flatMap { $0.points.map(\.powerKw) }.max() ?? 0
    }

    /// The web `formatDateShort(date)` — a locale-aware "MMM d" label, with the
    /// em-dash sentinel for a missing instant (web returns `'—'`).
    public static func shortLabel(
        for date: Date?,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String {
        guard let date else {
            return "—"
        }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.setLocalizedDateFormatFromTemplate("MMMd")
        return formatter.string(from: date)
    }

    /// Rounds a kW value to one decimal (web merge `Math.round(power * 10) / 10`).
    static func roundTenth(_ value: Double) -> Double {
        (value * 10).rounded() / 10
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the
/// dependency-free core so it is reachable from the projection's unit tests.
public enum ComparisonSurface {
    public static let slug = "SessionComparisonChart"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected
/// localizer (`(key, fallback) -> String`) so the summaries are testable without a
/// bundle, exactly like the view's P1/S10 facade.
public enum ComparisonAccessibility {
    /// The chart-level summary: title + session count + peak power.
    public static func chartSummary(
        series: [ComparisonSeries],
        localize: (String, String) -> String
    ) -> String {
        let title = localize("charging.curve.sessionComparison", "Session Comparison")
        guard !series.isEmpty else {
            return "\(title): \(localize("common.noData", "No data available"))"
        }
        let sessions = localize("charging.curve.chart.sessionCount", "sessions")
        let peakWord = localize("charging.curve.chart.peak", "peak")
        let unit = localize("charging.curve.unitKw", "kW")
        let peak = formatPower(ComparisonProjection.peakPowerKw(of: series))
        return "\(title): \(series.count) \(sessions), \(peakWord) \(peak) \(unit)"
    }

    /// One series' VoiceOver value: "{date} ({charger}): peak X kW".
    public static func seriesLabel(
        _ series: ComparisonSeries,
        localize: (String, String) -> String
    ) -> String {
        let charger = localize(series.charger.localizationKey, series.charger.fallback)
        let peakWord = localize("charging.curve.chart.peak", "peak")
        let unit = localize("charging.curve.unitKw", "kW")
        return "\(series.dateLabel) (\(charger)): \(peakWord) \(formatPower(series.peakPowerKw)) \(unit)"
    }

    /// A fixed-precision power string (C-locale, deterministic for tests + VoiceOver).
    static func formatPower(_ value: Double) -> String {
        String(format: "%.1f", value)
    }
}
