import Foundation

/// Pure, testable display formatters ported from the web `lib/numberFormat.ts`
/// (`formatBytes`, `fmtInt`) and `lib/dateFormat.ts` (`formatDurationMsCompact`,
/// `formatRelative`, absolute `formatDateTime`). Applied only at the display boundary —
/// the model stores raw wire values (bytes, ms, ISO strings) and never pre-formats.
public enum BackupRestoreFormat {
    /// The em-dash fallback shared by every formatter (web `'—'`).
    public static let emptyValue = "—"

    private static let groupingFormatter: NumberFormatter = {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 0
        formatter.locale = Locale(identifier: "en_US")
        return formatter
    }()

    /// Web `fmtInt(v)` — grouped integer (e.g. `12,345`).
    public static func int(_ value: Int) -> String {
        groupingFormatter.string(from: NSNumber(value: value)) ?? String(value)
    }

    /// Web `formatBytes(bytes)` — 1024-based B/KB/MB/GB with one decimal.
    public static func bytes(_ bytes: Int64) -> String {
        let value = Double(bytes)
        let kilo = 1024.0
        let mega = kilo * 1024
        let giga = mega * 1024
        if value < kilo { return "\(bytes) B" }
        if value < mega { return "\(oneDecimal(value / kilo)) KB" }
        if value < giga { return "\(oneDecimal(value / mega)) MB" }
        return "\(oneDecimal(value / giga)) GB"
    }

    /// Web `formatDurationMsCompact(ms)` — `Nms` / `N.Ns` / `N.Nm`.
    public static func durationMs(_ ms: Int) -> String {
        if ms < 1000 { return "\(ms)ms" }
        if ms < 60000 { return "\(oneDecimal(Double(ms) / 1000))s" }
        return "\(oneDecimal(Double(ms) / 60000))m"
    }

    /// Web `formatRelative(iso)` — `just now` / `Nm ago` / `Nh ago` / `Nd ago`, falling
    /// back to an absolute medium date at ≥ 7 days. `now` is injectable for testing.
    public static func relative(_ iso: String?, now: Date = Date()) -> String {
        guard let iso, let date = parseISO(iso) else { return emptyValue }
        let seconds = Int(now.timeIntervalSince(date))
        if seconds < 60 { return "just now" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m ago" }
        let hours = minutes / 60
        if hours < 24 { return "\(hours)h ago" }
        let days = hours / 24
        if days < 7 { return "\(days)d ago" }
        return mediumDate(date)
    }

    /// Web `<TimeStamp>` absolute format: en-US `MMM d, yyyy, h:mm a`; em-dash on nil/invalid.
    public static func dateTime(_ iso: String?) -> String {
        guard let iso, let date = parseISO(iso) else { return emptyValue }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.dateFormat = "MMM d, yyyy, h:mm a"
        return formatter.string(from: date)
    }

    // MARK: - Primitives

    private static func oneDecimal(_ value: Double) -> String {
        String(format: "%.1f", value)
    }

    private static func mediumDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.dateFormat = "MMM d, yyyy"
        return formatter.string(from: date)
    }

    /// Tolerant ISO-8601 parse (with + without fractional seconds), mirroring the sibling
    /// admin formatters.
    static func parseISO(_ iso: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: iso) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: iso)
    }
}
