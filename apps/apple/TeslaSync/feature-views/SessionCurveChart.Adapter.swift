//
//  SessionCurveChart.Adapter.swift
//  TeslaSync — P4 feature view · 0090 · SessionCurveChart (Apple)
//
//  The testable projection core for the "Power vs SOC" charging-curve surface —
//  the faithful port of the area chart in
//  features/charging/components/charging-curve/SessionCurveChart.tsx and the
//  `generateChargingCurve` / `isDcSession` helpers (helpers.ts) that produce the
//  `curveData` the web component receives as a prop. Everything here is pure and
//  dependency-free (Foundation only) so it can be unit-tested without a bundle or
//  a rendered view.
//
//  Web parity notes:
//    • `SessionCurvePoint` mirrors the web `CurvePoint` (`{ soc, power }`) chart
//      datum; `power` is in kW (the web divides `peak_power_w` by 1000).
//    • `isDc` is the native `isDcSession`: a (JS-)truthy `charger_type` OR a peak
//      above 20 kW (`peak_power_w > 20000`).
//    • `generateChargingCurve` reproduces the web simulation exactly: a flat curve
//      for AC, and for DC a full-power plateau to 50%, a linear taper to 50% of
//      peak across 50–80%, then a steeper roll-off across 80–100%.
//    • The web feeds the RAW points to `<AreaChart>` and rounds power to one
//      decimal only for the `ChartContainer` data table
//      (`Math.round(p.power * 10) / 10`); `chartData` keeps that rounding for the
//      accessible data representation while the chart plots `points`.
//    • An empty curve (no selected session / a non-positive SOC span) → `.empty`;
//      the loading / error envelope (prompt P4 states) is supplied by the bound
//      source, mirroring the parent page's `isLoading` / refetch wiring.
//

import Foundation

// MARK: - Cached session input (subset of web `ChargingSession`)

/// The cached `ChargingSession` fields this surface consumes to simulate the
/// power-vs-SOC curve — the inputs to the web `generateChargingCurve(session)`.
/// Kept as a tiny value type so the curve core stays transport-free. Power is SI
/// on disk (watts, web `peak_power_w`); the projection converts to kW for display.
public struct SessionCurveInput: Sendable, Equatable {
    /// The battery level when charging began (web `start_soc_pct`, 0–100 percent).
    /// `nil` defaults to 0 (web `?? 0`).
    public var startSocPct: Double?
    /// The battery level when charging ended (web `end_soc_pct`, 0–100 percent).
    /// `nil` defaults to 100 (web `?? 100`).
    public var endSocPct: Double?
    /// The session's peak power in watts (web `peak_power_w`, SI). `nil` defaults
    /// to 11 kW (web `?? 11_000`).
    public var peakPowerW: Double?
    /// The charger label, if known (web `charger_type`). A non-empty value marks
    /// the session as DC (web `isDcSession`).
    public var chargerType: String?

    public init(
        startSocPct: Double? = nil,
        endSocPct: Double? = nil,
        peakPowerW: Double? = nil,
        chargerType: String? = nil
    ) {
        self.startSocPct = startSocPct
        self.endSocPct = endSocPct
        self.peakPowerW = peakPowerW
        self.chargerType = chargerType
    }
}

// MARK: - Curve point (web `CurvePoint`)

/// One point on the power-vs-SOC curve — the SwiftUI parity of the web
/// `CurvePoint` (`{ soc, power }`). `soc` is the state of charge (percent, the x
/// value) and `power` is the charging power in kW (the y value).
public struct SessionCurvePoint: Sendable, Equatable, Identifiable {
    /// The state of charge for this point (web `soc`, percent).
    public var soc: Double
    /// The charging power for this point (web `power`, kW).
    public var power: Double

    public var id: Double {
        soc
    }

    public init(soc: Double, power: Double) {
        self.soc = soc
        self.power = power
    }
}

// MARK: - Projection (the adapter output the view renders)

/// The fully-computed projection the view renders: the raw curve `points` the
/// chart plots, the `chartData` (power rounded to one decimal, web data-table
/// parity), and the derived summary the header + VoiceOver read. `hasData`
/// mirrors the web `curveData.length > 0` split between content and empty.
public struct SessionCurveProjection: Sendable, Equatable {
    /// The raw curve points fed to the chart (web `<AreaChart data={curveData}>`).
    public var points: [SessionCurvePoint]
    /// The curve points with power rounded to one decimal — the web data-table
    /// values (`Math.round(p.power * 10) / 10`), used by the accessible series.
    public var chartData: [SessionCurvePoint]
    /// Whether any point resolved (web `curveData.length > 0`).
    public var hasData: Bool
    /// The peak charging power across the curve, in kW (for the a11y summary).
    public var peakPowerKw: Double
    /// The first SOC plotted (the curve's left edge), or `nil` when empty.
    public var startSoc: Double?
    /// The last SOC plotted (the curve's right edge), or `nil` when empty.
    public var endSoc: Double?
    /// Whether the session charged on DC (web `isDcSession`) — the curve shape.
    public var isDc: Bool

    public init(
        points: [SessionCurvePoint],
        chartData: [SessionCurvePoint],
        hasData: Bool,
        peakPowerKw: Double,
        startSoc: Double?,
        endSoc: Double?,
        isDc: Bool
    ) {
        self.points = points
        self.chartData = chartData
        self.hasData = hasData
        self.peakPowerKw = peakPowerKw
        self.startSoc = startSoc
        self.endSoc = endSoc
        self.isDc = isDc
    }

    /// The empty projection (no selected session / no curve points).
    public static let empty = SessionCurveProjection(
        points: [],
        chartData: [],
        hasData: false,
        peakPowerKw: 0,
        startSoc: nil,
        endSoc: nil,
        isDc: false
    )
}

// MARK: - Builder (port of the web `generateChargingCurve` / `isDcSession`)

/// Pure functions that turn a cached session into the power-vs-SOC curve the
/// chart plots — a 1:1 port of the web `generateChargingCurve` so both platforms
/// show the identical curve.
public enum SessionCurveBuilder {
    /// The default peak power when a session has none, in watts (web `?? 11_000`).
    public static let defaultPeakPowerW: Double = 11000
    /// The DC peak-power threshold in watts (web `peak_power_w > 20_000`).
    public static let dcPowerThresholdW: Double = 20000

    /// The native `isDcSession`: a (JS-)truthy `charger_type` OR a peak above
    /// 20 kW. JS treats any non-empty string as truthy (including whitespace), so
    /// the type check is a non-empty test rather than a trim — `0`/`nil` power and
    /// powers at or below the threshold fall back to the charger-type signal.
    public static func isDc(chargerType: String?, peakPowerW: Double?) -> Bool {
        if let chargerType, !chargerType.isEmpty {
            return true
        }
        if let peakPowerW, peakPowerW > dcPowerThresholdW {
            return true
        }
        return false
    }

    /// The power (kW) at a given SOC for the simulated curve — the body of the web
    /// `for` loop. AC charges flat at peak; DC holds peak to 50%, tapers linearly
    /// to half-peak across 50–80%, then rolls off more steeply across 80–100%.
    /// Never negative (web `Math.max(power, 0)`).
    public static func power(atSoc soc: Double, peakKw: Double, isDc: Bool) -> Double {
        guard isDc else { return max(peakKw, 0) }
        let power: Double
        if soc <= 50 {
            power = peakKw
        } else if soc <= 80 {
            let taper = 1 - ((soc - 50) / 30) * 0.5
            power = peakKw * taper
        } else {
            let drop = 1 - ((soc - 80) / 20) * 0.7
            power = peakKw * 0.5 * drop
        }
        return max(power, 0)
    }

    /// Generates the power-vs-SOC curve for a session — the web
    /// `generateChargingCurve(session)`. Steps SOC by 1 from `start_soc_pct ?? 0`
    /// up to and including `end_soc_pct ?? 100`; an empty range yields no points.
    public static func generateCurve(_ input: SessionCurveInput) -> [SessionCurvePoint] {
        let startSoc = input.startSocPct ?? 0
        let endSoc = input.endSocPct ?? 100
        let peakKw = (input.peakPowerW ?? defaultPeakPowerW) / 1000
        let dc = isDc(chargerType: input.chargerType, peakPowerW: input.peakPowerW)

        var points: [SessionCurvePoint] = []
        var soc = startSoc
        while soc <= endSoc {
            points.append(SessionCurvePoint(soc: soc, power: power(atSoc: soc, peakKw: peakKw, isDc: dc)))
            soc += 1
        }
        return points
    }

    /// Rounds a power value to one decimal — the web data-table rounding
    /// (`Math.round(p.power * 10) / 10`). Power is non-negative here, so nearest-
    /// or-away matches JS `Math.round`'s round-half-up.
    public static func roundedPower(_ value: Double) -> Double {
        (value * 10).rounded() / 10
    }

    /// Projects a cached session into the render model: the raw curve points, the
    /// rounded `chartData`, `hasData`, the peak kW, the SOC span, and the DC shape
    /// flag. A `nil` session (nothing selected) projects to `.empty`.
    public static func project(_ input: SessionCurveInput?) -> SessionCurveProjection {
        guard let input else { return .empty }
        let points = generateCurve(input)
        guard !points.isEmpty else {
            return SessionCurveProjection(
                points: [],
                chartData: [],
                hasData: false,
                peakPowerKw: 0,
                startSoc: nil,
                endSoc: nil,
                isDc: isDc(chargerType: input.chargerType, peakPowerW: input.peakPowerW)
            )
        }
        let chartData = points.map { SessionCurvePoint(soc: $0.soc, power: roundedPower($0.power)) }
        let peak = points.map(\.power).max() ?? 0
        return SessionCurveProjection(
            points: points,
            chartData: chartData,
            hasData: true,
            peakPowerKw: roundedPower(peak),
            startSoc: points.first?.soc,
            endSoc: points.last?.soc,
            isDc: isDc(chargerType: input.chargerType, peakPowerW: input.peakPowerW)
        )
    }
}

// MARK: - Render phase (web content/empty split, plus the load envelope)

/// What the surface should render. The web source only distinguishes
/// content-vs-empty (the parent always passes a computed `curveData`); the
/// loading / error envelope around it (prompt P4 states) is supplied by the bound
/// source, mirroring the parent page's `isLoading` / refetch wiring.
public enum SessionCurvePhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status for the selected session (web `isLoading` /
/// resolved / failure), projected into a phase by `resolvePhase`.
public enum SessionCurveLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data
/// banner so the cached curve is clearly labeled while reconnecting / offline.
public enum SessionCurveConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

public extension SessionCurveBuilder {
    /// Resolves the render phase from the bound load status + whether the curve
    /// resolved any point (web `curveData.length > 0 ? content : empty`).
    static func resolvePhase(_ status: SessionCurveLoadStatus, hasData: Bool) -> SessionCurvePhase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .loaded:
            hasData ? .content : .empty
        }
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the
/// dependency-free core so it is reachable from the projection's unit tests.
public enum SessionCurveSurface {
    public static let slug = "SessionCurveChart"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected
/// localizer (`(key, fallback) -> String`) so the summaries are testable without
/// a bundle, exactly like the view's P1/S10 facade. Numbers format through an
/// injected `(Double, Int) -> String` so the tests stay locale-independent.
public enum SessionCurveAccessibility {
    /// The chart-level summary: title + peak power + SOC span (web title + the
    /// curve the chart encodes).
    public static func chartSummary(
        projection: SessionCurveProjection,
        localize: (String, String) -> String,
        number: (Double, Int) -> String
    ) -> String {
        let title = localize("charging.curve.powerVsSoc", "Power vs SOC")
        guard projection.hasData, let start = projection.startSoc, let end = projection.endSoc else {
            return "\(title): \(localize("common.noData", "No data available"))"
        }
        let peakLabel = localize("charging.curve.a11y.peak", "peak")
        let kw = localize("charging.curve.unit.kw", "kW")
        let fromLabel = localize("charging.curve.a11y.from", "from")
        let toLabel = localize("charging.curve.a11y.to", "to")
        let peak = number(projection.peakPowerKw, 1)
        let from = number(start, 0)
        let to = number(end, 0)
        return "\(title): \(peakLabel) \(peak) \(kw), \(fromLabel) \(from)% \(toLabel) \(to)%"
    }

    /// One point's VoiceOver value: "{soc}% SOC: {power} kW".
    public static func pointValue(
        _ point: SessionCurvePoint,
        localize: (String, String) -> String,
        number: (Double, Int) -> String
    ) -> String {
        let socLabel = localize("charging.curve.col.soc", "SOC %")
        let kw = localize("charging.curve.unit.kw", "kW")
        return "\(number(point.soc, 0))% \(socLabel): \(number(point.power, 1)) \(kw)"
    }
}
