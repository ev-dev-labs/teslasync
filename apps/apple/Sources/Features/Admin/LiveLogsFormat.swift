import Foundation

/// Pure, Foundation-only ports of the web `LiveLogsPage` helpers (`formatTime`,
/// `extractMessage`, `extractFields`, `extractVehicleId`, `downloadFilename`,
/// `eventToText`) plus the catalog interpolation for the stat captions. Kept SwiftUI-free
/// so the projections are unit-tested in isolation and the view holds no parsing/formatting
/// logic. Log payloads are unit-agnostic control-plane text (no SI conversion applies).
public enum LiveLogsFormat {
    /// Web absent-value sentinel (`liveLogs.table.noLevel` default `'—'`).
    public static let dash = "—"

    // MARK: - Time (web `formatTime` — HH:mm:ss.SSS, millisecond precision)

    /// Web `formatTime(ms)` — `HH:mm:ss.SSS` so bursty streams stay distinguishable. The
    /// calendar is injectable (tests pin UTC); the default mirrors the web's local clock.
    public static func time(_ date: Date, calendar: Calendar = .current) -> String {
        let parts = calendar.dateComponents([.hour, .minute, .second, .nanosecond], from: date)
        let milliseconds = (parts.nanosecond ?? 0) / 1_000_000
        return String(
            format: "%02d:%02d:%02d.%03d",
            parts.hour ?? 0,
            parts.minute ?? 0,
            parts.second ?? 0,
            milliseconds
        )
    }

    // MARK: - Entry projection (web `buildLogEvent` + `extract*`)

    /// Builds a `LiveLogEntry` from a raw zerolog JSON line, decoding the level, message,
    /// structured fields, and vehicle id (web `buildLogEvent` + `extractMessage` /
    /// `extractFields` / `extractVehicleId`). Non-JSON payloads fall back to the raw text as
    /// the message with `info` level + no fields, exactly like the web.
    public static func makeEntry(seq: Int, payload: String, receivedAt: Date) -> LiveLogEntry {
        let parsed = parseObject(payload)
        return LiveLogEntry(
            seq: seq,
            receivedAt: receivedAt,
            payload: payload,
            level: detectLevel(parsed),
            message: extractMessage(parsed, raw: payload),
            fields: extractFields(parsed),
            vehicleID: extractVehicleID(parsed)
        )
    }

    /// Parses a payload into a JSON object, or `nil` when it is not a JSON dictionary
    /// (web `tryParseJSON` returning `null`).
    public static func parseObject(_ raw: String) -> [String: Any]? {
        guard
            let data = raw.data(using: .utf8),
            let object = try? JSONSerialization.jsonObject(with: data),
            let dictionary = object as? [String: Any]
        else { return nil }
        return dictionary
    }

    /// Web `detectLevel` — the `level` field, defaulting to `info` (matches zerolog).
    public static func detectLevel(_ parsed: [String: Any]?) -> String {
        if let level = parsed?["level"] as? String, !level.isEmpty { return level }
        return "info"
    }

    /// Web `extractMessage` — `message` ?? `msg` ?? the raw line.
    public static func extractMessage(_ parsed: [String: Any]?, raw: String) -> String {
        if let message = parsed?["message"] as? String { return message }
        if let message = parsed?["msg"] as? String { return message }
        return raw
    }

    /// Web `extractFields` — every entry except `level`/`time`/`message`/`msg`, skipping
    /// nulls, stringified. Sorted by key for a stable native render order.
    public static func extractFields(_ parsed: [String: Any]?) -> [LiveLogField] {
        guard let parsed else { return [] }
        let skip: Set = ["level", "time", "message", "msg"]
        var out: [LiveLogField] = []
        for key in parsed.keys.sorted() {
            guard !skip.contains(key), let value = parsed[key], !(value is NSNull) else { continue }
            out.append(LiveLogField(key: key, value: stringify(value)))
        }
        return out
    }

    /// Web `extractVehicleId` — the first of `vehicle_id` / `vehicleID` / `vehicleId` that is
    /// a non-empty string or a number.
    public static func extractVehicleID(_ parsed: [String: Any]?) -> String? {
        guard let parsed else { return nil }
        for key in ["vehicle_id", "vehicleID", "vehicleId"] {
            guard let value = parsed[key], !(value is NSNull) else { continue }
            if let string = value as? String, !string.isEmpty { return string }
            if let number = value as? NSNumber, !isBoolean(number) { return numberString(number) }
        }
        return nil
    }

    /// Stringifies a decoded JSON value (web field-render `typeof` ladder): strings verbatim,
    /// numbers/booleans coerced, nested values re-serialized, else a sentinel.
    public static func stringify(_ value: Any) -> String {
        if let string = value as? String { return string }
        if let number = value as? NSNumber {
            if isBoolean(number) { return number.boolValue ? "true" : "false" }
            return numberString(number)
        }
        if let data = try? JSONSerialization.data(withJSONObject: value) {
            return String(data: data, encoding: .utf8) ?? "[unserialisable]"
        }
        return "[unserialisable]"
    }

    private static func isBoolean(_ number: NSNumber) -> Bool {
        CFGetTypeID(number) == CFBooleanGetTypeID()
    }

    private static func numberString(_ number: NSNumber) -> String {
        let value = number.doubleValue
        if value.rounded() == value, abs(value) < 1e15 {
            return String(number.int64Value)
        }
        return String(value)
    }

    // MARK: - Download (web `downloadFilename` / `eventToText`)

    /// Web `downloadFilename` timestamp: an ISO-8601 stamp with `:` → `-` and the fractional
    /// seconds trimmed (`2026-06-15T10-10-32Z`). Injectable `now` for tests.
    public static func timestamp(now: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        formatter.timeZone = TimeZone(identifier: "UTC")
        return formatter.string(from: now).replacingOccurrences(of: ":", with: "-")
    }

    /// The download filename (web `t('liveLogs.filename', { ts })`), resolved from the catalog
    /// template `teslasync-logs-%1$@.txt`.
    public static func filename(now: Date) -> String {
        String(format: String(localized: "translation.liveLogs.filename"), timestamp(now: now))
    }

    /// Web `eventToText` — `[HH:mm:ss.SSS] LEVEL <raw payload>`.
    public static func eventToText(_ entry: LiveLogEntry, calendar: Calendar = .current) -> String {
        "[\(time(entry.receivedAt, calendar: calendar))] \(entry.level.uppercased()) \(entry.payload)"
    }

    /// The body of the downloaded `.txt` (web `filteredEvents.map(eventToText).join('\n')`).
    public static func downloadBody(_ entries: [LiveLogEntry], calendar: Calendar = .current) -> String {
        entries.map { eventToText($0, calendar: calendar) }.joined(separator: "\n")
    }

    // MARK: - Grep (web `grepPattern` — case-insensitive RegExp)

    /// Web `grepPattern` — a case-insensitive regex, or `nil` when the trimmed expression is
    /// empty or invalid (the web swallows the `SyntaxError` and renders no highlight).
    public static func grepRegex(_ grep: String) -> NSRegularExpression? {
        let trimmed = grep.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return try? NSRegularExpression(pattern: trimmed, options: [.caseInsensitive])
    }

    // MARK: - Stat captions (web i18next `{{count}}` → catalog `%1$@`)

    /// Resolves a `count` stat caption (`liveLogs.stats.*` → `"… %1$@"`) with the grouped
    /// count. Used for Buffered / Received / Server drops. The key is dynamic, so it is
    /// resolved with `NSLocalizedString` (the catalog table) before `%1$@` substitution.
    public static func countText(_ catalogKey: String, count: Int, locale: Locale = .current) -> String {
        String(format: NSLocalizedString(catalogKey, comment: ""), grouped(count, locale: locale))
    }

    /// Resolves the footer caption `liveLogs.stats.bufferedMax` (`"Buffered: %1$@ / max %2$@"`).
    public static func bufferedMaxText(count: Int, max: Int, locale: Locale = .current) -> String {
        String(
            format: String(localized: "translation.liveLogs.stats.bufferedMax"),
            grouped(count, locale: locale),
            grouped(max, locale: locale)
        )
    }

    /// A locale-grouped integer (web `Intl`-formatted `{{count}}`).
    public static func grouped(_ value: Int, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }
}
