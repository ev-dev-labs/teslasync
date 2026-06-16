import Foundation

/// Pure display-boundary formatters for the Trip-Replay surface (web `fmtDuration`,
/// `fmtDriveTime`, `fmtNumber`, `fmtInt`, and the `'—'` fallbacks). Unit-bearing values
/// (distance, speed, temperature) are formatted by the SI-aware `Units` facade in the views;
/// this enum only covers the replay-clock + unit-free numbers, so it stays SwiftUI-free and
/// unit-tested. Every helper returns the em dash for absent / non-finite input (never "nan"),
/// matching the web `'—'` sentinel.
public enum TripReplayPageFormat {
    /// The em dash shown for a missing value (web `'—'`).
    public static let emptyValue = "—"

    /// Web `fmtDuration(ms)`: `H:MM:SS` once an hour is reached, else `MM:SS`. Non-finite /
    /// negative input collapses to `00:00` so an upstream data bug surfaces as a sane fallback
    /// instead of leaking "NaN:NaN" into the transport readout.
    public static func duration(milliseconds: Double) -> String {
        guard milliseconds.isFinite, milliseconds > 0 else { return "00:00" }
        let totalSeconds = Int(milliseconds / 1000)
        let hours = totalSeconds / 3600
        let minutes = (totalSeconds % 3600) / 60
        let seconds = totalSeconds % 60
        let mm = String(format: "%02d", minutes)
        let ss = String(format: "%02d", seconds)
        return hours > 0 ? "\(hours):\(mm):\(ss)" : "\(mm):\(ss)"
    }

    /// Web `fmtDriveTime(min)`: `Xh Ym` once an hour is reached, else `Ym`.
    public static func driveTime(minutes: Double) -> String {
        guard minutes.isFinite else { return emptyValue }
        let hours = Int((minutes / 60).rounded(.down))
        let mins = Int(minutes.truncatingRemainder(dividingBy: 60).rounded())
        return hours > 0 ? "\(hours)h \(mins)m" : "\(mins)m"
    }

    /// Web `fmtNumber(value, decimals)`: en-US grouping, fixed fraction digits.
    public static func number(_ value: Double, decimals: Int = 1) -> String {
        guard value.isFinite else { return emptyValue }
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.\(decimals)f", value)
    }

    /// Web `fmtInt(value)`: a grouped whole number, or the em dash when absent / non-finite.
    public static func int(_ value: Double?) -> String {
        guard let value, value.isFinite else { return emptyValue }
        return number(value, decimals: 0)
    }

    /// Web `${fmtInt(value)}%`.
    public static func percent(_ value: Double?) -> String {
        guard let value, value.isFinite else { return emptyValue }
        return "\(number(value, decimals: 0))%"
    }
}
