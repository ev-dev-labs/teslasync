//
//  FeatureToggles.Adapter.swift
//  TeslaSync — P4 feature view · 0205 · FeatureToggles (Apple)
//
//  The testable projection core for the Tesla "Feature Flags" surface — the
//  faithful port of features/settings/components/FeatureToggles.tsx. Everything
//  here is pure and dependency-free (Foundation only) so it can be unit-tested
//  without a bundle or a rendered view.
//
//  Web parity notes:
//    • The web component reads `featureConfig.data` (a `Record<string, unknown>`)
//      and, per entry, derives `{ key, enabled, details }`:
//        - isObj   = typeof value === 'object' && value !== null   (arrays count;
//                    JSON null does NOT — it is a primitive here).
//        - enabled = Boolean(isObj ? value.enabled : value)        (JS truthiness:
//                    "", 0, NaN, null, undefined → false; "false", [], {} → true).
//        - details = isObj ? Object.entries(value).filter(k !== 'enabled')
//                      .map(`${k}: ${JSON.stringify(v)}`).join(', ') : null.
//      `FeatureConfigValue` + `FeatureTogglesAdapter` reproduce those three rules
//      exactly (see the executed adapter tests).
//    • The web iterates `Object.entries(data)` in insertion order; the native
//      payload decodes through an unordered dictionary, so entries (and the nested
//      detail keys) sort by key for a deterministic, sensible UI — the same
//      deterministic-ordering choice the sibling FlagsTable / AlertsSection
//      surfaces made.
//    • The web `entries.length > 0 ? <grid> : <EmptyState>` split becomes the
//      resolved `.content` vs `.empty` phase, widened with the loading / error /
//      stale / offline envelope the P4 surface contract requires (the web query
//      itself has no freshness concept — it is supplied by the bound source).
//

import Foundation

// MARK: - Feature config value (web `unknown`, stored as JSON)

/// A closed JSON value mirroring the heterogeneous feature-config value the web
/// source reads as `unknown`. Modeled as a `Sendable`/`Equatable` enum so the
/// projection can reproduce the web `Boolean(...)` truthiness and the
/// `JSON.stringify(...)` detail rendering exactly while flowing through the
/// state-holder seam.
public enum FeatureConfigValue: Sendable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case array([FeatureConfigValue])
    case object([String: FeatureConfigValue])
    case null
}

public extension FeatureConfigValue {
    /// Projects a decoded JSON payload (`JSONSerialization` output / `Any`) into
    /// the closed value, so the production source can bind the real cached config.
    /// A `nil` payload (an absent key) is treated as JSON `null` (both are falsy).
    static func from(json: Any?) -> FeatureConfigValue {
        switch json {
        case .none, is NSNull:
            return .null
        case let number as NSNumber:
            // CFBoolean bridges to NSNumber; keep booleans distinct from numbers.
            if CFGetTypeID(number) == CFBooleanGetTypeID() { return .bool(number.boolValue) }
            return .number(number.doubleValue)
        case let text as String:
            return .string(text)
        case let array as [Any]:
            return .array(array.map { FeatureConfigValue.from(json: $0) })
        case let dict as [String: Any]:
            return .object(dict.mapValues { FeatureConfigValue.from(json: $0) })
        default:
            return .null
        }
    }

    /// Whether the web treats this value as an object for the `isObj` branch:
    /// `typeof value === 'object' && value !== null`. Arrays are objects in JS;
    /// JSON `null` and primitives are not.
    var isObjectLike: Bool {
        switch self {
        case .object, .array: true
        default: false
        }
    }

    /// JavaScript `Boolean(value)` truthiness. Falsy: `false`, `0`/`-0`/`NaN`,
    /// `""`, `null`/`undefined`. Truthy: every non-empty string (INCLUDING
    /// `"false"`), every array, and every object — even empty ones.
    var isTruthy: Bool {
        switch self {
        case .null:
            false
        case let .bool(flag):
            flag
        case let .number(number):
            number != 0 && !number.isNaN
        case let .string(text):
            !text.isEmpty
        case .array, .object:
            true
        }
    }

    /// The `Foundation` object for `JSONSerialization` (web `JSON.stringify`).
    var foundationObject: Any {
        switch self {
        case .null:
            NSNull()
        case let .bool(flag):
            flag
        case let .number(number):
            number
        case let .string(text):
            text
        case let .array(items):
            items.map(\.foundationObject)
        case let .object(dict):
            dict.mapValues(\.foundationObject)
        }
    }

    /// Web `String(number)` — whole values render without a fractional part.
    static func numberString(_ value: Double) -> String {
        guard value.isFinite else { return value.isNaN ? "NaN" : (value > 0 ? "Infinity" : "-Infinity") }
        if value.rounded() == value, abs(value) < 1e15 { return String(Int(value)) }
        return String(value)
    }
}

// MARK: - JSON.stringify (web detail value rendering)

/// The `JSON.stringify(value)` port used to render each detail value in
/// `${k}: ${JSON.stringify(v)}`. Primitives stringify directly; containers
/// serialize to compact JSON (keys sorted for determinism, slashes unescaped).
public enum FeatureTogglesJSON {
    /// Renders `value` exactly as the web `JSON.stringify(value)` does for the
    /// kinds a feature-config detail can hold.
    public static func encode(_ value: FeatureConfigValue) -> String {
        switch value {
        case .null:
            "null"
        case let .bool(flag):
            flag ? "true" : "false"
        case let .number(number):
            // JSON.stringify maps non-finite numbers to null.
            number.isFinite ? FeatureConfigValue.numberString(number) : "null"
        case let .string(text):
            quoted(text)
        case .array, .object:
            compact(value) ?? "null"
        }
    }

    /// `JSON.stringify(string)` — wraps in quotes with JSON escaping.
    static func quoted(_ text: String) -> String {
        var out = "\""
        for scalar in text.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\u{08}": out += "\\b"
            case "\u{09}": out += "\\t"
            case "\u{0A}": out += "\\n"
            case "\u{0C}": out += "\\f"
            case "\u{0D}": out += "\\r"
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

    /// Compact JSON for containers: no spaces, slashes unescaped, keys sorted for
    /// a deterministic preview. Returns `nil` only for an unserializable value.
    static func compact(_ value: FeatureConfigValue) -> String? {
        let object = value.foundationObject
        guard JSONSerialization.isValidJSONObject(object) else { return nil }
        guard
            let data = try? JSONSerialization.data(
                withJSONObject: object,
                options: [.sortedKeys, .withoutEscapingSlashes]
            )
        else { return nil }
        return String(bytes: data, encoding: .utf8)
    }
}

// MARK: - Feature toggle row (web per-entry `{ key, enabled, details }`)

/// One row of the feature-config table — the native parity of the web
/// `featureEntries` element: the feature key, its resolved enabled flag, and the
/// optional details summary (`nil` for primitive values, web `details = null`).
public struct FeatureToggleEntry: Sendable, Equatable, Identifiable {
    public var key: String
    public var enabled: Bool
    /// The web `details` string, or `nil` for a primitive value (rendered "—").
    public var details: String?

    public var id: String {
        key
    }

    public init(key: String, enabled: Bool, details: String?) {
        self.key = key
        self.enabled = enabled
        self.details = details
    }
}

// MARK: - Projection (the cached → view-model adapter)

/// The projected table content the view renders — the ordered entries plus the
/// resolved-empty helper the render phase switches over.
public struct FeatureTogglesProjection: Sendable, Equatable {
    /// Every feature entry, sorted by key (the deterministic native order).
    public var entries: [FeatureToggleEntry]

    public init(entries: [FeatureToggleEntry]) {
        self.entries = entries
    }

    /// Whether any feature resolved (web `featureEntries.length > 0`).
    public var hasData: Bool {
        !entries.isEmpty
    }

    /// The count of enabled features (header / accessibility summary).
    public var enabledCount: Int {
        entries.lazy.filter(\.enabled).count
    }

    /// The resolved-but-empty projection (web `featureEntries.length === 0`).
    public static let empty = FeatureTogglesProjection(entries: [])
}

/// Builds the `FeatureTogglesProjection` from the cached config map — the faithful
/// port of the web `useMemo` that maps `Object.entries(data)` to `featureEntries`.
public enum FeatureTogglesAdapter {
    /// Projects the cached `Record<string, unknown>` into ordered entries,
    /// reproducing the web `isObj` / `Boolean(enabled)` / `details` derivation.
    public static func project(_ config: [String: FeatureConfigValue]) -> FeatureTogglesProjection {
        let entries = config
            .sorted { $0.key < $1.key }
            .map { key, value in entry(key: key, value: value) }
        return FeatureTogglesProjection(entries: entries)
    }

    /// Derives one entry from a raw config value (web per-entry transform).
    static func entry(key: String, value: FeatureConfigValue) -> FeatureToggleEntry {
        let isObj = value.isObjectLike
        let enabledSource = isObj ? member(value, "enabled") : value
        let enabled = enabledSource.isTruthy
        let details = isObj ? detailsString(for: value) : nil
        return FeatureToggleEntry(key: key, enabled: enabled, details: details)
    }

    /// Web `value.enabled` — the `"enabled"` member of an object, or `.null`
    /// (web `undefined`, falsy) when absent / for an array.
    static func member(_ value: FeatureConfigValue, _ name: String) -> FeatureConfigValue {
        if case let .object(dict) = value { return dict[name] ?? .null }
        return .null
    }

    /// Web `Object.entries(value).filter(k !== 'enabled').map(`${k}: ${JSON.stringify(v)}`).join(', ')`.
    /// Object keys sort for determinism; array entries keep their index order.
    static func detailsString(for value: FeatureConfigValue) -> String {
        detailEntries(for: value)
            .filter { $0.0 != "enabled" }
            .map { "\($0.0): \(FeatureTogglesJSON.encode($0.1))" }
            .joined(separator: ", ")
    }

    /// The `Object.entries(value)` pairs: object keys sorted; array elements keyed
    /// by their numeric index (web `Object.entries([...])` yields `"0"`, `"1"`, …).
    static func detailEntries(for value: FeatureConfigValue) -> [(String, FeatureConfigValue)] {
        switch value {
        case let .object(dict):
            dict.sorted { $0.key < $1.key }.map { ($0.key, $0.value) }
        case let .array(items):
            items.enumerated().map { (String($0.offset), $0.element) }
        default:
            []
        }
    }
}

// MARK: - Render phase + load envelope (web content/empty split, widened)

/// What the surface should render. The web source only distinguishes
/// content-vs-empty (`featureEntries.length`); the loading / error envelope
/// around it (the P4 states) is supplied by the bound source.
public enum FeatureTogglesPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case content
}

/// The bound source's load status for the feature-config query, projected into a
/// phase by `FeatureTogglesPhaseResolver`.
public enum FeatureTogglesLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live freshness (ADR-013): drives the freshness chip + the cached-data banner
/// so cached config is clearly labeled while reconnecting / offline.
public enum FeatureTogglesConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// Resolves the render phase from the load status + whether any entry is known.
/// Cached entries stay visible behind a refresh / error; only the initial fetch
/// shows the loading chrome and only a resolved-empty config shows the empty copy.
public enum FeatureTogglesPhaseResolver {
    public static func phase(status: FeatureTogglesLoadStatus, hasData: Bool) -> FeatureTogglesPhase {
        switch status {
        case .loading:
            hasData ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            hasData ? .content : .empty
        case let .failed(message):
            hasData ? .content : .error(message)
        }
    }
}

// MARK: - Formatting (web `formatDateTime`)

/// Locale-aware date+time formatting, the native parity of the web
/// `formatDateTime(fetched_at)` (numeric year, short month, numeric day, 2-digit
/// hour + minute). Returns `nil` for an absent timestamp so the "Synced" chip
/// stays hidden, matching the web `{featureConfig?.fetched_at && …}` guard.
public enum FeatureTogglesFormat {
    public static func synced(at date: Date?, locale: Locale = .current) -> String? {
        guard let date else { return nil }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the
/// dependency-free core so it is reachable from the projection's unit tests.
public enum FeatureTogglesSurface {
    public static let slug = "FeatureToggles"
}
