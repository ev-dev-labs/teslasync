//
//  MotorHistoryWidget.Projection.swift
//  TeslaSync — P4 dashboard widget · 0066 · MotorHistoryWidget (Apple)
//
//  Pure, Foundation-only domain for the surface: the cached MotorSnapshot → chart
//  projection adapter (1:1 port of the web `buildChartData`), the dual-axis scale
//  math, and the display formatters. No SwiftUI / no networking lives here so the
//  adapter can be exercised by a plain `swift` host harness and XCTest.
//

import Foundation

// MARK: - Cached input (port of web MotorSnapshot subset)

/// One cached `/motor` row the state holder hands the surface. Mirrors the subset
/// of the web `MotorSnapshot` the chart consumes (everything on disk is SI:
/// torque in Nm, stator/motor temp in °C, accelerations in g).
public struct MotorSnapshotInput: Equatable, Sendable {
    public var ts: String?
    public var createdAt: String?
    public var diTorque: Double?
    public var diStatorTemp: Double?
    public var motorTempCFront: Double?
    public var gear: String?
    public var shiftState: String?
    public var lateralAccel: Double?
    public var longitudinalAccel: Double?

    public init(
        ts: String? = nil,
        createdAt: String? = nil,
        diTorque: Double? = nil,
        diStatorTemp: Double? = nil,
        motorTempCFront: Double? = nil,
        gear: String? = nil,
        shiftState: String? = nil,
        lateralAccel: Double? = nil,
        longitudinalAccel: Double? = nil
    ) {
        self.ts = ts
        self.createdAt = createdAt
        self.diTorque = diTorque
        self.diStatorTemp = diStatorTemp
        self.motorTempCFront = motorTempCFront
        self.gear = gear
        self.shiftState = shiftState
        self.lateralAccel = lateralAccel
        self.longitudinalAccel = longitudinalAccel
    }
}

// MARK: - Chart datum (port of web ChartDatum)

/// One plotted sample: torque (Nm) + stator temp (already converted to the user's
/// display unit) + optional g-forces, keyed on its timestamp.
public struct MotorChartDatum: Identifiable, Equatable, Sendable {
    public let id: String
    public let time: Date
    public let torque: Double?
    public let statorTemp: Double?
    public let gear: String?
    public let lateralG: Double?
    public let longitudinalG: Double?

    public init(
        time: Date,
        torque: Double?,
        statorTemp: Double?,
        gear: String?,
        lateralG: Double?,
        longitudinalG: Double?,
        id: String? = nil
    ) {
        self.time = time
        self.torque = torque
        self.statorTemp = statorTemp
        self.gear = gear
        self.lateralG = lateralG
        self.longitudinalG = longitudinalG
        self.id = id ?? ISO8601DateFormatter().string(from: time)
    }
}

// MARK: - Temperature conversion (display boundary — frontend SI cutover)

/// SI Celsius → the user's display unit (port of web `convertTempFromSI`). The DB
/// and API stay SI; conversion happens only here, at the render boundary.
public enum MotorTemperature {
    /// Danger-zone threshold in Celsius (web `DANGER_TEMP_C`).
    public static let dangerCelsius: Double = 100

    public static func fromSI(_ celsius: Double, _ system: MeasurementSystem) -> Double {
        switch system {
        case .metric: celsius
        case .imperial: celsius * 9 / 5 + 32
        }
    }
}

// MARK: - Dual-axis scale (Swift Charts single-scale → faithful right temp axis)

/// Swift Charts plots on one Y scale, but the web shows torque (left, Nm) and
/// stator temp (right) on independent axes with a danger band keyed to the temp
/// scale. This maps temp values into the torque plotting space (and back) so the
/// stator line and the 100 °C band line up exactly as on the web.
public struct MotorChartScale: Equatable, Sendable {
    public let torqueMax: Double
    public let tempMax: Double

    public init(torqueMax: Double, tempMax: Double) {
        self.torqueMax = torqueMax
        self.tempMax = tempMax
    }

    /// temp-axis value → torque plotting space.
    public func tempToTorque(_ value: Double) -> Double {
        guard tempMax > 0 else { return 0 }
        return value * (torqueMax / tempMax)
    }

    /// torque plotting space → temp-axis value (for the trailing axis labels).
    public func torqueToTemp(_ value: Double) -> Double {
        guard torqueMax > 0 else { return 0 }
        return value * (tempMax / torqueMax)
    }
}

// MARK: - Projection (the adapter output)

/// Everything the view needs to render, derived purely from the cached rows + the
/// user's measurement system. Built by `MotorHistoryProjectionBuilder`.
public struct MotorHistoryProjection: Equatable, Sendable {
    public var data: [MotorChartDatum]
    public var latestTorque: Double?
    public var latestStatorTemp: Double?
    public var dangerThreshold: Double
    public var scale: MotorChartScale
    public var temperatureUnitLabel: String

    public var hasData: Bool {
        !data.isEmpty
    }

    public static let empty = MotorHistoryProjection(
        data: [],
        latestTorque: nil,
        latestStatorTemp: nil,
        dangerThreshold: MotorTemperature.dangerCelsius,
        scale: MotorChartScale(torqueMax: 100, tempMax: 120),
        temperatureUnitLabel: "°C"
    )

    public init(
        data: [MotorChartDatum],
        latestTorque: Double?,
        latestStatorTemp: Double?,
        dangerThreshold: Double,
        scale: MotorChartScale,
        temperatureUnitLabel: String
    ) {
        self.data = data
        self.latestTorque = latestTorque
        self.latestStatorTemp = latestStatorTemp
        self.dangerThreshold = dangerThreshold
        self.scale = scale
        self.temperatureUnitLabel = temperatureUnitLabel
    }
}

/// Pure adapter: cached `MotorSnapshotInput[]` + measurement system → projection.
/// A faithful port of the web `buildChartData` + the widget's `useMemo` derivations
/// (latest values, danger threshold, temp-axis max).
public enum MotorHistoryProjectionBuilder {
    public static func build(
        snapshots: [MotorSnapshotInput],
        measurement: MeasurementSystem
    ) -> MotorHistoryProjection {
        let data = chartData(from: snapshots, measurement: measurement)
        let dangerThreshold = MotorTemperature.fromSI(MotorTemperature.dangerCelsius, measurement)
        let latestTorque = lastNonNil(data, \.torque)
        let latestStatorTemp = lastNonNil(data, \.statorTemp)
        let scale = MotorChartScale(
            torqueMax: torqueMax(data),
            tempMax: tempMax(data, dangerThreshold: dangerThreshold)
        )
        return MotorHistoryProjection(
            data: data,
            latestTorque: latestTorque,
            latestStatorTemp: latestStatorTemp,
            dangerThreshold: dangerThreshold,
            scale: scale,
            temperatureUnitLabel: measurement.temperatureLabel
        )
    }

    /// Port of `buildChartData`: drop rows without a timestamp, convert stator temp
    /// to the display unit, and sort ascending by time.
    static func chartData(
        from snapshots: [MotorSnapshotInput],
        measurement: MeasurementSystem
    ) -> [MotorChartDatum] {
        snapshots
            .compactMap { snapshot -> MotorChartDatum? in
                guard let stamp = snapshot.ts ?? snapshot.createdAt,
                      let time = parseTimestamp(stamp) else { return nil }
                let statorRaw = snapshot.diStatorTemp ?? snapshot.motorTempCFront
                return MotorChartDatum(
                    time: time,
                    torque: snapshot.diTorque,
                    statorTemp: statorRaw.map { MotorTemperature.fromSI($0, measurement) },
                    gear: snapshot.gear ?? snapshot.shiftState,
                    lateralG: snapshot.lateralAccel,
                    longitudinalG: snapshot.longitudinalAccel,
                    id: stamp
                )
            }
            .sorted { $0.time < $1.time }
    }

    /// Last non-nil value of a keypath, scanning newest-first (web latest loops).
    static func lastNonNil(_ data: [MotorChartDatum], _ key: KeyPath<MotorChartDatum, Double?>) -> Double? {
        data.reversed().first { $0[keyPath: key] != nil }?[keyPath: key] ?? nil
    }

    /// Left (torque) axis ceiling — a "nice" bound over the absolute torque values,
    /// with a sane floor so the temp line still scales when torque is sparse.
    static func torqueMax(_ data: [MotorChartDatum]) -> Double {
        let magnitudes = data.compactMap { $0.torque.map(abs) }.filter(\.isFinite)
        guard let peak = magnitudes.max(), peak > 0 else { return 100 }
        return max(50, (peak / 50).rounded(.up) * 50)
    }

    /// Right (temp) axis ceiling: at least danger + 20, expanded past the hottest
    /// reading, rounded up (web `tempMax`).
    static func tempMax(_ data: [MotorChartDatum], dangerThreshold: Double) -> Double {
        var bound = dangerThreshold + 20
        for datum in data {
            if let temp = datum.statorTemp, temp > bound { bound = temp }
        }
        return bound.rounded(.up)
    }

    /// Parses an ISO-8601 timestamp, tolerating fractional seconds.
    static func parseTimestamp(_ raw: String) -> Date? {
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

// MARK: - Display formatting (port of web fmtNumber)

/// Locale-aware fixed-fraction number formatting (web `fmtNumber`). Non-finite
/// input renders an em dash, never "nan".
public enum MotorNumberFormat {
    public static func decimal(_ value: Double?, fractionDigits: Int) -> String {
        guard let value, value.isFinite else { return "—" }
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.\(fractionDigits)f", value)
    }
}
