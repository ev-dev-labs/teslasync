import Foundation
import SwiftUI

/// Pure display-boundary formatters for the Anomaly Detection surface (web `fmtNumber` + the
/// `typeLabel` map + the `TimeStamp` renderer). The anomaly numbers are raw signal-space values —
/// there is no SI unit preference on this page (web uses `fmtNumber` directly) — so these only do
/// grouping/precision, relative-time, and the categorical severity/type/icon mappings. Each
/// numeric helper returns an em dash for non-finite input (never "nan").
public enum AnomalyDashboardFormat {
    /// The em dash shown for a missing/invalid value (web `'—'`).
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

    /// Web integer count (`fmtNumber(n, 0)` / the raw stat-card numbers).
    public static func integer(_ value: Int) -> String {
        number(Double(value), decimals: 0)
    }

    /// Web `fmtNumber(a.value, 2)` / `fmtNumber(a.baseline, 2)` — two-decimal signal value.
    public static func signalValue(_ value: Double) -> String {
        number(value, decimals: 2)
    }

    /// Web `${fmtNumber(a.z_score, 1)}σ` — the one-decimal z-score with the sigma suffix.
    public static func zScore(_ value: Double) -> String {
        "\(number(value, decimals: 1))σ"
    }

    // MARK: - Type label (web `typeLabel`)

    /// Web `typeLabel(type)`: `z_score → Statistical`, `range → Range`, `trend → Trend`, else the
    /// raw type. The known tiers resolve from the string catalog; unknown values pass through.
    public static func typeLabel(_ type: String) -> String {
        switch type {
        case "z_score": String(localized: "anomaly.type.statistical", defaultValue: "Statistical")
        case "range": String(localized: "anomaly.type.range", defaultValue: "Range")
        case "trend": String(localized: "anomaly.type.trend", defaultValue: "Trend")
        default: type
        }
    }

    // MARK: - Severity / status tone (web `severityVariant` / `statusColor`)

    /// Web `severityVariant(s)`: `critical → danger`, `warning → warning`, else `success`.
    public static func tone(for severity: AnomalySeverity) -> TSTone {
        switch severity {
        case .critical: .danger
        case .warning: .warning
        case .info, .other: .success
        }
    }

    /// Subtle row tint for the timeline (web `bg-red-500/[0.05]` / `bg-neon-amber/[0.05]` / neutral).
    /// `nil` keeps the default surface for the benign/info tier.
    public static func rowTone(for severity: AnomalySeverity) -> TSTone? {
        switch severity {
        case .critical: .danger
        case .warning: .warning
        case .info, .other: nil
        }
    }

    // MARK: - Health icon (web `HEALTH_ICONS`)

    /// Web `HEALTH_ICONS[category] ?? Shield` mapped to SF Symbols (battery → Battery, tires → Car,
    /// motors → Zap, hvac → Wind, charging → Activity, unknown → Shield).
    public static func healthIcon(for category: String) -> String {
        switch category.lowercased() {
        case "battery": "minus.plus.batteryblock"
        case "tires": "car.fill"
        case "motors": "bolt.fill"
        case "hvac": "wind"
        case "charging": "bolt.car.fill"
        default: "shield.lefthalf.filled"
        }
    }

    // MARK: - Timestamp (web `TimeStamp value={a.detected_at}`)

    /// Web `TimeStamp` visible body (default `auto` → relative, e.g. "2h ago"). Tolerant ISO-8601
    /// parse (with + without fractional seconds), mirroring the Admin formatters; em dash when the
    /// value is missing or unparseable (web renders `'—'` with no tooltip).
    public static func relativeTimestamp(_ iso: String, now: Date = Date()) -> String {
        guard let date = parseISO(iso) else { return emptyValue }
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: now)
    }

    /// Web `TimeStamp` tooltip alternate (the absolute instant) — surfaced as the accessibility
    /// value so VoiceOver users get the precise time the relative chip summarizes.
    public static func absoluteTimestamp(_ iso: String) -> String {
        guard let date = parseISO(iso) else { return emptyValue }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.dateFormat = "MMM d, yyyy, h:mm a"
        return formatter.string(from: date)
    }

    /// Tolerant ISO-8601 parse (with + without fractional seconds), mirroring `ApiLogsFormat`.
    static func parseISO(_ iso: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: iso) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: iso)
    }
}
