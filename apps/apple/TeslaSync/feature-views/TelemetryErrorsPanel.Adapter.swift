//
//  TelemetryErrorsPanel.Adapter.swift
//  TeslaSync — P4 feature view · 0009 · TelemetryErrorsPanel (Apple)
//
//  The testable projection core for the Telemetry Errors panel — the SwiftUI
//  parity of features/admin/components/devtools/TelemetryErrorsPanel.tsx plus the
//  `extractTelemetryErrors` / `pickString` defensive normaliser it is fed by
//  (helpers.ts). Everything here is pure + dependency-free (no store, no bundle, no
//  rendered view) so the wire-shape handling, the JSON export, the timestamp
//  formatting, the state projection, and the VoiceOver summaries are all unit
//  tested in isolation.
//

import Foundation

// MARK: - Wire value (defensive, like the web `unknown` Tesla response)

/// A minimal, order-preserving JSON value used to model Tesla's untyped
/// fleet-telemetry-errors response. Tesla firmwares/proxies have been observed to
/// wrap, unwrap, or rename fields, so — exactly like the web `extractTelemetryErrors`
/// — the panel inspects an `unknown` value rather than a fixed Codable shape.
public indirect enum TelemetryJSON: Sendable, Equatable {
    case object([Member])
    case array([TelemetryJSON])
    case string(String)
    case number(Double)
    case bool(Bool)
    case null

    /// One key/value pair in an object, kept as a struct (not a tuple) so the
    /// enum synthesises `Equatable` and the original key order is preserved for
    /// the raw-response disclosure.
    public struct Member: Sendable, Equatable {
        public let key: String
        public let value: TelemetryJSON
        public init(_ key: String, _ value: TelemetryJSON) {
            self.key = key
            self.value = value
        }
    }

    /// The array payload when this value is an array (web `Array.isArray`).
    public var arrayValue: [TelemetryJSON]? {
        if case let .array(items) = self { return items }
        return nil
    }

    /// Object member lookup (web `record[key]`).
    public subscript(_ key: String) -> TelemetryJSON? {
        if case let .object(members) = self { return members.first { $0.key == key }?.value }
        return nil
    }

    /// String coercion mirroring web `pickString`: a non-empty string, or a number
    /// rendered minimally (integral numbers without a trailing `.0`, like JS
    /// `String(n)`). Booleans/null/containers do not coerce.
    public var coercedString: String? {
        switch self {
        case let .string(value):
            value.isEmpty ? nil : value
        case let .number(value):
            TelemetryJSON.minimalNumber(value)
        default:
            nil
        }
    }

    static func minimalNumber(_ value: Double) -> String {
        if value.rounded() == value, abs(value) < 1e15 {
            return String(Int64(value))
        }
        return String(value)
    }
}

// MARK: - Parsing (production source path)

public extension TelemetryJSON {
    /// Builds a `TelemetryJSON` from raw response bytes. Used by the production
    /// source to feed the panel; tests construct values directly. Returns `nil`
    /// only when the bytes are not valid JSON.
    static func parse(_ data: Data) -> TelemetryJSON? {
        guard let object = try? JSONSerialization.jsonObject(
            with: data, options: [.fragmentsAllowed]
        ) else { return nil }
        return convert(object)
    }

    private static func convert(_ value: Any) -> TelemetryJSON {
        switch value {
        case let dict as [String: Any]:
            // JSONSerialization drops key order; sort for a stable disclosure.
            return .object(dict.keys.sorted().map { Member($0, convert(dict[$0] ?? NSNull())) })
        case let list as [Any]:
            return .array(list.map(convert))
        case let number as NSNumber:
            if CFGetTypeID(number) == CFBooleanGetTypeID() { return .bool(number.boolValue) }
            return .number(number.doubleValue)
        case let string as String:
            return .string(string)
        default:
            return .null
        }
    }
}

// MARK: - Normalised row (web `TelemetryError`)

/// The UI-normalised error row after the defensive extractor unwraps Tesla's
/// envelope — the native port of the web `TelemetryError` (types.ts). `id` is the
/// composite `rowKey` (Tesla rows carry no id), keeping list identity collision-free.
public struct TelemetryErrorsPanelErrorRow: Identifiable, Equatable, Sendable {
    public let rowKey: String
    public let timestamp: String
    public let code: String
    public let message: String

    public var id: String {
        rowKey
    }

    public init(rowKey: String, timestamp: String, code: String, message: String) {
        self.rowKey = rowKey
        self.timestamp = timestamp
        self.code = code
        self.message = message
    }
}

// MARK: - Extractor (port of web `extractTelemetryErrors` + `pickString`)

/// Normalises Tesla's per-vehicle fleet-telemetry-errors response into UI rows,
/// handling every observed wire variant (envelope-wrapped, envelope-less,
/// array-only, snake/camel field names) without throwing — the alternative is the
/// silent empty-table bug. `ok == false` means "shape not recognised" so the panel
/// can offer the raw-response disclosure; `ok == true` with zero rows is the
/// healthy "vehicle reported no errors" state.
public enum TelemetryErrorsExtractor {
    private static let timestampKeys = ["reported_at", "timestamp", "created_at", "ts"]
    private static let codeKeys = ["error_code", "code", "name", "topic"]
    private static let messageKeys = ["error_message", "message", "body", "description"]

    public static func extract(_ data: TelemetryJSON?) -> (rows: [TelemetryErrorsPanelErrorRow], ok: Bool) {
        guard let data, case .object = data else {
            // Web: non-object (incl. arrays at root, scalars, null) → ([], false).
            if let array = data?.arrayValue { return (map(array), true) }
            return ([], false)
        }

        let candidates: [TelemetryJSON?] = [
            data["errors"],
            data["response"]?["errors"],
            data["response"],
            data
        ]
        guard let raw = candidates.compactMap({ $0?.arrayValue }).first else {
            return ([], false)
        }
        return (map(raw), true)
    }

    private static func map(_ raw: [TelemetryJSON]) -> [TelemetryErrorsPanelErrorRow] {
        raw.enumerated().map { index, row in
            let timestamp = pickString(row, timestampKeys)
            let code = pickString(row, codeKeys)
            let message = pickString(row, messageKeys)
            let vin = pickString(row, ["vin"])
            return TelemetryErrorsPanelErrorRow(
                rowKey: "\(timestamp)|\(code)|\(vin)|\(index)",
                timestamp: timestamp,
                code: code,
                message: message
            )
        }
    }

    /// First key whose value coerces to a non-empty string (web `pickString`).
    public static func pickString(_ row: TelemetryJSON, _ keys: [String]) -> String {
        for key in keys {
            if let value = row[key]?.coercedString { return value }
        }
        return ""
    }
}

// MARK: - JSON serialisation (web `JSON.stringify(value, null, 2)`)

/// Two-space pretty JSON emitter matching `JSON.stringify(value, null, 2)`, used
/// both for the raw-response disclosure and the row export so their output is
/// deterministic and unit-testable without `JSONSerialization`.
public extension TelemetryJSON {
    func prettyPrinted() -> String {
        render(indent: 0)
    }

    private func render(indent: Int) -> String {
        let pad = String(repeating: " ", count: indent)
        let childPad = String(repeating: " ", count: indent + 2)
        switch self {
        case let .object(members):
            guard !members.isEmpty else { return "{}" }
            let body = members
                .map { "\(childPad)\(TelemetryJSON.escape($0.key)): \($0.value.render(indent: indent + 2))" }
                .joined(separator: ",\n")
            return "{\n\(body)\n\(pad)}"
        case let .array(items):
            guard !items.isEmpty else { return "[]" }
            let body = items
                .map { "\(childPad)\($0.render(indent: indent + 2))" }
                .joined(separator: ",\n")
            return "[\n\(body)\n\(pad)]"
        case let .string(value):
            return TelemetryJSON.escape(value)
        case let .number(value):
            return TelemetryJSON.minimalNumber(value)
        case let .bool(value):
            return value ? "true" : "false"
        case .null:
            return "null"
        }
    }

    /// JSON string escaping (quotes, backslash, the named control escapes, and the
    /// `\u`-prefixed four-hex-digit escape for the remaining C0 controls) — parity
    /// with `JSON.stringify`.
    static func escape(_ string: String) -> String {
        var out = "\""
        for scalar in string.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\u{08}": out += "\\b"
            case "\u{0C}": out += "\\f"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            default:
                if scalar.value < 0x20 {
                    out += String(format: "\\u%04x", scalar.value)
                } else {
                    out.unicodeScalars.append(scalar)
                }
            }
        }
        out += "\""
        return out
    }
}

// MARK: - Export (web download Blob)

/// The JSON export payload for the "Download Errors" affordance — the rows as a
/// pretty JSON array plus the `telemetry-errors-{vin|all}.json` filename (web
/// `JSON.stringify(errors, null, 2)` + the anchor `download` attribute).
public struct TelemetryErrorsExport: Sendable, Equatable {
    public let json: String
    public let filename: String

    public init(json: String, filename: String) {
        self.json = json
        self.filename = filename
    }

    public static func make(rows: [TelemetryErrorsPanelErrorRow], vin: String) -> TelemetryErrorsExport {
        let array = TelemetryJSON.array(rows.map { row in
            .object([
                .init("rowKey", .string(row.rowKey)),
                .init("timestamp", .string(row.timestamp)),
                .init("code", .string(row.code)),
                .init("message", .string(row.message))
            ])
        })
        let slug = vin.isEmpty ? "all" : vin
        return TelemetryErrorsExport(json: array.prettyPrinted(), filename: "telemetry-errors-\(slug).json")
    }
}

// MARK: - Timestamp formatting (web `formatDateTime`)

/// Locale-aware timestamp formatter for the table's first column (web
/// `formatDateTime`): a parseable ISO date renders as a medium date + short time;
/// an empty or unparseable value renders as the em-dash sentinel.
public enum TelemetryErrorsFormat {
    public static let dash = "—"

    public static func timestamp(
        _ raw: String,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String {
        guard !raw.isEmpty, let date = parse(raw) else { return dash }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    private static func parse(_ raw: String) -> Date? {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = iso.date(from: raw) { return date }
        iso.formatOptions = [.withInternetDateTime]
        if let date = iso.date(from: raw) { return date }
        if let seconds = Double(raw) { return Date(timeIntervalSince1970: seconds) }
        return nil
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver strings for the panel rows + badges. Pure + public so the
/// spoken content is asserted without rendering the view.
public enum TelemetryErrorsAccessibility {
    public static func rowSummary(for row: TelemetryErrorsPanelErrorRow) -> String {
        [
            TelemetryErrorsFormat.timestamp(row.timestamp),
            row.code.isEmpty ? TelemetryErrorsFormat.dash : row.code,
            row.message.isEmpty ? TelemetryErrorsFormat.dash : row.message
        ].joined(separator: ", ")
    }
}
