//
//  RecentDrivesSection.Format.swift
//  TeslaSync — P4 feature view · 0297 · RecentDrivesSection (Apple)
//
//  Pure SI → display converters + the cell formatters the Distance / Duration / Battery columns
//  render, reproducing the web `lib/unitConversion.ts` constants, `lib/numberFormat.ts`
//  formatting, and the drive-detail `helpers.ts` `durationStr` split so every platform shows
//  identical text. No store, no bundle, no view — unit-testable in isolation, shared by the
//  projection and (transitively) the views.
//

import Foundation

/// Web-parity SI conversion + number/duration/battery formatting for the RecentDrivesSection
/// surface.
public enum RecentDrivesUnitMath {
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

    /// Web `convertDistanceFromSI(meters, to)`: meters → the display distance unit. Unknown
    /// labels fall back to kilometers (the SI display floor), matching the web default branch.
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

    /// Web `fmtInt(v)`: `fmtNumber(v, 0)` — the grouped integer the duration minutes use.
    public static func fmtInt(_ value: Double, locale: Locale = Locale(identifier: "en-US")) -> String {
        fmtNumber(value, decimals: 0, locale: locale)
    }

    /// The Distance cell: web `${fmtNumber(convertDistanceFromSI(distance_m ?? 0, unit))} ${unit}`.
    /// `fmtNumber` has no per-call precision in the web source, so it uses the global precision
    /// (default 2), threaded here as `precision`.
    public static func distanceText(
        meters: Double,
        unit: String,
        precision: Int,
        locale: Locale = Locale(identifier: "en-US")
    ) -> String {
        let display = distanceFromSI(meters, unit)
        return fmtNumber(display, decimals: precision, locale: locale) + " " + unit
    }

    /// The Duration cell: web `durationStr((duration_s ?? 0) / 60)` — `h = floor(min / 60)`,
    /// `m = fmtInt(min % 60)`, then `"{h}h {m}m"` when there is an hour component, else `"{m}m"`.
    public static func durationText(seconds: Double, locale: Locale = Locale(identifier: "en-US")) -> String {
        let minutes = safe(seconds) / 60
        let hours = Int((minutes / 60).rounded(.down))
        let remainder = fmtInt(minutes.truncatingRemainder(dividingBy: 60), locale: locale)
        return hours > 0 ? "\(hours)h \(remainder)m" : "\(remainder)m"
    }

    /// The Battery cell: web `start_soc_pct != null && end_soc_pct != null ? `${start}% → ${end}%`
    /// : '—'`. The percents are rendered like the web raw template (`${number}`): no grouping,
    /// trailing `.0` dropped.
    public static func batteryText(start: Double?, end: Double?, empty: String) -> String {
        guard let start, let end else { return empty }
        return "\(percentText(start))% → \(percentText(end))%"
    }

    /// Mirrors the web raw `${number}` stringification used by the Battery template: an integer
    /// when whole, otherwise the trimmed decimal, with no thousands grouping.
    public static func percentText(_ value: Double, locale: Locale = Locale(identifier: "en-US")) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.usesGroupingSeparator = false
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 10
        formatter.roundingMode = .halfUp
        let number = NSNumber(value: safe(value))
        return formatter.string(from: number) ?? "\(Int(safe(value)))"
    }
}
