import Foundation
import SwiftUI

/// Pure display-boundary formatters + status derivation for the Maintenance surface (web `fmtNumber`,
/// `formatDate`/`formatDateTime`, `formatCurrency`, `computeProgress`, `statusFromPct`,
/// `progressBarColor`, `categoryBgClass`). SI/domain values come from the model; all string shaping
/// happens here — never in the model or the view body. Each numeric helper returns an em dash for
/// non-finite input (never "nan").
public enum MaintenanceFormat {
    /// The em dash shown for a missing value (web `'—'`).
    public static let emptyValue = "—"

    // MARK: - Numbers (web `fmtNumber(value, decimals)`)

    /// Web `fmtNumber(value, decimals)`: en-US grouping, fixed fraction digits.
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

    /// Web `fmtNumber(value, 0)`.
    public static func integer(_ value: Double) -> String {
        number(value, decimals: 0)
    }

    // MARK: - Mileage (web `${fmtNumber(miles, 0)} ${t('mi')}`)

    /// Maintenance odometer miles rendered verbatim with the hardcoded `mi` label (web behavior —
    /// service-log odometer readings are shown in miles regardless of the user's distance unit).
    public static func mileageLabel(_ miles: Double) -> String {
        "\(integer(miles)) \(String(localized: "mi"))"
    }

    // MARK: - Currency (web `formatCurrency(amount, 0)` / `<Currency>`)

    /// Web `formatCurrency(amount, decimals)` → a currency-symbol prefix + en-US grouped number.
    public static func currency(_ amount: Double, symbol: String, decimals: Int = 0) -> String {
        guard amount.isFinite else { return emptyValue }
        return "\(symbol)\(number(amount, decimals: decimals))"
    }

    /// Web `${formatCurrency(annual, 0)}/yr` — the annualized-cost card value.
    public static func annualCurrency(_ amount: Double, symbol: String) -> String {
        "\(currency(amount, symbol: symbol))/yr"
    }

    // MARK: - Dates (web `formatDate` / `formatDateTime`)

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.dateFormat = "MMM d, yyyy"
        return formatter
    }()

    private static let dateTimeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter
    }()

    /// Web `formatDate(d)` — "MMM d, yyyy" (due dates, projections).
    public static func date(_ date: Date) -> String {
        dayFormatter.string(from: date)
    }

    /// Web `formatDateTime(d)` — locale date + time (Service Records table date column).
    public static func dateTime(_ date: Date) -> String {
        dateTimeFormatter.string(from: date)
    }

    // MARK: - Category (web `categoryBgClass` tone + capitalized label)

    /// Web `c.charAt(0).toUpperCase() + c.slice(1)` — capitalized category label.
    public static func capitalized(_ category: String) -> String {
        guard let first = category.first else { return category }
        return first.uppercased() + category.dropFirst()
    }

    /// Web `CATEGORY_COLORS` mapped to the shared semantic tone (purple/cyan fold into accent/info).
    public static func categoryTone(_ category: String) -> TSTone {
        switch category.lowercased() {
        case "brakes": .danger
        case "battery": .success
        case "filters", "alignment": .warning
        case "tires", "wipers": .accent
        case "fluids": .info
        default: .neutral
        }
    }
}

// MARK: - Progress + derived status (web `computeProgress` / `statusFromPct` / `progressBarColor`)

public extension MaintenanceFormat {
    /// Web `computeProgress(item)` → a 0…100 completion percentage from the available interval data
    /// (miles-since-service, months-since-service, or current/due ratio), clamped. `now` is injected
    /// so the months branch stays pure/testable (web `Date.now()`).
    static func progress(_ item: MaintenanceItem, now: Date = Date()) -> Double {
        if let intervalMiles = item.intervalMiles, intervalMiles > 0, let last = item.lastServiceMileage {
            let elapsed = item.currentMileage - last
            return clampPercent(elapsed / intervalMiles * 100)
        }
        if let months = item.intervalMonths, months > 0, let lastDate = item.lastServiceDate {
            let intervalSeconds = Double(months) * 30.44 * 24 * 60 * 60
            let elapsed = now.timeIntervalSince(lastDate)
            return clampPercent(elapsed / intervalSeconds * 100)
        }
        if let due = item.dueMileage, due > 0 {
            return clampPercent(item.currentMileage / due * 100)
        }
        return 0
    }

    /// Web `statusFromPct(pct)`: ≥90 overdue, ≥70 soon, else good.
    static func statusFromPct(_ pct: Double) -> MaintenanceStatus {
        if pct >= 90 { return .overdue }
        if pct >= 70 { return .soon }
        return .good
    }

    /// Web `derivedStatus` — completed items keep `completed`; otherwise derive from progress.
    static func derivedStatus(_ item: MaintenanceItem, now: Date = Date()) -> MaintenanceStatus {
        item.status == .completed ? .completed : statusFromPct(progress(item, now: now))
    }

    /// Web `progressBarColor(pct)` mapped to the shared tone (≥90 danger, ≥70 warning, else success).
    static func progressTone(_ pct: Double) -> TSTone {
        if pct >= 90 { return .danger }
        if pct >= 70 { return .warning }
        return .success
    }

    /// Web `${fmtNumber(pct, 0)}%` progress label.
    static func percentLabel(_ pct: Double) -> String {
        "\(integer(pct))%"
    }

    /// 0…1 fraction for `TSMetricBar` (clamped).
    static func progressFraction(_ pct: Double) -> Double {
        min(max(pct, 0), 100) / 100
    }

    private static func clampPercent(_ value: Double) -> Double {
        guard value.isFinite else { return 0 }
        return min(100, max(0, value))
    }
}
