//
//  HealthGaugeGrid.Adapter.swift
//  TeslaSync — P4 feature view · 0154 · HealthGaugeGrid (Apple)
//
//  The testable projection core: a `DrivetrainHealthInput` + `HealthGaugeUnitPrefs` → the
//  view-ready radial health-score gauge, the four motor-detail rows, and the four drive-stat
//  rows (or `nil` for the web `stats === undefined` skeleton), reproducing the web source's
//  numeric + string pipeline VERBATIM so the native surface shows the exact same values as
//  features/driving/components/drivetrain-health/HealthGaugeGrid.tsx.
//
//  Deliberately free of SwiftUI (Foundation only) so the conversion + formatting + projection
//  + accessibility compile and run on a plain host and are pinned by unit tests. The status →
//  token tint mapping lives in HealthGaugeGrid.Views.swift; here a row's label is resolved
//  lazily through the P1/S10 facade so the projector itself holds no SwiftUI.
//

import Foundation

// MARK: - Number formatting (ported from web lib/numberFormat.ts)

/// Locale-aware number formatting that mirrors the web `fmtNumber`/`fmtInt`
/// (`safeNumber(v).toLocaleString(locale, { min/maxFractionDigits })`) plus the locale-free
/// `${value}` template stringification the web uses for the raw health-score row.
public enum HealthGaugeFormat {
    /// The web global decimal precision default (`numberFormat.ts` `_globalPrecision = 2`), used
    /// by the gauge centre when the clamped score is not an integer (web `getGlobalPrecision()`).
    public static let defaultPrecision = 2

    /// `safeNumber` from numberFormat.ts (and the charts `safe`): non-finite inputs collapse to 0.
    public static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// `fmtNumber(v, decimals, locale)` — fixed fraction digits, grouped, rounding half away from
    /// zero to match `Number.toLocaleString`'s default `halfExpand`.
    public static func number(_ value: Double, decimals: Int, localeIdentifier: String = "en_US") -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = max(0, decimals)
        formatter.maximumFractionDigits = max(0, decimals)
        formatter.roundingMode = .halfUp
        let safe = safeNumber(value)
        return formatter.string(from: NSNumber(value: safe)) ?? String(format: "%.\(max(0, decimals))f", safe)
    }

    /// `fmtInt(v)` — `fmtNumber(v, 0)`, the grouped whole-number formatter the web uses for the
    /// drive count + total distance. Accepts a `Double` because the web feeds it the converted
    /// (fractional) distance before flooring to whole units.
    public static func integer(_ value: Double, localeIdentifier: String = "en_US") -> String {
        number(value, decimals: 0, localeIdentifier: localeIdentifier)
    }

    /// `fmtInt(v)` for an already-integral count (web `fmtInt(stats.totalDrives)`).
    public static func integer(_ value: Int, localeIdentifier: String = "en_US") -> String {
        number(Double(value), decimals: 0, localeIdentifier: localeIdentifier)
    }

    /// Reproduces a JavaScript template-literal `${value}` for a finite number: locale-free
    /// (always `.` decimal, no grouping) and trailing-zero-trimmed, so `95` → "95", `95.5` →
    /// "95.5" — the exact text the web `${healthScore}%` row produces. Non-finite collapses to "0".
    public static func jsNumberString(_ value: Double) -> String {
        guard value.isFinite else { return "0" }
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = false
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 15
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }
}

// MARK: - SI → display converters (ported 1:1 from web lib/unitConversion.ts)

/// Meters in a mile / kilometer / foot — the exact constants the web converters use.
private enum HealthGaugeSIConstants {
    static let metersPerKilometer = 1000.0
    static let metersPerMile = 1609.344
    static let metersPerFoot = 0.3048
    static let secondsPerHour = 3600.0
}

/// Distance converter ported 1:1 from `convertDistanceFromSI(meters, to)` in
/// `lib/unitConversion.ts`: `km` is `m / 1000`, `mi` is `m / 1609.344`, `ft` is `m / 0.3048`.
func convertHealthDistanceFromSI(_ meters: Double, to unit: HealthDistanceUnit) -> Double {
    switch unit {
    case .kilometers:
        meters / HealthGaugeSIConstants.metersPerKilometer
    case .miles:
        meters / HealthGaugeSIConstants.metersPerMile
    case .feet:
        meters / HealthGaugeSIConstants.metersPerFoot
    }
}

/// Speed converter ported 1:1 from `convertSpeedFromSI(mps, to)` in `lib/unitConversion.ts`:
/// `km/h` is `mps * 3600 / 1000`, `mph` is `mps * 3600 / 1609.344`.
func convertHealthSpeedFromSI(_ metersPerSecond: Double, to unit: HealthSpeedUnit) -> Double {
    switch unit {
    case .kilometersPerHour:
        metersPerSecond * HealthGaugeSIConstants.secondsPerHour / HealthGaugeSIConstants.metersPerKilometer
    case .milesPerHour:
        metersPerSecond * HealthGaugeSIConstants.secondsPerHour / HealthGaugeSIConstants.metersPerMile
    }
}

// MARK: - Projected radial gauge (web `RadialGauge`)

/// The projected health-score gauge: the localized label, the formatted centre value, the unit
/// suffix, the 0...1 ring fill (`clamped / 100`), and the status that tints the arc. Mirrors the
/// web `<RadialGauge value={healthScore} max={100} unit="%" color={healthColor} />`.
public struct HealthScoreGauge: Equatable, Sendable {
    public let labelKey: String
    public let labelFallback: String
    public let valueText: String
    public let unit: String
    public let fraction: Double
    public let status: DrivetrainHealthStatus

    public init(
        labelKey: String,
        labelFallback: String,
        valueText: String,
        unit: String,
        fraction: Double,
        status: DrivetrainHealthStatus
    ) {
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.valueText = valueText
        self.unit = unit
        self.fraction = fraction
        self.status = status
    }

    /// The resolved (localized) label for display + accessibility (P1/S10 facade).
    public var label: String {
        HealthGaugeGridStrings.string(labelKey, labelFallback)
    }

    /// The centre readout spoken by VoiceOver — value plus unit suffix.
    public var spokenValue: String {
        "\(valueText)\(unit)"
    }
}

// MARK: - Projected key/value row (web `KVList` item)

/// One key/value row — the native mirror of a web `KVList` `{ label, value }` item. The label is
/// resolved lazily through the P1/S10 facade so the projector stays SwiftUI-free; the value is
/// pre-formatted to the exact web string.
public struct HealthDetailRow: Identifiable, Equatable, Sendable {
    public let id: String
    public let labelKey: String
    public let labelFallback: String
    public let value: String

    public init(id: String, labelKey: String, labelFallback: String, value: String) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.value = value
    }

    /// The resolved (localized) label for display + accessibility (P1/S10 facade).
    public var label: String {
        HealthGaugeGridStrings.string(labelKey, labelFallback)
    }
}

// MARK: - Projection

/// The fully-projected surface content: the radial gauge, the four motor-detail rows, and the
/// four drive-stat rows — or `nil` drive rows for the web `stats ? <KVList/> : <Skeleton/>`
/// per-panel branch.
public struct HealthGaugeGridProjection: Equatable, Sendable {
    public let gauge: HealthScoreGauge
    public let motorRows: [HealthDetailRow]
    public let driveRows: [HealthDetailRow]?

    public init(gauge: HealthScoreGauge, motorRows: [HealthDetailRow], driveRows: [HealthDetailRow]?) {
        self.gauge = gauge
        self.motorRows = motorRows
        self.driveRows = driveRows
    }

    /// Whether the drive-statistics panel has resolved rows (web `stats` truthy).
    public var hasDriveStats: Bool {
        driveRows != nil
    }
}

// MARK: - Projector (pure, web-parity)

/// Pure projector: `DrivetrainHealthInput` + `HealthGaugeUnitPrefs` → `HealthGaugeGridProjection`.
/// Every value is computed with the exact same arithmetic + formatting as the web component so
/// the web and native surfaces show identical strings side by side.
public enum HealthGaugeGridProjector {
    public static func project(data: DrivetrainHealthInput, units: HealthGaugeUnitPrefs) -> HealthGaugeGridProjection {
        HealthGaugeGridProjection(
            gauge: gauge(for: data, locale: units.localeIdentifier),
            motorRows: motorRows(for: data),
            driveRows: data.stats.map { driveRows(for: $0, units: units) }
        )
    }

    /// The radial gauge: `clamped = max(0, min(score, 100))`, the centre reads `fmtNumber(clamped,
    /// decimals)` (0 decimals when integral, else the global precision), the unit is "%", and the
    /// arc fills `clamped / 100` — exactly the web `<RadialGauge>` pipeline.
    private static func gauge(for data: DrivetrainHealthInput, locale: String) -> HealthScoreGauge {
        let clamped = min(max(HealthGaugeFormat.safeNumber(data.healthScore), 0), 100)
        let decimals = clamped == clamped.rounded() ? 0 : HealthGaugeFormat.defaultPrecision
        return HealthScoreGauge(
            labelKey: "drivetrain.healthScore",
            labelFallback: "Health Score",
            valueText: HealthGaugeFormat.number(clamped, decimals: decimals, localeIdentifier: locale),
            unit: "%",
            fraction: clamped / 100,
            status: data.overallHealth
        )
    }

    /// The four motor-detail rows in the web render order. The Overall Health value is the
    /// localized status name (web capitalizes the enum inline); the Health Score value is the raw
    /// `${healthScore}%` template literal; the Active Sensors value is `String(count)` (the web
    /// uses no grouping for the sensor count).
    private static func motorRows(for data: DrivetrainHealthInput) -> [HealthDetailRow] {
        [
            HealthDetailRow(
                id: "motorStatus",
                labelKey: "drivetrain.motorStatus",
                labelFallback: "Motor Status",
                value: data.motorStatus
            ),
            HealthDetailRow(
                id: "overallHealth",
                labelKey: "drivetrain.overallHealth",
                labelFallback: "Overall Health",
                value: HealthGaugeGridStrings.string(data.overallHealth.labelKey, data.overallHealth.labelFallback)
            ),
            HealthDetailRow(
                id: "healthScore",
                labelKey: "drivetrain.healthScoreLabel",
                labelFallback: "Health Score",
                value: "\(HealthGaugeFormat.jsNumberString(data.healthScore))%"
            ),
            HealthDetailRow(
                id: "sensorCount",
                labelKey: "drivetrain.sensorCount",
                labelFallback: "Active Sensors",
                value: "\(data.activeSensorCount)"
            )
        ]
    }

    /// The four drive-statistic rows (web `stats` present). Total Drives + Total Distance use
    /// `fmtInt`; Avg + Top Speed use `fmtNumber(_, 1)`; each distance/speed is converted from SI
    /// via the ported converters and suffixed with the user's unit symbol.
    private static func driveRows(for stats: DriveStatsInput, units: HealthGaugeUnitPrefs) -> [HealthDetailRow] {
        let locale = units.localeIdentifier
        let distance = convertHealthDistanceFromSI(stats.totalDistanceMeters, to: units.distance)
        let avgSpeed = convertHealthSpeedFromSI(stats.avgSpeedMetersPerSecond, to: units.speed)
        let topSpeed = convertHealthSpeedFromSI(stats.topSpeedMetersPerSecond, to: units.speed)
        let distanceText = HealthGaugeFormat.integer(distance, localeIdentifier: locale)
        let avgText = HealthGaugeFormat.number(avgSpeed, decimals: 1, localeIdentifier: locale)
        let topText = HealthGaugeFormat.number(topSpeed, decimals: 1, localeIdentifier: locale)
        return [
            HealthDetailRow(
                id: "totalDrives",
                labelKey: "drivetrain.totalDrives",
                labelFallback: "Total Drives",
                value: HealthGaugeFormat.integer(stats.totalDrives, localeIdentifier: locale)
            ),
            HealthDetailRow(
                id: "totalDistance",
                labelKey: "drivetrain.totalDistance",
                labelFallback: "Total Distance",
                value: "\(distanceText) \(units.distance.symbol)"
            ),
            HealthDetailRow(
                id: "avgSpeed",
                labelKey: "drivetrain.avgSpeed",
                labelFallback: "Avg Speed",
                value: "\(avgText) \(units.speed.symbol)"
            ),
            HealthDetailRow(
                id: "topSpeed",
                labelKey: "drivetrain.topSpeed",
                labelFallback: "Top Speed",
                value: "\(topText) \(units.speed.symbol)"
            )
        ]
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summaries spoken for the surface. Pure + public so the spoken content can
/// be unit-tested without rendering the view. Callers pass already-localized strings (the labels)
/// so the summary holds no English literals itself.
public enum HealthGaugeGridAccessibility {
    /// One spoken phrase for one key/value row, e.g. "Total Drives 1,284".
    public static func rowSummary(label: String, value: String) -> String {
        "\(label) \(value)"
    }

    /// The gauge summary, e.g. "Health Score 95%".
    public static func gaugeSummary(for gauge: HealthScoreGauge) -> String {
        "\(gauge.label) \(gauge.spokenValue)"
    }

    /// The full surface summary: the gauge, then every motor row, then every drive row (when
    /// present). e.g. "Health Score 95%. Motor Status Optimal. Overall Health Good. …".
    public static func summary(for projection: HealthGaugeGridProjection) -> String {
        var phrases = [gaugeSummary(for: projection.gauge)]
        phrases.append(contentsOf: projection.motorRows.map { rowSummary(label: $0.label, value: $0.value) })
        if let driveRows = projection.driveRows {
            phrases.append(contentsOf: driveRows.map { rowSummary(label: $0.label, value: $0.value) })
        }
        return phrases.joined(separator: ". ")
    }
}
