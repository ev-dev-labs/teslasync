//
//  Currency.Adapter.swift
//  TeslaSync — P4 shared surface · 0083 · Currency (Apple)
//
//  The testable, dependency-light core for the currency renderer — the SwiftUI parity of
//  `components/data-display/format/Currency.tsx`. Everything here is pure (Foundation only): the input
//  snapshot (the web props + the `useFormatting().currencySymbol` selection), the surface metadata
//  (the diagnostics slug + the web defaults), the symbol-resolution rule (the verbatim port of the
//  `useFormatting` ternary), the locale-aware number formatter (the native shape of the web
//  `fmtNumber(value, precision)` call), the locale-neutral canonical string (the web `title`
//  attribute's `value.toFixed(precision)`), and the VoiceOver label builder. No store, no rendered
//  view, so each piece is unit tested in isolation.
//
//  Parity note — states. The web source is purely presentational: it takes an already-resolved
//  `value` plus the user's preferred `currencySymbol` (a synchronous selector over the loaded
//  settings — `useFormatting` issues no fetch) and renders the amount. It has no asynchronous data
//  source and therefore no loading / error / stale / offline branch to mirror; synthesising such
//  chrome would invent state the web source does not have (the same disposition as the 0075
//  AnimatedNumber and 0053 AIThinkingIndicator surfaces). The genuine render branches this core models
//  are exactly the two the web has: the formatted-value branch (`{symbol}{fmtNumber(value)}`) and the
//  fallback branch (`value == null || !isFinite(value)` → the caller's `fallback`, default em dash).
//
//  Parity note — i18n. The web component renders no translatable copy (no `t()` call); its only
//  locale-sensitive output is the number's grouping separators and decimal mark. The P1/S10 binding
//  for this surface is therefore the injected `Locale` that drives that formatting (the native parity
//  of the web `fmtNumber` global-locale read), not a string catalog. The `fallback` glyph is caller
//  data with a locale-neutral em-dash default, exactly as the web prop default is. See Currency.strings.
//

import Foundation

// MARK: - Surface metadata (diagnostics slug + web defaults)

/// The static identity of the surface — the P1/S11 diagnostics slug emitted with `view.opened` and
/// the web prop defaults (`precision = 2`, `fallback = "—"`, `useFormatting` symbol fallback `"$"`)
/// plus the fraction-digit clamp.
public enum CurrencyMeta {
    /// The diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "Currency"

    /// Web `precision` prop default (the standard for fiat amounts).
    public static let defaultPrecision = 2

    /// Web `fallback` prop default — the em dash rendered for a null / non-finite value.
    public static let defaultFallback = "—"

    /// Web `useFormatting().currencySymbol` fallback when settings carry no usable symbol.
    public static let defaultCurrencySymbol = "$"

    /// Upper bound on fraction digits, matching the web `setGlobalPrecision` clamp of 0...20 so a
    /// negative or runaway `precision` can never throw inside the formatter.
    public static let maxFractionDigits = 20
}

// MARK: - Formatting settings (web `useFormatting().currencySymbol` selector)

/// The slice of the user's formatting settings this surface binds — the native parity of the
/// `useFormatting()` hook's `currencySymbol` selection. The surface reads the resolved symbol
/// synchronously from this projection (the P1/S8 settings state-holder feeds it in production); there
/// is no network access, exactly as the web hook performs none.
public struct CurrencyFormattingSettings: Sendable, Equatable {
    /// The raw `settings.currency_symbol` value from the user's settings (`nil` when unset).
    public let rawCurrencySymbol: String?

    public init(rawCurrencySymbol: String? = nil) {
        self.rawCurrencySymbol = rawCurrencySymbol
    }

    /// The resolved preferred symbol — the verbatim port of the web ternary
    /// `settings.currency_symbol && settings.currency_symbol.trim() ? settings.currency_symbol : '$'`:
    /// a present, non-blank symbol is used *as-is* (untrimmed, matching the web); a `nil`, empty, or
    /// whitespace-only symbol falls back to `"$"`.
    public var currencySymbol: String {
        guard let raw = rawCurrencySymbol else { return CurrencyMeta.defaultCurrencySymbol }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? CurrencyMeta.defaultCurrencySymbol : raw
    }
}

// MARK: - Input (web `CurrencyProps` + the resolved settings symbol)

/// One coalesced snapshot of the surface's inputs — the web props plus the `useFormatting` symbol
/// source. `value` is the amount in the user's preferred currency (the component performs no FX
/// conversion, exactly as the web does not); `precision` is the fraction-digit count (web default 2);
/// `symbolOverride` forces a symbol regardless of settings (web `symbolOverride ?? currencySymbol`);
/// `fallback` is the null/non-finite render (web default em dash); `settings` carries the preferred
/// symbol; `locale` carries the grouping/decimal conventions the web reads from the global formatter.
/// Equatable so the view can adopt a changed snapshot.
public struct CurrencyInput: Sendable, Equatable {
    public var value: Double?
    public var precision: Int
    public var symbolOverride: String?
    public var fallback: String
    public var settings: CurrencyFormattingSettings
    public var locale: Locale

    public init(
        value: Double?,
        precision: Int = CurrencyMeta.defaultPrecision,
        symbolOverride: String? = nil,
        fallback: String = CurrencyMeta.defaultFallback,
        settings: CurrencyFormattingSettings = CurrencyFormattingSettings(),
        locale: Locale = .autoupdatingCurrent
    ) {
        self.value = value
        self.precision = precision
        self.symbolOverride = symbolOverride
        self.fallback = fallback
        self.settings = settings
        self.locale = locale
    }

    /// The symbol actually rendered — the web `symbolOverride ?? currencySymbol`. A non-`nil`
    /// override wins (even an empty string, mirroring JavaScript `??`); otherwise the settings symbol.
    public var effectiveSymbol: String {
        symbolOverride ?? settings.currencySymbol
    }

    /// Whether `value` is a finite number suitable for rendering — the web guard
    /// `value == null || !Number.isFinite(value)` inverted. A `nil` or non-finite value takes the
    /// fallback branch.
    public var hasRenderableValue: Bool {
        guard let value, value.isFinite else { return false }
        return true
    }
}

// MARK: - Number formatting (web `fmtNumber` + the `value.toFixed` canonical)

/// The pure formatting core — the native port of the web `fmtNumber(value, precision)` (the visible,
/// locale-aware number), the `{symbol}{number}` composition, and the locale-neutral `value.toFixed`
/// used for the web `title` attribute. Every function is deterministic and value-type (no shared
/// mutable formatter is escaped), so the rendered output is asserted without a view.
public enum CurrencyFormatting {
    /// Web `safeNumber`: a non-finite value (NaN / ±Infinity) formats as zero rather than reaching the
    /// formatter and producing "NaN". The fallback branch already screens these out before display,
    /// so this only hardens the formatter itself.
    public static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Clamp the fraction-digit count to the web `setGlobalPrecision` range (0...20) so a negative or
    /// runaway `precision` can never make the formatter throw.
    public static func clampPrecision(_ precision: Int) -> Int {
        min(max(0, precision), CurrencyMeta.maxFractionDigits)
    }

    /// Locale-aware number formatting — the native parity of `fmtNumber`: a fixed number of fraction
    /// digits (clamped 0...20) with locale grouping separators, rounding half away from zero to match
    /// `Intl.NumberFormat`'s default `halfExpand`, and the `safeNumber` fallback to `0`.
    public static func number(_ value: Double, precision: Int, locale: Locale) -> String {
        let digits = clampPrecision(precision)
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = digits
        formatter.maximumFractionDigits = digits
        formatter.roundingMode = .halfUp
        let safeValue = safe(value)
        return formatter.string(from: NSNumber(value: safeValue)) ?? String(format: "%.\(digits)f", safeValue)
    }

    /// Locale-neutral fixed-point string — the native parity of `value.toFixed(precision)`: no
    /// grouping, a `.` decimal mark, and a fixed fraction-digit count. Used for the canonical
    /// (tooltip) form so the figure is unambiguous regardless of the display locale.
    public static func fixed(_ value: Double, precision: Int) -> String {
        let digits = clampPrecision(precision)
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.usesGroupingSeparator = false
        formatter.minimumFractionDigits = digits
        formatter.maximumFractionDigits = digits
        formatter.roundingMode = .halfUp
        let safeValue = safe(value)
        return formatter.string(from: NSNumber(value: safeValue)) ?? String(format: "%.\(digits)f", safeValue)
    }

    /// The visible display string — the web `{symbol}{fmtNumber(value, precision)}`, rendered adjacent
    /// with no separator.
    public static func display(symbol: String, value: Double, precision: Int, locale: Locale) -> String {
        symbol + number(value, precision: precision, locale: locale)
    }

    /// The canonical string — the web `title` attribute `${symbol}${value.toFixed(precision)}`,
    /// locale-neutral so a tooltip reads the same in every locale.
    public static func canonical(symbol: String, value: Double, precision: Int) -> String {
        symbol + fixed(value, precision: precision)
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the surface's VoiceOver string from the input, so the spoken content is asserted without
/// rendering the view. The web is a bare `<span>` with a `title`; the native refinement voices the
/// visible amount (`{symbol}{localized number}`) on the value branch and the `fallback` glyph on the
/// fallback branch, so VoiceOver announces what is on screen rather than a bare number.
public enum CurrencyAccessibility {
    /// The spoken label for the surface — the visible display string, or the fallback glyph.
    public static func label(_ input: CurrencyInput) -> String {
        guard let value = input.value, value.isFinite else { return input.fallback }
        return CurrencyFormatting.display(
            symbol: input.effectiveSymbol,
            value: value,
            precision: input.precision,
            locale: input.locale
        )
    }
}
