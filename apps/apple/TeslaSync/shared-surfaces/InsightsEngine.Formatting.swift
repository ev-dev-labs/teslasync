//
//  InsightsEngine.Formatting.swift
//  TeslaSync — P4 shared surface · 0092 · InsightsEngine (Apple)
//
//  The number / currency formatting boundary — the native port of the web `useFormatting`
//  (`formatCurrency`) + `fmtNumber` that the InsightsEngine descriptions interpolate. The web
//  component reads the user's `currency_symbol` + locale via `useFormatting` and calls `fmtNumber`
//  with an EXPLICIT decimal count at every site (0 / 1 / 2), so there is no dependency on the global
//  precision default — this port takes the decimals explicitly too.
//
//  Pure Foundation (no SwiftUI). Formatting is applied here at the display boundary (per the SI
//  cutover guidance: read SI / domain values, format only for display), driven by the locale +
//  currency symbol carried on the input snapshot.
//

import Foundation

/// The currency + locale context the surface formats with — the native peer of the `useFormatting`
/// inputs (`currency_symbol`, the global BCP-47 locale). Kept as a small `Sendable` value so it can
/// ride on the input snapshot and be injected for deterministic tests.
public struct InsightsEngineFormattingContext: Sendable, Equatable {
    /// The user's currency symbol (web `settings.currency_symbol`, default "$"). A blank value falls
    /// back to "$" to match `useFormatting`.
    public var currencySymbol: String
    /// BCP-47 locale identifier used for grouping / decimal separators (web `_globalLocale`).
    public var localeIdentifier: String

    public init(currencySymbol: String = "$", localeIdentifier: String = "en_US") {
        let trimmed = currencySymbol.trimmingCharacters(in: .whitespaces)
        self.currencySymbol = trimmed.isEmpty ? "$" : currencySymbol
        self.localeIdentifier = localeIdentifier
    }
}

/// The number / currency formatter — the native port of `fmtNumber` + `useFormatting.formatCurrency`.
///
/// `fmtNumber(v, d, locale)` ≙ `safeNumber(v).toLocaleString(locale, { min/maxFractionDigits: d })`
/// (a non-finite value coerces to 0). `formatCurrency(amount, d)` ≙
/// `` `${currencySymbol}${fmtNumber(amount, d)}` `` — the symbol is simply prepended (no locale
/// currency placement), exactly as the web does.
public struct InsightsEngineFormatting: Sendable {
    public let currencySymbol: String
    private let locale: Locale

    public init(_ context: InsightsEngineFormattingContext) {
        currencySymbol = context.currencySymbol
        locale = Locale(identifier: context.localeIdentifier)
    }

    /// Locale-aware fixed-precision decimal — the port of `fmtNumber(value, decimals)`. Always shows
    /// exactly `decimals` fraction digits with grouping separators; a non-finite value renders as 0
    /// (web `safeNumber`).
    public func number(_ value: Double, decimals: Int) -> String {
        let safe = value.isFinite ? value : 0
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        // Intl.NumberFormat default rounds halves away from zero ("halfExpand").
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: safe)) ?? "0"
    }

    /// Symbol-prefixed currency — the port of `formatCurrency(amount, decimals)`.
    public func currency(_ amount: Double, decimals: Int) -> String {
        "\(currencySymbol)\(number(amount, decimals: decimals))"
    }
}
