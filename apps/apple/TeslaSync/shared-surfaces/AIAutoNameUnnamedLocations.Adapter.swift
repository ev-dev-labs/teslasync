//
//  AIAutoNameUnnamedLocations.Adapter.swift
//  TeslaSync — P4 shared surface · 0006 · AIAutoNameUnnamedLocations (Apple)
//
//  The testable projection core for the "Suggest a name for this location" Helix
//  panel — the SwiftUI parity of components/ai/AIAutoNameUnnamedLocations.tsx. Everything
//  here is pure + dependency-free (Foundation only — no SwiftUI, no Observation, no
//  network), so the typed `tool_result` → draft decode, the stream-lifecycle button
//  logic, and the spoken summary are all unit tested in isolation (and in the SwiftPM
//  harness) without rendering a view.
//
//  Parity note: the web `handleEvent` only captures a `tool_result` frame whose
//  `name === 'draft_location_name'` AND `ok === true`, then narrows the payload with
//  `typeof` guards (`location_id` number, `proposed_name` string, `status` string,
//  optional `reason` string) and drops anything that fails — never throwing, never
//  surfacing a partial draft. `LocationNameDraft.from(_:)` reproduces that walk exactly.
//

import Foundation

// MARK: - Surface identity (P1/S11 slug + web `withAiFeature` id)

/// The surface's stable, non-UI identity — the diagnostics slug (P1/S11 `view.opened`)
/// and the AI feature id the web `withAiFeature` gates on. Kept here (SwiftUI-free) so
/// the state-holder can emit telemetry without depending on the view layer.
public enum AIAutoNameSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "AIAutoNameUnnamedLocations"
    /// The AI feature id (web `withAiFeature('auto-name-unnamed-locations', …)`).
    public static let featureID = "auto-name-unnamed-locations"
}

// MARK: - JSON value (the `tool_result.data` payload element)

/// A minimal, `Sendable` JSON value — the native mirror of the untyped `ev.data`
/// object the web `handleEvent` narrows with `typeof` guards. Kept deliberately small
/// (the only shapes the SSE writer emits for this tool) so the decode stays a pure,
/// exhaustively-tested function rather than a reflection-driven coder.
public enum AIJSONValue: Equatable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: AIJSONValue])
    case array([AIJSONValue])
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
}

// MARK: - Tool result (web `AiStreamEvent` `tool_result` case)

/// One decoded `tool_result` SSE frame — the native mirror of the web event's
/// `{ id, name, ok, data, error }` shape. The view never sees this type; the
/// state-holder forwards it to `LocationNameDraft.from(_:)`.
public struct AIToolResult: Equatable, Sendable {
    public let id: String
    public let name: String
    public let ok: Bool
    public let data: [String: AIJSONValue]?
    public let error: String?

    public init(id: String, name: String, ok: Bool, data: [String: AIJSONValue]? = nil, error: String? = nil) {
        self.id = id
        self.name = name
        self.ok = ok
        self.data = data
        self.error = error
    }
}

// MARK: - Location name draft (web `LocationNameDraft` envelope)

/// The typed envelope returned by the `draft_location_name` tool — the native mirror
/// of the web `LocationNameDraft` interface
/// (internal/ai/tools/auto_name_unnamed_locations.go `locationNameDraft`). `status` is
/// kept as the web's open `'ok' | 'rejected' | string`, with `isOK` deriving the single
/// branch the view cares about (apply enabled / "rejected by validator" hidden).
public struct LocationNameDraft: Equatable, Sendable {
    /// The synthetic visited-location id the tool echoes back.
    public let locationID: Int64
    /// The concise, human-readable name Helix proposes.
    public let proposedName: String
    /// The validator verdict — `"ok"` or anything else (e.g. `"rejected"`).
    public let status: String
    /// The optional validator rationale shown under the proposal.
    public let reason: String?

    public init(locationID: Int64, proposedName: String, status: String, reason: String? = nil) {
        self.locationID = locationID
        self.proposedName = proposedName
        self.status = status
        self.reason = reason
    }

    /// Web `draft.status === 'ok'` — the only branch that enables "Apply to form" and
    /// hides the "Proposal rejected by validator" line.
    public var isOK: Bool {
        status == "ok"
    }

    /// The tool whose `tool_result` frame carries a draft (web
    /// `ev.name === 'draft_location_name'`).
    public static let toolName = "draft_location_name"

    /// Native port of the web `handleEvent` guard chain: accept the frame only when it
    /// is the draft tool, succeeded, and carries a `location_id` number + `proposed_name`
    /// string + `status` string; `reason` is an optional string. Any failure yields `nil`
    /// (the web `return` no-op) so a malformed frame never bleeds a partial proposal.
    public static func from(_ result: AIToolResult) -> LocationNameDraft? {
        guard result.name == toolName, result.ok, let data = result.data else { return nil }
        guard
            let locationNumber = data["location_id"]?.numberValue,
            let proposedName = data["proposed_name"]?.stringValue,
            let status = data["status"]?.stringValue
        else {
            return nil
        }
        return LocationNameDraft(
            locationID: Int64(locationNumber),
            proposedName: proposedName,
            status: status,
            reason: data["reason"]?.stringValue
        )
    }
}

// MARK: - Stream lifecycle (web `AiStreamState`)

/// The user-facing stream lifecycle — the native port of the web
/// `'idle' | 'streaming' | 'paused-confirm' | 'done' | 'error'`. `pausedConfirm` blocks
/// a new `start()` (web `canStart`), `streaming` flips the button to "Helix is thinking…".
public enum AIStreamPhase: Equatable, Sendable {
    case idle
    case streaming
    case pausedConfirm
    case done
    case error(String)

    /// Web `stream.state === 'error'`.
    public var isError: Bool {
        if case .error = self { return true }
        return false
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound feature-gate / context snapshot — the orthogonal
/// connectivity axis rendered as the header chip + banner. `live` hides the banner.
public enum AIConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Feature gate (web `withAiFeature` / `useAiEnabled`)

/// The AI-Off gate state (ADR-015) — the native mirror of `useAiEnabled(feature)`.
/// `loading` shows skeleton chrome while the gate resolves; `off` collapses the surface
/// to nothing (web `withAiFeature` returns `null`); `on` renders the card.
public enum AIFeatureGateState: String, Sendable, Equatable, CaseIterable {
    case loading
    case on
    case off
}

// MARK: - Pure button / output logic (web `AIFeatureCard` + `AiOutputPanel` branches)

/// The pure, view-free decision logic ported from `AIFeatureCard` and `AiOutputPanel`.
/// Each function is a direct translation of a web boolean so the view is a pure
/// function of these and every branch is unit tested.
public enum AINameDraftLogic {
    /// Web `isBusy = stream.state === 'streaming' || stream.state === 'paused-confirm'`.
    public static func isBusy(_ phase: AIStreamPhase) -> Bool {
        phase == .streaming || phase == .pausedConfirm
    }

    /// Web `canStart={locationId > 0 && stream.state !== 'paused-confirm'}`.
    public static func canStart(locationID: Int64, phase: AIStreamPhase) -> Bool {
        locationID > 0 && phase != .pausedConfirm
    }

    /// Web `buttonDisabled = !canStart || isStreaming`, widened with the native leaf
    /// contract so the action cannot fire while offline (no stream is possible).
    public static func buttonDisabled(
        locationID: Int64,
        phase: AIStreamPhase,
        connection: AIConnection
    ) -> Bool {
        let canStart = canStart(locationID: locationID, phase: phase)
        return !canStart || phase == .streaming || connection == .offline
    }

    /// Web `AiOutputPanel` `hasAnything = text.length > 0 || state ∈ {streaming, error, done}`.
    /// Returns whether the streamed-output panel is visible at all.
    public static func outputVisible(phase: AIStreamPhase, hasText: Bool) -> Bool {
        hasText || phase == .streaming || phase == .done || phase.isError
    }

    /// Web `text.length === 0 && state === 'streaming'` → the animated thinking indicator.
    public static func thinkingVisible(phase: AIStreamPhase, hasText: Bool) -> Bool {
        !hasText && phase == .streaming
    }

    /// Whether the resting "invite" card is showing (gate on, nothing streamed yet,
    /// no draft captured) — the native friendly empty/idle state.
    public static func isIdleInvite(phase: AIStreamPhase, hasDraft: Bool, hasText: Bool) -> Bool {
        !hasDraft && !hasText && phase == .idle
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary for the card from already-localised parts, so the
/// spoken content is asserted without rendering the view. Mirrors the visible reading
/// order: title, then the current label (when present), then the proposal verdict.
public enum AINameDraftAccessibility {
    public static func summary(
        title: String,
        currentLabel: String?,
        proposedLabel: String,
        draft: LocationNameDraft?,
        rejectedLabel: String
    ) -> String {
        var parts: [String] = [title]
        if let currentLabel, !currentLabel.isEmpty {
            parts.append(currentLabel)
        }
        if let draft {
            parts.append("\(proposedLabel): \(draft.proposedName)")
            if let reason = draft.reason, !reason.isEmpty {
                parts.append(reason)
            }
            if !draft.isOK {
                parts.append(rejectedLabel)
            }
        }
        return parts.joined(separator: ". ")
    }
}
