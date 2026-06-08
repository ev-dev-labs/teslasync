//
//  ElevationChart.Models.swift
//  TeslaSync — P4 feature view · 0141 · ElevationChart (Apple)
//
//  The pure value types for the drive-detail "Elevation Profile" surface — the
//  per-sample input slice, the speed display unit, the chart series enum, the
//  projected sample, the elevation gain/loss/net summary, and the render / load /
//  connection states. Foundation-only so they are shared by the projection
//  (`ElevationChart.Adapter.swift`), the state holder, and the views without
//  dragging in SwiftUI. Faithful to the web
//  features/driving/components/drive-detail/ElevationChart.tsx data shapes (its
//  `ChartDataPoint` { time, elevation, speed } slice + the `DriveStats`
//  elevGain / elevLoss it reads).
//

import Foundation

// MARK: - Sample input (web `ChartDataPoint` slice)

/// One drive telemetry sample reduced to the fields the elevation profile reads.
/// SI canonical: `elevationM` in meters, `speedMps` in meters per second (the web
/// receives `elevation` already in meters and `speed` pre-converted to the user's
/// unit; native keeps both at the SI floor and converts speed only at the display
/// boundary, per ADR-004). `time` is the pre-formatted clock label (web
/// `formatTime(...)`), and `index` preserves the telemetry order for the x-axis.
public struct ElevationSample: Sendable, Equatable, Identifiable {
    /// Sample order in the drive (the chart x-position; web x-axis `time` order).
    public var index: Int
    /// The pre-formatted clock label shown on the x-axis (web `time`).
    public var time: String
    /// Elevation in meters (web `elevation`, SI).
    public var elevationM: Double
    /// Vehicle speed in meters per second (web `speed` before its SI→unit convert).
    public var speedMps: Double

    public var id: Int {
        index
    }

    public init(index: Int, time: String, elevationM: Double, speedMps: Double) {
        self.index = index
        self.time = time
        self.elevationM = elevationM
        self.speedMps = speedMps
    }
}

// MARK: - Speed display unit (web `unitPrefs.speed`)

/// The user's speed display unit — the SwiftUI parity of the web
/// `SpeedUnitPref` ('km/h' | 'mph'). The raw value is the suffix shown next to the
/// "Speed" series name (web ``Speed (${speedUnit})``); `convert` mirrors
/// `convertSpeedFromSI` so a meters-per-second sample renders in the chosen unit.
public enum SpeedUnit: String, Sendable, Equatable, CaseIterable, Identifiable {
    case kmh
    case mph

    public var id: String {
        rawValue
    }

    /// The display suffix (web uses the bare pref string as the label).
    public var label: String {
        switch self {
        case .kmh: "km/h"
        case .mph: "mph"
        }
    }

    /// Converts a meters-per-second value into this unit (web `convertSpeedFromSI`:
    /// km/h = mps·3600/1000; mph = mps·3600/1609.344).
    public func convert(mps: Double) -> Double {
        switch self {
        case .kmh: mps * Self.secondsPerHour / Self.metersPerKm
        case .mph: mps * Self.secondsPerHour / Self.metersPerMile
        }
    }

    private static let secondsPerHour = 3600.0
    private static let metersPerKm = 1000.0
    private static let metersPerMile = 1609.344
}

// MARK: - Series (web `<Area>` / `<Line>`)

/// The two plotted series — the area (elevation, left axis) and the line (speed,
/// right axis), mirroring the web `<Area dataKey="elevation">` and `<Line
/// dataKey="speed">` and their `name` props.
public enum ElevationSeries: String, Sendable, Equatable, CaseIterable, Identifiable {
    case elevation
    case speed

    public var id: String {
        rawValue
    }

    /// Plot / legend order (web renders the elevation area before the speed line).
    public var order: Int {
        switch self {
        case .elevation: 0
        case .speed: 1
        }
    }

    /// The i18n key for the series name (web `t('driveDetail.elevation' | '...speed')`).
    public var localizationKey: String {
        switch self {
        case .elevation: "driveDetail.elevation"
        case .speed: "driveDetail.speed"
        }
    }

    /// The web English series name.
    public var fallback: String {
        switch self {
        case .elevation: "Elevation"
        case .speed: "Speed"
        }
    }
}

// MARK: - Projected sample (one charted point)

/// One projected sample carrying the elevation in meters and the speed already
/// converted into the display unit — the native parity of a single web
/// `chartData` row as the `<Area>`/`<Line>` consume it.
public struct ElevationPoint: Sendable, Equatable, Identifiable {
    public var index: Int
    public var time: String
    /// Elevation in meters (left y-axis value).
    public var elevationM: Double
    /// Speed in the user's display unit (right y-axis value).
    public var speedDisplay: Double

    public var id: Int {
        index
    }

    public init(index: Int, time: String, elevationM: Double, speedDisplay: Double) {
        self.index = index
        self.time = time
        self.elevationM = elevationM
        self.speedDisplay = speedDisplay
    }

    /// The value plotted for one series (elevation in m, speed in the display unit).
    public func value(for series: ElevationSeries) -> Double {
        switch series {
        case .elevation: elevationM
        case .speed: speedDisplay
        }
    }
}

// MARK: - Elevation summary (web `stats.elevGain` / `elevLoss`)

/// The elevation gain / loss / net totals shown above the chart, all in meters —
/// the native parity of the web header (`{elevGain} m gain · {elevLoss} m loss ·
/// Net: {elevGain - elevLoss} m`). Derived from the consecutive-sample diffs so
/// the projection is self-contained and testable (the web computes the same totals
/// in its parent `useDriveDetailData` reduction).
public struct ElevationStats: Sendable, Equatable {
    /// Cumulative climb in meters (Σ of positive consecutive elevation diffs).
    public var gainM: Double
    /// Cumulative descent in meters (Σ of |negative consecutive elevation diffs|).
    public var lossM: Double

    public init(gainM: Double, lossM: Double) {
        self.gainM = gainM
        self.lossM = lossM
    }

    /// Net elevation change in meters (web `elevGain - elevLoss`).
    public var netM: Double {
        gainM - lossM
    }
}

// MARK: - Render phase (web content/empty split, plus the load envelope)

/// What the surface should render. The web source distinguishes content
/// (`chartData.length > 1`) from its empty branch ("No telemetry data available");
/// the loading / error envelope around it (prompt P4 states) is supplied by the
/// bound source, mirroring the web parent page's `isLoading` / error wiring.
public enum ElevationPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status for the drive query (web `isLoading` / resolved
/// / failure), projected into a phase by `resolvePhase`.
public enum ElevationLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data
/// banner so a cached trace is clearly labeled while reconnecting / offline.
public enum ElevationConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}
