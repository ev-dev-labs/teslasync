//
//  ClimateHistoryWidget.Projection.swift
//  TeslaSync — P4 dashboard widget · 0027 · ClimateHistoryWidget (Apple)
//
//  Pure, Foundation-only domain for the surface: the user's temperature unit (web
//  `useUnits` → `unitPrefs.temperature`), the SI Celsius → display converter (web
//  `convertTempFromSI`), the cached `ClimateState` → chart projection adapter (1:1
//  port of the web `buildChartData` + the `latestInside` / `latestOutside` scans),
//  and the display formatters. No SwiftUI / no networking lives here so the adapter
//  can be exercised by a plain `swift` host harness and XCTest.
//

import Foundation

// MARK: - Temperature display unit (port of web TemperatureUnitPref)

/// The temperature display unit, mirroring the web `TemperatureUnitPref`
/// (`'°C' | '°F'`). The raw value is the suffix appended to a value, exactly as the
/// web concatenates `${fmtInt(value)}${tempUnit}` (the symbol already carries the
/// degree sign).
public enum ClimateTemperatureUnit: String, Sendable, CaseIterable, Equatable {
    case celsius = "°C"
    case fahrenheit = "°F"

    /// The display suffix (web `tempUnit` = `unitPrefs.temperature`).
    public var label: String {
        rawValue
    }

    /// Resolves the unit from a stored settings label, defaulting to Celsius —
    /// matching the web `UNIT_DEFAULTS.temperature` (`'°C'`), with `°F` honored when
    /// explicitly stored.
    public static func fromLabel(_ raw: String?) -> ClimateTemperatureUnit {
        raw == "°F" ? .fahrenheit : .celsius
    }
}

// MARK: - SI conversion (display boundary — frontend SI cutover)

/// SI Celsius → the user's display unit. A faithful port of the web
/// `convertTempFromSI` (lib/unitConversion.ts). The DB and API stay SI (degrees
/// Celsius, per Phase-42); conversion happens only here, at the render boundary —
/// never on disk.
public enum ClimateTempConvert {
    /// Converts SI Celsius to the display unit. Non-finite / absent input maps to
    /// `nil` (web only plots `insideTemp != null` / `outsideTemp != null`).
    public static func fromSI(_ celsius: Double?, _ unit: ClimateTemperatureUnit) -> Double? {
        guard let celsius, celsius.isFinite else { return nil }
        switch unit {
        case .celsius: return celsius
        case .fahrenheit: return celsius * 9 / 5 + 32
        }
    }
}

// MARK: - Series identity (the two plotted lines)

/// The two plotted series, in the web's draw order (inside, then outside). Drives
/// the stat row, the chart series, and the accessibility summary so all three stay
/// in lock-step. `cabin` is the web `inside` key; `outside` is the web `outside`
/// key.
public enum ClimateSeries: String, CaseIterable, Sendable {
    case cabin
    case outside

    /// The i18n key for the series' label (web `widget.climateHistory.cabin` /
    /// `widget.climateHistory.outside`).
    public var labelKey: String {
        "widget.climateHistory.\(rawValue)"
    }

    /// The English fallback for the series label (web `t(key, 'Cabin')` /
    /// `t(key, 'Outside')`).
    public var labelFallback: String {
        switch self {
        case .cabin: "Cabin"
        case .outside: "Outside"
        }
    }

    /// Reads this series' display value off a chart datum.
    public func value(in datum: ClimateChartDatum) -> Double? {
        switch self {
        case .cabin: datum.inside
        case .outside: datum.outside
        }
    }
}

// MARK: - Cached input (port of web ClimateState subset)

/// One cached `/climate` row the state holder hands the surface. Mirrors the subset
/// of the web `ClimateState` the chart consumes. Both temperatures are SI Celsius
/// (Phase-42 on-disk contract); `nil` models an absent reading so a series can
/// connect across gaps (web `connectNulls`). The web keys the point on
/// `created_at ?? timestamp` and drops rows lacking both.
public struct ClimateSnapshotInput: Equatable, Sendable {
    public var createdAt: String?
    public var timestamp: String?
    public var insideTemp: Double?
    public var outsideTemp: Double?

    public init(
        createdAt: String? = nil,
        timestamp: String? = nil,
        insideTemp: Double? = nil,
        outsideTemp: Double? = nil
    ) {
        self.createdAt = createdAt
        self.timestamp = timestamp
        self.insideTemp = insideTemp
        self.outsideTemp = outsideTemp
    }
}

// MARK: - Chart datum (port of web ChartDatum)

/// One plotted sample: the cabin + outside temperatures (already converted to the
/// user's display unit), keyed on its timestamp. `nil` series are skipped per line
/// so the area bridges gaps exactly like the web `connectNulls`.
public struct ClimateChartDatum: Identifiable, Equatable, Sendable {
    public let id: String
    public let time: Date
    public let inside: Double?
    public let outside: Double?

    public init(
        time: Date,
        inside: Double?,
        outside: Double?,
        id: String? = nil
    ) {
        self.time = time
        self.inside = inside
        self.outside = outside
        self.id = id ?? ISO8601DateFormatter().string(from: time)
    }
}

// MARK: - Projection (the adapter output)

/// Everything the view needs to render, derived purely from the cached rows + the
/// user's temperature unit. Built by `ClimateHistoryProjectionBuilder`.
public struct ClimateHistoryProjection: Equatable, Sendable {
    public var data: [ClimateChartDatum]
    public var latest: [ClimateSeries: Double]
    public var temperatureUnitLabel: String
    public var yDomain: ClosedRange<Double>

    public var hasData: Bool {
        !data.isEmpty
    }

    /// The latest display value for a series (newest-first scan), or `nil`.
    public func latestValue(_ series: ClimateSeries) -> Double? {
        latest[series]
    }

    public static let empty = ClimateHistoryProjection(
        data: [],
        latest: [:],
        temperatureUnitLabel: ClimateTemperatureUnit.celsius.label,
        yDomain: 0 ... 1
    )

    public init(
        data: [ClimateChartDatum],
        latest: [ClimateSeries: Double],
        temperatureUnitLabel: String,
        yDomain: ClosedRange<Double>
    ) {
        self.data = data
        self.latest = latest
        self.temperatureUnitLabel = temperatureUnitLabel
        self.yDomain = yDomain
    }
}

/// Pure adapter: cached `ClimateSnapshotInput[]` + temperature unit → projection. A
/// faithful port of the web `buildChartData` + the `latestInside` / `latestOutside`
/// newest-first scans + the y-axis scale derivation.
public enum ClimateHistoryProjectionBuilder {
    public static func build(
        snapshots: [ClimateSnapshotInput],
        unit: ClimateTemperatureUnit
    ) -> ClimateHistoryProjection {
        let data = chartData(from: snapshots, unit: unit)
        var latest: [ClimateSeries: Double] = [:]
        for series in ClimateSeries.allCases {
            if let value = latestNonNil(data, series) { latest[series] = value }
        }
        return ClimateHistoryProjection(
            data: data,
            latest: latest,
            temperatureUnitLabel: unit.label,
            yDomain: yDomain(data: data)
        )
    }

    /// Port of `buildChartData`: keep rows with a timestamp (`created_at || timestamp`),
    /// convert each series to the display unit, and sort ascending by time. The web
    /// sorts on the ISO string with `localeCompare`; for ISO-8601 instants that is the
    /// same as chronological order, which we use directly.
    static func chartData(
        from snapshots: [ClimateSnapshotInput],
        unit: ClimateTemperatureUnit
    ) -> [ClimateChartDatum] {
        snapshots
            .compactMap { snapshot -> ClimateChartDatum? in
                guard let stamp = preferredTimestamp(snapshot),
                      let time = parseTimestamp(stamp) else { return nil }
                return ClimateChartDatum(
                    time: time,
                    inside: ClimateTempConvert.fromSI(snapshot.insideTemp, unit),
                    outside: ClimateTempConvert.fromSI(snapshot.outsideTemp, unit),
                    id: stamp
                )
            }
            .sorted { $0.time < $1.time }
    }

    /// The point's time key: `created_at` when present and non-empty, otherwise
    /// `timestamp` (web `filter(created_at || timestamp)` + `created_at ?? timestamp`).
    static func preferredTimestamp(_ snapshot: ClimateSnapshotInput) -> String? {
        if let createdAt = snapshot.createdAt, !isBlank(createdAt) { return createdAt }
        if let timestamp = snapshot.timestamp, !isBlank(timestamp) { return timestamp }
        return nil
    }

    /// Last non-nil value of a series, scanning newest-first (web `latestInside` /
    /// `latestOutside` loops from the end).
    static func latestNonNil(_ data: [ClimateChartDatum], _ series: ClimateSeries) -> Double? {
        data.reversed().first { series.value(in: $0) != nil }.flatMap { series.value(in: $0) }
    }

    /// The y-axis envelope: spans every plotted value with a small symmetric pad.
    /// Unlike pressure, temperature legitimately goes negative (sub-zero °C and °F),
    /// so the lower bound is NOT floored at 0 — Recharts likewise auto-fits the domain
    /// to the data without a zero clamp here.
    static func yDomain(data: [ClimateChartDatum]) -> ClosedRange<Double> {
        var values: [Double] = []
        for datum in data {
            for series in ClimateSeries.allCases {
                if let value = series.value(in: datum) { values.append(value) }
            }
        }
        guard let lower = values.min(), let upper = values.max() else {
            return 0 ... 1
        }
        guard upper > lower else {
            let pad = Swift.max(abs(upper) * 0.1, 1)
            return (lower - pad) ... (upper + pad)
        }
        let pad = (upper - lower) * 0.08
        return (lower - pad) ... (upper + pad)
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

    private static func isBlank(_ raw: String) -> Bool {
        raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

// MARK: - Display formatting (port of web fmtInt)

/// Locale-aware integer formatting (web `fmtInt` = `fmtNumber(value, 0)`). The
/// widget renders an em dash for a missing value — never "nan" or "0".
public enum ClimateNumberFormat {
    /// The em dash shown for a missing value (web `'—'`).
    public static let dash = "—"

    /// `value != null ? fmtInt(value) : '—'` (web stat / tooltip value).
    public static func temperature(_ value: Double?) -> String {
        guard let value, value.isFinite else { return dash }
        return integer(value)
    }

    /// Rounded integer with grouping separators (web `fmtInt(12345.6) → "12,346"`).
    public static func integer(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 0
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.0f", value)
    }
}
