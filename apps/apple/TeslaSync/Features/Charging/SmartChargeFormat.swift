//
//  SmartChargeFormat.swift
//  TeslaSync — P4-APPLE P7 · page:charging/SmartCharge (Apple) — Display formatting
//
//  Locale-aware number / percent / currency / time formatting applied only at the
//  render boundary — the native peers of the web page's `fmtNumber`, `fmtPercent`,
//  `useFormatting().formatCurrency`, and `useDateFormat().formatTime` /
//  `formatDateTime`, plus `RateTimeline.formatHour`. Pure + dependency-free.
//

import Foundation

/// Display formatting for the Smart Charge page. Values are pre-converted; these
/// helpers only render — never compute physical units.
enum SmartChargeFormat {
    /// Web `fmtNumber(value, fractionDigits)` — grouped, fixed fraction digits.
    static func number(_ value: Double, fractionDigits: Int = 1) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        return formatter.string(from: NSNumber(value: value))
            ?? String(format: "%.\(fractionDigits)f", value)
    }

    /// Web `fmtPercent(value, digits)` — `fmtNumber(value, digits)` + "%".
    static func percent(_ value: Double, fractionDigits: Int = 0) -> String {
        "\(number(value, fractionDigits: fractionDigits))%"
    }

    /// Web `useFormatting().formatCurrency(amount)` — `$` + grouped 2-dp amount.
    static func currency(_ amount: Double) -> String {
        "\(currencySymbol)\(number(amount, fractionDigits: 2))"
    }

    /// The configured currency symbol (web `settings.currency_symbol`, default `$`).
    static let currencySymbol = "$"

    /// A rate rendered as cents per kWh, e.g. `18.0¢/kWh` (web sublabel).
    static func centsPerKwh(_ cents: Double) -> String {
        "\(number(cents, fractionDigits: 1))¢/kWh"
    }

    /// Web `useDateFormat().formatTime` — short, locale-aware time of day.
    static func time(_ date: Date) -> String {
        date.formatted(date: .omitted, time: .shortened)
    }

    /// Web `useDateFormat().formatDateTime` — abbreviated date + short time.
    static func dateTime(_ date: Date) -> String {
        date.formatted(date: .abbreviated, time: .shortened)
    }

    /// Web `RateTimeline.formatHour` — compact 12-hour label (`12a` / `3p`).
    static func hourLabel(_ hour: Int) -> String {
        if hour == 0 || hour == 24 { return "12a" }
        if hour == 12 { return "12p" }
        return hour < 12 ? "\(hour)a" : "\(hour - 12)p"
    }

    /// Web `defaultDepartBy()` — tomorrow at 07:30 local time.
    static func defaultDepartBy(now: Date = Date(), calendar: Calendar = .current) -> Date {
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: now) ?? now
        return calendar.date(
            bySettingHour: 7, minute: 30, second: 0, of: tomorrow
        ) ?? tomorrow
    }
}
