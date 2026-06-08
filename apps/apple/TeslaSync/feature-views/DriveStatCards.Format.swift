//
//  DriveStatCards.Format.swift
//  TeslaSync — P4 feature view · 0139 · DriveStatCards (Apple)
//
//  Pure SI → display converters + the `safe()` / `fmtNumber()` / `fmtInt()` /
//  `formatDuration()` helpers, reproducing the web `lib/unitConversion.ts` constants,
//  `lib/numberFormat.ts` formatting, and the drive-detail `helpers.ts` duration split so
//  every platform shows identical text. No store, no bundle, no view — unit-testable in
//  isolation, shared by the projection and (transitively) the views.
//

import Foundation

/// Web-parity SI conversion + number/duration formatting for the DriveStatCards surface.
public enum DriveStatCardsUnitMath {
    /// 1 mile = 1609.344 m exactly (international yard, NIST) — web `METERS_PER_MILE`.
    public static let metersPerMile = 1609.344
    /// 1 km = 1000 m exactly — web `METERS_PER_KM`.
    public static let metersPerKm = 1000.0
    /// 1 ft = 0.3048 m exactly (international foot, NIST) — web `METERS_PER_FOOT`.
    public static let metersPerFoot = 0.3048

    /// Web `safeNumber(v)`: a finite number, else `0` (guards `NaN` / `±Infinity` / nullish).
    public static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Web `convertDistanceFromSI(meters, to)`: meters → the display distance unit.
    public static func distanceFromSI(_ meters: Double, _ unit: String) -> Double {
        switch unit {
        case "mi": meters / metersPerMile
        case "ft": meters / metersPerFoot
        default: meters / metersPerKm
        }
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

    /// Web `fmtInt(v)`: `fmtNumber(v, 0)` — the grouped integer the SOC pair uses.
    public static func fmtInt(_ value: Double, locale: Locale = Locale(identifier: "en-US")) -> String {
        fmtNumber(value, decimals: 0, locale: locale)
    }

    /// Web drive-detail `formatDuration(min)`: `h = floor(min / 60)`, `m = round(min % 60)`,
    /// then `"{h}h {m}m"` when there is an hour component, else `"{m}m"`.
    public static func formatDuration(minutes: Double) -> String {
        let safeMinutes = safe(minutes)
        let hours = Int((safeMinutes / 60).rounded(.down))
        let mins = Int(safeMinutes.truncatingRemainder(dividingBy: 60).rounded())
        return hours > 0 ? "\(hours)h \(mins)m" : "\(mins)m"
    }
}
