//
//  WarrantyStatusWidget.Builder.swift
//  TeslaSync — P4 dashboard widget · 0113 · WarrantyStatusWidget (Apple)
//
//  Pure parser + formatting primitives — the deterministic core of the
//  cached→projection adapter, a faithful Swift port of the helpers in
//  features/dashboard/widgets/WarrantyStatusWidget.tsx (asString / asNumber
//  narrowing, daysUntil, statusVariant, the distance/number/date formatting, and
//  the MetricBar fill maths). The projection assembly lives in
//  WarrantyStatusWidget.Projection.swift. No SwiftUI / transport here.
//

import Foundation

/// Pure adapters that narrow + format the untyped warranty envelope. Mirrors the
/// web source exactly so iOS, iPadOS, macOS, and the web render the same numbers,
/// dates, and badges.
public enum WarrantyProjectionBuilder {
    // Web `lib/unitConversion.ts` constants — `convertDistanceFromSI` divisors.
    static let metersPerKm = 1000.0
    static let metersPerMile = 1609.344
    static let metersPerFoot = 0.3048

    /// One warranty coverage type (web `COVERAGE_TYPES`): the data key, its i18n
    /// label key and English fallback.
    struct CoverageType {
        let key: String
        let labelKey: String
        let fallback: String
    }

    /// Web `COVERAGE_TYPES` — order preserved so coverage rows render identically.
    static let coverageTypes: [CoverageType] = [
        CoverageType(key: "basic", labelKey: "widget.warranty.basic", fallback: "Basic"),
        CoverageType(
            key: "battery_drive_unit",
            labelKey: "widget.warranty.batteryDrive",
            fallback: "Battery/Drive Unit"
        ),
        CoverageType(key: "corrosion", labelKey: "widget.warranty.corrosion", fallback: "Corrosion"),
        CoverageType(key: "emissions", labelKey: "widget.warranty.emissions", fallback: "Emissions"),
        CoverageType(key: "body", labelKey: "widget.warranty.body", fallback: "Body")
    ]

    // MARK: Narrowing (web `asString` / `asNumber`)

    /// Web `asString(val)` — a non-empty string, or a stringified number, else nil.
    static func asString(_ value: WarrantyValue?) -> String? {
        guard let value else { return nil }
        switch value {
        case .null, .bool:
            return nil
        case let .string(string):
            return string.isEmpty ? nil : string
        case let .number(number):
            guard number.isFinite else { return nil }
            // Web `String(number)`: integral values render without a decimal point.
            if number == number.rounded(), abs(number) < 1e15 {
                return String(Int(number))
            }
            return String(number)
        }
    }

    /// Web `asNumber(val)` — a finite number, or a finite `Number(string)`, else nil.
    /// Mirrors JS `Number('')  === 0` for the empty / whitespace string.
    static func asNumber(_ value: WarrantyValue?) -> Double? {
        guard let value else { return nil }
        switch value {
        case .null, .bool:
            return nil
        case let .number(number):
            return number.isFinite ? number : nil
        case let .string(string):
            let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty { return 0 }
            guard let parsed = Double(trimmed), parsed.isFinite else { return nil }
            return parsed
        }
    }

    /// Web `asString(a ?? b ?? c)` — the first *present, non-null* cell, narrowed to
    /// a string. The `??` chain stops at the first non-nullish raw value, so a
    /// present-but-empty cell does NOT fall through (it narrows to nil).
    static func firstString(_ data: WarrantyDataInput, _ keys: [String]) -> String? {
        asString(firstRaw(data, keys))
    }

    /// Web `asNumber(a ?? b ?? c)`.
    static func firstNumber(_ data: WarrantyDataInput, _ keys: [String]) -> Double? {
        asNumber(firstRaw(data, keys))
    }

    /// First present, non-null cell across `keys` (web nullish-coalescing chain).
    static func firstRaw(_ data: WarrantyDataInput, _ keys: [String]) -> WarrantyValue? {
        for key in keys {
            if let value = data.value(key), value != .null {
                return value
            }
        }
        return nil
    }

    // MARK: Days / variant (web `daysUntil` / `statusVariant`)

    /// Web `daysUntil(dateStr)` — `Math.ceil((expiry - now) / 86_400_000)`, nil for
    /// missing / invalid dates. `now` is injected for deterministic tests.
    static func daysUntil(_ dateStr: String?, now: Date) -> Int? {
        guard let dateStr, let expiry = parseDate(dateStr) else { return nil }
        let days = expiry.timeIntervalSince(now) / 86400.0
        guard days.isFinite else { return nil }
        return Int(days.rounded(.up))
    }

    /// Web `statusVariant(days)` — `error` when unknown / expired, `warning` within
    /// 90 days, else `success`.
    static func statusVariant(_ days: Int?) -> WarrantyVariant {
        guard let days, days > 0 else { return .error }
        return days <= 90 ? .warning : .success
    }

    // MARK: Distance (web `convertDistanceFromSI`)

    /// Web `convertDistanceFromSI(value, to)` — divides by the unit's metre-count.
    /// Unknown units fall back to miles (the web type only emits `km` / `mi` / `ft`).
    ///
    /// NOTE: the web source feeds the raw `mileage_limit_mi` / `current_mileage_mi`
    /// cells straight through this SI converter (the field name says "mi" but the
    /// value is treated as the SI metre baseline, per the Phase-42/48 SI cutover).
    /// We replicate that exact arithmetic so the native surface renders
    /// byte-identical distance numbers to the web — parity over "correctness".
    static func convertDistanceFromSI(_ value: Double, to unit: String) -> Double {
        switch unit {
        case "km": value / metersPerKm
        case "ft": value / metersPerFoot
        default: value / metersPerMile
        }
    }

    // MARK: Number / date formatting (web fmtNumber / formatDate / Intl month-year)

    /// Web `fmtNumber(value, decimals)` — locale-grouped, fixed-fraction number.
    /// Non-finite input collapses to `0` (web `safeNumber`).
    static func decimalString(_ value: Double, fractionDigits: Int, locale: String) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = Locale(identifier: locale)
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        let safe = value.isFinite ? value : 0
        return formatter.string(from: NSNumber(value: safe)) ?? "\(Int(safe))"
    }

    /// Web `formatDate(date)` — medium localized date, `'—'` for null / invalid
    /// (web `year:'numeric', month:'short', day:'numeric'` ⇒ `DateFormatter.medium`).
    static func dateMedium(_ iso: String?, format: WarrantyFormatting) -> String {
        guard let iso, let date = parseDate(iso) else { return "—" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: format.localeIdentifier)
        formatter.timeZone = TimeZone(identifier: format.timeZoneIdentifier) ?? .current
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }

    /// Web coverage value `Intl.DateTimeFormat(locale, { month:'short', year:'numeric' })`
    /// ⇒ `"Apr 2024"`. Falls back to the raw string for an unparseable date (the web
    /// would render "Invalid Date" — we show the source value instead).
    ///
    /// NOTE: the web `Intl.DateTimeFormat` call here omits the `timeZone` option, so
    /// it is tz-naive (renders in the runtime's local zone). Coverage expiries are
    /// typically date-only (`"YYYY-MM-01"`, parsed as UTC midnight), so we pin UTC to
    /// keep the calendar month deterministic — a behind-UTC zone would otherwise shift
    /// `"2025-06-01"` back to "May 2025".
    static func monthYear(_ iso: String?, format: WarrantyFormatting) -> String {
        guard let iso else { return "—" }
        guard let date = parseDate(iso) else { return iso }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: format.localeIdentifier)
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.setLocalizedDateFormatFromTemplate("MMMyyyy")
        return formatter.string(from: date)
    }

    /// Parses the ISO-8601 (or date-only) string the web hands to `new Date(...)`.
    static func parseDate(_ iso: String) -> Date? {
        let trimmed = iso.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return nil }

        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let parsed = withFraction.date(from: trimmed) { return parsed }

        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        if let parsed = plain.date(from: trimmed) { return parsed }

        let dateOnly = DateFormatter()
        dateOnly.locale = Locale(identifier: "en_US_POSIX")
        dateOnly.timeZone = TimeZone(identifier: "UTC")
        dateOnly.dateFormat = "yyyy-MM-dd"
        return dateOnly.date(from: trimmed)
    }

    /// Web `MetricBar` fill — `Math.min(value / max, 1)` clamped to a safe `0...1`.
    /// Mirrors the web edge behaviour: `value / 0` (positive) saturates the bar,
    /// non-positive / non-finite ratios empty it.
    static func fraction(value: Double, max: Double) -> Double {
        if max == 0 { return value > 0 ? 1 : 0 }
        guard max > 0, value.isFinite else { return value > 0 ? 1 : 0 }
        return Swift.min(Swift.max(value / max, 0), 1)
    }

    /// Web coverage truthiness `covVal != null && covVal !== false && covVal !== ''`.
    /// Numbers (incl. `0`) and non-empty strings and `true` are "covered"; JSON
    /// null, `false`, and the empty string are not.
    static func isTruthyCoverage(_ value: WarrantyValue) -> Bool {
        switch value {
        case .null: false
        case let .bool(flag): flag
        case let .string(string): !string.isEmpty
        case .number: true
        }
    }
}
