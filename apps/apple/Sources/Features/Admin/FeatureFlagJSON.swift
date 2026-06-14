import Foundation

/// A typed JSON value — the native peer of the web `FeatureFlagValue = unknown`
/// (a flag value is stored as arbitrary JSON in Postgres). Modelled as an explicit
/// sum type so the editor can round-trip arbitrary JSON (object / array / scalar) and
/// the table can render a compact preview, exactly like the web `previewValue` /
/// `compact` helpers. Pure + Sendable so the model stays unit-testable off the main
/// actor.
public enum FlagJSONValue: Equatable, Hashable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    indirect case array([FlagJSONValue])
    indirect case object([String: FlagJSONValue])

    // MARK: - Parsing (web `JSON.parse(valueInput)`)

    /// Parses a JSON string into a value, tolerating top-level scalars (a flag value can
    /// be a bare `true` / `42` / `"x"`). Returns nil for empty or malformed input, which
    /// the editor surfaces as the inline parse error (web `parsed.ok === false`).
    public static func parse(_ raw: String) -> FlagJSONValue? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let data = trimmed.data(using: .utf8) else { return nil }
        guard let object = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) else {
            return nil
        }
        return FlagJSONValue(foundation: object)
    }

    /// Bridges a `JSONSerialization` value, distinguishing booleans from numbers via the
    /// CoreFoundation boolean type id (the canonical fix for the `NSNumber` bool/number
    /// ambiguity).
    init(foundation: Any) {
        if foundation is NSNull {
            self = .null
        } else if let number = foundation as? NSNumber {
            self = CFGetTypeID(number) == CFBooleanGetTypeID() ? .bool(number.boolValue) : .number(number.doubleValue)
        } else if let string = foundation as? String {
            self = .string(string)
        } else if let array = foundation as? [Any] {
            self = .array(array.map(FlagJSONValue.init(foundation:)))
        } else if let object = foundation as? [String: Any] {
            self = .object(object.mapValues(FlagJSONValue.init(foundation:)))
        } else {
            self = .null
        }
    }

    /// The Foundation representation used for pretty serialization. Booleans are bridged
    /// as `NSNumber` booleans so they serialize as `true` / `false`, not `1` / `0`.
    var foundation: Any {
        switch self {
        case .null: NSNull()
        case let .bool(value): NSNumber(value: value)
        case let .number(value): NSNumber(value: value)
        case let .string(value): value
        case let .array(items): items.map(\.foundation)
        case let .object(dict): dict.mapValues(\.foundation)
        }
    }

    // MARK: - Serialization (web `JSON.stringify`)

    /// Two-space pretty JSON (web `JSON.stringify(value, null, 2)`), used to seed the
    /// editor. Falls back to the compact form if Foundation cannot serialize the value.
    public var prettyJSON: String {
        guard let data = try? JSONSerialization.data(
            withJSONObject: foundation,
            options: [.prettyPrinted, .sortedKeys, .fragmentsAllowed]
        ), let string = String(data: data, encoding: .utf8) else {
            return compactJSON
        }
        return string
    }

    /// Compact JSON (web `JSON.stringify(value)`), hand-rolled so boolean / number
    /// formatting matches the web exactly and object keys are deterministically ordered.
    public var compactJSON: String {
        switch self {
        case .null: "null"
        case let .bool(value): value ? "true" : "false"
        case let .number(value): Self.numberString(value)
        case let .string(value): Self.quote(value)
        case let .array(items): "[" + items.map(\.compactJSON).joined(separator: ",") + "]"
        case let .object(dict):
            "{" + dict.keys.sorted().map { Self.quote($0) + ":" + dict[$0]!.compactJSON }.joined(separator: ",") + "}"
        }
    }

    // MARK: - Display previews (web `previewValue` / `compact`)

    /// Single-cell preview (web `previewValue`): scalars render bare / quoted, and an
    /// object / array longer than 120 chars is elided to `117…`.
    public var preview: String {
        let string = compactJSON
        switch self {
        case .array, .object: return string.count > 120 ? String(string.prefix(117)) + "…" : string
        default: return string
        }
    }

    /// Compact audit preview (web `compact`): a JSON `null` (or an absent value) renders
    /// as the em-dash, and anything longer than 60 chars is elided to `57…`.
    public static func compact(_ value: FlagJSONValue?) -> String {
        guard let value, value != .null else { return "—" }
        let string = value.compactJSON
        return string.count > 60 ? String(string.prefix(57)) + "…" : string
    }

    // MARK: - Primitives

    /// Mirrors JS `String(n)`: integral doubles drop the `.0`, others keep precision.
    static func numberString(_ value: Double) -> String {
        if value.rounded() == value, abs(value) < 1e15 { return String(Int64(value)) }
        return String(value)
    }

    /// Minimal JSON string escaping (quotes, backslash, control characters).
    static func quote(_ raw: String) -> String {
        var out = "\""
        for scalar in raw.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
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
        return out + "\""
    }
}
