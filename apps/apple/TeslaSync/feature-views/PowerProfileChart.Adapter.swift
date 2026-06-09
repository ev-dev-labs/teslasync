//
//  PowerProfileChart.Adapter.swift
//  TeslaSync — P4 feature view · 0146 · PowerProfileChart (Apple)
//
//  The value types for the "Power Profile" drive-detail surface — a faithful port of the
//  data the area chart in features/driving/components/drive-detail/PowerProfileChart.tsx
//  reads: the per-sample `power` trace (built by the sibling `useDriveDetailData.ts`
//  `chartData`) plus the `DriveStats` power summary (`powerMax` / `powerMin` /
//  `avgPower`) printed below the chart. Pure and dependency-free (Foundation only); the
//  projection logic lives in PowerProfileChart.Projection.swift so both files stay within
//  the file-length budget and unit-test without a bundle or a rendered view.
//
//  Web parity notes:
//    • `PowerProfileSample` carries the subset of `ChartDataPoint` (./types.ts) the chart reads
//      (`time`, `power`). Power is in kW already (the web `chartData` prop is
//      pre-derived) and may be negative for regeneration — the surface never re-converts.
//    • `PowerProfileStats` is the `DriveStats` power triple the web footer prints; the
//      value arrives from the parent (web prop) and is also derivable from the samples by
//      the projection, matching the `useDriveDetailData` reducer.
//

import Foundation

// MARK: - Sample input (the web `ChartDataPoint` fields this surface reads)

/// One per-sample point on the power trace — the SwiftUI parity of the subset of
/// `ChartDataPoint` (drive-detail/types.ts) the web `PowerProfileChart` touches. Power is
/// in kW already (the web `chartData` prop is pre-derived) and is signed: positive while
/// driving, negative during regeneration.
public struct PowerProfileSample: Sendable, Equatable, Identifiable {
    /// Stable plot order on the x-axis (web categorical `time`; native plots by index and
    /// labels the endpoints with `time`, matching `interval="preserveStartEnd"`).
    public var index: Int
    /// The formatted time label for this sample (web `time`, from `formatTime`).
    public var time: String
    /// Instantaneous power in kW (web `power`); negative values are regeneration.
    public var power: Double

    public var id: Int {
        index
    }

    public init(index: Int, time: String, power: Double) {
        self.index = index
        self.time = time
        self.power = power
    }
}

// MARK: - Footer summary (web `DriveStats` power triple)

/// The three power figures printed below the chart (web `stats.powerMax` / `powerMin` /
/// `avgPower`). The parent supplies these as a prop in the web (`useDriveDetailData`); the
/// projection can also derive them from the samples for previews, tests, and a source that
/// has only the trace.
public struct PowerProfileStats: Sendable, Equatable {
    /// Peak drive power in kW (web `stats.powerMax`, the "Max Power" figure).
    public var powerMax: Double
    /// Peak regeneration in kW (web `stats.powerMin`, the signed "Max Regen" figure).
    public var powerMin: Double
    /// Mean power in kW across the trace (web `stats.avgPower`, the "Avg" figure).
    public var avgPower: Double

    public init(powerMax: Double, powerMin: Double, avgPower: Double) {
        self.powerMax = powerMax
        self.powerMin = powerMin
        self.avgPower = avgPower
    }

    /// The all-zero summary (web `DriveStats` defaults before any telemetry is reduced).
    public static let zero = PowerProfileStats(powerMax: 0, powerMin: 0, avgPower: 0)
}

// MARK: - Render phase + bound load status

/// What the surface should render. The web component distinguishes the dense trace
/// (`chartData.length > 1`) from the "No telemetry data available" empty box; the
/// loading / error envelope (prompt P4 states) is supplied by the bound source, mirroring
/// the parent `DriveDetailPage`'s `isLoading` / error wiring.
public enum PowerProfilePhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status for the drive query (web `isLoading` / resolved /
/// failure), projected into a phase by `resolvePhase`.
public enum PowerProfileLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner so
/// a cached trace is clearly labeled while reconnecting / offline.
public enum PowerProfileConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Number formatting (web `fmtInt` / `fmtNumber`)

/// Locale-aware number formatting matching `web/src/lib/numberFormat.ts`: a global
/// precision of 2 fraction digits, grouped thousands, and `safeNumber` (non-finite → 0).
/// The locale is injectable so the footer strings are deterministic in tests (the web
/// global locale is "en-US").
public enum PowerNumberFormat {
    /// The web `_globalPrecision` default (2 fraction digits).
    public static let defaultFractionDigits = 2

    /// `fmtNumber(v, decimals)` — grouped, fixed-fraction; non-finite coerces to 0.
    public static func number(
        _ value: Double,
        fractionDigits: Int = defaultFractionDigits,
        locale: Locale = .current
    ) -> String {
        let safe = value.isFinite ? value : 0
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        return formatter.string(from: NSNumber(value: safe)) ?? "0"
    }

    /// `fmtInt(v)` — `fmtNumber(v, 0)`.
    public static func int(_ value: Double, locale: Locale = .current) -> String {
        number(value, fractionDigits: 0, locale: locale)
    }

    /// `${fmtInt(v)} kW` — the web "Max Power" / "Max Regen" footer value.
    public static func kilowattInt(_ value: Double, locale: Locale = .current) -> String {
        "\(int(value, locale: locale)) kW"
    }

    /// `${fmtNumber(v)} kW` — the web "Avg" footer value + the cursor tooltip value.
    public static func kilowatt(_ value: Double, locale: Locale = .current) -> String {
        "\(number(value, locale: locale)) kW"
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the
/// dependency-free core so it is reachable from the projection's unit tests.
public enum PowerProfileSurface {
    public static let slug = "PowerProfileChart"
}
