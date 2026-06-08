//
//  EnergySummaryPanel.Adapter.swift
//  TeslaSync — P4 feature view · 0142 · EnergySummaryPanel (Apple)
//
//  The testable projection core for the drive energy-summary panel — the SwiftUI
//  parity of features/driving/components/drive-detail/EnergySummaryPanel.tsx plus the
//  web helpers it is fed by: `fmtNumber` / `fmtWithUnit` (lib/numberFormat.ts) and the
//  `unitPrefs.distance` distance preference (hooks/useUnits.ts). Everything here is
//  pure + dependency-free (no store, no bundle, no rendered view) so the number
//  formatting, the energy kWh/Wh ladder, the efficiency unit conversion, the
//  battery-delta wording, and the six metric projections are all unit tested in
//  isolation.
//
//  Parity note: the web panel renders each energy figure with a
//  `value > 1000 ? fmtWithUnit(value / 1000, 'kWh') : `${fmtNumber(value)} Wh`` rule
//  (a strict `> 1000` threshold) and a 2-decimal locale format. Efficiency reads in
//  `Wh/km`, converted to `Wh/mi` (× 1.609344) only when the user's distance
//  preference is miles. This core reproduces that arithmetic and labelling verbatim;
//  the drive + stats values are computed by the parent surface (out of scope here).
//

import Foundation

// MARK: - Distance preference (web `useUnits().unitPrefs.distance`)

/// The user's distance display preference — the native mirror of the web
/// `unitPrefs.distance` (`'mi' | 'km'`), derived from the shared `MeasurementSystem`
/// state holder. Drives the range unit label and the efficiency unit + conversion.
public enum EnergySummaryDistanceUnit: String, Sendable, Equatable, CaseIterable {
    case km
    case mi

    /// Maps the shared measurement system onto the distance preference: imperial ⇒
    /// miles, metric ⇒ kilometres (the same split the web `deriveDistance` makes).
    public init(_ system: MeasurementSystem) {
        self = system == .imperial ? .mi : .km
    }

    /// The distance unit suffix (mirrors `MeasurementSystem.distanceLabel`).
    public var distanceLabel: String {
        self == .mi ? "mi" : "km"
    }

    /// The efficiency unit suffix — web `unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km'`.
    public var efficiencyLabel: String {
        "Wh/\(distanceLabel)"
    }

    /// The Wh/km → display factor — web `toEfficiencyDisplay`: × 1.609344 for miles,
    /// identity for kilometres.
    public var efficiencyFactor: Double {
        self == .mi ? 1.609344 : 1
    }
}

// MARK: - Number / energy formatting (port of numberFormat.ts)

/// Pure number + energy formatting ported from the web helpers so the rounding, the
/// grouping separators, and the kWh/Wh scaling match the source exactly. The web
/// global precision is 2 and `safeNumber` coerces non-finite input to 0; both are
/// reproduced here. Locale is injectable so the output is deterministic under test.
public enum EnergySummaryFormat {
    /// The em-dash sentinel the web renders for a missing / non-applicable value.
    public static let dash = "—"

    /// Native port of `safeNumber` (numberFormat.ts): non-finite ⇒ 0.
    static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Native port of `fmtNumber(v, decimals)`: locale grouping, fixed fraction
    /// digits, half-away rounding (web `toLocaleString` default), `safeNumber` guard.
    public static func number(_ value: Double, decimals: Int = 2, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: safe(value))) ?? "0"
    }

    /// Native port of `fmtWithUnit(v, unit)` — `fmtNumber(v)` plus a spaced unit.
    public static func withUnit(_ value: Double, _ unit: String, locale: Locale = .current) -> String {
        number(value, locale: locale) + " " + unit
    }

    /// The web energy ladder: `value > 1000 ? fmtWithUnit(value / 1000, 'kWh')
    /// : `${fmtNumber(value)} Wh``. Reproduced verbatim — note the threshold is a
    /// strict greater-than, so exactly 1000 stays in watt-hours.
    public static func energy(_ value: Double, locale: Locale = .current) -> String {
        value > 1000
            ? withUnit(value / 1000, "kWh", locale: locale)
            : withUnit(value, "Wh", locale: locale)
    }

    /// A grouping-free, trailing-zero-free number — the native equivalent of the web
    /// template-literal `${value}` interpolation used for the battery-percent delta
    /// and endpoints (JavaScript `Number → String` adds no thousands separators).
    public static func plain(_ value: Double, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = false
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 3
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: safe(value))) ?? "0"
    }

    // MARK: Web metric expressions

    /// Web "Energy Consumed" / "Energy Recovered" cell — the energy ladder applied to
    /// the raw watt-hour figure.
    public static func energyCell(_ wattHours: Double, locale: Locale = .current) -> String {
        energy(wattHours, locale: locale)
    }

    /// Web "Net Consumption" cell — the energy ladder applied to `energyWh - regenWh`.
    public static func netCell(energyWh: Double, regenWh: Double, locale: Locale = .current) -> String {
        energy(energyWh - regenWh, locale: locale)
    }

    /// Web "Efficiency" cell — `consumptionWhKm > 0 ? `${fmtNumber(display)} ${unit}`
    /// : '—'`, where `display = consumptionWhKm × unit.efficiencyFactor`.
    public static func efficiencyCell(
        consumptionWhKm: Double,
        unit: EnergySummaryDistanceUnit,
        locale: Locale = .current
    ) -> String {
        guard consumptionWhKm > 0 else { return dash }
        return withUnit(consumptionWhKm * unit.efficiencyFactor, unit.efficiencyLabel, locale: locale)
    }

    /// Web "Battery Used" value — `start != null && end != null ? `${start - end}%`
    /// : '—'` (the delta is interpolated unformatted, so `plain` is used).
    public static func batteryUsedValue(start: Double?, end: Double?, locale: Locale = .current) -> String {
        guard let start, let end else { return dash }
        return plain(start - end, locale: locale) + "%"
    }

    /// Web "Battery Used" detail — `${start ?? '?'}% → ${end ?? '?'}%`.
    public static func batteryUsedDetail(start: Double?, end: Double?, locale: Locale = .current) -> String {
        let startText = start.map { plain($0, locale: locale) } ?? "?"
        let endText = end.map { plain($0, locale: locale) } ?? "?"
        return "\(startText)% → \(endText)%"
    }

    /// Web "Range Used" cell — `start != null && end != null ?
    /// fmtWithUnit(start - end, distanceUnit) : '—'`.
    public static func rangeUsedCell(
        start: Double?,
        end: Double?,
        unit: EnergySummaryDistanceUnit,
        locale: Locale = .current
    ) -> String {
        guard let start, let end else { return dash }
        return withUnit(start - end, unit.distanceLabel, locale: locale)
    }
}

// MARK: - Input data (web props: `drive` + `stats`)

/// One coalesced snapshot of the panel's numeric inputs — the native mirror of the
/// web props the panel reads (`stats.energyWh / regenWh / consumptionWhKm /
/// startRange / endRange` and `drive.startBatteryPct / endBatteryPct`). The values
/// are carried verbatim from the parent surface (the Drive Detail page); no SI
/// conversion happens here — the only display preference is the distance unit, which
/// rides on the input snapshot in `EnergySummaryInput`.
public struct EnergySummaryInputData: Sendable, Equatable {
    public var energyWh: Double
    public var regenWh: Double
    public var consumptionWhKm: Double
    public var startRange: Double?
    public var endRange: Double?
    public var startBatteryPct: Double?
    public var endBatteryPct: Double?

    public init(
        energyWh: Double = 0,
        regenWh: Double = 0,
        consumptionWhKm: Double = 0,
        startRange: Double? = nil,
        endRange: Double? = nil,
        startBatteryPct: Double? = nil,
        endBatteryPct: Double? = nil
    ) {
        self.energyWh = energyWh
        self.regenWh = regenWh
        self.consumptionWhKm = consumptionWhKm
        self.startRange = startRange
        self.endRange = endRange
        self.startBatteryPct = startBatteryPct
        self.endBatteryPct = endBatteryPct
    }
}

// MARK: - Metric projection (web grid cells)

/// One resolved metric cell — the native mirror of one cell in the web six-up grid.
/// The display label is carried as an i18n key + English fallback (resolved in the
/// view); `value` (and the optional `detail` sub-line) are already locale-formatted so
/// the view is a pure function of this value. `tint` selects the cell's accent.
public struct EnergySummaryMetric: Identifiable, Equatable, Sendable {
    /// The accent role for the value text — mapped to the shared chart-series tokens
    /// in the view (ADR-006 semantic, not literal): the web `text-{colour}-400`.
    public enum Tint: String, Sendable, Equatable {
        case energy // web amber-400
        case recovered // web green-400
        case net // web cyan-400
        case efficiency // web purple-400
        case battery // web amber-400
        case range // web green-400
    }

    public let id: String
    public let labelKey: String
    public let labelFallback: String
    public let value: String
    public let detail: String?
    public let tint: Tint

    public init(
        id: String,
        labelKey: String,
        labelFallback: String,
        value: String,
        detail: String? = nil,
        tint: Tint
    ) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.value = value
        self.detail = detail
        self.tint = tint
    }
}

/// Builds the six metric cells from an input snapshot + distance preference — the
/// native port of the web grid (`Energy Consumed`, `Energy Recovered`, `Net
/// Consumption`, `Efficiency`, `Battery Used`, `Range Used`), in source order. This is
/// the testable adapter the prompt's "cached → projection" unit test exercises.
public enum EnergySummaryMetricsBuilder {
    public static func metrics(
        for data: EnergySummaryInputData,
        unit: EnergySummaryDistanceUnit,
        locale: Locale = .current
    ) -> [EnergySummaryMetric] {
        [
            consumed(data, locale: locale),
            recovered(data, locale: locale),
            net(data, locale: locale),
            efficiency(data, unit: unit, locale: locale),
            battery(data, locale: locale),
            range(data, unit: unit, locale: locale)
        ]
    }

    private static func consumed(_ data: EnergySummaryInputData, locale: Locale) -> EnergySummaryMetric {
        EnergySummaryMetric(
            id: "consumed",
            labelKey: "driveDetail.energyConsumed",
            labelFallback: "Energy Consumed",
            value: EnergySummaryFormat.energyCell(data.energyWh, locale: locale),
            tint: .energy
        )
    }

    private static func recovered(_ data: EnergySummaryInputData, locale: Locale) -> EnergySummaryMetric {
        EnergySummaryMetric(
            id: "recovered",
            labelKey: "driveDetail.energyRecovered",
            labelFallback: "Energy Recovered",
            value: EnergySummaryFormat.energyCell(data.regenWh, locale: locale),
            tint: .recovered
        )
    }

    private static func net(_ data: EnergySummaryInputData, locale: Locale) -> EnergySummaryMetric {
        EnergySummaryMetric(
            id: "net",
            labelKey: "driveDetail.netConsumption",
            labelFallback: "Net Consumption",
            value: EnergySummaryFormat.netCell(energyWh: data.energyWh, regenWh: data.regenWh, locale: locale),
            tint: .net
        )
    }

    private static func efficiency(
        _ data: EnergySummaryInputData,
        unit: EnergySummaryDistanceUnit,
        locale: Locale
    ) -> EnergySummaryMetric {
        EnergySummaryMetric(
            id: "efficiency",
            labelKey: "driveDetail.efficiency",
            labelFallback: "Efficiency",
            value: EnergySummaryFormat.efficiencyCell(
                consumptionWhKm: data.consumptionWhKm,
                unit: unit,
                locale: locale
            ),
            tint: .efficiency
        )
    }

    private static func battery(_ data: EnergySummaryInputData, locale: Locale) -> EnergySummaryMetric {
        EnergySummaryMetric(
            id: "battery",
            labelKey: "driveDetail.batteryUsed",
            labelFallback: "Battery Used",
            value: EnergySummaryFormat.batteryUsedValue(
                start: data.startBatteryPct,
                end: data.endBatteryPct,
                locale: locale
            ),
            detail: EnergySummaryFormat.batteryUsedDetail(
                start: data.startBatteryPct,
                end: data.endBatteryPct,
                locale: locale
            ),
            tint: .battery
        )
    }

    private static func range(
        _ data: EnergySummaryInputData,
        unit: EnergySummaryDistanceUnit,
        locale: Locale
    ) -> EnergySummaryMetric {
        EnergySummaryMetric(
            id: "range",
            labelKey: "driveDetail.rangeUsed",
            labelFallback: "Range Used",
            value: EnergySummaryFormat.rangeUsedCell(
                start: data.startRange,
                end: data.endRange,
                unit: unit,
                locale: locale
            ),
            tint: .range
        )
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver string for a metric cell from already-localised parts, so the
/// spoken content is asserted without rendering the view.
public enum EnergySummaryAccessibility {
    /// The per-cell spoken label: "{label}: {value}" — with the battery detail
    /// appended when present ("{label}: {value}, {detail}").
    public static func metricLabel(label: String, value: String, detail: String? = nil) -> String {
        guard let detail, !detail.isEmpty else { return "\(label): \(value)" }
        return "\(label): \(value), \(detail)"
    }
}
