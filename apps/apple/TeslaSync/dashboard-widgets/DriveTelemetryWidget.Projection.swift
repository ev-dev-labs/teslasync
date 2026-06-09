//
//  DriveTelemetryWidget.Projection.swift
//  TeslaSync — P4 dashboard widget · 0041 · DriveTelemetryWidget (Apple)
//
//  Pure, Foundation-only domain for the surface: the cached drive + telemetry →
//  chart projection adapter (1:1 port of the web `DriveTelemetryWidget` `useMemo`
//  derivations), the dual-axis scale math (speed/battery/elevation left, power
//  right — Recharts `ComposedChart` had two `YAxis`), and the display formatters.
//  No SwiftUI / no networking lives here so the adapter can be exercised by a
//  plain `swift` host harness and XCTest.
//

import Foundation

// MARK: - SI display conversion (display boundary — frontend SI cutover)

/// SI → the user's display unit. Ports of the web `convertDistanceFromSI` /
/// `convertSpeedFromSI` (`lib/unitConversion.ts`). The DB and API stay SI; the
/// conversion happens only here, at the render boundary.
public enum DriveTelemetryConvert {
    static let metersPerKm: Double = 1000
    static let metersPerMile: Double = 1609.344
    static let secondsPerHour: Double = 3600

    /// SI meters → km (metric) / miles (imperial).
    public static func distanceFromSI(_ meters: Double, _ system: MeasurementSystem) -> Double {
        switch system {
        case .metric: meters / metersPerKm
        case .imperial: meters / metersPerMile
        }
    }

    /// SI meters-per-second → km/h (metric) / mph (imperial).
    public static func speedFromSI(_ mps: Double, _ system: MeasurementSystem) -> Double {
        switch system {
        case .metric: mps * secondsPerHour / metersPerKm
        case .imperial: mps * secondsPerHour / metersPerMile
        }
    }
}

// MARK: - Cached input (port of web Drive + DriveTelemetryPoint subsets)

/// One cached `/drives` row the state holder hands the surface. Mirrors the
/// subset of the web `Drive` the widget consumes (everything on disk is SI:
/// distance in meters, duration in seconds, energy in watt-hours).
public struct DriveTelemetrySummaryInput: Equatable, Sendable {
    public var id: Int64
    public var startTs: String?
    public var distanceM: Double
    public var durationS: Double
    public var energyUsedWh: Double?
    public var startAddress: String?

    public init(
        id: Int64,
        startTs: String? = nil,
        distanceM: Double = 0,
        durationS: Double = 0,
        energyUsedWh: Double? = nil,
        startAddress: String? = nil
    ) {
        self.id = id
        self.startTs = startTs
        self.distanceM = distanceM
        self.durationS = durationS
        self.energyUsedWh = energyUsedWh
        self.startAddress = startAddress
    }
}

/// One cached `/drives/{id}/telemetry` sample. Mirrors the subset of the web
/// `DriveTelemetryPoint` the chart consumes: speed is SI m/s (converted at the
/// boundary), power is already kW (pass-through, the web axis is "Power (kW)"),
/// battery/soc are percent, elevation is meters.
public struct DriveTelemetryPointInput: Equatable, Sendable {
    public var timestamp: String?
    public var createdAt: String?
    public var speed: Double?
    public var power: Double?
    public var batteryLevel: Double?
    public var soc: Double?
    public var elevation: Double?

    public init(
        timestamp: String? = nil,
        createdAt: String? = nil,
        speed: Double? = nil,
        power: Double? = nil,
        batteryLevel: Double? = nil,
        soc: Double? = nil,
        elevation: Double? = nil
    ) {
        self.timestamp = timestamp
        self.createdAt = createdAt
        self.speed = speed
        self.power = power
        self.batteryLevel = batteryLevel
        self.soc = soc
        self.elevation = elevation
    }
}

// MARK: - Chart datum (port of web ChartDatum)

/// One plotted sample: speed (display unit) + power (kW) + battery (%) +
/// elevation (m), keyed on its timestamp.
public struct DriveTelemetryChartDatum: Identifiable, Equatable, Sendable {
    public let id: String
    public let time: Date
    public let speed: Double?
    public let power: Double?
    public let battery: Double?
    public let elevation: Double?

    public init(
        time: Date,
        speed: Double?,
        power: Double?,
        battery: Double?,
        elevation: Double?,
        id: String? = nil
    ) {
        self.time = time
        self.speed = speed
        self.power = power
        self.battery = battery
        self.elevation = elevation
        self.id = id ?? ISO8601DateFormatter().string(from: time)
    }
}

// MARK: - Dual-axis scale (Swift Charts single-scale → faithful right power axis)

/// Swift Charts plots on one Y scale, but the web `ComposedChart` shows speed /
/// battery / elevation on the left axis (domain `[0, dataMax + 10]`) and power on
/// an independent right axis. This maps power values into the left plotting space
/// (and back) so the power area and the right axis line up with the left series.
public struct DriveTelemetryChartScale: Equatable, Sendable {
    public let leftMax: Double
    public let powerMin: Double
    public let powerMax: Double

    public init(leftMax: Double, powerMin: Double, powerMax: Double) {
        self.leftMax = leftMax
        self.powerMin = powerMin
        self.powerMax = powerMax
    }

    private var powerRange: Double {
        powerMax - powerMin
    }

    /// power value → left plotting space.
    public func powerToPlot(_ value: Double) -> Double {
        guard powerRange > 0, leftMax > 0 else { return 0 }
        return (value - powerMin) / powerRange * leftMax
    }

    /// left plotting space → power value (for the trailing axis labels).
    public func plotToPower(_ plot: Double) -> Double {
        guard leftMax > 0 else { return powerMin }
        return powerMin + plot / leftMax * powerRange
    }

    /// The plotted position of 0 kW — the power area's baseline.
    public var powerBaselinePlot: Double {
        powerToPlot(0)
    }
}

// MARK: - Projection (the adapter output)

/// Everything the view needs to render, derived purely from the cached drive +
/// telemetry + the user's measurement system. Built by
/// `DriveTelemetryProjectionBuilder`.
public struct DriveTelemetryProjection: Equatable, Sendable {
    public var data: [DriveTelemetryChartDatum]
    public var hasDrive: Bool
    public var startAddress: String?
    public var distanceText: String
    public var distanceUnitLabel: String
    public var durationText: String
    public var efficiencyText: String?
    public var efficiencyUnitLabel: String
    public var speedUnitLabel: String
    public var scale: DriveTelemetryChartScale
    public var latestSpeed: Double?
    public var latestPower: Double?
    public var latestBattery: Double?

    /// True once telemetry samples exist — drives the chart vs "no telemetry".
    public var hasData: Bool {
        !data.isEmpty
    }

    public static let empty = DriveTelemetryProjection(
        data: [],
        hasDrive: false,
        startAddress: nil,
        distanceText: "—",
        distanceUnitLabel: MeasurementSystem.metric.distanceLabel,
        durationText: "—",
        efficiencyText: nil,
        efficiencyUnitLabel: "Wh/\(MeasurementSystem.metric.distanceLabel)",
        speedUnitLabel: MeasurementSystem.metric.speedLabel,
        scale: DriveTelemetryChartScale(leftMax: 10, powerMin: 0, powerMax: 1),
        latestSpeed: nil,
        latestPower: nil,
        latestBattery: nil
    )

    public init(
        data: [DriveTelemetryChartDatum],
        hasDrive: Bool,
        startAddress: String?,
        distanceText: String,
        distanceUnitLabel: String,
        durationText: String,
        efficiencyText: String?,
        efficiencyUnitLabel: String,
        speedUnitLabel: String,
        scale: DriveTelemetryChartScale,
        latestSpeed: Double?,
        latestPower: Double?,
        latestBattery: Double?
    ) {
        self.data = data
        self.hasDrive = hasDrive
        self.startAddress = startAddress
        self.distanceText = distanceText
        self.distanceUnitLabel = distanceUnitLabel
        self.durationText = durationText
        self.efficiencyText = efficiencyText
        self.efficiencyUnitLabel = efficiencyUnitLabel
        self.speedUnitLabel = speedUnitLabel
        self.scale = scale
        self.latestSpeed = latestSpeed
        self.latestPower = latestPower
        self.latestBattery = latestBattery
    }
}

/// Pure adapter: cached drives + telemetry + measurement system → projection. A
/// faithful port of the web widget's `latestDrive` reduce, `chartData` map, and
/// `stats` `useMemo`.
public enum DriveTelemetryProjectionBuilder {
    public static func build(
        drives: [DriveTelemetrySummaryInput],
        telemetry: [DriveTelemetryPointInput],
        measurement: MeasurementSystem
    ) -> DriveTelemetryProjection {
        let latest = latestDrive(drives)
        let data = chartData(from: telemetry, measurement: measurement)
        let scale = scale(for: data)
        let distance = latest.map { DriveTelemetryConvert.distanceFromSI($0.distanceM, measurement) }

        return DriveTelemetryProjection(
            data: data,
            hasDrive: latest != nil,
            startAddress: latest?.startAddress?.isEmpty == false ? latest?.startAddress : nil,
            distanceText: distance.map { DriveTelemetryNumberFormat.decimal($0, fractionDigits: 1) } ?? "—",
            distanceUnitLabel: measurement.distanceLabel,
            durationText: latest.map {
                DriveTelemetryNumberFormat.decimal($0.durationS / 60, fractionDigits: 0)
            } ?? "—",
            efficiencyText: efficiencyText(latest: latest, distance: distance),
            efficiencyUnitLabel: "Wh/\(measurement.distanceLabel)",
            speedUnitLabel: measurement.speedLabel,
            scale: scale,
            latestSpeed: lastNonNil(data, \.speed),
            latestPower: lastNonNil(data, \.power),
            latestBattery: lastNonNil(data, \.battery)
        )
    }

    /// Port of the web `latestDrive` reduce: the drive with the newest `startTs`
    /// (falling back to the first row when no timestamp parses).
    static func latestDrive(_ drives: [DriveTelemetrySummaryInput]) -> DriveTelemetrySummaryInput? {
        guard !drives.isEmpty else { return nil }
        return drives.max {
            (parseTimestamp($0.startTs) ?? .distantPast) < (parseTimestamp($1.startTs) ?? .distantPast)
        } ?? drives.first
    }

    /// Port of `chartData`: drop samples without a timestamp, convert speed to the
    /// display unit, carry power/battery/elevation, sort ascending by time.
    static func chartData(
        from telemetry: [DriveTelemetryPointInput],
        measurement: MeasurementSystem
    ) -> [DriveTelemetryChartDatum] {
        telemetry
            .compactMap { point -> DriveTelemetryChartDatum? in
                guard let stamp = point.timestamp ?? point.createdAt,
                      let time = parseTimestamp(stamp) else { return nil }
                return DriveTelemetryChartDatum(
                    time: time,
                    speed: point.speed.map { DriveTelemetryConvert.speedFromSI($0, measurement) },
                    power: point.power,
                    battery: point.batteryLevel ?? point.soc,
                    elevation: point.elevation,
                    id: stamp
                )
            }
            .sorted { $0.time < $1.time }
    }

    /// Efficiency stat (Wh per display-distance-unit). Present only when the web
    /// guard holds: `energyUsedWh != null && distanceM > 0`.
    static func efficiencyText(latest: DriveTelemetrySummaryInput?, distance: Double?) -> String? {
        guard let latest, let energy = latest.energyUsedWh, latest.distanceM > 0,
              let distance, distance > 0 else { return nil }
        return DriveTelemetryNumberFormat.decimal(energy / distance, fractionDigits: 0)
    }

    /// Left axis ceiling = `dataMax + 10` over the left-axis series (speed,
    /// battery, elevation), floored so the axis still scales when data is sparse;
    /// power axis spans `[min(0, …), max(0, …)]` so the 0 kW baseline is in range.
    static func scale(for data: [DriveTelemetryChartDatum]) -> DriveTelemetryChartScale {
        let leftValues = data.flatMap { datum in
            [datum.speed, datum.battery, datum.elevation].compactMap(\.self)
        }.filter(\.isFinite)
        let leftPeak = leftValues.max() ?? 0
        let leftMax = max(10, leftPeak + 10)

        let powerValues = data.compactMap(\.power).filter(\.isFinite)
        let powerMin = min(0, powerValues.min() ?? 0)
        var powerMax = max(0, powerValues.max() ?? 0)
        if powerMax <= powerMin { powerMax = powerMin + 1 }

        return DriveTelemetryChartScale(leftMax: leftMax, powerMin: powerMin, powerMax: powerMax)
    }

    /// Last non-nil value of a keypath, scanning newest-first (web latest loops).
    static func lastNonNil(
        _ data: [DriveTelemetryChartDatum],
        _ key: KeyPath<DriveTelemetryChartDatum, Double?>
    ) -> Double? {
        data.reversed().first { $0[keyPath: key] != nil }?[keyPath: key] ?? nil
    }

    /// Parses an ISO-8601 timestamp, tolerating fractional seconds.
    static func parseTimestamp(_ raw: String?) -> Date? {
        guard let raw else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: trimmed) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: trimmed)
    }
}

// MARK: - Display formatting (port of web fmtNumber / fmtInt)

/// Locale-aware fixed-fraction number formatting (web `fmtNumber`). Non-finite
/// input renders an em dash, never "nan".
public enum DriveTelemetryNumberFormat {
    public static func decimal(_ value: Double?, fractionDigits: Int) -> String {
        guard let value, value.isFinite else { return "—" }
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.\(fractionDigits)f", value)
    }
}
