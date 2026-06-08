//
//  CostSavingsPanel.Adapter.swift
//  TeslaSync — P4 feature view · 0136 · CostSavingsPanel (Apple)
//
//  The settings, formatting, and arithmetic core for the drive-detail cost &
//  savings panel — the SwiftUI parity of
//  features/driving/components/drive-detail/CostSavingsPanel.tsx plus the web hooks
//  it reads (useSettings / useUnits / useFormatting) and their helpers (`fmtNumber`,
//  `convertDistanceFromSI`, the `FUEL` constants). Pure + Foundation-only (no store,
//  bundle, or view) so the settings derivation, the locale number/currency
//  formatting, the SI distance conversion, the gas-cost estimate, the
//  per-distance-unit cost, and the savings arithmetic are all unit tested here.
//  The resolved tiles live in `CostSavingsPanel.Tiles.swift`.
//
//  Render math reproduced verbatim from the source (all disk/API values are SI —
//  meters, Wh — and unit choice is applied only here at display time):
//    energyKwh = stats.energyWh / 1000
//    tripCost  = evCost = energyKwh * costPerKwh
//    gasCost   = estimateGasCost(drive.distanceM)        // nil per the web guards
//    savings   = gasCost == nil ? nil : gasCost - evCost
//

import Foundation

// MARK: - Ported constants (lib/unitConversion.ts + lib/constants.ts)

/// Exact factors + web defaults the panel math depends on, ported verbatim.
public enum CostSavingsConstants {
    /// 1 mile = 1609.344 m exactly (`METERS_PER_MILE`).
    public static let metersPerMile = 1609.344
    /// 1 km = 1000 m exactly (`METERS_PER_KM`).
    public static let metersPerKm = 1000.0
    /// 1 US gallon = 3.78541 L (`FUEL.GALLONS_TO_LITERS`).
    public static let gallonsToLiters = 3.78541
    /// Web `settings.base_cost_per_kwh ?? 0.12`.
    public static let defaultCostPerKwh = 0.12
    /// Web `currency_symbol` blank fallback.
    public static let defaultCurrencySymbol = "$"
    /// Web `useFormatting` userPrecision default.
    public static let defaultPrecision = 2
    /// Web `deriveLocale` fallback tag.
    public static let defaultLocaleIdentifier = "en-US"
    /// Web `formatCurrency(costPerDistanceUnit(...), 3)` fixed precision.
    public static let costPerUnitPrecision = 3
}

// MARK: - Raw settings (web `settings` payload the three hooks read)

/// The raw, optional settings fields the web hooks consume — the input to
/// ``CostSavingsConfig/make(from:)``. Mirrors the `useSettings` payload subset the
/// panel touches; the production source fills it from the settings query.
public struct CostSavingsRawSettings: Sendable, Equatable {
    public var baseCostPerKwh: Double?
    public var currencySymbol: String?
    public var decimalPrecision: Double?
    public var unitOfLength: String?
    public var gasEfficiencyMpg: Double?
    public var gasPricePerUnit: Double?
    public var gasUnit: String?
    public var locale: String?

    public init(
        baseCostPerKwh: Double? = nil,
        currencySymbol: String? = nil,
        decimalPrecision: Double? = nil,
        unitOfLength: String? = nil,
        gasEfficiencyMpg: Double? = nil,
        gasPricePerUnit: Double? = nil,
        gasUnit: String? = nil,
        locale: String? = nil
    ) {
        self.baseCostPerKwh = baseCostPerKwh
        self.currencySymbol = currencySymbol
        self.decimalPrecision = decimalPrecision
        self.unitOfLength = unitOfLength
        self.gasEfficiencyMpg = gasEfficiencyMpg
        self.gasPricePerUnit = gasPricePerUnit
        self.gasUnit = gasUnit
        self.locale = locale
    }
}

// MARK: - Display config (web useSettings + useUnits + useFormatting, derived)

/// The fully-derived display configuration the three web hooks expose. The
/// production source maps raw settings into this via ``make(from:)``; tests and
/// previews use the memberwise init.
public struct CostSavingsConfig: Equatable, Sendable {
    /// Web `unit_of_length === 'mi' ? 'mi' : 'km'`.
    public enum DistanceUnit: String, Sendable, CaseIterable {
        case km
        case mi
    }

    /// Web `(settings.gas_unit ?? 'gallon') === 'liter'`.
    public enum GasUnit: String, Sendable, CaseIterable {
        case gallon
        case liter
    }

    public var costPerKwh: Double
    public var currencySymbol: String
    public var decimalPrecision: Int
    public var distanceUnit: DistanceUnit
    public var gasEfficiencyMpg: Double
    public var gasPricePerUnit: Double
    public var gasUnit: GasUnit
    public var localeIdentifier: String

    public init(
        costPerKwh: Double = CostSavingsConstants.defaultCostPerKwh,
        currencySymbol: String = CostSavingsConstants.defaultCurrencySymbol,
        decimalPrecision: Int = CostSavingsConstants.defaultPrecision,
        distanceUnit: DistanceUnit = .km,
        gasEfficiencyMpg: Double = 0,
        gasPricePerUnit: Double = 0,
        gasUnit: GasUnit = .gallon,
        localeIdentifier: String = CostSavingsConstants.defaultLocaleIdentifier
    ) {
        self.costPerKwh = costPerKwh
        self.currencySymbol = currencySymbol
        self.decimalPrecision = decimalPrecision
        self.distanceUnit = distanceUnit
        self.gasEfficiencyMpg = gasEfficiencyMpg
        self.gasPricePerUnit = gasPricePerUnit
        self.gasUnit = gasUnit
        self.localeIdentifier = localeIdentifier
    }

    /// The locale `fmtNumber` formats through (web `deriveLocale`/global locale).
    public var locale: Locale {
        Locale(identifier: localeIdentifier)
    }

    /// Derives the display config from raw settings, applying every web default:
    /// the `?? 0.12` rate, the trim-then-keep-original currency symbol, the
    /// floor/finite/≥0 precision rule, the `mi`/`km` + `gallon`/`liter`
    /// derivations, the `?? 0` gas fields, and the blank-locale → `en-US` fallback.
    public static func make(from raw: CostSavingsRawSettings) -> CostSavingsConfig {
        CostSavingsConfig(
            costPerKwh: raw.baseCostPerKwh ?? CostSavingsConstants.defaultCostPerKwh,
            currencySymbol: deriveCurrencySymbol(raw.currencySymbol),
            decimalPrecision: derivePrecision(raw.decimalPrecision),
            distanceUnit: raw.unitOfLength == "mi" ? .mi : .km,
            gasEfficiencyMpg: raw.gasEfficiencyMpg ?? 0,
            gasPricePerUnit: raw.gasPricePerUnit ?? 0,
            gasUnit: raw.gasUnit == "liter" ? .liter : .gallon,
            localeIdentifier: deriveLocale(raw.locale)
        )
    }

    /// Web `currency_symbol && currency_symbol.trim() ? currency_symbol : '$'` —
    /// note the source keeps the *untrimmed* symbol when its trim is non-empty.
    static func deriveCurrencySymbol(_ raw: String?) -> String {
        guard let raw, !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return CostSavingsConstants.defaultCurrencySymbol
        }
        return raw
    }

    /// Web `useFormatting` userPrecision: `floor(decimal_precision)` when finite & ≥0, else 2.
    static func derivePrecision(_ raw: Double?) -> Int {
        guard let raw, raw.isFinite, raw >= 0 else { return CostSavingsConstants.defaultPrecision }
        return Int(raw.rounded(.down))
    }

    /// Web `deriveLocale`: a non-blank trimmed tag, else `en-US`.
    static func deriveLocale(_ raw: String?) -> String {
        guard let raw, !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return CostSavingsConstants.defaultLocaleIdentifier
        }
        return raw
    }
}

// MARK: - Drive inputs (web `drive: DriveDetail` + `stats: DriveStats` props)

/// The two SI values the panel reads — `drive.distanceM` (meters) and
/// `stats.energyWh` (watt-hours). Carried raw; unit choice happens in the formatters.
public struct CostSavingsInputs: Equatable, Sendable {
    public var distanceM: Double
    public var energyWh: Double

    public init(distanceM: Double = 0, energyWh: Double = 0) {
        self.distanceM = distanceM
        self.energyWh = energyWh
    }
}

// MARK: - Number / currency formatting (ports of numberFormat.ts + useFormatting)

/// Pure formatting ported from the web helpers so rounding, grouping, and the
/// currency-symbol prefix match the source. `fmtNumber`'s `safeNumber` guard
/// (non-finite ⇒ 0) and locale grouping are reproduced; currency prepends the raw
/// symbol (web `${currencySymbol}${fmtNumber(...)}`), not a locale currency style.
public enum CostSavingsFormat {
    /// Native port of `safeNumber`: non-finite ⇒ 0.
    static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Native port of `fmtNumber(v, decimals, locale)`: grouping, fixed fraction
    /// digits, half-away rounding, and the `safeNumber` guard.
    public static func number(_ value: Double, decimals: Int, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: safe(value))) ?? "0"
    }

    /// Native port of `formatCurrency` / `formatEnergyCost`:
    /// `symbol + fmtNumber(amount, decimals)`.
    public static func currency(
        _ amount: Double,
        decimals: Int,
        symbol: String,
        locale: Locale = .current
    ) -> String {
        symbol + number(amount, decimals: decimals, locale: locale)
    }

    /// The plain decimal used for the `costPerKwh` / `mpg` sub-label interpolation —
    /// the web passes these raw to i18next, which stringifies without a fixed
    /// precision. Trims trailing zeros (min 0), never rounds a realistic rate away
    /// (up to 6 digits), and stays locale-aware for native.
    public static func plain(_ value: Double, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = false
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 6
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: safe(value))) ?? "0"
    }

    /// Native port of `convertDistanceFromSI(meters, to)` for the km / mi cases used here.
    public static func convertDistanceFromSI(
        _ meters: Double,
        to unit: CostSavingsConfig.DistanceUnit
    ) -> Double {
        switch unit {
        case .km: meters / CostSavingsConstants.metersPerKm
        case .mi: meters / CostSavingsConstants.metersPerMile
        }
    }
}

// MARK: - Cost & savings math (web component body + useFormatting callbacks)

/// The panel's pure arithmetic — the native port of the component's computed values
/// and the `useFormatting` callbacks, with every web guard reproduced.
public enum CostSavingsMath {
    /// Web `stats.energyWh / 1000` — Wh → kWh.
    public static func energyKwh(_ energyWh: Double) -> Double {
        energyWh / 1000
    }

    /// Web `formatEnergyCost`'s inner `kwh * costPerKwh` (== `evCost`).
    public static func tripCost(energyWh: Double, costPerKwh: Double) -> Double {
        energyKwh(energyWh) * costPerKwh
    }

    /// Web `costPerDistanceUnit(kwh, distanceM)`: nil when `distanceM <= 0`; else
    /// `(kwh * costPerKwh) / convertDistanceFromSI(distanceM, unit)`, guarded to nil
    /// when the converted distance is non-positive.
    public static func costPerDistanceUnit(
        energyWh: Double,
        costPerKwh: Double,
        distanceM: Double,
        unit: CostSavingsConfig.DistanceUnit
    ) -> Double? {
        guard distanceM > 0 else { return nil }
        let cost = energyKwh(energyWh) * costPerKwh
        let distance = CostSavingsFormat.convertDistanceFromSI(distanceM, to: unit)
        return distance > 0 ? cost / distance : nil
    }

    /// Web `estimateGasCost(distanceM)`: nil when `mpg <= 0 || gasPrice <= 0 ||
    /// distanceM <= 0`; else `gallonsUsed * gasPrice`, scaled by the gallon→liter
    /// factor when gas is priced per liter. MPG is miles-based, so the distance is
    /// bridged to miles first (the one internal SI→imperial conversion).
    public static func estimateGasCost(
        distanceM: Double,
        mpg: Double,
        gasPrice: Double,
        gasUnit: CostSavingsConfig.GasUnit
    ) -> Double? {
        guard mpg > 0, gasPrice > 0, distanceM > 0 else { return nil }
        let gallonsUsed = CostSavingsFormat.convertDistanceFromSI(distanceM, to: .mi) / mpg
        switch gasUnit {
        case .liter: return gallonsUsed * CostSavingsConstants.gallonsToLiters * gasPrice
        case .gallon: return gallonsUsed * gasPrice
        }
    }

    /// Web `gasCost != null ? gasCost - evCost : null`.
    public static func savings(gasCost: Double?, evCost: Double) -> Double? {
        guard let gasCost else { return nil }
        return gasCost - evCost
    }
}
