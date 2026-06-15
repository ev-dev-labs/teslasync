import Foundation

/// Pure display-boundary formatters for the Quick Glance surface (web `fmtNumber` + the
/// inline `value ?? '—'` fallbacks and the `convertDistanceFromSI` / `convertTempFromSI`
/// renders). Battery percent is unit-independent, so it formats directly; the absolute
/// range (metres) and interior temperature (Celsius) convert through the shared SI `Units`
/// facade at the render boundary (ADR-005) — nothing non-SI is stored or computed. Every
/// helper returns an em dash for `nil` / non-finite input (never "nan"), matching the web
/// `'—'` sentinel.
public enum GlanceFormat {
    /// The em dash shown for a missing value (web `'—'`).
    public static let emptyValue = "—"

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

    /// Web `rated_range != null ? `${fmtNumber(convertDistanceFromSI(rated_range,
    /// distanceUnit), 0)} ${distanceUnit}` : '—'`. SI metres → the user's distance unit
    /// (via the shared facade), no fraction digits, with a trailing unit suffix.
    public static func range(_ meters: Double?, _ prefs: UnitPreferences) -> String {
        guard let meters else { return emptyValue }
        let display = Units.convertDistance(meters, prefs)
        guard display.isFinite else { return emptyValue }
        return "\(number(display, decimals: 0)) \(prefs.distance)"
    }

    /// Web `inside_temp != null ? `${fmtNumber(convertTempFromSI(inside_temp, tempUnit),
    /// 1)}${tempUnit}` : '—'`. SI Celsius → the user's temperature unit (via the shared
    /// facade), one fraction digit, with the unit suffix appended (no separating space).
    public static func temperature(_ celsius: Double?, _ prefs: UnitPreferences) -> String {
        guard let celsius else { return emptyValue }
        let display = Units.convertTemperature(celsius, prefs)
        guard display.isFinite else { return emptyValue }
        return "\(number(display, decimals: 1))\(prefs.temperature)"
    }

    /// The relative-time label the freshness chip shows (web `FreshnessIndicator` renders
    /// the time elapsed since the last successful fetch). Locale-aware + data-derived, so
    /// it carries no hardcoded UI literal.
    public static func relativeTime(since timestamp: Date?, now: Date = Date()) -> String? {
        guard let timestamp else { return nil }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: timestamp, relativeTo: now)
    }

    /// Web `FreshnessIndicator` staleness — values older than the 2-minute window are
    /// flagged stale (ADR-013) but stay visible.
    public static func isStale(_ timestamp: Date?, now: Date = Date(), window: TimeInterval = 120) -> Bool {
        guard let timestamp else { return false }
        return now.timeIntervalSince(timestamp) > window
    }
}
