//
//  StatusHeader.Format.swift
//  TeslaSync — P4 feature view · 0028 · StatusHeader (Apple)
//
//  Pure number formatting that reproduces the web `lib/numberFormat.ts` `fmtInt` / `fmtNumber`
//  the source uses for the "Total entries" and "Replayable" counts, so every platform shows
//  identical grouped text (e.g. `12,345`). No store, no bundle, no view — unit-testable in
//  isolation, shared by the projection.
//

import Foundation

/// Web-parity integer/number formatting for the StatusHeader surface. Mirrors
/// `web/src/lib/numberFormat.ts`: `safeNumber` (non-finite → 0) + `toLocaleString` grouped
/// output at a fixed number of fraction digits.
public enum StatusHeaderNumberFormat {
    /// Web `safeNumber(v)`: a finite number, else `0` (guards `NaN` / `±Infinity` / nullish).
    public static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Web `fmtNumber(v, decimals)`: locale-aware grouped formatting at a fixed number of
    /// fraction digits, with the JS `toLocaleString` half-away-from-zero rounding and the
    /// `safeNumber` non-finite → 0 guard. `locale` defaults to en-US (the web default).
    public static func fmtNumber(
        _ value: Double,
        decimals: Int,
        locale: Locale = Locale(identifier: "en-US")
    ) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        formatter.roundingMode = .halfUp
        let number = NSNumber(value: safe(value))
        return formatter.string(from: number) ?? String(format: "%.\(decimals)f", safe(value))
    }

    /// Web `fmtInt(v)`: `fmtNumber(v, 0)` — the grouped integer the count tiles render.
    public static func fmtInt(_ value: Double, locale: Locale = Locale(identifier: "en-US")) -> String {
        fmtNumber(value, decimals: 0, locale: locale)
    }

    /// `fmtInt` over an `Int` count (the DLQ `count` / replayable totals are integers).
    public static func fmtInt(_ value: Int, locale: Locale = Locale(identifier: "en-US")) -> String {
        fmtInt(Double(value), locale: locale)
    }
}
