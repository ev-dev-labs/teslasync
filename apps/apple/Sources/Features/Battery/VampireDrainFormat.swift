import Foundation

/// Pure display-boundary formatters for the Vampire Drain surface (web `fmtNumber` + the
/// inline `${value}%/hr` / `${value} kWh` / `${value}%` / `${value}h` / `${value}/100`
/// formatting and `formatDate` / `formatDateTime`). Every measurement here (percent, %/hr,
/// parked hours, kWh, score) is unit-system-independent, so it formats directly with the
/// web's fixed fraction digits (no user-unit conversion — ADR-005). Each helper returns an
/// em dash for non-finite input (never "nan").
public enum VampireDrainFormat {
    /// The em dash shown for a missing/non-finite value (web `'—'`).
    public static let emptyValue = "—"

    /// Web `fmtNumber(value, decimals)`: en-US grouping with fixed fraction digits.
    public static func number(_ value: Double, decimals: Int) -> String {
        guard value.isFinite else { return emptyValue }
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.\(decimals)f", value)
    }

    /// Web `${fmtNumber(avg_drain_rate, 2)}%/hr` — the Avg-Drain-Rate metric value.
    public static func ratePerHour(_ value: Double) -> String {
        "\(number(value, decimals: 2))%/hr"
    }

    /// Web `${fmtNumber(total_energy_lost, 1)} kWh` — the Total-Phantom-Loss metric value.
    public static func kilowattHours(_ value: Double) -> String {
        "\(number(value, decimals: 1)) kWh"
    }

    /// Web `${fmtNumber(worst_drain_pct, 1)}%` / `${fmtNumber(drain_pct, 1)}%` — a one-dp
    /// percentage (the Worst-Session metric + the table Loss% badge).
    public static func lossPercent(_ value: Double) -> String {
        "\(number(value, decimals: 1))%"
    }

    /// Web `${fmtNumber(drain_score, 0)}/100` — the Drain-Score metric value.
    public static func score(_ value: Double) -> String {
        "\(number(value, decimals: 0))/100"
    }

    /// Web `${fmtNumber(start_battery, 0)}%` / `${fmtNumber(end_battery, 0)}%` — a whole-
    /// percent battery level (the table Start% / End% cells).
    public static func batteryPercent(_ value: Double) -> String {
        "\(number(value, decimals: 0))%"
    }

    /// Web `fmtNumber(drain_rate_pct_hr, 2)` — the bare two-dp rate (table Rate %/hr cell,
    /// no unit suffix, exactly as the web column renders it).
    public static func rate(_ value: Double) -> String {
        number(value, decimals: 2)
    }

    /// Web `${fmtNumber(duration_hours, 1)}h` — the table Duration cell.
    public static func durationHours(_ value: Double) -> String {
        "\(number(value, decimals: 1))h"
    }

    /// Web `formatDateTime(raw)` — a medium date + short time for the sessions table.
    /// Unparseable strings pass through unchanged (never "nan"/blank).
    public static func dateTime(_ raw: String) -> String {
        guard let date = parse(raw) else { return raw }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    /// Web `formatDate(raw)` — a short calendar date for the chart x-axis tick labels.
    public static func dateShort(_ raw: String) -> String {
        guard let date = parse(raw) else { return raw }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.dateStyle = .short
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }

    private static func parse(_ raw: String) -> Date? {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = iso.date(from: raw) { return date }
        iso.formatOptions = [.withInternetDateTime]
        if let date = iso.date(from: raw) { return date }
        let day = DateFormatter()
        day.locale = Locale(identifier: "en_US_POSIX")
        day.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        if let date = day.date(from: raw) { return date }
        day.dateFormat = "yyyy-MM-dd"
        return day.date(from: raw)
    }
}
