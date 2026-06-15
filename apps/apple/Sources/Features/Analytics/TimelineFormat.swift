import Foundation

/// Pure display-boundary formatters for the Timeline surface (web `fmtInt` / `fmtPercent` /
/// `formatDateTime` / `formatHoursFromSeconds` / `formatDurationFromSeconds`). Durations are SI
/// seconds from the model; formatting to "Xh Ym" happens only here. Each returns an em dash for
/// non-finite input (never "nan").
public enum TimelineFormat {
    /// The em dash shown for a missing value (web `'—'`).
    public static let emptyValue = "—"

    /// Web `fmtInt(value)` — en-US grouping, no fraction digits.
    public static func integer(_ value: Double) -> String {
        guard value.isFinite else { return emptyValue }
        return number(value, decimals: 0)
    }

    /// Web `fmtPercent(value, 1)` — one fraction digit with a trailing percent sign.
    public static func percent(_ value: Double, decimals: Int = 1) -> String {
        guard value.isFinite else { return emptyValue }
        return "\(number(value, decimals: decimals))%"
    }

    /// Web `formatHoursFromSeconds`: floors to whole hours, appends minutes only when ≥ 30s of the
    /// remaining minute. `0h*` collapses to a bare `Nm`.
    public static func hoursFromSeconds(_ seconds: Double) -> String {
        guard seconds.isFinite else { return emptyValue }
        let hoursTotal = seconds / 3600
        let wholeHours = hoursTotal.rounded(.down)
        let minutes = (hoursTotal - wholeHours) * 60
        if wholeHours == 0 {
            return "\(integer(minutes))m"
        }
        let hourLabel = integer(wholeHours)
        return minutes >= 0.5 ? "\(hourLabel)h \(integer(minutes))m" : "\(hourLabel)h"
    }

    /// Web `formatDurationFromSeconds`: sub-minute intervals render as whole seconds, otherwise
    /// fall through to the hours/minutes form.
    public static func durationFromSeconds(_ seconds: Double) -> String {
        guard seconds.isFinite else { return emptyValue }
        if seconds < 60 {
            return "\(integer(seconds))s"
        }
        return hoursFromSeconds(seconds)
    }

    /// Web `formatDateTime(ts)` — locale-aware medium date + short time, the table's Time column.
    public static func dateTime(_ date: Date) -> String {
        dateTimeFormatter.string(from: date)
    }

    /// A state's distribution tooltip line (web
    /// `${state}: ${formatDurationFromSeconds(total)} (${fmtPercent(percentage, 1)})`).
    public static func distributionTooltip(state: String, totalSeconds: Double, percentage: Double) -> String {
        "\(state): \(durationFromSeconds(totalSeconds)) (\(percent(percentage)))"
    }

    // MARK: - Internals

    /// Web `fmtNumber(value, decimals)` — en-US grouping, fixed fraction digits.
    static func number(_ value: Double, decimals: Int) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.\(decimals)f", value)
    }

    private static let dateTimeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter
    }()
}
