//
//  ChargerSpecsPanel.Adapter.swift
//  TeslaSync — P4 feature view · 0098 · ChargerSpecsPanel (Apple)
//
//  The testable projection core: a cached `ChargerSpecsInput` (SI watt-hours / watts) + the
//  user's locale/precision → the four view-ready spec columns, reproducing the web source's
//  pipeline VERBATIM so the native surface shows the exact same rows as
//  features/charging/components/charging-list/ChargerSpecsPanel.tsx.
//
//  The web row text is `{v.count} sessions · {showAvgPower && v.avgPower != null ?
//  `${fmtInt(v.avgPower)} kW avg` : fmtWithUnit(v.energy, 'kWh')}`. Energy arrives summed in
//  SI watt-hours and is shown in kWh (`convertEnergyFromSI(_, 'kWh')` = wh / 1000) at the
//  global precision (2); the averaged peak power arrives in SI watts and is shown as an
//  integer kW (`convertPowerFromSI(_, 'kW')` = w / 1000 → `fmtInt`). The session count is the
//  raw integer (web `{v.count}`, no grouping). This file is deliberately free of SwiftUI so
//  the conversion + formatting + projection + accessibility compile and run on a plain host
//  and are pinned by unit tests.
//

import Foundation

// MARK: - Unit conversion (ported 1:1 from web lib/unitConversion.ts)

/// Energy converter ported 1:1 from `convertEnergyFromSI(wh, 'kWh')` in `lib/unitConversion.ts`
/// (`wh / 1000`). The charging session energies arrive summed in SI watt-hours (the floor the
/// Phase-42 pipeline stores), exactly the input the web helper converts before the panel shows
/// it in kWh.
func convertChargerEnergyToKwh(_ wattHours: Double) -> Double {
    wattHours / 1000
}

/// Power converter ported 1:1 from `convertPowerFromSI(watts, 'kW')` in `lib/unitConversion.ts`
/// (`watts / 1000`). The averaged peak power arrives in SI watts; the panel shows integer kW.
func convertChargerPowerToKilowatts(_ watts: Double) -> Double {
    watts / 1000
}

// MARK: - Number formatting (ported from web lib/numberFormat.ts `fmtNumber`)

/// Locale-aware decimal formatting that mirrors the web `fmtNumber`
/// (`safeNumber(v).toLocaleString(locale, { min/maxFractionDigits })`), rounding half away from
/// zero to match `Intl.NumberFormat`'s default `halfExpand`. Energy uses the global precision
/// (`fmtWithUnit(energy, 'kWh')`, two digits); power uses zero digits (`fmtInt`).
public enum ChargerSpecsFormat {
    /// `safeNumber` from numberFormat.ts: non-finite inputs collapse to 0.
    static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// `fmtNumber(v, decimals, locale)` — fixed fraction digits, grouped, half-away-from-zero.
    public static func number(_ value: Double, decimals: Int, localeIdentifier: String) -> String {
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
}

// MARK: - Column catalog (web four `<SpecColumn>` instances)

/// The four spec columns the web grid renders, in source order: Voltage, Phase, Cable, Brand.
/// Each carries the web `t()` keys (label + empty message), the SF Symbol that maps the web
/// lucide icon, whether it shows average power (web `showAvgPower`, Brand only), and whether it
/// counts toward the panel's `hasData` gate (web checks voltage/cable/brand — Phase excluded).
public enum ChargerSpecsColumnKind: String, Sendable, Equatable, CaseIterable {
    case voltage
    case phase
    case cable
    case brand

    /// i18n key for the column label (web `t('charging.specs.by…')`).
    public var labelKey: String {
        switch self {
        case .voltage: "charging.specs.byVoltage"
        case .phase: "charging.specs.byPhase"
        case .cable: "charging.specs.byCable"
        case .brand: "charging.specs.byBrand"
        }
    }

    /// English fallback for the column label (web default literal).
    public var labelFallback: String {
        switch self {
        case .voltage: "By Voltage"
        case .phase: "By Phase"
        case .cable: "By Cable"
        case .brand: "By Brand"
        }
    }

    /// i18n key for the per-column empty message (web `emptyMsg`).
    public var emptyKey: String {
        switch self {
        case .voltage: "charging.specs.noVoltage"
        case .phase: "charging.specs.noPhase"
        case .cable: "charging.specs.noCable"
        case .brand: "charging.specs.noBrand"
        }
    }

    /// English fallback for the per-column empty message (web default literal).
    public var emptyFallback: String {
        switch self {
        case .voltage: "No voltage data"
        case .phase: "No phase data"
        case .cable: "No cable data"
        case .brand: "No brand data"
        }
    }

    /// SF Symbol mapping the web lucide icon (Zap / Activity / Cable / Plug).
    public var iconSystemName: String {
        switch self {
        case .voltage: "bolt.fill"
        case .phase: "waveform.path.ecg"
        case .cable: "cable.connector"
        case .brand: "powerplug.fill"
        }
    }

    /// Web `showAvgPower` — only the Brand column renders the average-power metric.
    public var showsAveragePower: Bool {
        self == .brand
    }

    /// Web `hasData` checks `voltage || cable || brand` — the Phase column is deliberately
    /// excluded from the populated-vs-empty gate.
    public var countsTowardData: Bool {
        self != .phase
    }
}

// MARK: - Cached input (SI)

/// One cached spec group — the native mirror of the web `SpecEntry` BEFORE display conversion:
/// the grouping label, the session count, the summed energy in SI watt-hours, and the averaged
/// peak power in SI watts (`nil` when no session in the group reported power, web
/// `avgPower?: number`).
public struct ChargerSpecEntryInput: Sendable, Equatable {
    public let name: String
    public let count: Int
    public let energyWattHours: Double
    public let averagePowerWatts: Double?

    public init(name: String, count: Int, energyWattHours: Double, averagePowerWatts: Double? = nil) {
        self.name = name
        self.count = count
        self.energyWattHours = energyWattHours
        self.averagePowerWatts = averagePowerWatts
    }
}

/// The cached charger-specs breakdown this surface consumes — the native mirror of the web
/// `ChargerSpecsData` (`{ voltage, phase, cable, brand }`). Entries arrive already grouped and
/// sorted by count descending (web `computeChargerSpecs`); the projector preserves that order.
public struct ChargerSpecsInput: Sendable, Equatable {
    public let voltage: [ChargerSpecEntryInput]
    public let phase: [ChargerSpecEntryInput]
    public let cable: [ChargerSpecEntryInput]
    public let brand: [ChargerSpecEntryInput]

    public init(
        voltage: [ChargerSpecEntryInput] = [],
        phase: [ChargerSpecEntryInput] = [],
        cable: [ChargerSpecEntryInput] = [],
        brand: [ChargerSpecEntryInput] = []
    ) {
        self.voltage = voltage
        self.phase = phase
        self.cable = cable
        self.brand = brand
    }

    /// The entries for one column kind.
    public func entries(for kind: ChargerSpecsColumnKind) -> [ChargerSpecEntryInput] {
        switch kind {
        case .voltage: voltage
        case .phase: phase
        case .cable: cable
        case .brand: brand
        }
    }
}

// MARK: - Display preferences (web `useSettings` global precision + locale)

/// The display preferences the surface honors. The panel always shows kWh / kW (the web hard-
/// codes those units), so the only inputs are the BCP-47 locale and the energy precision, which
/// mirror the web `_globalLocale` and `_globalPrecision` (default 2) set by `useSettings`.
public struct ChargerSpecsUnitPrefs: Sendable, Equatable {
    public let localeIdentifier: String
    public let energyPrecision: Int

    public init(localeIdentifier: String = "en_US", energyPrecision: Int = 2) {
        self.localeIdentifier = localeIdentifier
        self.energyPrecision = energyPrecision
    }
}

// MARK: - Projection (view-ready)

/// One view-ready row — the native mirror of one `SpecColumn` line item: the grouping name and
/// the combined detail string (web `{v.count} sessions · {metric}`), plus the composed VoiceOver
/// label.
public struct ChargerSpecRow: Identifiable, Sendable, Equatable {
    public let id: String
    public let name: String
    public let detail: String
    public let accessibilityLabel: String

    public init(name: String, detail: String, accessibilityLabel: String) {
        id = name
        self.name = name
        self.detail = detail
        self.accessibilityLabel = accessibilityLabel
    }
}

/// One view-ready column — the native mirror of a `<SpecColumn>`: the kind (carrying label /
/// empty / icon) and the projected rows. An empty `rows` renders the column's empty message.
public struct ChargerSpecColumn: Identifiable, Sendable, Equatable {
    public let id: String
    public let kind: ChargerSpecsColumnKind
    public let rows: [ChargerSpecRow]

    public init(kind: ChargerSpecsColumnKind, rows: [ChargerSpecRow]) {
        id = kind.rawValue
        self.kind = kind
        self.rows = rows
    }

    /// Web `items.length === 0` — render the empty message instead of rows.
    public var isEmpty: Bool {
        rows.isEmpty
    }
}

/// The fully-projected surface content: the four columns in source order. `hasData` is the web
/// grid gate (`specs.voltage.length > 0 || specs.cable.length > 0 || specs.brand.length > 0` —
/// Phase intentionally excluded).
public struct ChargerSpecsProjection: Sendable, Equatable {
    public let columns: [ChargerSpecColumn]

    public init(columns: [ChargerSpecColumn]) {
        self.columns = columns
    }

    /// Web `hasData`: at least one of Voltage / Cable / Brand has rows.
    public var hasData: Bool {
        columns.contains { $0.kind.countsTowardData && !$0.rows.isEmpty }
    }
}

// MARK: - Projector (pure, web-parity)

/// Pure projector shared by the model and the views. No store, no SwiftUI view — only value-typed
/// inputs/outputs (i18n resolved through the Foundation `ChargerSpecsStrings.string` facade) so
/// every row string can be pinned by unit tests independent of the rendered grid.
public enum ChargerSpecsProjector {
    /// The middot separator between the session count and the metric (web `·`).
    public static let separator = "·"

    /// The session-count text, e.g. "12 sessions". The count is the raw integer with no grouping
    /// (web renders `{v.count}` directly), substituted into the localized `%@ sessions` format.
    public static func sessionsText(count: Int) -> String {
        String(format: ChargerSpecsStrings.string("charging.specs.sessionsFormat", "%@ sessions"), String(count))
    }

    /// The energy metric text, e.g. "42.57 kWh": `fmtWithUnit(convertEnergyFromSI(wh,'kWh'), 'kWh')`
    /// at the global precision.
    public static func energyText(wattHours: Double, prefs: ChargerSpecsUnitPrefs) -> String {
        let kwh = convertChargerEnergyToKwh(wattHours)
        let value = ChargerSpecsFormat.number(
            kwh,
            decimals: prefs.energyPrecision,
            localeIdentifier: prefs.localeIdentifier
        )
        return String(format: ChargerSpecsStrings.string("charging.specs.energyFormat", "%@ kWh"), value)
    }

    /// The power metric text, e.g. "11 kW avg": `${fmtInt(convertPowerFromSI(watts,'kW'))} kW avg`
    /// (integer kW).
    public static func powerText(watts: Double, prefs: ChargerSpecsUnitPrefs) -> String {
        let kilowatts = convertChargerPowerToKilowatts(watts)
        let value = ChargerSpecsFormat.number(kilowatts, decimals: 0, localeIdentifier: prefs.localeIdentifier)
        return String(format: ChargerSpecsStrings.string("charging.specs.powerFormat", "%@ kW avg"), value)
    }

    /// The metric for one entry: the average-power text on the Brand column when a power reading
    /// exists (web `showAvgPower && v.avgPower != null`), otherwise the energy text.
    public static func metricText(
        for entry: ChargerSpecEntryInput,
        kind: ChargerSpecsColumnKind,
        prefs: ChargerSpecsUnitPrefs
    ) -> String {
        if kind.showsAveragePower, let watts = entry.averagePowerWatts {
            return powerText(watts: watts, prefs: prefs)
        }
        return energyText(wattHours: entry.energyWattHours, prefs: prefs)
    }

    /// Projects one cached entry into a view-ready row: the name plus "N sessions · metric".
    public static func row(
        for entry: ChargerSpecEntryInput,
        kind: ChargerSpecsColumnKind,
        prefs: ChargerSpecsUnitPrefs
    ) -> ChargerSpecRow {
        let sessions = sessionsText(count: entry.count)
        let metric = metricText(for: entry, kind: kind, prefs: prefs)
        let detail = "\(sessions) \(separator) \(metric)"
        return ChargerSpecRow(
            name: entry.name,
            detail: detail,
            accessibilityLabel: ChargerSpecsAccessibility.rowSummary(name: entry.name, detail: detail)
        )
    }

    /// Projects the cached breakdown into the four view-ready columns in source order.
    public static func project(specs: ChargerSpecsInput, prefs: ChargerSpecsUnitPrefs) -> ChargerSpecsProjection {
        let columns = ChargerSpecsColumnKind.allCases.map { kind in
            ChargerSpecColumn(
                kind: kind,
                rows: specs.entries(for: kind).map { row(for: $0, kind: kind, prefs: prefs) }
            )
        }
        return ChargerSpecsProjection(columns: columns)
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver label spoken for one spec row. Pure + public so the spoken content can be
/// unit-tested without rendering the view. The caller passes already-localized strings (the name
/// and the combined detail) so the summary holds no English literals itself.
public enum ChargerSpecsAccessibility {
    /// e.g. "Tesla, 8 sessions · 11 kW avg" — the grouping name and the combined detail.
    public static func rowSummary(name: String, detail: String) -> String {
        "\(name), \(detail)"
    }
}
