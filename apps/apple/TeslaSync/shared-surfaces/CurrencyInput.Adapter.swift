//
//  CurrencyInput.Adapter.swift
//  TeslaSync — P4 shared surface · 0150 · CurrencyInput (Apple)
//
//  The testable, dependency-light core for the currency field — the SwiftUI parity of
//  `components/forms/CurrencyInput.tsx` and the `lib/currencyFormat.ts` helpers it binds. Everything
//  here is pure (Foundation only): the canonical micro-unit storage (the web `valueToMicro` /
//  `microToValue`, 1 major unit = 1_000_000 micro so currencies with 0/2/3/4 fractional digits keep
//  full precision), the locale-aware currency formatter (the web `formatCurrencyValue` /
//  `currencySymbol`), and the locale-aware parser (the web `parseCurrencyText` / `parseLocaleNumber`:
//  symbol + ISO-code stripping, accounting parentheses, locale group/decimal separators). No store,
//  no bundle, no rendered view, so each piece is unit tested in isolation against the web's own cases.
//
//  Naming note: the sibling `Currency` display surface (0083) already declares a module-public
//  `CurrencyInput` value type, so this surface's symbols are namespaced `CurrencyInputField*`. The
//  diagnostics slug stays "CurrencyInput" (the web source filename), see `CurrencyInputFieldMeta`.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. A plain closure so the pure core needs no bundle: the app passes the
/// P1/S10 facade, tests pass the identity-fallback resolver.
public typealias CurrencyInputFieldResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Surface metadata

/// Static, non-identifying surface constants. The slug is the web source name (`CurrencyInput`) so
/// the P1/S11 `view.opened` event matches across platforms even though the Swift type is namespaced.
public enum CurrencyInputFieldMeta {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "CurrencyInput"

    /// Web `precision` default — display fraction digits (storage keeps full micro precision).
    public static let defaultPrecision = 2

    /// Web `resolveLocale` final fallback when no explicit/system locale is available.
    public static let fallbackLocaleIdentifier = "en_US"
}

// MARK: - Canonical micro-unit storage (web `valueToMicro` / `microToValue`)

/// Integer micro-unit conversions — the native port of the web canonical storage. One major unit is
/// `scale` micro-units, so a tariff like 0.12345 USD/kWh round-trips without floating-point drift.
public enum CurrencyInputFieldMicro {
    /// 1 major unit = 1_000_000 micro-units (web `MICRO_SCALE`).
    public static let scale = 1_000_000

    /// Convert a major-unit value to integer micro-units, rounding to the nearest micro (web
    /// `Math.round(value * MICRO_SCALE)`). `nil` for a nil / non-finite value.
    public static func fromValue(_ value: Double?) -> Int? {
        guard let value, value.isFinite else { return nil }
        let scaled = (value * Double(scale)).rounded()
        guard scaled.isFinite, abs(scaled) < 9.0e18 else { return nil }
        return Int(scaled)
    }

    /// Convert integer micro-units back to the major unit (web `micro / MICRO_SCALE`). `nil` for nil.
    public static func toValue(_ micro: Int?) -> Double? {
        guard let micro else { return nil }
        return Double(micro) / Double(scale)
    }
}

// MARK: - Formatting + parsing (verbatim port of `lib/currencyFormat.ts`)

/// The pure formatting + parsing core — the native port of the web currency helpers. Every function
/// is deterministic and dependency-light so the rendered text is asserted without a view. Swift's
/// `NumberFormatter` (currency style) reproduces `Intl.NumberFormat` for the ISO cases the surface
/// uses (`$1.50`, `1,50 €`, `£1.50`, `$0.1235`), verified by the unit tests.
public enum CurrencyInputFieldFormatter {
    /// Web `clampPrecision`: a finite, truncated value clamped to `0...20`, else the default `2`.
    public static func clampPrecision(_ precision: Int?) -> Int {
        guard let precision else { return CurrencyInputFieldMeta.defaultPrecision }
        return max(0, min(20, precision))
    }

    /// Resolve the effective locale — the web `resolveLocale` (explicit prop, else the system, else
    /// `en-US`). Swift's `Locale.autoupdatingCurrent` stands in for `navigator.language`.
    public static func resolveLocale(_ explicit: Locale?) -> Locale {
        explicit ?? .autoupdatingCurrent
    }

    /// Format a major-unit value as currency text — the web `formatCurrencyValue`. Returns `""` for a
    /// nil / non-finite value so the field renders blank. `useGrouping` defaults to `false` (web
    /// input-field rendering: group separators inside an editable field cause cursor + round-trip
    /// pain). An unresolvable ISO code falls back to a plain decimal prefixed with the literal code.
    public static func format(
        value: Double?,
        currency: String,
        locale: Locale,
        precision: Int,
        useGrouping: Bool = false
    ) -> String {
        guard let value, value.isFinite else { return "" }
        let style = NumberStyle(locale: locale, digits: clampPrecision(precision), useGrouping: useGrouping)
        return localizedCurrency(value, currency: currency, style: style)
            ?? plainCurrency(value, currency: currency, style: style)
    }

    /// Format a micro-unit value as currency text — the web `formatCurrencyMicro` (microToValue then
    /// `formatCurrencyValue`).
    public static func formatMicro(
        _ micro: Int?,
        currency: String,
        locale: Locale,
        precision: Int,
        useGrouping: Bool = false
    ) -> String {
        format(
            value: CurrencyInputFieldMicro.toValue(micro),
            currency: currency,
            locale: locale,
            precision: precision,
            useGrouping: useGrouping
        )
    }

    /// The localized currency symbol — the web `currencySymbol` (`('USD','en-US') -> '$'`). Falls
    /// back to the literal code when the symbol can't be resolved (non-ISO 4217 code).
    public static func symbol(currency: String, locale: Locale) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = currency
        formatter.locale = locale
        guard let symbol = formatter.currencySymbol, !symbol.isEmpty, symbol != genericCurrencySign else {
            return currency
        }
        return symbol
    }

    /// Best-effort reverse lookup from a settings symbol to an ISO 4217 code — the verbatim web
    /// `currencyCodeFromSymbol` table, defaulting to `USD` for an unknown symbol.
    public static func code(fromSymbol symbol: String?) -> String {
        let trimmed = (symbol ?? "").trimmingCharacters(in: .whitespaces)
        return symbolToCode[trimmed] ?? "USD"
    }

    /// Parse user-typed text to a major-unit value — the web `parseCurrencyText`. Strips the
    /// localized symbol + the literal ISO code, honours accounting parentheses (`($1.50)` -> -1.5)
    /// and a leading sign, normalises the locale's group/decimal separators, then parses. `nil` for
    /// empty / unparseable input.
    public static func parse(text: String?, currency: String, locale: Locale) -> Double? {
        var raw = (text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if raw.isEmpty { return nil }

        var negative = false
        if raw.hasPrefix("("), raw.hasSuffix(")") {
            negative = true
            raw = String(raw.dropFirst().dropLast()).trimmingCharacters(in: .whitespaces)
        }

        raw = stripAdornments(raw, currency: currency, locale: locale)
        if raw.isEmpty { return nil }

        if raw.hasPrefix("-") {
            negative.toggle()
            raw = String(raw.dropFirst()).trimmingCharacters(in: .whitespaces)
        } else if raw.hasPrefix("+") {
            raw = String(raw.dropFirst()).trimmingCharacters(in: .whitespaces)
        }
        if raw.isEmpty { return nil }

        guard let number = parseLocaleNumber(raw, locale: locale), number.isFinite else { return nil }
        return negative ? -number : number
    }

    /// Parse user-typed text directly to integer micro-units — the web `parseCurrencyTextToMicro`.
    public static func parseToMicro(text: String?, currency: String, locale: Locale) -> Int? {
        CurrencyInputFieldMicro.fromValue(parse(text: text, currency: currency, locale: locale))
    }

    /// Parse a numeric string using the locale's group + decimal separators — the web
    /// `parseLocaleNumber` (`'1,234.56' en-US -> 1234.56`, `'1.234,56' de-DE -> 1234.56`,
    /// `'1 234,56' fr-FR -> 1234.56`). Space-like group separators (regular space, `U+00A0`,
    /// `U+202F`) are stripped, matching the web's space handling and today's ICU narrow no-break
    /// space. Returns `nil` when the residue is not a finite number.
    public static func parseLocaleNumber(_ text: String, locale: Locale) -> Double? {
        if text.isEmpty { return nil }
        let probe = NumberFormatter()
        probe.numberStyle = .decimal
        probe.locale = locale
        let groupSeparator = probe.groupingSeparator ?? ","
        let decimalSeparator = probe.decimalSeparator ?? "."

        var normalized = text
        if isSpaceLike(groupSeparator) {
            for space in spaceLikeSeparators {
                normalized = normalized.replacingOccurrences(of: space, with: "")
            }
        } else if !groupSeparator.isEmpty, groupSeparator != decimalSeparator {
            normalized = normalized.replacingOccurrences(of: groupSeparator, with: "")
        }
        if decimalSeparator != "." {
            normalized = normalized.replacingOccurrences(of: decimalSeparator, with: ".")
        }
        normalized = normalized.components(separatedBy: .whitespacesAndNewlines).joined()
        if normalized.isEmpty { return nil }
        return Double(normalized)
    }

    // MARK: Private

    /// The Unicode generic-currency sign `¤` (`U+00A4`) that `NumberFormatter` emits for an
    /// unresolvable code; treated as "no symbol" so the literal code is shown instead.
    private static let genericCurrencySign = "\u{00A4}"

    /// Space variants that ICU uses as group separators across locales (regular, no-break, narrow
    /// no-break) — all collapsed to nothing when the active group separator is space-like.
    private static let spaceLikeSeparators = [" ", "\u{00A0}", "\u{202F}"]

    /// The web `currencyCodeFromSymbol` table — settings symbol → ISO 4217 code.
    private static let symbolToCode: [String: String] = [
        "$": "USD", "€": "EUR", "£": "GBP", "¥": "JPY", "₹": "INR", "₽": "RUB",
        "₩": "KRW", "A$": "AUD", "C$": "CAD", "CHF": "CHF", "kr": "SEK", "R$": "BRL",
        "R": "ZAR", "NZ$": "NZD", "HK$": "HKD", "NT$": "TWD", "S$": "SGD", "₺": "TRY",
        "฿": "THB", "Mex$": "MXN", "zł": "PLN"
    ]

    private static func isSpaceLike(_ separator: String) -> Bool {
        spaceLikeSeparators.contains(separator)
    }

    /// The formatter configuration shared by the localized + fallback paths — bundled so the call
    /// sites stay within the line-length budget.
    private struct NumberStyle {
        let locale: Locale
        let digits: Int
        let useGrouping: Bool
    }

    private static func makeFormatter(currency: String?, style: NumberStyle) -> NumberFormatter {
        let formatter = NumberFormatter()
        formatter.numberStyle = currency == nil ? .decimal : .currency
        if let currency { formatter.currencyCode = currency }
        formatter.locale = style.locale
        formatter.minimumFractionDigits = style.digits
        formatter.maximumFractionDigits = style.digits
        formatter.usesGroupingSeparator = style.useGrouping
        // Intl.NumberFormat rounds half away from zero (`halfExpand`); NumberFormatter defaults to
        // banker's rounding, so pin `.halfUp` for web parity (0.12345 → 0.1235, not 0.1234).
        formatter.roundingMode = .halfUp
        return formatter
    }

    /// The localized currency-formatted string, or `nil` when the code has no real symbol (the
    /// generic `¤` sign or an empty symbol) so the caller falls back — the web `try { Intl… } catch`.
    private static func localizedCurrency(_ value: Double, currency: String, style: NumberStyle) -> String? {
        let formatter = makeFormatter(currency: currency, style: style)
        guard let symbol = formatter.currencySymbol, !symbol.isEmpty, symbol != genericCurrencySign else {
            return nil
        }
        return formatter.string(from: NSNumber(value: value))
    }

    /// The web `catch` fallback: a plain decimal prefixed with the literal code (`"USD 1.50"`).
    private static func plainCurrency(_ value: Double, currency: String, style: NumberStyle) -> String {
        let formatter = makeFormatter(currency: nil, style: style)
        let plain = formatter.string(from: NSNumber(value: value)) ?? String(value)
        return "\(currency) \(plain)".trimmingCharacters(in: .whitespaces)
    }

    /// Strip the localized symbol and the literal ISO code (case-insensitive) wrapping the numeric
    /// portion — the web `stripCurrencyAdornments`.
    private static func stripAdornments(_ raw: String, currency: String, locale: Locale) -> String {
        let currencySymbol = symbol(currency: currency, locale: locale)
        let code = currency.trimmingCharacters(in: .whitespaces)
        var out = raw
        if !currencySymbol.isEmpty, currencySymbol != code {
            out = out.replacingOccurrences(of: currencySymbol, with: "")
        }
        if !code.isEmpty {
            out = out.replacingOccurrences(of: code, with: "", options: [.caseInsensitive])
        }
        return out.trimmingCharacters(in: .whitespaces)
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the field's VoiceOver label from the (already-localized) aria-label and the current
/// display text, so the spoken content is asserted without rendering the view. Mirrors the web
/// `aria-label` plus the value the screen reader reads from the input.
public enum CurrencyInputFieldAccessibility {
    /// "{label}, {value}" when a value is shown, "{label}, {emptyHint}" when the field is blank — so
    /// VoiceOver never lands on a bare, unlabeled number or an empty control.
    public static func fieldLabel(ariaLabel: String, value: String, emptyHint: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "\(ariaLabel), \(emptyHint)" : "\(ariaLabel), \(trimmed)"
    }
}
