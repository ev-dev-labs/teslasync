import Foundation

/// Pure display-boundary formatters for the Locations surface (web `fmtNumber` / `useUnits` /
/// `formatDate` + the chart label truncation). SI seconds come from the model; conversion to the
/// user's duration unit happens here via the shared KMP `Units` facade (P1/S5) — never in the
/// model. Each returns an em dash for non-finite input (never "nan").
public enum LocationsFormat {
    /// The em dash shown for a missing value (web `'—'`).
    public static let emptyValue = "—"

    // MARK: - Counts (web `fmtNumber(value, 0)` / bare integers)

    /// Web integer rendering with en-US grouping (visit counts, place/city counts).
    public static func integer(_ value: Int) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.maximumFractionDigits = 0
        return formatter.string(from: NSNumber(value: value)) ?? "\(value)"
    }

    // MARK: - Duration (web `formatDuration(seconds)` via `useUnits`)

    /// SI seconds → the user's duration unit (web `formatDuration(s)` — Total-Time, Avg-Visit, and
    /// the per-row total/avg captions). Routes through the shared `Units` facade so every platform
    /// shows identical strings.
    public static func duration(_ seconds: Double, _ prefs: UnitPreferences) -> String {
        guard seconds.isFinite else { return emptyValue }
        return Units.formatDuration(seconds, prefs)
    }

    // MARK: - Chart Y value (web `+(fmtNumber(total_duration_s / 3600, 1))`)

    /// Web `total_duration_s / 3600` rounded to one decimal — the hours value plotted by the
    /// Top-Locations-by-Time bar chart.
    public static func hours(_ seconds: Double) -> Double {
        guard seconds.isFinite else { return 0 }
        return (seconds / 3600 * 10).rounded() / 10
    }

    // MARK: - Chart category label (web `name.length > 25 ? name.slice(0,22) + '…' : name`)

    /// Web bar-chart label truncation: addresses longer than 25 characters are clipped to 22 plus
    /// an ellipsis so the category axis stays legible.
    public static func chartLabel(_ addressName: String) -> String {
        if addressName.count > 25 {
            return String(addressName.prefix(22)) + "…"
        }
        return addressName
    }

    // MARK: - Dates (web `formatDate(last_visited)` → "Apr 4, 2026")

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.dateFormat = "MMM d, yyyy"
        return formatter
    }()

    /// Web `formatDate(loc.last_visited)` — "MMM d, yyyy" calendar date in the per-row caption.
    public static func date(_ date: Date) -> String {
        dayFormatter.string(from: date)
    }
}
