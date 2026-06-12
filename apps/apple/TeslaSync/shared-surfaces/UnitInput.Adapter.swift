//
//  UnitInput.Adapter.swift
//  TeslaSync — P4 shared surface · 0162 · UnitInput (Apple)
//
//  The testable, dependency-light core for the unit field — the SwiftUI parity of
//  `components/forms/UnitInput.tsx` and the `lib/unitInput.ts` helpers it binds. Everything here is
//  pure (Foundation only): the canonical-unit model (the web canonical storage — miles, mph, °C, kWh,
//  percent, currency-as-typed), the settings-driven formatter (the web `formatForUnit`), the
//  locale-aware + unit-suffix-tolerant parser (the web `parseForUnit` / `parseLocaleNumber`), and the
//  display-unit symbol (the web `unitSymbol`). No store, no bundle, no rendered view, so each piece is
//  unit tested in isolation against the web source's own cases.
//
//  Canonical units (verbatim from the web source): distance → miles, speed → mph, temperature → °C,
//  energy → kWh, percent → 0…100, currency → as-typed (symbol from settings). Returning canonical
//  from `parse` lets the host store one value and re-render in whatever unit the user later prefers
//  without losing precision — exactly the web contract.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. A plain closure so the pure core needs no bundle: the app passes the
/// P1/S10 facade, tests pass the identity-fallback resolver.
public typealias UnitInputFieldResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Surface metadata

/// Static, non-identifying surface constants. The slug is the web source name (`UnitInput`) so the
/// P1/S11 `view.opened` event matches across platforms.
public enum UnitInputFieldMeta {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "UnitInput"

    /// Web `settings.decimal_precision ?? 2` default — display fraction digits.
    public static let defaultPrecision = 2

    /// Web `resolveLocale` final fallback when no explicit/system locale is available.
    public static let fallbackLocaleIdentifier = "en_US"
}

// MARK: - Unit kind (web `UnitKind`)

/// The unit family this field represents — the verbatim web `UnitKind` union. Selects which
/// canonical↔display conversion and which display symbol the converter applies.
public enum UnitInputFieldKind: String, Sendable, Equatable, CaseIterable {
    case distance
    case energy
    case temperature
    case speed
    case percent
    case currency
}

// MARK: - Settings slice (web `useSettings()` — the display-preference inputs)

/// The display unit for distance + speed (web `settings.unit_of_length`).
public enum UnitInputFieldLengthUnit: String, Sendable, Equatable, CaseIterable {
    case miles = "mi"
    case kilometers = "km"
}

/// The display unit for temperature (web `settings.unit_of_temp`).
public enum UnitInputFieldTempUnit: String, Sendable, Equatable, CaseIterable {
    case celsius = "C"
    case fahrenheit = "F"
}

/// The slice of the web `AppSettings` the field reads on every render: the length + temperature
/// display units, the decimal precision, the currency symbol, and the formatting locale. Defaults
/// mirror the web `useSettings` defaults (km, C, 2, "$", en-US) so an unconfigured field behaves
/// identically across platforms.
public struct UnitInputFieldSettings: Sendable, Equatable {
    public var lengthUnit: UnitInputFieldLengthUnit
    public var tempUnit: UnitInputFieldTempUnit
    public var decimalPrecision: Int
    public var currencySymbol: String
    public var locale: Locale

    public init(
        lengthUnit: UnitInputFieldLengthUnit = .kilometers,
        tempUnit: UnitInputFieldTempUnit = .celsius,
        decimalPrecision: Int = UnitInputFieldMeta.defaultPrecision,
        currencySymbol: String = "$",
        locale: Locale = Locale(identifier: UnitInputFieldMeta.fallbackLocaleIdentifier)
    ) {
        self.lengthUnit = lengthUnit
        self.tempUnit = tempUnit
        self.decimalPrecision = decimalPrecision
        self.currencySymbol = currencySymbol
        self.locale = locale
    }
}

// MARK: - Converter (verbatim port of `lib/unitInput.ts`)

/// The pure formatting + parsing + symbol core — the native port of the web unit helpers. Every
/// function is deterministic and dependency-light so the rendered text is asserted without a view.
public enum UnitInputFieldConverter {
    /// Web `KM_PER_MI` — kilometres per mile.
    public static let kmPerMile = 1.609344

    /// Longest-first so `km/h` is stripped before `km`, and `kwh` before `kw` — the verbatim web
    /// `STRIPPABLE_SUFFIXES`. All lower-cased; matched case-insensitively.
    public static let strippableSuffixes = ["km/h", "kwh", "mph", "°c", "°f", "kw", "mi", "km", "°"]

    // MARK: Conversions (web distance/temp helpers)

    /// Web `distanceDisplayToCanonical` — a km display value to canonical miles.
    public static func distanceDisplayToCanonical(_ display: Double) -> Double {
        display / kmPerMile
    }

    /// Web `distanceCanonicalToDisplay` — canonical miles to a km display value.
    public static func distanceCanonicalToDisplay(_ canonical: Double) -> Double {
        canonical * kmPerMile
    }

    /// Web `tempDisplayToCanonical` — a °F display value to canonical °C.
    public static func tempDisplayToCanonical(_ display: Double) -> Double {
        ((display - 32) * 5) / 9
    }

    /// Web `tempCanonicalToDisplay` — canonical °C to a °F display value.
    public static func tempCanonicalToDisplay(_ canonical: Double) -> Double {
        (canonical * 9) / 5 + 32
    }

    // MARK: Symbol (web `unitSymbol`)

    /// The display-unit symbol shown in the field's trailing adornment — the verbatim web
    /// `unitSymbol`. Currency falls back to `$` for a blank settings symbol.
    public static func symbol(kind: UnitInputFieldKind, settings: UnitInputFieldSettings) -> String {
        switch kind {
        case .distance:
            return settings.lengthUnit == .kilometers ? "km" : "mi"
        case .speed:
            return settings.lengthUnit == .kilometers ? "km/h" : "mph"
        case .temperature:
            return settings.tempUnit == .fahrenheit ? "°F" : "°C"
        case .energy:
            return "kWh"
        case .percent:
            return "%"
        case .currency:
            let trimmed = trim(settings.currencySymbol)
            return trimmed.isEmpty ? "$" : trimmed
        }
    }

    // MARK: Format (web `formatForUnit`)

    /// Format a canonical metric value as the field's display text — the web `formatForUnit`. Returns
    /// `""` for a nil / non-finite value so the field renders blank. Group separators are OFF (web
    /// input-field rendering); rounding is half-away-from-zero to match `Intl.NumberFormat`.
    public static func format(
        value: Double?,
        kind: UnitInputFieldKind,
        settings: UnitInputFieldSettings
    ) -> String {
        guard let value, value.isFinite else { return "" }
        let display = displayValue(value, kind: kind, settings: settings)
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = settings.locale
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = max(0, settings.decimalPrecision)
        formatter.usesGroupingSeparator = false
        // Intl.NumberFormat rounds half away from zero (`halfExpand`); NumberFormatter defaults to
        // banker's rounding, so pin `.halfUp` for web parity (1.23456 @ 4dp → 1.2346, not 1.2345).
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: display)) ?? ""
    }

    // MARK: Parse (web `parseForUnit`)

    /// Parse user-typed text into the canonical metric value for the unit kind — the web
    /// `parseForUnit`. Tolerates a leading currency symbol + accounting parentheses, a trailing `%`,
    /// and a trailing unit suffix (`mph`, `km/h`, `°C`, `kWh`, …); parses locale-aware unless
    /// `strict`; converts the display value back to canonical. `nil` for empty / unparseable input.
    public static func parse(
        text: String?,
        kind: UnitInputFieldKind,
        settings: UnitInputFieldSettings,
        strict: Bool = false
    ) -> Double? {
        var raw = trim(text ?? "")
        if raw.isEmpty { return nil }

        if kind == .currency {
            raw = stripCurrency(raw, settings: settings)
        }
        if kind == .percent, raw.hasSuffix("%") {
            raw = trim(String(raw.dropLast()))
        }
        raw = stripUnitSuffix(raw)
        if raw.isEmpty { return nil }

        let parsed = strict ? Double(raw) : parseLocaleNumber(raw, locale: settings.locale)
        guard let number = parsed, number.isFinite else { return nil }
        return canonicalValue(number, kind: kind, settings: settings)
    }

    /// Parse a numeric string using the locale's group + decimal separators — the web
    /// `parseLocaleNumber` (`'1,234.56' en-US → 1234.56`, `'1.234,56' de-DE → 1234.56`). The group
    /// separator is removed (when distinct from the decimal) and the decimal separator normalised to
    /// `.`. Returns `nil` when the residue is not a finite number.
    public static func parseLocaleNumber(_ text: String, locale: Locale) -> Double? {
        if text.isEmpty { return nil }
        let probe = NumberFormatter()
        probe.numberStyle = .decimal
        probe.locale = locale
        let groupSeparator = probe.groupingSeparator ?? ","
        let decimalSeparator = probe.decimalSeparator ?? "."

        var normalized = text
        if !groupSeparator.isEmpty, groupSeparator != decimalSeparator {
            normalized = normalized.replacingOccurrences(of: groupSeparator, with: "")
        }
        if decimalSeparator != "." {
            normalized = normalized.replacingOccurrences(of: decimalSeparator, with: ".")
        }
        if normalized.isEmpty { return nil }
        guard let value = Double(normalized), value.isFinite else { return nil }
        return value
    }

    // MARK: Private

    private static func trim(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Web currency pre-processing: strip a leading symbol, then honour accounting parentheses
    /// (`($10)` → `-10`), re-stripping the symbol when it sits inside the parens.
    private static func stripCurrency(_ input: String, settings: UnitInputFieldSettings) -> String {
        let trimmedSymbol = trim(settings.currencySymbol)
        let symbol = trimmedSymbol.isEmpty ? "$" : trimmedSymbol
        var raw = input
        if raw.hasPrefix(symbol) {
            raw = trim(String(raw.dropFirst(symbol.count)))
        }
        if raw.hasPrefix("("), raw.hasSuffix(")") {
            let inner = trim(String(raw.dropFirst().dropLast()))
            raw = "-" + inner
            if raw.hasPrefix("-" + symbol) {
                raw = "-" + trim(String(raw.dropFirst(1 + symbol.count)))
            }
        }
        return raw
    }

    /// Strip the longest matching trailing unit suffix (case-insensitive) — the web loop over
    /// `STRIPPABLE_SUFFIXES` (first match wins; the list is ordered longest-first).
    private static func stripUnitSuffix(_ input: String) -> String {
        let lower = input.lowercased()
        for suffix in strippableSuffixes where lower.hasSuffix(suffix) {
            return trim(String(input.dropLast(suffix.count)))
        }
        return input
    }

    /// Canonical→display conversion (web `formatForUnit`'s display IIFE).
    private static func displayValue(
        _ value: Double,
        kind: UnitInputFieldKind,
        settings: UnitInputFieldSettings
    ) -> Double {
        switch kind {
        case .distance, .speed:
            settings.lengthUnit == .kilometers ? distanceCanonicalToDisplay(value) : value
        case .temperature:
            settings.tempUnit == .fahrenheit ? tempCanonicalToDisplay(value) : value
        case .energy, .percent, .currency:
            value
        }
    }

    /// Display→canonical conversion (web `parseForUnit`'s trailing `switch`).
    private static func canonicalValue(
        _ value: Double,
        kind: UnitInputFieldKind,
        settings: UnitInputFieldSettings
    ) -> Double {
        switch kind {
        case .distance, .speed:
            settings.lengthUnit == .kilometers ? distanceDisplayToCanonical(value) : value
        case .temperature:
            settings.tempUnit == .fahrenheit ? tempDisplayToCanonical(value) : value
        case .energy, .percent, .currency:
            value
        }
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the field's VoiceOver label from the (already-localized) field label and the current
/// display text, so the spoken content is asserted without rendering the view. Mirrors the web
/// `<Input label>` plus the value the screen reader reads from the input.
public enum UnitInputFieldAccessibility {
    /// "{label}, {value}" when a value is shown, "{label}, {emptyHint}" when blank — so VoiceOver
    /// never lands on a bare, unlabeled number or an empty control.
    public static func fieldLabel(label: String, value: String, emptyHint: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "\(label), \(emptyHint)" : "\(label), \(trimmed)"
    }
}
