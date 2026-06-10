//
//  AIGeofenceAwareAutomationSuggestions.Adapter.swift
//  TeslaSync — P4 shared surface · 0020 · AIGeofenceAwareAutomationSuggestions (Apple)
//
//  The testable projection core for the "Suggest a geofence-aware automation" Helix panel
//  — the SwiftUI parity of components/ai/AIGeofenceAwareAutomationSuggestions.tsx.
//  Everything here is pure + dependency-free (Foundation only — no SwiftUI, no Observation,
//  no network), so the typed `tool_result` → draft decode, the prompt/stream-lifecycle
//  button logic, and the spoken summary are all unit tested in isolation (and in the SwiftPM
//  harness) without rendering a view.
//
//  Parity note: the web `handleEvent` only captures a `tool_result` frame whose
//  `name === 'draft_automation_graph'` AND `ok === true`, unwraps `data.draft` through
//  `normalizeAutomationInput` (name string, vehicle_id number, enabled bool, triggers /
//  conditions / actions arrays; description optional string), and keeps it only when the
//  graph normalises AND `data.status` is a string — anything else is dropped (the web
//  `return` no-op). `GeofenceAutomationDraft.from(_:)` reproduces that walk exactly, so a
//  malformed provider response can never bleed a partial proposal into the user's form.
//

import Foundation

// MARK: - Surface identity (P1/S11 slug + web `withAiFeature` id)

/// The surface's stable, non-UI identity — the diagnostics slug (P1/S11 `view.opened`)
/// and the AI feature id the web `withAiFeature` gates on. Kept here (SwiftUI-free) so
/// the state-holder can emit telemetry without depending on the view layer.
public enum GeofenceAutomationSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "AIGeofenceAwareAutomationSuggestions"
    /// The AI feature id (web `withAiFeature('geofence-aware-automation-suggestions', …)`).
    public static let featureID = "geofence-aware-automation-suggestions"
}

// MARK: - JSON value (the `tool_result.data` payload element)

/// A minimal, `Sendable` JSON value — the native mirror of the untyped `ev.data` object
/// the web `handleEvent` narrows with `typeof` / `Array.isArray` guards. It carries the
/// nested `object` / `array` shapes because the automation graph's `triggers` /
/// `conditions` / `actions` are opaque node arrays the panel only counts and forwards
/// (web `AutomationFullInput['triggers']` passthrough).
public enum GeofenceAutomationJSON: Equatable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: GeofenceAutomationJSON])
    case array([GeofenceAutomationJSON])
    case null

    /// The string payload (web `typeof x === 'string'`), or `nil` for any other kind.
    public var stringValue: String? {
        if case let .string(value) = self { return value }
        return nil
    }

    /// The numeric payload (web `typeof x === 'number'`), or `nil` for any other kind.
    public var numberValue: Double? {
        if case let .number(value) = self { return value }
        return nil
    }

    /// The boolean payload (web `typeof x === 'boolean'`), or `nil` for any other kind.
    public var boolValue: Bool? {
        if case let .bool(value) = self { return value }
        return nil
    }

    /// The array payload (web `Array.isArray(x)`), or `nil` for any other kind.
    public var arrayValue: [GeofenceAutomationJSON]? {
        if case let .array(value) = self { return value }
        return nil
    }

    /// The object payload (web `typeof x === 'object' && x !== null`), or `nil` otherwise.
    public var objectValue: [String: GeofenceAutomationJSON]? {
        if case let .object(value) = self { return value }
        return nil
    }
}

// MARK: - Tool result (web `AiStreamEvent` `tool_result` case)

/// One decoded `tool_result` SSE frame — the native mirror of the web event's
/// `{ id, name, ok, data, error }` shape. The view never sees this type; the state-holder
/// forwards it to `GeofenceAutomationDraft.from(_:)`.
public struct GeofenceAutomationToolResult: Equatable, Sendable {
    public let id: String
    public let name: String
    public let ok: Bool
    public let data: [String: GeofenceAutomationJSON]?
    public let error: String?

    public init(
        id: String,
        name: String,
        ok: Bool,
        data: [String: GeofenceAutomationJSON]? = nil,
        error: String? = nil
    ) {
        self.id = id
        self.name = name
        self.ok = ok
        self.data = data
        self.error = error
    }
}

// MARK: - Automation graph (web `AutomationFullInput`)

/// The canonical wire-shaped automation graph — the native mirror of the web
/// `AutomationFullInput` (the same JSON the baseline `POST /api/v1/automations` handler
/// accepts). `triggers` / `conditions` / `actions` stay opaque node arrays (web
/// `AutomationFullInput['triggers']`): the panel only renders their counts and forwards
/// the whole graph to the parent form on "Apply to form" — it never inspects a node.
public struct GeofenceAutomationInput: Equatable, Sendable {
    public let name: String
    public let description: String
    public let vehicleID: Int64
    public let enabled: Bool
    public let triggers: [GeofenceAutomationJSON]
    public let conditions: [GeofenceAutomationJSON]
    public let actions: [GeofenceAutomationJSON]

    public init(
        name: String,
        description: String,
        vehicleID: Int64,
        enabled: Bool,
        triggers: [GeofenceAutomationJSON],
        conditions: [GeofenceAutomationJSON],
        actions: [GeofenceAutomationJSON]
    ) {
        self.name = name
        self.description = description
        self.vehicleID = vehicleID
        self.enabled = enabled
        self.triggers = triggers
        self.conditions = conditions
        self.actions = actions
    }

    /// Native port of the web `normalizeAutomationInput`: defensively coerce the typed
    /// envelope into the graph shape the parent's `formToPayload` expects, rejecting
    /// (returning `nil`) anything we cannot positively prove from the wire shape — a
    /// malformed draft never silently corrupts the user's form state. Requires `name`
    /// string, `vehicle_id` number, `enabled` bool, and `triggers` / `conditions` /
    /// `actions` arrays; `description` is an optional string defaulting to "".
    public static func normalize(_ value: GeofenceAutomationJSON?) -> GeofenceAutomationInput? {
        guard let object = value?.objectValue else { return nil }
        guard
            let name = object["name"]?.stringValue,
            let vehicleNumber = object["vehicle_id"]?.numberValue,
            let enabled = object["enabled"]?.boolValue,
            let triggers = object["triggers"]?.arrayValue,
            let conditions = object["conditions"]?.arrayValue,
            let actions = object["actions"]?.arrayValue
        else {
            return nil
        }
        return GeofenceAutomationInput(
            name: name,
            description: object["description"]?.stringValue ?? "",
            vehicleID: Int64(vehicleNumber),
            enabled: enabled,
            triggers: triggers,
            conditions: conditions,
            actions: actions
        )
    }
}

// MARK: - Automation draft (web `AutomationDraft` envelope)

/// The typed envelope returned by the `draft_automation_graph` tool — the native mirror
/// of the web `AutomationDraft` interface (internal/ai/tools/automation_builder.go
/// `automationGraphDraftOutput`). `status` keeps the web's open `'ok' | 'invalid' | string`,
/// with `isOK` deriving the single branch the view cares about (apply enabled / the
/// "rejected by validator" line hidden).
public struct GeofenceAutomationDraft: Equatable, Sendable {
    /// The proposed automation graph (web `draft.draft`), applied to the parent form.
    public let input: GeofenceAutomationInput
    /// The validator verdict — `"ok"` or anything else (e.g. `"invalid"`).
    public let status: String
    /// The optional validator rationale shown under the proposal (web `validation_error`).
    public let validationError: String?

    public init(input: GeofenceAutomationInput, status: String, validationError: String? = nil) {
        self.input = input
        self.status = status
        self.validationError = validationError
    }

    /// Web `draft.status === 'ok'` — the only branch that enables "Apply to form" and
    /// hides the "Proposal rejected by validator" line.
    public var isOK: Bool {
        status == "ok"
    }

    /// The tool whose `tool_result` frame carries a draft (web
    /// `ev.name === 'draft_automation_graph'`).
    public static let toolName = "draft_automation_graph"

    /// Native port of the web `handleEvent` guard chain: accept the frame only when it is
    /// the draft tool, succeeded, carries a `data.draft` that normalises to a graph, AND a
    /// `data.status` string. Any failure yields `nil` (the web `return` no-op).
    public static func from(_ result: GeofenceAutomationToolResult) -> GeofenceAutomationDraft? {
        guard result.name == toolName, result.ok, let data = result.data else { return nil }
        guard
            let input = GeofenceAutomationInput.normalize(data["draft"]),
            let status = data["status"]?.stringValue
        else {
            return nil
        }
        return GeofenceAutomationDraft(
            input: input,
            status: status,
            validationError: data["validation_error"]?.stringValue
        )
    }
}
