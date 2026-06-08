//
//  DetailCards.Adapter.swift
//  TeslaSync — P4 feature view · 0153 · DetailCards (Apple)
//
//  The testable projection core for the drivetrain-health "Detail Cards" surface:
//  the decoded domain models (parity with the web `DrivetrainHealthData` +
//  `DrivingStats` props), the `safe()` numeric guard, the two key/value card
//  projections (web "Temperature Details" + "Power Summary" `KVList` items), the
//  `displayTemp` helper (port of the web `./helpers` function), and the VoiceOver
//  row summaries. Everything here is pure + dependency-free (Foundation only) so it
//  can be unit-tested without a store or a rendered view.
//

import Foundation

// MARK: - Numeric guard (port of the web `safeNumber`)

/// Numeric helpers shared by the projection. `safe` mirrors the web
/// `safeNumber = (v) => typeof v === 'number' && isFinite(v) ? v : 0` used by the
/// `numberFormat` helpers, so a `NaN` / `Infinity` never reaches a formatted label.
public enum DetailCardsNumeric {
    /// Returns the value when it is finite, else `0`.
    public static func safe(_ value: Double?) -> Double {
        guard let value, value.isFinite else { return 0 }
        return value
    }
}

// MARK: - Domain models (ports of `DrivetrainHealthData` + `DrivingStats`)

/// One drivetrain-health snapshot (web `DrivetrainHealthData`). The surface reads
/// the four temperatures; `motorStatus` / `overallHealth` are carried for fidelity
/// with the web type even though this card does not render them.
public struct DetailCardsHealth: Equatable, Sendable {
    public var frontMotorTempC: Double?
    public var rearMotorTempC: Double?
    public var inverterTempC: Double?
    public var batteryTempC: Double?
    public var motorStatus: String
    public var overallHealth: String

    public init(
        frontMotorTempC: Double?,
        rearMotorTempC: Double?,
        inverterTempC: Double?,
        batteryTempC: Double?,
        motorStatus: String = "",
        overallHealth: String = "good"
    ) {
        self.frontMotorTempC = frontMotorTempC
        self.rearMotorTempC = rearMotorTempC
        self.inverterTempC = inverterTempC
        self.batteryTempC = batteryTempC
        self.motorStatus = motorStatus
        self.overallHealth = overallHealth
    }
}

/// The aggregate driving stats (web `DrivingStats`). The surface reads
/// `regenEnergyWh` (SI watt-hours) and `co2SavedKg`; the rest of the documented
/// fields are kept for type fidelity with the web prop.
public struct DetailCardsStats: Equatable, Sendable {
    public var totalDrives: Double
    public var totalDistanceKm: Double
    public var totalDurationS: Double
    public var avgEfficiencyWhKm: Double
    public var avgSpeedKmh: Double
    public var topSpeedKmh: Double
    public var regenRatio: Double
    public var regenEnergyWh: Double
    public var co2SavedKg: Double

    public init(
        totalDrives: Double = 0,
        totalDistanceKm: Double = 0,
        totalDurationS: Double = 0,
        avgEfficiencyWhKm: Double = 0,
        avgSpeedKmh: Double = 0,
        topSpeedKmh: Double = 0,
        regenRatio: Double = 0,
        regenEnergyWh: Double = 0,
        co2SavedKg: Double = 0
    ) {
        self.totalDrives = totalDrives
        self.totalDistanceKm = totalDistanceKm
        self.totalDurationS = totalDurationS
        self.avgEfficiencyWhKm = avgEfficiencyWhKm
        self.avgSpeedKmh = avgSpeedKmh
        self.topSpeedKmh = topSpeedKmh
        self.regenRatio = regenRatio
        self.regenEnergyWh = regenEnergyWh
        self.co2SavedKg = co2SavedKg
    }
}

// MARK: - Card row (one `KVList` item)

/// One key/value row — the projection of a single web `KVList` item. `id` is a
/// stable identity; `labelKey` / `labelFallback` are the i18n key + web English
/// default (resolved through the P1/S10 facade at the view boundary); `value` is
/// the fully-formatted display string (or the em dash for absent data).
public struct DetailCardRow: Identifiable, Equatable, Sendable {
    public var id: String
    public var labelKey: String
    public var labelFallback: String
    public var value: String

    public init(id: String, labelKey: String, labelFallback: String, value: String) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.value = value
    }
}

/// The derived power figures the "Power Summary" card reads, all in kilowatts (the
/// web component is fed these pre-derived by its parent page): the session peak
/// power, the average of per-drive peaks, and the most-negative regen power.
public struct DetailCardsPowerFigures: Equatable, Sendable {
    public var peakPowerKw: Double
    public var avgPowerMaxKw: Double
    public var minRegenPowerKw: Double

    public init(peakPowerKw: Double, avgPowerMaxKw: Double, minRegenPowerKw: Double) {
        self.peakPowerKw = peakPowerKw
        self.avgPowerMaxKw = avgPowerMaxKw
        self.minRegenPowerKw = minRegenPowerKw
    }
}

/// The localized unit suffixes the power card appends (web inline `kW` / `kg`
/// literals), bundled so the projection stays within a small parameter list.
public struct DetailCardsUnitLabels: Equatable, Sendable {
    public var power: String
    public var mass: String

    public init(power: String, mass: String) {
        self.power = power
        self.mass = mass
    }
}

// MARK: - Projection (port of the web card bodies)

/// The pure projection from the decoded health / stats / power inputs to the rows
/// each card renders. Mirrors the web `DetailCards` composition exactly: the
/// temperature card maps four motor/inverter/battery temps through `displayTemp`;
/// the power card gates each metric (`peakPower > 0`, `avgPowerMax > 0`,
/// `minRegenPower < 0`, `stats` present) before formatting, falling back to the em
/// dash otherwise.
public enum DetailCardsProjection {
    /// The em dash shown when a value is absent (web literal `'—'`).
    public static let emptyValue = "—"

    /// Port of the web `displayTemp(celsius, formatTemperature)`: the em dash when
    /// the temperature is `nil`, otherwise the unit-formatted temperature.
    public static func displayTemp(
        _ celsius: Double?,
        formatTemperature: (Double?) -> String
    ) -> String {
        guard let celsius else { return emptyValue }
        return formatTemperature(celsius)
    }

    /// The "Temperature Details" card rows (web first `KVList`): front motor, rear
    /// motor, inverter, and battery temperatures, each via `displayTemp`.
    public static func temperatureRows(
        _ health: DetailCardsHealth?,
        formatTemperature: (Double?) -> String
    ) -> [DetailCardRow] {
        [
            DetailCardRow(
                id: "frontMotorTemp",
                labelKey: "drivetrain.frontMotorTemp",
                labelFallback: "Front Motor Temp",
                value: displayTemp(health?.frontMotorTempC, formatTemperature: formatTemperature)
            ),
            DetailCardRow(
                id: "rearMotorTemp",
                labelKey: "drivetrain.rearMotorTemp",
                labelFallback: "Rear Motor Temp",
                value: displayTemp(health?.rearMotorTempC, formatTemperature: formatTemperature)
            ),
            DetailCardRow(
                id: "inverterTemp",
                labelKey: "drivetrain.inverterTemp",
                labelFallback: "Inverter Temp",
                value: displayTemp(health?.inverterTempC, formatTemperature: formatTemperature)
            ),
            DetailCardRow(
                id: "batteryTemp",
                labelKey: "drivetrain.batteryTemp",
                labelFallback: "Battery Temp",
                value: displayTemp(health?.batteryTempC, formatTemperature: formatTemperature)
            )
        ]
    }

    /// The "Power Summary" card rows (web second `KVList`). The power inputs arrive
    /// in kilowatts (the web component renders them with a literal `kW` suffix); the
    /// regen energy is SI watt-hours formatted through the unit-aware energy
    /// formatter; CO₂ is kilograms.
    public static func powerRows(
        figures: DetailCardsPowerFigures,
        stats: DetailCardsStats?,
        formatting: any DetailCardsFormatting,
        units: DetailCardsUnitLabels
    ) -> [DetailCardRow] {
        [
            DetailCardRow(
                id: "peakPower",
                labelKey: "drivetrain.peakPowerLabel",
                labelFallback: "Peak Power",
                value: peakPowerValue(figures.peakPowerKw, formatting: formatting, powerUnit: units.power)
            ),
            DetailCardRow(
                id: "avgPower",
                labelKey: "drivetrain.avgPowerLabel",
                labelFallback: "Avg Peak Power",
                value: avgPowerValue(figures.avgPowerMaxKw, formatting: formatting, powerUnit: units.power)
            ),
            DetailCardRow(
                id: "maxRegen",
                labelKey: "drivetrain.maxRegenLabel",
                labelFallback: "Max Regen",
                value: maxRegenValue(figures.minRegenPowerKw, formatting: formatting, powerUnit: units.power)
            ),
            DetailCardRow(
                id: "totalRegen",
                labelKey: "drivetrain.regenLabel",
                labelFallback: "Total Regen",
                value: totalRegenValue(stats, formatting: formatting)
            ),
            DetailCardRow(
                id: "co2",
                labelKey: "drivetrain.co2Label",
                labelFallback: "CO₂ Saved",
                value: co2Value(stats, formatting: formatting, massUnit: units.mass)
            )
        ]
    }

    /// Web `peakPower > 0 ? \`${fmtInt(peakPower)} kW\` : '—'`.
    public static func peakPowerValue(
        _ peakPower: Double,
        formatting: any DetailCardsFormatting,
        powerUnit: String
    ) -> String {
        guard peakPower > 0 else { return emptyValue }
        return "\(formatting.formatInt(peakPower)) \(powerUnit)"
    }

    /// Web `avgPowerMax > 0 ? \`${fmtNumber(avgPowerMax, 1)} kW\` : '—'`.
    public static func avgPowerValue(
        _ avgPowerMax: Double,
        formatting: any DetailCardsFormatting,
        powerUnit: String
    ) -> String {
        guard avgPowerMax > 0 else { return emptyValue }
        return "\(formatting.formatNumber(avgPowerMax, decimals: 1)) \(powerUnit)"
    }

    /// Web `minRegenPower < 0 ? \`${fmtNumber(Math.abs(minRegenPower), 1)} kW\` : '—'`.
    public static func maxRegenValue(
        _ minRegenPower: Double,
        formatting: any DetailCardsFormatting,
        powerUnit: String
    ) -> String {
        guard minRegenPower < 0 else { return emptyValue }
        return "\(formatting.formatNumber(abs(minRegenPower), decimals: 1)) \(powerUnit)"
    }

    /// Web `stats ? formatEnergy(stats.regenEnergyWh, { precision: 1 }) : '—'`.
    public static func totalRegenValue(
        _ stats: DetailCardsStats?,
        formatting: any DetailCardsFormatting
    ) -> String {
        guard let stats else { return emptyValue }
        return formatting.formatEnergy(stats.regenEnergyWh, precision: 1)
    }

    /// Web `stats ? \`${fmtNumber(stats.co2SavedKg, 1)} kg\` : '—'`.
    public static func co2Value(
        _ stats: DetailCardsStats?,
        formatting: any DetailCardsFormatting,
        massUnit: String
    ) -> String {
        guard let stats else { return emptyValue }
        return "\(formatting.formatNumber(stats.co2SavedKg, decimals: 1)) \(massUnit)"
    }

    /// Whether every row would resolve to the em dash — no health, no stats, and no
    /// positive peak / average power or negative regen. The cards still render (the
    /// web never hides them); this only distinguishes the empty rendering.
    public static func isEmpty(
        health: DetailCardsHealth?,
        peakPower: Double,
        avgPowerMax: Double,
        minRegenPower: Double,
        stats: DetailCardsStats?
    ) -> Bool {
        health == nil
            && stats == nil
            && peakPower <= 0
            && avgPowerMax <= 0
            && minRegenPower >= 0
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver string for one key/value row so the spoken content can be
/// unit-tested without rendering a view: "Front Motor Temp, 45.0°C".
public enum DetailCardsAccessibility {
    /// "<label>, <value>" — the row's localized label followed by its formatted
    /// value, spoken as a single element.
    public static func rowSummary(label: String, value: String) -> String {
        "\(label), \(value)"
    }
}
