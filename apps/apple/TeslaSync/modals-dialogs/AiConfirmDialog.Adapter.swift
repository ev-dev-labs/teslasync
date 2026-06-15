//
//  AiConfirmDialog.Adapter.swift
//  TeslaSync — P4 modal / dialog · 0001 · ConfirmDialog (Apple)
//
//  The testable, dependency-free projection core for the AI tool-use confirmation dialog — the
//  faithful port of web/src/components/ai/ConfirmDialog.tsx (exported `AiConfirmDialog`). The web
//  source is a focus-trapped `Modal` that gates a dispatcher-paused, LLM-proposed tool call: it shows
//  what the assistant wants to do (an intro that differs for a mutating vs read-only tool), the tool
//  name rendered verbatim in a monospaced block, the tool's optional human description, the proposed
//  arguments pretty-printed as `JSON.stringify(args ?? {}, null, 2)`, and Cancel / Approve affordances
//  that both disable (and the Approve spins) while the parent's continuation POST is in flight.
//
//  Naming note (collision resolution): the prompt's native filename `ConfirmDialog.*` is already owned
//  by sibling prompt 0012 (the generic destructive-action `components/ui/ConfirmDialog.tsx`, public
//  symbols `ConfirmDialog` / `ConfirmDialogModel`, slug "ConfirmDialog"). To avoid overwriting that
//  surface and to avoid duplicate Swift symbols inside module TeslaSync, the AI tool-use dialog ships
//  under `AiConfirmDialog.*` / `AiConfirm*` (matching the web export `AiConfirmDialog`) with slug
//  "AiConfirmDialog". No 0012 file is touched.
//
//  Everything here is pure Foundation so the intro selection, the argument pretty-printer, the resolved
//  visibility / body phase, the inline-failure envelope, and the dialog copy are all unit-testable
//  without a bundle, a view, or the network.
//
//  Web parity notes:
//    • `t('ai.confirm.title', 'Approve Helix action')`            → `titleText(localize:)`.
//    • `tool.mutates ? intro.mutates : intro.read`                → `introText(mutates:localize:)`.
//    • `t('ai.confirm.toolLabel'/'argsLabel'/'run'/'cancel', …)`  → `toolLabelText` / `argsLabelText`
//                                                                   / `confirmLabelText` / `cancelLabelText`.
//    • `JSON.stringify(args ?? {}, null, 2)`                      → `formatArguments(_:)` (2-space
//                                                                   indent, `{}` when null/empty).
//    • `disabled={loading}` on Cancel + `loading`/`disabled` on   → `confirmDisabled(busy:)` /
//      Approve, `onClose={loading ? noop : onCancel}`               `cancelDisabled(busy:)`.
//    • The web only ever renders with a tool; `resolvePhase` /    → loading / empty / error envelopes
//      `resolveVisibility` widen that so no state is a blank box.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, in the dependency-free core so
/// the projection's unit tests can reach it. Disambiguated from sibling 0012's "ConfirmDialog" slug so
/// the two distinct surfaces stay separable in diagnostics (see the file header).
public enum AiConfirmSurface {
    public static let slug = "AiConfirmDialog"
}

// MARK: - Load status / render phase / freshness

/// The bound source's delivery status for the tool awaiting approval (web parent-supplied `open` +
/// `tool`). The request is normally pushed synchronously; the loading / failed arms exist so an
/// intentionally-presented dialog renders real chrome rather than a blank box.
public enum AiConfirmLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-state freshness (ADR-013): drives the freshness chip + cached-data banner so an approval
/// prompt assembled from a cached confirm-request is clearly labeled while reconnecting / offline.
public enum AiConfirmConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// What the surface renders at the top level. The web early-returns nothing when there is no tool to
/// confirm (the `Modal` render gate); `hidden` models that, and `presented` shows the dialog (whose
/// body switches over `phase`).
public enum AiConfirmVisibility: Sendable, Equatable {
    case hidden
    case presented
}

/// What the presented dialog body renders. The web only ever shows the approval form; the loading /
/// empty / error envelopes are added so an intentionally-presented dialog is never a blank box.
public enum AiConfirmPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case content
}

// MARK: - Tool preview (web `AiToolPreview`)

/// The tool metadata the dispatcher's `confirm_request` SSE frame supplies — the projection of the web
/// `AiToolPreview`. `name` is rendered verbatim, `description` is shown only when present (web
/// `tool.description && …`), and `mutates` selects the intro copy.
public struct AiToolPreview: Sendable, Equatable {
    public let name: String
    public let description: String?
    public let mutates: Bool

    public init(name: String, description: String? = nil, mutates: Bool) {
        self.name = name
        self.description = description
        self.mutates = mutates
    }
}

// MARK: - JSON argument model (ordered, for faithful JSON.stringify parity)

/// One ordered member of a JSON object. Object key order is preserved (as JS object insertion order is)
/// so the pretty-printed argument block is stable and matches the web byte-for-byte.
public struct AiJSONMember: Sendable, Equatable {
    public let key: String
    public let value: AiJSONValue

    public init(_ key: String, _ value: AiJSONValue) {
        self.key = key
        self.value = value
    }
}

/// A JSON value the LLM may propose as a tool argument. Mirrors the `unknown` JSON shapes
/// `JSON.stringify` accepts; `integer` is kept distinct from `double` so whole numbers render without a
/// trailing `.0` exactly as JS does.
public indirect enum AiJSONValue: Sendable, Equatable {
    case string(String)
    case integer(Int)
    case double(Double)
    case bool(Bool)
    case null
    case object([AiJSONMember])
    case array([AiJSONValue])
}

// MARK: - Confirm request (web props)

/// One approval prompt the source delivers — the projection of the web `AiConfirmDialogProps`. `tool`
/// is the `AiToolPreview`, `arguments` is the top-level argument object (web `args`, `nil` → `{}`), and
/// `loading` mirrors the `loading` prop the parent toggles while the continuation POST is in flight.
public struct AiConfirmRequest: Sendable, Equatable {
    public let tool: AiToolPreview
    public let arguments: [AiJSONMember]?
    public let loading: Bool

    public init(tool: AiToolPreview, arguments: [AiJSONMember]? = nil, loading: Bool = false) {
        self.tool = tool
        self.arguments = arguments
        self.loading = loading
    }
}

// MARK: - Projection core (pure)

/// The dependency-free resolution shared by the model and tests: the intro selection, the dialog copy,
/// the resolved visibility + body phase, the inline-failure envelope, the disabled rules, and the
/// `JSON.stringify(args ?? {}, null, 2)` argument pretty-printer. All copy resolves through an injected
/// localizer so it stays bundle-free.
public enum AiConfirmProjection {
    /// Localization keys for the copy the web source resolves through `t()`.
    public enum Keys {
        public static let title = "ai.confirm.title"
        public static let introMutates = "ai.confirm.intro.mutates"
        public static let introRead = "ai.confirm.intro.read"
        public static let toolLabel = "ai.confirm.toolLabel"
        public static let argsLabel = "ai.confirm.argsLabel"
        public static let run = "ai.confirm.run"
        public static let cancel = "ai.confirm.cancel"
    }

    /// English fallbacks matching the web source's literal defaults verbatim.
    public enum Fallbacks {
        public static let title = "Approve Helix action"
        public static let introMutates =
            "The assistant wants to make a change to your data. Review what it will do, then approve or cancel."
        public static let introRead =
            "The assistant wants to run a tool. Review the inputs, then approve or cancel."
        public static let toolLabel = "Tool"
        public static let argsLabel = "Arguments"
        public static let run = "Approve"
        public static let cancel = "Cancel"
    }

    // MARK: Copy

    /// The dialog title (web `t('ai.confirm.title', 'Approve Helix action')`).
    public static func titleText(localize: (String, String) -> String) -> String {
        localize(Keys.title, Fallbacks.title)
    }

    /// The intro paragraph (web `tool.mutates ? intro.mutates : intro.read`).
    public static func introText(mutates: Bool, localize: (String, String) -> String) -> String {
        mutates
            ? localize(Keys.introMutates, Fallbacks.introMutates)
            : localize(Keys.introRead, Fallbacks.introRead)
    }

    /// The "Tool" section label (web `t('ai.confirm.toolLabel', 'Tool')`).
    public static func toolLabelText(localize: (String, String) -> String) -> String {
        localize(Keys.toolLabel, Fallbacks.toolLabel)
    }

    /// The "Arguments" section label (web `t('ai.confirm.argsLabel', 'Arguments')`).
    public static func argsLabelText(localize: (String, String) -> String) -> String {
        localize(Keys.argsLabel, Fallbacks.argsLabel)
    }

    /// The Approve button title (web `t('ai.confirm.run', 'Approve')`).
    public static func confirmLabelText(localize: (String, String) -> String) -> String {
        localize(Keys.run, Fallbacks.run)
    }

    /// The Cancel button title (web `t('ai.confirm.cancel', 'Cancel')`).
    public static func cancelLabelText(localize: (String, String) -> String) -> String {
        localize(Keys.cancel, Fallbacks.cancel)
    }

    // MARK: Gates / envelopes

    /// Whether the Approve action is disabled — a mutation is in flight (web `disabled={loading}` +
    /// `loading` prop). There is no countdown / typed gate on this dialog, so busy is the only gate.
    public static func confirmDisabled(busy: Bool) -> Bool {
        busy
    }

    /// Whether the Cancel action is disabled (web `disabled={loading}`): the web also routes the modal
    /// close to a no-op while loading, so both dismiss paths are locked while busy.
    public static func cancelDisabled(busy: Bool) -> Bool {
        busy
    }

    /// The presented dialog's body phase. A usable tool shows the approval content; otherwise the
    /// loading / empty / error envelope renders so the dialog is never blank.
    public static func resolvePhase(status: AiConfirmLoadStatus, hasRequest: Bool) -> AiConfirmPhase {
        switch status {
        case .loading:
            hasRequest ? .content : .loading
        case .loaded:
            hasRequest ? .content : .empty
        case let .failed(message):
            hasRequest ? .content : .error(message)
        }
    }

    /// The web render gate resolved to a rendered surface: nothing while there is no tool (web `null`),
    /// else the presented panel. `pinned` models an intentionally-presented dialog so the loading /
    /// empty / error chrome still renders rather than vanishing (engineering guideline #6).
    public static func resolveVisibility(hasRequest: Bool, pinned: Bool) -> AiConfirmVisibility {
        (hasRequest || pinned) ? .presented : .hidden
    }

    /// The failure message kept on screen while a delivered tool survives a failed reload (the inline
    /// error shown above the approval content), else `nil`.
    public static func inlineFailure(status: AiConfirmLoadStatus, hasRequest: Bool) -> String? {
        guard hasRequest, case let .failed(message) = status else { return nil }
        return message
    }

    // MARK: Argument pretty-printer (web `JSON.stringify(args ?? {}, null, 2)`)

    /// Renders the proposed arguments exactly as the web `JSON.stringify(args ?? {}, null, 2)`: a
    /// 2-space-indented object, `{}` when there are no arguments (the web `args ?? {}` default).
    public static func formatArguments(_ members: [AiJSONMember]?) -> String {
        serialize(.object(members ?? []), indent: 0)
    }

    /// Recursively serializes a JSON value with the JS `JSON.stringify(_, null, 2)` shape: 2 spaces per
    /// depth level, `": "` key separators, `,\n` item separators, and `{}` / `[]` for empties.
    private static func serialize(_ value: AiJSONValue, indent: Int) -> String {
        switch value {
        case let .string(string):
            return encode(string)
        case let .integer(integer):
            return String(integer)
        case let .double(double):
            return encode(double)
        case let .bool(bool):
            return bool ? "true" : "false"
        case .null:
            return "null"
        case let .object(members):
            guard !members.isEmpty else { return "{}" }
            let inner = indentation(indent + 1)
            let body = members
                .map { "\(inner)\(encode($0.key)): \(serialize($0.value, indent: indent + 1))" }
                .joined(separator: ",\n")
            return "{\n\(body)\n\(indentation(indent))}"
        case let .array(items):
            guard !items.isEmpty else { return "[]" }
            let inner = indentation(indent + 1)
            let body = items
                .map { "\(inner)\(serialize($0, indent: indent + 1))" }
                .joined(separator: ",\n")
            return "[\n\(body)\n\(indentation(indent))]"
        }
    }

    /// Two spaces per depth level (the web indent argument `2`).
    private static func indentation(_ level: Int) -> String {
        String(repeating: " ", count: level * 2)
    }

    /// JSON-encodes a string with the same escapes `JSON.stringify` emits (quote, backslash, the short
    /// control escapes, and a `\u00NN` unicode escape for the remaining C0 controls). Forward slashes
    /// are left as-is, as JS does.
    private static func encode(_ string: String) -> String {
        var out = "\""
        for scalar in string.unicodeScalars {
            switch scalar {
            case "\"":
                out += "\\\""
            case "\\":
                out += "\\\\"
            case "\n":
                out += "\\n"
            case "\r":
                out += "\\r"
            case "\t":
                out += "\\t"
            default:
                if scalar.value < 0x20 {
                    out += String(format: "\\u%04x", Int(scalar.value))
                } else {
                    out.unicodeScalars.append(scalar)
                }
            }
        }
        out += "\""
        return out
    }

    /// Renders a double the way JS prints it: whole values drop the fractional part (`2.0` → `2`),
    /// everything else uses Swift's shortest round-trip representation.
    private static func encode(_ double: Double) -> String {
        guard double.isFinite else { return "null" }
        if double == double.rounded(), abs(double) < 1e15 {
            return String(Int64(double))
        }
        return String(double)
    }
}
