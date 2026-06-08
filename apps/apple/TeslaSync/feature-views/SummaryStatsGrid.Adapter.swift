//
//  SummaryStatsGrid.Adapter.swift
//  TeslaSync — P4 feature view · 0093 · SummaryStatsGrid (Apple)
//
//  The testable projection core for the charging-curve summary stats grid — the
//  SwiftUI parity of features/charging/components/charging-curve/SummaryStatsGrid.tsx
//  plus the two web helpers it is fed by: `useFormatting` (currency symbol + decimal
//  precision from settings) and `fmtInt` / `fmtNumber` (lib/numberFormat.ts).
//  Everything here is pure + dependency-free (no store, no bundle, no rendered view)
//  so the locale number formatting, the six-tile model, the responsive column math,
//  and the VoiceOver summaries are all unit tested in isolation.
//
//  Units note: the web component renders the unit symbols "kWh" / "kW" / "min" as
//  literal suffixes (no unit conversion is applied — the parent ChargingCurve page
//  supplies these values already in display units). Native must hold no English
//  literals, so the symbols are carried as i18n keys + fallbacks and resolved at the
//  display boundary through the P1/S10 facade. The numeric values are locale-stable
//  pre-formatted strings, rendered verbatim.
//

import Foundation

// MARK: - Source values (web `SummaryStats` prop)

/// The six metrics the web `SummaryStats` interface carries. SI/units-free at this
/// layer — the parent page resolves these into kWh / kW / minutes before handing
/// them down, exactly as the web grid receives them — so no unit conversion applies.
public struct SummaryStatsGridValues: Sendable, Equatable {
    public var totalSessions: Double
    public var totalEnergy: Double
    public var avgRate: Double
    public var peakRate: Double
    public var avgDuration: Double
    public var totalCost: Double

    public init(
        totalSessions: Double = 0,
        totalEnergy: Double = 0,
        avgRate: Double = 0,
        peakRate: Double = 0,
        avgDuration: Double = 0,
        totalCost: Double = 0
    ) {
        self.totalSessions = totalSessions
        self.totalEnergy = totalEnergy
        self.avgRate = avgRate
        self.peakRate = peakRate
        self.avgDuration = avgDuration
        self.totalCost = totalCost
    }
}

// MARK: - Number formatting (port of numberFormat.ts + useFormatting.ts)

/// Pure locale number formatting, ported from the web `fmtNumber` / `fmtInt` so the
/// grouping, fraction digits, and non-finite coercion match the source exactly.
public enum SummaryStatsGridFormat {
    /// Locale decimal with grouping separators and a fixed fraction width — the
    /// native port of `fmtNumber(v, digits)`: non-finite coerces to 0 (web
    /// `safeNumber`), rounds half away from zero (web `toLocaleString` default),
    /// and pads to exactly `fractionDigits` decimals.
    public static func decimal(_ value: Double, fractionDigits: Int, locale: Locale) -> String {
        let safe = value.isFinite ? value : 0
        let digits = max(0, fractionDigits)
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = digits
        formatter.maximumFractionDigits = digits
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: safe)) ?? String(format: "%.\(digits)f", safe)
    }
}

/// The native mirror of the web `useFormatting` hook: the user's currency symbol and
/// decimal precision (from settings) plus the active locale. Drives the three web
/// formatters the grid uses — `fmtInt` (0 digits), `fmtNumber` (user precision), and
/// `formatCurrency` (symbol + user precision).
public struct SummaryStatsGridFormatting: Sendable, Equatable {
    /// Web `settings.currency_symbol` (blank → `$`).
    public var currencySymbol: String
    /// Web `settings.decimal_precision` (default 2).
    public var decimalPrecision: Int
    /// The BCP-47 locale backing the grouping/decimal separators (web global locale).
    public var locale: Locale

    public init(currencySymbol: String = "$", decimalPrecision: Int = 2, locale: Locale = .current) {
        let trimmed = currencySymbol.trimmingCharacters(in: .whitespaces)
        self.currencySymbol = trimmed.isEmpty ? "$" : currencySymbol
        self.decimalPrecision = max(0, decimalPrecision)
        self.locale = locale
    }

    /// Web `fmtNumber(v)` at the user precision.
    public func number(_ value: Double) -> String {
        SummaryStatsGridFormat.decimal(value, fractionDigits: decimalPrecision, locale: locale)
    }

    /// Web `fmtInt(v)` — `fmtNumber(v, 0)`.
    public func integer(_ value: Double) -> String {
        SummaryStatsGridFormat.decimal(value, fractionDigits: 0, locale: locale)
    }

    /// Web `formatCurrency(amount)` — `${currencySymbol}${fmtNumber(amount, precision)}`.
    public func currency(_ amount: Double) -> String {
        currencySymbol + number(amount)
    }
}

// MARK: - Unit symbol (web `unit` prop → i18n key + fallback)

/// One unit suffix carried as an i18n key + English fallback so the view resolves it
/// through the P1/S10 facade rather than embedding the literal symbol in Swift.
public struct SummaryStatsGridUnit: Sendable, Equatable {
    public let key: String
    public let fallback: String

    public init(key: String, fallback: String) {
        self.key = key
        self.fallback = fallback
    }
}

// MARK: - Card model (web `<SummaryCard label value unit loading>`)

/// One resolved summary card — the native mirror of a single web `<SummaryCard>`. The
/// label is carried as an i18n key + English fallback (resolved in the view); `value`
/// is the pre-formatted, locale-stable string, or `nil` for the web `loading`
/// skeleton branch; `unit` is the optional resolved-at-display unit suffix.
public struct SummaryStatsGridCard: Identifiable, Equatable, Sendable {
    public let id: String
    public let labelKey: String
    public let labelFallback: String
    /// `nil` ⇒ render the skeleton (web `SummaryCard` `loading` branch).
    public let value: String?
    public let unit: SummaryStatsGridUnit?

    public init(
        id: String,
        labelKey: String,
        labelFallback: String,
        value: String?,
        unit: SummaryStatsGridUnit?
    ) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.value = value
        self.unit = unit
    }
}

// MARK: - Responsive layout (web `grid-cols-2 lg:grid-cols-3 xl:grid-cols-6`)

/// The responsive column math, ported from the web Tailwind grid so it is unit
/// testable and identical across iPhone / iPad / Mac widths. Tailwind breakpoints
/// are CSS pixels: `lg` = 1024, `xl` = 1280.
public enum SummaryStatsGridLayout {
    public static let lgBreakpoint: CGFloat = 1024
    public static let xlBreakpoint: CGFloat = 1280

    /// Columns for an available width: 2 below `lg`, 3 below `xl`, 6 at/above `xl`
    /// (web `grid-cols-2` / `lg:grid-cols-3` / `xl:grid-cols-6`).
    public static func columnCount(forWidth width: CGFloat) -> Int {
        if width >= xlBreakpoint { return 6 }
        if width >= lgBreakpoint { return 3 }
        return 2
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the combined VoiceOver string for a card ("{label}, {value} {unit}") so the
/// spoken content is asserted without rendering the view.
public enum SummaryStatsGridAccessibility {
    public static func cardLabel(label: String, value: String, unit: String?) -> String {
        if let unit, !unit.isEmpty {
            return "\(label), \(value) \(unit)"
        }
        return "\(label), \(value)"
    }
}
