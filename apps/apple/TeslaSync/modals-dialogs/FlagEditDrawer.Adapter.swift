//
//  FlagEditDrawer.Adapter.swift
//  TeslaSync — P4 modal / dialog · 0019 · FlagEditDrawer (Apple)
//
//  The testable, dependency-free projection core for the feature-flag edit / create drawer — the
//  faithful port of features/admin/components/feature-flags/FlagEditDrawer.tsx. Everything here is
//  pure Foundation so the JSON value parse (web `JSON.parse`), the pretty-printed seed (web
//  `defaultValueJson`), the save gate (web `canSave`), the resolved title (web `editTitle` /
//  `createTitle`), the value-error copy (web `parsed.error`), and the resolved visibility / body
//  phase are all unit-tested without a bundle, a view, or persistence.
//
//  Web parity notes:
//    • `editing = initial !== null` → `FlagEditMode` derived from `FlagEditRequest.initial`.
//    • `defaultValueJson(initial)` (`JSON.stringify(value, null, 2)`, `''` when absent / on throw) →
//      `defaultValueJSON(_:)`.
//    • `parsed` (`'' → valueEmpty`, `JSON.parse → value`, `catch → valueInvalid {{msg}}`) →
//      `parseValue(_:)` returning the closed `FlagEditValueParse`, with `valueErrorMessage(_:_:)`
//      composing the localized copy the web inlines in `parsed.error`.
//    • `keyValid` / `reasonValid` (`trim().length > 0`) → `isNonBlank(_:)`.
//    • `canSave = parsed.ok && keyValid && reasonValid && !saving` → `canSave(...)`.
//    • All `t()` keys + English fallbacks → `Keys` / `Fallbacks` (P1/S10).
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, in the dependency-free core so
/// the projection's unit tests can reach it.
public enum FlagEditDrawerSurface {
    public static let slug = "FlagEditDrawer"
}

// MARK: - Edit mode (web `editing = initial !== null`)

/// Whether the drawer edits an existing flag or creates a new one (web `editing`). Drives the title,
/// the key-field immutability, and the immutable helper note.
public enum FlagEditMode: Sendable, Equatable {
    case create
    case edit
}

// MARK: - JSON value (web `FeatureFlagValue = unknown`, parsed via `JSON.parse`)

/// A closed JSON value mirroring the heterogeneous flag value the web reads as `unknown`. Named with
/// the `FlagEdit` prefix so it never collides with the sibling `FlagValue` (FlagsTable) in the single
/// app module (engineering guideline #9). `Sendable`/`Equatable` so the parsed payload flows through
/// the controller seam and is asserted in tests.
public indirect enum FlagEditJSONValue: Sendable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case array([FlagEditJSONValue])
    case object([String: FlagEditJSONValue])
    case null
}

public extension FlagEditJSONValue {
    /// Projects a decoded `JSONSerialization` payload (`Any?`) into the closed value so a production
    /// source can seed the drawer from a cached flag.
    static func from(json: Any?) -> FlagEditJSONValue {
        guard let json else { return .null }
        switch json {
        case is NSNull:
            return .null
        case let number as NSNumber:
            // CFBoolean bridges to NSNumber; keep booleans distinct from numbers.
            if CFGetTypeID(number) == CFBooleanGetTypeID() { return .bool(number.boolValue) }
            return .number(number.doubleValue)
        case let text as String:
            return .string(text)
        case let array as [Any]:
            return .array(array.map { FlagEditJSONValue.from(json: $0) })
        case let dict as [String: Any]:
            var result: [String: FlagEditJSONValue] = [:]
            for (key, value) in dict {
                result[key] = FlagEditJSONValue.from(json: value)
            }
            return .object(result)
        default:
            return .null
        }
    }

    /// The `Foundation` object for `JSONSerialization`.
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
}

// MARK: - Parse result (web `parsed = { ok, value?, error? }`)

/// The outcome of parsing the value textarea (web `parsed`): blank input, an invalid-JSON failure
/// carrying the parser detail (web `e.message`), or a valid value. Pure + `Equatable` so the parse
/// is unit-tested deterministically; the localized display copy is composed by `valueErrorMessage`.
public enum FlagEditValueParse: Sendable, Equatable {
    case empty
    case invalid(String)
    case valid(FlagEditJSONValue)

    /// Web `parsed.ok` — gates the Save button.
    public var isValid: Bool {
        if case .valid = self { return true }
        return false
    }

    /// Web `parsed.value` — the parsed JSON forwarded to `onSave`, else `nil`.
    public var value: FlagEditJSONValue? {
        if case let .valid(value) = self { return value }
        return nil
    }
}

// MARK: - Seed + request (web props)

/// The existing flag the drawer seeds from (web `initial: FeatureFlagEntry`). `value` is the closed
/// JSON the drawer pretty-prints into the textarea (web `defaultValueJson`).
public struct FlagEditInitial: Sendable, Equatable {
    public let key: String
    public let value: FlagEditJSONValue

    public init(key: String, value: FlagEditJSONValue) {
        self.key = key
        self.value = value
    }
}

/// One delivered editor request — the projection of the web props (`initial` + `saving`). A `nil`
/// `initial` is the web "create new" mode; `saving` mirrors the parent-driven `saving` prop that
/// disables the form and spins the Save button.
public struct FlagEditRequest: Sendable, Equatable {
    public let initial: FlagEditInitial?
    public let saving: Bool

    public init(initial: FlagEditInitial? = nil, saving: Bool = false) {
        self.initial = initial
        self.saving = saving
    }

    /// Web `editing = initial !== null`.
    public var mode: FlagEditMode {
        initial == nil ? .create : .edit
    }

    /// The seeded flag key, or empty in create mode.
    public var initialKey: String {
        initial?.key ?? ""
    }
}

// MARK: - Load status / render phase / freshness

/// The bound source's delivery status for the editor request. The request is normally pushed
/// synchronously; the loading / failed arms exist so an intentionally-presented drawer renders real
/// chrome rather than a blank box.
public enum FlagEditLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-state freshness (ADR-013): drives the freshness chip + cached-data banner so a drawer
/// assembled from a cached flag is clearly labeled while reconnecting / offline.
public enum FlagEditConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// What the surface renders at the top level (web `Drawer open`): hidden when there is nothing to
/// edit, else the presented drawer (whose body switches over `phase`).
public enum FlagEditVisibility: Sendable, Equatable {
    case hidden
    case presented
}

/// What the presented drawer body renders. The web only ever shows the form; the loading / empty /
/// error envelopes are added so an intentionally-presented drawer is never a blank box.
public enum FlagEditPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case content
}

// MARK: - Projection core (pure)

/// The dependency-free resolution shared by the model and tests: the JSON parse, the pretty-printed
/// seed, the non-blank predicate, the save gate, the resolved title, the value-error copy, and the
/// resolved visibility / body phase / inline failure.
public enum FlagEditDrawerProjection {
    /// The localization keys for every `t()` call in the web source (P1/S10).
    public enum Keys {
        public static let editTitle = "admin.flags.drawer.editTitle"
        public static let createTitle = "admin.flags.drawer.createTitle"
        public static let save = "admin.flags.drawer.save"
        public static let cancel = "common.cancel"
        public static let keyLabel = "admin.flags.editor.keyLabel"
        public static let keyPrompt =
            "admin.flags.editor.keyPlaceholder" // parity:allow web i18n key (FlagEditDrawer.tsx)
        public static let keyImmutable = "admin.flags.editor.keyImmutable"
        public static let valueLabel = "admin.flags.editor.valueLabel"
        public static let valueEmpty = "admin.flags.editor.valueEmpty"
        public static let valueInvalid = "admin.flags.editor.valueInvalid"
        public static let reasonLabel = "admin.flags.editor.reasonLabel"
        public static let reasonPrompt =
            "admin.flags.editor.reasonPlaceholder" // parity:allow web i18n key (FlagEditDrawer.tsx)
    }

    /// The English fallbacks the web inlines as the second `t()` argument.
    public enum Fallbacks {
        public static let editTitle = "Edit flag \"{{key}}\""
        public static let createTitle = "Create flag"
        public static let save = "Save flag"
        public static let cancel = "Cancel"
        public static let keyLabel = "Flag key"
        public static let keyPrompt = "feature.dlq.replay_enabled"
        public static let keyImmutable = "Flag keys are immutable once created. Delete + re-create to rename."
        public static let valueLabel = "Value (JSON)"
        public static let valueEmpty = "Value is required."
        public static let valueInvalid = "Invalid JSON: {{msg}}"
        public static let reasonLabel = "Reason"
        public static let reasonPrompt = "Why this change? (logged in audit)"
    }

    /// The seeded textarea contents (web `defaultValueJson`): empty in create mode, else the value
    /// pretty-printed (`JSON.stringify(value, null, 2)`), falling back to empty on a serialize throw.
    public static func defaultValueJSON(_ initial: FlagEditInitial?) -> String {
        guard let initial else { return "" }
        return prettyJSON(initial.value) ?? ""
    }

    /// Verbatim port of the web `parsed` memo: blank input is `.empty` (web `valueEmpty`), valid JSON
    /// is `.valid(value)`, and a parse failure is `.invalid(detail)` carrying the parser message the
    /// web surfaces via `{{msg}}`. Accepts top-level fragments, matching `JSON.parse`.
    public static func parseValue(_ raw: String) -> FlagEditValueParse {
        if raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return .empty
        }
        guard let data = raw.data(using: .utf8) else {
            return .invalid("Invalid encoding")
        }
        do {
            let object = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
            return .valid(FlagEditJSONValue.from(json: object))
        } catch {
            let nsError = error as NSError
            let detail = (nsError.userInfo[NSDebugDescriptionErrorKey] as? String) ?? nsError.localizedDescription
            return .invalid(detail)
        }
    }

    /// The localized value-field error (web `parsed.error`): the required-value copy when blank, the
    /// `Invalid JSON: {{msg}}` template with the parser detail substituted when invalid, else `nil`.
    public static func valueErrorMessage(
        _ parse: FlagEditValueParse,
        localize: (String, String) -> String
    ) -> String? {
        switch parse {
        case .valid:
            nil
        case .empty:
            localize(Keys.valueEmpty, Fallbacks.valueEmpty)
        case let .invalid(detail):
            localize(Keys.valueInvalid, Fallbacks.valueInvalid)
                .replacingOccurrences(of: "{{msg}}", with: detail)
        }
    }

    /// Web `keyInput.trim().length > 0` / `reason.trim().length > 0`.
    public static func isNonBlank(_ text: String) -> Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Verbatim port of `canSave = parsed.ok && keyValid && reasonValid && !saving`.
    public static func canSave(parseValid: Bool, keyValid: Bool, reasonValid: Bool, saving: Bool) -> Bool {
        parseValid && keyValid && reasonValid && !saving
    }

    /// The drawer title: the `Edit flag "{{key}}"` template with the seeded key substituted, else the
    /// localized `Create flag`.
    public static func title(mode: FlagEditMode, initialKey: String, localize: (String, String) -> String) -> String {
        switch mode {
        case .edit:
            localize(Keys.editTitle, Fallbacks.editTitle)
                .replacingOccurrences(of: "{{key}}", with: initialKey)
        case .create:
            localize(Keys.createTitle, Fallbacks.createTitle)
        }
    }

    /// The presented drawer's body phase. A usable request shows the form; otherwise the loading /
    /// empty / error envelope renders so the drawer is never blank.
    public static func resolvePhase(status: FlagEditLoadStatus, hasRequest: Bool) -> FlagEditPhase {
        switch status {
        case .loading:
            hasRequest ? .content : .loading
        case .loaded:
            hasRequest ? .content : .empty
        case let .failed(message):
            hasRequest ? .content : .error(message)
        }
    }

    /// The drawer presents when a request is delivered; `pinned` keeps an intentionally-presented
    /// drawer on screen so its loading / empty / error chrome renders (engineering guideline #6).
    public static func resolveVisibility(hasRequest: Bool, pinned: Bool) -> FlagEditVisibility {
        (hasRequest || pinned) ? .presented : .hidden
    }

    /// The failure message kept above the form while a delivered request survives a failed reload.
    public static func inlineFailure(status: FlagEditLoadStatus, hasRequest: Bool) -> String? {
        guard hasRequest, case let .failed(message) = status else { return nil }
        return message
    }

    /// `JSON.stringify(value, null, 2)` — pretty JSON (2-space indent), sorted keys for determinism,
    /// slashes unescaped, top-level fragments allowed. Returns `nil` on the web `catch` path.
    static func prettyJSON(_ value: FlagEditJSONValue) -> String? {
        let object = value.foundationObject
        guard
            let data = try? JSONSerialization.data(
                withJSONObject: object,
                options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes, .fragmentsAllowed]
            )
        else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }
}
