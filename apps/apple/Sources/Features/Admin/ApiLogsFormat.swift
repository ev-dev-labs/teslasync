import Foundation

// MARK: - Display-boundary formatters (web `numberFormat.ts` / `DateTime` / `JsonViewer`)

/// Pure, testable display formatters for the API Logs surface. API-call metadata carries
/// no SI units, so these only format at the display boundary (numbers, latency, the UTC
/// timestamp, pretty JSON, and the i18next `{{token}}` interpolations the web page uses).
public enum ApiLogsFormat {
    /// The em-dash shown for nil / unrenderable values (web `'—'` fallback).
    public static let emptyValue = "—"

    /// Web `fmtInt` — grouped integer (e.g. `1,234`). en-US so tests are deterministic.
    public static func int(_ value: Int) -> String {
        formatter(fractionDigits: 0).string(from: NSNumber(value: value)) ?? String(value)
    }

    /// Web `fmtNumber` — grouped decimal with up to one fractional digit.
    public static func number(_ value: Double) -> String {
        formatter(fractionDigits: 1).string(from: NSNumber(value: value)) ?? String(value)
    }

    /// Web `${fmtNumber(error_rate)}%`.
    public static func percent(_ value: Double) -> String {
        "\(number(value))%"
    }

    /// Web `${fmtInt(avg_duration_ms)}ms` (aggregate) — grouped integer + `ms`.
    public static func durationMs(_ value: Int) -> String {
        "\(int(value))ms"
    }

    /// Web `${log.duration_ms}ms` (per row) — raw integer + `ms`, no grouping.
    public static func rowDurationMs(_ value: Int) -> String {
        "\(value)ms"
    }

    /// Web `<DateTime value={log.ts} in="utc" />` — `MMM d, yyyy, h:mm a` in UTC;
    /// em-dash for nil / invalid.
    public static func dateTime(_ iso: String?) -> String {
        guard let iso, let date = parseISO(iso) else { return emptyValue }
        let dateFormatter = DateFormatter()
        dateFormatter.locale = Locale(identifier: "en_US")
        dateFormatter.timeZone = TimeZone(identifier: "UTC")
        dateFormatter.dateFormat = "MMM d, yyyy, h:mm a"
        return dateFormatter.string(from: date)
    }

    /// Web `JsonViewer` pretty-print: 2-space JSON, falling back to the raw string when it
    /// does not parse; em-dash for nil / empty.
    public static func prettyJSON(_ raw: String?) -> String {
        guard let raw, !raw.isEmpty else { return emptyValue }
        guard let data = raw.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data),
              let pretty = try? JSONSerialization.data(
                  withJSONObject: object,
                  options: [.prettyPrinted, .sortedKeys]
              ),
              let string = String(data: pretty, encoding: .utf8)
        else {
            return raw
        }
        return string
    }

    /// Replaces i18next `{{token}}` markers (with optional surrounding spaces) in a
    /// resolved catalog template. Lets the page reuse the web string keys verbatim
    /// (`apiLogs.showing` / `apiLogs.pageOf` / `apiLogs.noData` / `apiLogs.serviceCount`)
    /// instead of forking the catalog into printf-style formats.
    public static func interpolate(_ template: String, _ values: [String: String]) -> String {
        var result = template
        for (key, value) in values {
            for token in ["{{\(key)}}", "{{ \(key) }}"] {
                result = result.replacingOccurrences(of: token, with: value)
            }
        }
        return result
    }

    /// Web `handleExport` — `JSON.stringify(logs, null, 2)` of the current page's rows,
    /// emitting the snake_case wire keys so the exported file matches the web download.
    public static func exportJSON(_ logs: [ApiCallLog]) -> String {
        guard !logs.isEmpty else { return "[]" }
        let array: [[String: Any]] = logs.map { log in
            [
                "id": log.id,
                "ts": log.ts,
                "vehicle_id": log.vehicleID as Any? ?? NSNull(),
                "service": log.service,
                "http_method": log.httpMethod,
                "endpoint": log.endpoint,
                "status_code": log.statusCode as Any? ?? NSNull(),
                "duration_ms": log.durationMs,
                "error_message": log.errorMessage as Any? ?? NSNull(),
                "rate_limited": log.rateLimited,
                "request_body": log.requestBody as Any? ?? NSNull(),
                "response_body": log.responseBody as Any? ?? NSNull()
            ]
        }
        guard let data = try? JSONSerialization.data(
            withJSONObject: array,
            options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        ),
            let string = String(data: data, encoding: .utf8)
        else {
            return "[]"
        }
        return string
    }

    /// Web `new Date(value).toISOString()` — UTC RFC-3339 used for the snake_case query.
    public static func iso(_ date: Date) -> String {
        let isoFormatter = ISO8601DateFormatter()
        isoFormatter.formatOptions = [.withInternetDateTime]
        return isoFormatter.string(from: date)
    }

    /// Tolerant ISO-8601 parse (with + without fractional seconds), mirroring the sibling
    /// Audit Log formatter.
    static func parseISO(_ iso: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: iso) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: iso)
    }

    private static func formatter(fractionDigits: Int) -> NumberFormatter {
        let numberFormatter = NumberFormatter()
        numberFormatter.locale = Locale(identifier: "en_US")
        numberFormatter.numberStyle = .decimal
        numberFormatter.minimumFractionDigits = 0
        numberFormatter.maximumFractionDigits = fractionDigits
        numberFormatter.usesGroupingSeparator = true
        return numberFormatter
    }
}
