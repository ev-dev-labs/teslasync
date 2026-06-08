//
//  TirePressureHistoryWidget.Projection.swift
//  TeslaSync — P4 dashboard widget · 0101 · TirePressureHistoryWidget (Apple)
//
//  Pure, Foundation-only domain for the surface: the user's pressure unit (web
//  `usePressureFormat` → `pressureUnit`), the SI kilopascal → display converter
//  (web `convertPressureFromSI`), the cached `TirePressureReading` → chart
//  projection adapter (1:1 port of the web `buildChartData` + `latestNonNull`),
//  the recommended-range band, and the display formatters. No SwiftUI / no
//  networking lives here so the adapter can be exercised by a plain `swift` host
//  harness and XCTest.
//

import Foundation

// MARK: - Pressure display unit (port of web PressureUnitPref)

/// The pressure display unit, mirroring the web `PressureUnitPref`
/// (`'kPa' | 'psi' | 'bar'`). The raw value is the label appended after a space,
/// exactly as the web concatenates `${value} ${pressureUnit}`.
public enum TirePressureUnit: String, Sendable, CaseIterable, Equatable {
    case kpa = "kPa"
    case psi
    case bar

    /// The display suffix (web `pressureUnit`).
    public var label: String {
        rawValue
    }

    /// Resolves the unit from a stored settings label, defaulting to bar — matching
    /// the web `derivePressure` (`unit_of_pressure === 'psi' ? 'psi' : 'bar'`), with
    /// `kPa` honored when explicitly stored.
    public static func fromLabel(_ raw: String?) -> TirePressureUnit {
        switch raw {
        case "psi": .psi
        case "kPa": .kpa
        default: .bar
        }
    }
}

// MARK: - SI conversion (display boundary — frontend SI cutover)

/// SI kilopascals → the user's display unit. A faithful port of the web
/// `convertPressureFromSI` (lib/unitConversion.ts). The DB and API stay SI
/// (kilopascals, per Phase-42); conversion happens only here, at the render
/// boundary — never on disk.
public enum TirePressureConvert {
    /// Kilopascals per psi (web `KPA_PER_PSI`, NIST SP 811).
    public static let kpaPerPsi = 6.894757
    /// Kilopascals per bar (web `KPA_PER_BAR`, BIPM definition).
    public static let kpaPerBar = 100.0

    /// Converts SI kilopascals to the display unit. Non-finite / absent input maps
    /// to `nil` (web `toPressureValue` returns `null` for null/`!Number.isFinite`).
    public static func fromSI(_ kpa: Double?, _ unit: TirePressureUnit) -> Double? {
        guard let kpa, kpa.isFinite else { return nil }
        switch unit {
        case .kpa: return kpa
        case .psi: return kpa / kpaPerPsi
        case .bar: return kpa / kpaPerBar
        }
    }
}

// MARK: - Recommended range (web RECOMMENDED_RANGE_BAR)

/// The manufacturer-recommended cold tire-pressure band the chart overlays as a
/// Min/Max reference pair. The web source names it `RECOMMENDED_RANGE_BAR`
/// (2.4–2.8 bar ≈ 35–41 psi).
///
/// Stored in SI kilopascals so it converts through the SAME `TirePressureConvert`
/// path as the plotted data and therefore always lines up with it on the axis:
/// 2.4 bar = 240 kPa, 2.8 bar = 280 kPa (1 bar = 100 kPa exactly).
///
/// NOTE: the web computes the reference position as `toPressureValue(2.4 * 100_000)`.
/// `toPressureValue` consumes **kilopascals** (the Phase-42 SI floor — verified by
/// the backend `convertPressureFromSI` contract), so the `* 100_000` factor (a
/// bar→pascal scale) is two orders of magnitude too large and pushes the reference
/// lines ~1000× above any real reading, off the top of the plot. This port uses the
/// correct kilopascal magnitudes so the recommended band renders on-scale.
public enum TirePressureRecommendation {
    /// Low edge of the recommended band, SI kilopascals (2.4 bar).
    public static let lowKpa = 240.0
    /// High edge of the recommended band, SI kilopascals (2.8 bar).
    public static let highKpa = 280.0
}

// MARK: - Cached input (port of web TirePressureReading subset)

/// One cached `/tire-pressure` row the state holder hands the surface. Mirrors the
/// subset of the web `TirePressureReading` the chart consumes. Every pressure is
/// SI kilopascals (Phase-42 on-disk contract); `nil` models an absent reading so
/// the series can connect across gaps (web `connectNulls`).
public struct TirePressureSnapshotInput: Equatable, Sendable {
    public var timestamp: String?
    public var frontLeft: Double?
    public var frontRight: Double?
    public var rearLeft: Double?
    public var rearRight: Double?

    public init(
        timestamp: String? = nil,
        frontLeft: Double? = nil,
        frontRight: Double? = nil,
        rearLeft: Double? = nil,
        rearRight: Double? = nil
    ) {
        self.timestamp = timestamp
        self.frontLeft = frontLeft
        self.frontRight = frontRight
        self.rearLeft = rearLeft
        self.rearRight = rearRight
    }
}

// MARK: - Chart datum (port of web ChartDatum)

/// One plotted sample: the four corner pressures (already converted to the user's
/// display unit), keyed on its timestamp. `nil` corners are skipped per series so
/// the line bridges gaps exactly like the web `connectNulls`.
public struct TirePressureChartDatum: Identifiable, Equatable, Sendable {
    public let id: String
    public let time: Date
    public let frontLeft: Double?
    public let frontRight: Double?
    public let rearLeft: Double?
    public let rearRight: Double?

    public init(
        time: Date,
        frontLeft: Double?,
        frontRight: Double?,
        rearLeft: Double?,
        rearRight: Double?,
        id: String? = nil
    ) {
        self.time = time
        self.frontLeft = frontLeft
        self.frontRight = frontRight
        self.rearLeft = rearLeft
        self.rearRight = rearRight
        self.id = id ?? ISO8601DateFormatter().string(from: time)
    }
}

// MARK: - Tire corner identity (the four plotted series)

/// The four wheel positions, in the web's series order (fl, fr, rl, rr). Drives the
/// stat row, the chart series, and the accessibility summary so all three stay in
/// lock-step.
public enum TireCorner: String, CaseIterable, Sendable {
    case frontLeft = "fl"
    case frontRight = "fr"
    case rearLeft = "rl"
    case rearRight = "rr"

    /// The i18n key for the corner's short label (web `widget.tirePressureHistory.fl` …).
    public var labelKey: String {
        "widget.tirePressureHistory.\(rawValue)"
    }

    /// The English fallback for the corner label (web `t(key, 'FL')` …).
    public var labelFallback: String {
        rawValue.uppercased()
    }

    /// Reads this corner's display value off a chart datum.
    public func value(in datum: TirePressureChartDatum) -> Double? {
        switch self {
        case .frontLeft: datum.frontLeft
        case .frontRight: datum.frontRight
        case .rearLeft: datum.rearLeft
        case .rearRight: datum.rearRight
        }
    }
}

// MARK: - Projection (the adapter output)

/// Everything the view needs to render, derived purely from the cached rows + the
/// user's pressure unit. Built by `TirePressureProjectionBuilder`.
public struct TirePressureProjection: Equatable, Sendable {
    public var data: [TirePressureChartDatum]
    public var latest: [TireCorner: Double]
    public var recommendedLow: Double
    public var recommendedHigh: Double
    public var pressureUnitLabel: String
    public var yDomain: ClosedRange<Double>

    public var hasData: Bool {
        !data.isEmpty
    }

    /// The latest display value for a corner (newest-first scan), or `nil`.
    public func latestValue(_ corner: TireCorner) -> Double? {
        latest[corner]
    }

    public static let empty = TirePressureProjection(
        data: [],
        latest: [:],
        recommendedLow: TirePressureRecommendation.lowKpa,
        recommendedHigh: TirePressureRecommendation.highKpa,
        pressureUnitLabel: TirePressureUnit.bar.label,
        yDomain: 0 ... 1
    )

    public init(
        data: [TirePressureChartDatum],
        latest: [TireCorner: Double],
        recommendedLow: Double,
        recommendedHigh: Double,
        pressureUnitLabel: String,
        yDomain: ClosedRange<Double>
    ) {
        self.data = data
        self.latest = latest
        self.recommendedLow = recommendedLow
        self.recommendedHigh = recommendedHigh
        self.pressureUnitLabel = pressureUnitLabel
        self.yDomain = yDomain
    }
}

/// Pure adapter: cached `TirePressureSnapshotInput[]` + pressure unit → projection.
/// A faithful port of the web `buildChartData` + `latestNonNull` + the widget's
/// reference-line / scale derivations.
public enum TirePressureProjectionBuilder {
    public static func build(
        snapshots: [TirePressureSnapshotInput],
        unit: TirePressureUnit
    ) -> TirePressureProjection {
        let data = chartData(from: snapshots, unit: unit)
        let low = TirePressureConvert.fromSI(TirePressureRecommendation.lowKpa, unit)
            ?? TirePressureRecommendation.lowKpa
        let high = TirePressureConvert.fromSI(TirePressureRecommendation.highKpa, unit)
            ?? TirePressureRecommendation.highKpa
        var latest: [TireCorner: Double] = [:]
        for corner in TireCorner.allCases {
            if let value = latestNonNil(data, corner) { latest[corner] = value }
        }
        return TirePressureProjection(
            data: data,
            latest: latest,
            recommendedLow: low,
            recommendedHigh: high,
            pressureUnitLabel: unit.label,
            yDomain: yDomain(data: data, low: low, high: high)
        )
    }

    /// Port of `buildChartData`: drop rows without a timestamp, convert each corner
    /// to the display unit, and sort ascending by time.
    static func chartData(
        from snapshots: [TirePressureSnapshotInput],
        unit: TirePressureUnit
    ) -> [TirePressureChartDatum] {
        snapshots
            .compactMap { snapshot -> TirePressureChartDatum? in
                guard let stamp = snapshot.timestamp,
                      let time = parseTimestamp(stamp) else { return nil }
                return TirePressureChartDatum(
                    time: time,
                    frontLeft: TirePressureConvert.fromSI(snapshot.frontLeft, unit),
                    frontRight: TirePressureConvert.fromSI(snapshot.frontRight, unit),
                    rearLeft: TirePressureConvert.fromSI(snapshot.rearLeft, unit),
                    rearRight: TirePressureConvert.fromSI(snapshot.rearRight, unit),
                    id: stamp
                )
            }
            .sorted { $0.time < $1.time }
    }

    /// Last non-nil value of a corner, scanning newest-first (web `latestNonNull`).
    static func latestNonNil(_ data: [TirePressureChartDatum], _ corner: TireCorner) -> Double? {
        data.reversed().first { corner.value(in: $0) != nil }.flatMap { corner.value(in: $0) }
    }

    /// The y-axis envelope: spans every plotted value AND the recommended band, with
    /// a small symmetric pad, floored at 0. Recharts auto-fits the domain to the
    /// data + reference lines; this reproduces that so the Min/Max lines and the
    /// corner series are always visible together.
    static func yDomain(data: [TirePressureChartDatum], low: Double, high: Double) -> ClosedRange<Double> {
        var values: [Double] = [low, high]
        for datum in data {
            for corner in TireCorner.allCases {
                if let value = corner.value(in: datum) { values.append(value) }
            }
        }
        let lower = values.min() ?? low
        let upper = values.max() ?? high
        guard upper > lower else {
            let pad = max(abs(upper) * 0.1, 1)
            return Swift.max(0, lower - pad) ... (upper + pad)
        }
        let pad = (upper - lower) * 0.08
        return Swift.max(0, lower - pad) ... (upper + pad)
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

// MARK: - Display formatting (port of web fmtNumber + formatPressure)

/// Locale-aware fixed-fraction number formatting (web `fmtNumber`). The widget's
/// `formatPressure` renders an em dash for a missing value — never "nan" or "0".
public enum TirePressureNumberFormat {
    /// The em dash shown for a missing value (web `'—'`).
    public static let dash = "—"

    /// `val != null ? fmtNumber(val, 1) : '—'` (web `formatPressure`).
    public static func pressure(_ value: Double?) -> String {
        guard let value, value.isFinite else { return dash }
        return decimal(value, fractionDigits: 1)
    }

    /// Fixed-fraction decimal (web `fmtNumber(value, digits)`).
    public static func decimal(_ value: Double, fractionDigits: Int) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        return formatter.string(from: NSNumber(value: value))
            ?? String(format: "%.\(fractionDigits)f", value)
    }
}
