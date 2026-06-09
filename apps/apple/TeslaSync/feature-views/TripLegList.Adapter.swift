//
//  TripLegList.Adapter.swift
//  TeslaSync — P4 feature view · 0177 · TripLegList (Apple)
//
//  The settings, conversion, formatting, and projection core for the trip-planner
//  route breakdown — the SwiftUI parity of
//  features/driving/components/TripLegList.tsx plus the web hooks it reads
//  (useUnits / useFormatting) and their helpers (`convertDistanceFromSI`,
//  `formatEnergy`, `formatCurrency`, `fmtNumber`). Pure + Foundation-only (no store,
//  bundle, or view) so the unit derivation, the SI distance conversion, the
//  locale-aware energy / currency formatting, the SOC rounding, and the from→to label
//  fallback are all unit tested here. The resolved row projection (the leg/charge-stop
//  interleave) lives in `TripLegList.Rows.swift`.
//
//  Render math reproduced VERBATIM from the source (every disk/API value is SI —
//  meters, watt-hours, seconds — and the unit choice is applied only here at display
//  time):
//    distance  = convertDistanceFromSI(leg.distance_m, unit).toFixed(1) + " " + unit
//    duration  = Math.round(leg.duration_s) + " min"          // source L70 (see note)
//    energy    = formatEnergy(leg.energy_wh, { precision: 1 }) // → kWh
//    soc       = Math.round(start)% → Math.round(arrival)%     // arrival<20 ⇒ danger
//    stop.dur  = Math.round(charge_duration_s / 60) + " min"   // source L99
//    stop.cost = formatCurrency(stop.cost)                     // symbol + fmtNumber
//
//  Parity note (duration): the web renders the *leg* duration as
//  `Math.round(leg.duration_s)` labelled "min" — the raw seconds value rounded, not a
//  seconds→minutes conversion (TripLegList.tsx L70). The *charge stop* divides by 60
//  first (L99). Both are ported exactly as written; this surface mirrors the source's
//  display, it does not silently reinterpret it.
//

import Foundation

// MARK: - Ported constants (lib/unitConversion.ts + the two web hooks)

/// Exact factors + web defaults the route breakdown depends on, ported verbatim.
public enum TripLegConstants {
    /// 1 mile = 1609.344 m exactly (`METERS_PER_MILE`, international yard / NIST).
    public static let metersPerMile = 1609.344
    /// 1 km = 1000 m exactly (`METERS_PER_KM`).
    public static let metersPerKm = 1000.0
    /// Seconds in a minute (`SECONDS_PER_MINUTE`) — the charge-stop divisor.
    public static let secondsPerMinute = 60.0
    /// Wh per kWh — `convertEnergyFromSI(wh, 'kWh')` divides by this.
    public static let whPerKwh = 1000.0
    /// Web `useFormatting` currency-symbol blank fallback.
    public static let defaultCurrencySymbol = "$"
    /// Web `useFormatting` userPrecision default (currency / cost).
    public static let defaultCurrencyPrecision = 2
    /// Web `deriveLocale` fallback tag.
    public static let defaultLocaleIdentifier = "en-US"
    /// Web `DEFAULT_EMPTY_DISPLAY` — the em dash shown for a non-finite value.
    public static let defaultEmptyDisplay = "—"
    /// Web `formatEnergy(value, { precision: 1 })` — the fixed energy precision the
    /// route breakdown passes for every leg + stop.
    public static let energyPrecision = 1
    /// Web `convertDistanceFromSI(...).toFixed(1)` — the fixed distance precision.
    public static let distancePrecision = 1
    /// Web `lat.toFixed(2)` / `lng.toFixed(2)` — the coordinate-fallback precision.
    public static let coordinatePrecision = 2
    /// The fixed energy display unit (web `DEFAULT_ENERGY_PREF = 'kWh'`).
    public static let energyUnitLabel = "kWh"
    /// Web `arrival_soc < 20` — the low-battery colour threshold.
    public static let lowArrivalSocThreshold = 20.0
}

// MARK: - Trip data shapes (web `TripLeg` / `TripChargeStop` / `TripLocation`)

/// One endpoint of a leg — the native mirror of the web `TripLocation` interface.
public struct TripLocationData: Equatable, Sendable {
    public let lat: Double
    public let lng: Double
    public let name: String

    public init(lat: Double, lng: Double, name: String) {
        self.lat = lat
        self.lng = lng
        self.name = name
    }
}

/// One planned leg — the native mirror of the web `TripLeg` interface. All numbers are
/// SI (meters, seconds, watt-hours); SOC is a unit-free percentage carried verbatim.
public struct TripLegData: Equatable, Sendable {
    public let from: TripLocationData
    public let to: TripLocationData
    public let distanceM: Double
    public let durationS: Double
    public let energyWh: Double
    public let startSoc: Double
    public let arrivalSoc: Double

    public init(
        from: TripLocationData,
        to: TripLocationData,
        distanceM: Double,
        durationS: Double,
        energyWh: Double,
        startSoc: Double,
        arrivalSoc: Double
    ) {
        self.from = from
        self.to = to
        self.distanceM = distanceM
        self.durationS = durationS
        self.energyWh = energyWh
        self.startSoc = startSoc
        self.arrivalSoc = arrivalSoc
    }
}

/// One charge stop inserted after a leg — the native mirror of `TripChargeStop`.
public struct TripChargeStopData: Equatable, Sendable {
    public let name: String
    public let location: TripLocationData
    public let chargeFromSoc: Double
    public let chargeToSoc: Double
    public let chargeDurationS: Double
    public let energyWh: Double
    public let cost: Double
    public let isRecommended: Bool

    public init(
        name: String,
        location: TripLocationData,
        chargeFromSoc: Double,
        chargeToSoc: Double,
        chargeDurationS: Double,
        energyWh: Double,
        cost: Double,
        isRecommended: Bool
    ) {
        self.name = name
        self.location = location
        self.chargeFromSoc = chargeFromSoc
        self.chargeToSoc = chargeToSoc
        self.chargeDurationS = chargeDurationS
        self.energyWh = energyWh
        self.cost = cost
        self.isRecommended = isRecommended
    }
}

// MARK: - Display config (web useUnits + useFormatting, derived)

/// The display configuration the two web hooks expose for this surface. The
/// production source maps the raw settings payload into this via ``make(from:)``;
/// tests and previews use the memberwise init. Energy is always kWh
/// (`DEFAULT_ENERGY_PREF`), so only the distance unit is user-selectable here.
public struct TripLegFormatConfig: Equatable, Sendable {
    /// Web `unitPrefs.distance` — `unit_of_length === 'mi' ? 'mi' : 'km'`. The raw
    /// value doubles as the on-screen unit label (a literal, not an i18n key).
    public enum DistanceUnit: String, Sendable, CaseIterable {
        case km
        case mi
    }

    public var distanceUnit: DistanceUnit
    public var currencySymbol: String
    public var currencyPrecision: Int
    public var localeIdentifier: String
    public var emptyDisplay: String

    public init(
        distanceUnit: DistanceUnit = .km,
        currencySymbol: String = TripLegConstants.defaultCurrencySymbol,
        currencyPrecision: Int = TripLegConstants.defaultCurrencyPrecision,
        localeIdentifier: String = TripLegConstants.defaultLocaleIdentifier,
        emptyDisplay: String = TripLegConstants.defaultEmptyDisplay
    ) {
        self.distanceUnit = distanceUnit
        self.currencySymbol = currencySymbol
        self.currencyPrecision = currencyPrecision
        self.localeIdentifier = localeIdentifier
        self.emptyDisplay = emptyDisplay
    }

    /// The locale the energy / currency formatters group + round through (web
    /// `unitPrefs.locale` / the global locale).
    public var locale: Locale {
        Locale(identifier: localeIdentifier)
    }

    /// Derives the display config from the raw settings the web hooks read, applying
    /// every web default: the `mi`/`km` distance derivation, the trim-then-keep
    /// currency symbol, the floor/finite/≥0 precision rule, and the blank-locale →
    /// `en-US` fallback.
    public static func make(from raw: RawSettings) -> TripLegFormatConfig {
        TripLegFormatConfig(
            distanceUnit: raw.unitOfLength == "mi" ? .mi : .km,
            currencySymbol: deriveCurrencySymbol(raw.currencySymbol),
            currencyPrecision: derivePrecision(raw.decimalPrecision),
            localeIdentifier: deriveLocale(raw.locale)
        )
    }

    /// The raw, optional settings fields the web hooks consume — the input to
    /// ``make(from:)``. Mirrors the `useSettings` payload subset this surface touches.
    public struct RawSettings: Equatable, Sendable {
        public var unitOfLength: String?
        public var currencySymbol: String?
        public var decimalPrecision: Double?
        public var locale: String?

        public init(
            unitOfLength: String? = nil,
            currencySymbol: String? = nil,
            decimalPrecision: Double? = nil,
            locale: String? = nil
        ) {
            self.unitOfLength = unitOfLength
            self.currencySymbol = currencySymbol
            self.decimalPrecision = decimalPrecision
            self.locale = locale
        }
    }

    /// Web `currency_symbol && currency_symbol.trim() ? currency_symbol : '$'` — note
    /// the source keeps the *untrimmed* symbol when its trim is non-empty.
    static func deriveCurrencySymbol(_ raw: String?) -> String {
        guard let raw, !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return TripLegConstants.defaultCurrencySymbol
        }
        return raw
    }

    /// Web `useFormatting` userPrecision: `floor(decimal_precision)` when finite & ≥0,
    /// else 2.
    static func derivePrecision(_ raw: Double?) -> Int {
        guard let raw, raw.isFinite, raw >= 0 else {
            return TripLegConstants.defaultCurrencyPrecision
        }
        return Int(raw.rounded(.down))
    }

    /// Web `deriveLocale`: a non-blank trimmed tag, else `en-US`.
    static func deriveLocale(_ raw: String?) -> String {
        guard let raw, !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return TripLegConstants.defaultLocaleIdentifier
        }
        return raw
    }
}

// MARK: - Conversion + formatting (ports of unitConversion.ts + the web hooks)

/// Pure conversion / formatting ported from the web helpers so rounding, grouping,
/// and the unit suffixes match the source. Distance uses JS `toFixed` semantics
/// (period decimal, no grouping); energy + currency use locale-aware grouping like
/// `Intl.NumberFormat` / `toLocaleString`.
public enum TripLegFormat {
    /// Native port of `safeNumber`: a non-finite value collapses to 0.
    static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Native port of JS `Math.round`: round-half-toward-+∞ (`floor(x + 0.5)`). A
    /// non-finite input coerces to 0 so the rendered integer is never `NaN`.
    public static func jsRound(_ value: Double) -> Int {
        guard value.isFinite else { return 0 }
        return Int((value + 0.5).rounded(.down))
    }

    /// Native port of `convertDistanceFromSI(meters, to)` for the km / mi cases the
    /// route breakdown uses.
    public static func convertDistanceFromSI(
        _ meters: Double,
        to unit: TripLegFormatConfig.DistanceUnit
    ) -> Double {
        switch unit {
        case .km: meters / TripLegConstants.metersPerKm
        case .mi: meters / TripLegConstants.metersPerMile
        }
    }

    /// Native port of `Number.prototype.toFixed(digits)` — a fixed fraction count with
    /// a period decimal separator and no grouping, locale-independent like JS.
    public static func toFixed(_ value: Double, _ digits: Int) -> String {
        String(format: "%.\(max(0, digits))f", safe(value))
    }

    /// Locale-aware fixed-fraction number (port of `Intl.NumberFormat` /
    /// `toLocaleString` with `minimum == maximum` fraction digits + half-up rounding),
    /// backing the energy + currency formatters.
    static func localeNumber(_ value: Double, fractionDigits: Int, locale: Locale) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: safe(value))) ?? "0"
    }

    /// Web `convertDistanceFromSI(meters, unit).toFixed(1) + " " + unit`. A non-finite
    /// distance yields the empty-display dash (null-safety hardening — the source
    /// assumes a finite distance and would otherwise render `NaN`).
    public static func distanceText(meters: Double, config: TripLegFormatConfig) -> String {
        guard meters.isFinite else { return config.emptyDisplay }
        let value = convertDistanceFromSI(meters, to: config.distanceUnit)
        return "\(toFixed(value, TripLegConstants.distancePrecision)) \(config.distanceUnit.rawValue)"
    }

    /// Web `formatEnergy(wh, { precision: 1 })`: non-finite → empty dash, else
    /// `convertEnergyFromSI(wh, 'kWh')` formatted at 1 fraction digit + " kWh".
    public static func energyText(wh: Double, config: TripLegFormatConfig) -> String {
        guard wh.isFinite else { return config.emptyDisplay }
        let kwh = wh / TripLegConstants.whPerKwh
        let number = localeNumber(kwh, fractionDigits: TripLegConstants.energyPrecision, locale: config.locale)
        return "\(number) \(TripLegConstants.energyUnitLabel)"
    }

    /// Web `formatCurrency(amount)`: `currencySymbol + fmtNumber(amount, userPrecision)`
    /// (the symbol is prepended; a non-finite amount collapses to 0 via `safeNumber`).
    public static func currencyText(amount: Double, config: TripLegFormatConfig) -> String {
        let number = localeNumber(amount, fractionDigits: config.currencyPrecision, locale: config.locale)
        return config.currencySymbol + number
    }

    /// Web `Math.round(soc)%` — the integer SOC percentage label.
    public static func socText(_ soc: Double) -> String {
        "\(jsRound(soc))%"
    }

    /// Web `` `${Math.round(from)}% → ${Math.round(to)}%` `` — the charge-stop SOC band.
    public static func socRangeText(from: Double, to: Double) -> String {
        "\(socText(from)) → \(socText(to))"
    }

    /// Web `leg.from.name || \`${lat.toFixed(2)}, ${lng.toFixed(2)}\``. JS `||` treats
    /// only the empty string as falsy, so a non-empty (even whitespace) name wins;
    /// otherwise the coordinates are shown at two decimals.
    public static func locationLabel(_ location: TripLocationData) -> String {
        if !location.name.isEmpty { return location.name }
        let lat = toFixed(location.lat, TripLegConstants.coordinatePrecision)
        let lng = toFixed(location.lng, TripLegConstants.coordinatePrecision)
        return "\(lat), \(lng)"
    }
}
