//
//  AIQuietHoursSuggestion.Adapter.swift
//  TeslaSync — P4 shared surface · 0041 · AIQuietHoursSuggestion (Apple)
//
//  The testable projection core for the "Suggest a quiet-hours window" Helix panel — the SwiftUI
//  parity of components/ai/AIQuietHoursSuggestion.tsx. Everything here is pure + dependency-free
//  (Foundation only — no SwiftUI, no Observation, no network), so the typed `tool_result` → proposal
//  decode, the apply patch, and the cached-inputs → view-projection map are all unit tested in
//  isolation (and in the SwiftPM harness) without rendering a view.
//
//  Parity note: the web `handleEvent` captures a `tool_result` frame whose
//  `name === 'draft_quiet_hours_window'` AND whose `ev.ok` is true, then validates the payload at the
//  TOP level (start_local / end_local / timezone strings, weekdays a number, bypass_severities an
//  array). A failed guard is a no-op (`return`, no proposal). Unlike its signal-explorer sibling, the
//  proposal fields live directly on `data` (not nested under `data.draft`), the `ev.ok` flag IS part
//  of the guard, and `bypass_severities` is FILTERED to its string elements (not rejected if a
//  non-string is present). `QuietHoursDraftProposal.from(_:)` reproduces that walk exactly, so a
//  malformed provider response can never bleed a partial window into the user's form.
//

import Foundation

// MARK: - Surface identity (P1/S11 slug + web `withAiFeature` id)

/// The surface's stable, non-UI identity — the diagnostics slug (P1/S11 `view.opened`) and the AI
/// feature id the web `withAiFeature` gates on. Kept here (SwiftUI-free) so the state-holder can emit
/// telemetry without depending on the view layer.
public enum QuietHoursSuggestionSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "AIQuietHoursSuggestion"
    /// The AI feature id (web `withAiFeature('quiet-hours-suggestion', …)`).
    public static let featureID = "quiet-hours-suggestion"
}

// MARK: - JSON value (the `tool_result.data` payload element)

/// A minimal, `Sendable` JSON value — the native mirror of the untyped `ev.data` object the web
/// `handleEvent` narrows with `typeof` / `Array.isArray` guards. It carries the `array` shape because
/// `bypass_severities` is a string array the panel reads element-by-element.
public enum QuietHoursSuggestionJSON: Equatable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: QuietHoursSuggestionJSON])
    case array([QuietHoursSuggestionJSON])
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
    public var arrayValue: [QuietHoursSuggestionJSON]? {
        if case let .array(value) = self { return value }
        return nil
    }

    /// The object payload (web `typeof x === 'object' && x !== null`), or `nil` otherwise.
    public var objectValue: [String: QuietHoursSuggestionJSON]? {
        if case let .object(value) = self { return value }
        return nil
    }
}

// MARK: - Tool result (web `AiStreamEvent` `tool_result` case)

/// One decoded `tool_result` SSE frame — the native mirror of the web event's `{ id, name, ok, data }`
/// shape. The view never sees this type; the state-holder forwards it to
/// `QuietHoursDraftProposal.from(_:)`.
public struct QuietHoursSuggestionToolResult: Equatable, Sendable {
    public let id: String
    public let name: String
    public let ok: Bool
    public let data: [String: QuietHoursSuggestionJSON]?
    public let error: String?

    public init(
        id: String,
        name: String,
        ok: Bool,
        data: [String: QuietHoursSuggestionJSON]? = nil,
        error: String? = nil
    ) {
        self.id = id
        self.name = name
        self.ok = ok
        self.data = data
        self.error = error
    }
}

// MARK: - Quiet-hours proposal (web `QuietHoursDraftProposal`)

/// The typed quiet-hours window the Helix panel proposes — the native mirror of the web
/// `QuietHoursDraftProposal` (the Go-side `QuietHoursWindowProposal` in
/// internal/ai/tools/quiet_hours_suggestion.go). The field set is intentionally narrow: only what the
/// baseline `QuietHoursPanel` form consumes, so the Helix panel can never over-write fields the user
/// did not consent to changing. `toPatch()` projects it onto the apply payload the parent form seeds.
public struct QuietHoursDraftProposal: Equatable, Sendable {
    /// Local window start (web `start_local`, e.g. `"22:00"`).
    public let startLocal: String
    /// Local window end (web `end_local`, e.g. `"07:00"`).
    public let endLocal: String
    /// IANA timezone the window is expressed in (web `timezone`).
    public let timezone: String
    /// The weekday bitmask the window applies to (web `weekdays`).
    public let weekdays: Int
    /// Severities that bypass the quiet window (web `bypass_severities`).
    public let bypassSeverities: [String]
    /// The advisory verdict (web `status`, e.g. `"ok"` / `"insufficient_history"`).
    public let status: String
    /// How many windows the user already has configured (web `existing_windows_count`).
    public let existingWindowsCount: Int

    public init(
        startLocal: String,
        endLocal: String,
        timezone: String,
        weekdays: Int,
        bypassSeverities: [String],
        status: String,
        existingWindowsCount: Int
    ) {
        self.startLocal = startLocal
        self.endLocal = endLocal
        self.timezone = timezone
        self.weekdays = weekdays
        self.bypassSeverities = bypassSeverities
        self.status = status
        self.existingWindowsCount = existingWindowsCount
    }

    /// The advisory `status` the web preview special-cases with a conservative-default note.
    public static let insufficientHistoryStatus = "insufficient_history"

    /// Web `proposal.status === 'insufficient_history'` — Helix fell back to a conservative default.
    public var hasInsufficientHistory: Bool {
        status == QuietHoursDraftProposal.insufficientHistoryStatus
    }

    /// Web `proposal.existing_windows_count > 0` — the user already has windows configured.
    public var hasExistingWindows: Bool {
        existingWindowsCount > 0
    }

    /// The tool whose `tool_result` frame carries a proposal
    /// (web `ev.name === 'draft_quiet_hours_window'`).
    public static let toolName = "draft_quiet_hours_window"

    /// Native port of the web `handleEvent` guard: accept the frame only when it is the draft tool,
    /// the result `ok` flag is set (web `&& ev.ok`), and the `data` proves `start_local` / `end_local`
    /// / `timezone` strings, a `weekdays` number, and a `bypass_severities` array. Any failure yields
    /// `nil` (the web `return` no-op). `bypass_severities` is FILTERED to its string elements (web
    /// `.filter((s) => typeof s === 'string')` — non-strings are dropped, not rejected); `status`
    /// defaults to `"ok"` and `existing_windows_count` to `0` when absent or the wrong kind.
    public static func from(_ result: QuietHoursSuggestionToolResult) -> QuietHoursDraftProposal? {
        guard result.name == toolName, result.ok, let data = result.data else { return nil }
        guard
            let startLocal = data["start_local"]?.stringValue,
            let endLocal = data["end_local"]?.stringValue,
            let timezone = data["timezone"]?.stringValue,
            let weekdays = data["weekdays"]?.numberValue,
            let severitiesArray = data["bypass_severities"]?.arrayValue
        else {
            return nil
        }
        let severities = severitiesArray.compactMap(\.stringValue)
        let status = data["status"]?.stringValue ?? "ok"
        let existing = data["existing_windows_count"]?.numberValue.map { Int($0) } ?? 0
        return QuietHoursDraftProposal(
            startLocal: startLocal,
            endLocal: endLocal,
            timezone: timezone,
            weekdays: Int(weekdays),
            bypassSeverities: severities,
            status: status,
            existingWindowsCount: existing
        )
    }

    /// Web `handleApply`'s payload: the captured scalars plus `enabled: true`, seeding the baseline
    /// `QuietHoursPanel` form via the parent `onApplyDraft` callback (the panel's Save button stays the
    /// sole write path — ADR-015 §I8 propose-only).
    public func toPatch() -> QuietHoursWindowPatch {
        QuietHoursWindowPatch(
            enabled: true,
            startLocal: startLocal,
            endLocal: endLocal,
            timezone: timezone,
            weekdays: weekdays,
            bypassSeverities: bypassSeverities
        )
    }
}

// MARK: - Apply patch (web `QuietHoursWindowInput`)

/// The patch the panel forwards to the parent form on "Apply to form" — the native mirror of the web
/// `QuietHoursWindowInput` (the create/update body the baseline `QuietHoursPanel` owns). The panel
/// never writes the API itself; this is the propose-only handoff (web `onApplyDraft`).
public struct QuietHoursWindowPatch: Equatable, Sendable {
    public let enabled: Bool
    public let startLocal: String
    public let endLocal: String
    public let timezone: String
    public let weekdays: Int
    public let bypassSeverities: [String]

    public init(
        enabled: Bool,
        startLocal: String,
        endLocal: String,
        timezone: String,
        weekdays: Int,
        bypassSeverities: [String]
    ) {
        self.enabled = enabled
        self.startLocal = startLocal
        self.endLocal = endLocal
        self.timezone = timezone
        self.weekdays = weekdays
        self.bypassSeverities = bypassSeverities
    }
}

// MARK: - Input snapshot (gate/connectivity context)

/// One coalesced snapshot of the panel's non-stream inputs — the `useAiEnabled` gate plus the parent
/// surface connectivity. The web source takes NO `vehicleId` prop and NO prompt (the request body is
/// the empty object), so unlike its NL-builder siblings there is no scope/prompt axis here; the panel
/// is a single-button advisor. Pure Foundation data, so it bundles the projection's cached inputs.
public struct QuietHoursSuggestionInputSnapshot: Sendable, Equatable {
    public var gate: QuietHoursSuggestionGate
    public var connection: QuietHoursSuggestionConnection
    public var errorMessage: String?

    public init(
        gate: QuietHoursSuggestionGate = .on,
        connection: QuietHoursSuggestionConnection = .live,
        errorMessage: String? = nil
    ) {
        self.gate = gate
        self.connection = connection
        self.errorMessage = errorMessage
    }
}

// MARK: - View projection (cached inputs → render decisions)

/// The pure projection of the panel's cached inputs (gate + stream phase + captured-proposal presence
/// + connectivity) into the render decisions the view switches on — the testable "adapter" boundary
/// (P4 acceptance: *adapter unit test (cached → projection)*). It holds no SwiftUI and no I/O, so the
/// mapping is asserted without a view or a network. `QuietHoursSuggestionModel` derives the very same
/// flags through `QuietHoursSuggestionLogic`, so the projection and the live model can never diverge.
public struct QuietHoursSuggestionProjection: Equatable, Sendable {
    /// The top-level render axis (gate + gate-error).
    public let renderState: QuietHoursSuggestionRenderState
    /// Web `canStart = stream.state !== 'paused-confirm'`.
    public let canStart: Bool
    /// Web `AIFeatureCard` `buttonDisabled = !canStart || isStreaming` (+ offline leaf contract).
    public let buttonDisabled: Bool
    /// Web `isStreaming = stream.state === 'streaming'` — flips the CTA to "Helix is thinking…".
    public let isStreaming: Bool
    /// Web `isBusy = streaming || paused-confirm` — gates the Suggest + Apply actions.
    public let isBusy: Bool
    /// Web `!(proposal == null || isBusy)` — enables the "Apply to form" action.
    public let canApply: Bool
    /// Web `AiOutputPanel` visibility (text, or a streaming/done/error lifecycle).
    public let outputVisible: Bool
    /// Web `AiOutputPanel` animated thinking branch (streaming, no text yet).
    public let thinkingVisible: Bool
    /// The friendly idle/empty hint (P4 empty contract): resting card, nothing proposed yet.
    public let showIdleHint: Bool
    /// The orthogonal connectivity axis (P4 leaf freshness chip + banner).
    public let connection: QuietHoursSuggestionConnection

    public init(
        renderState: QuietHoursSuggestionRenderState,
        canStart: Bool,
        buttonDisabled: Bool,
        isStreaming: Bool,
        isBusy: Bool,
        canApply: Bool,
        outputVisible: Bool,
        thinkingVisible: Bool,
        showIdleHint: Bool,
        connection: QuietHoursSuggestionConnection
    ) {
        self.renderState = renderState
        self.canStart = canStart
        self.buttonDisabled = buttonDisabled
        self.isStreaming = isStreaming
        self.isBusy = isBusy
        self.canApply = canApply
        self.outputVisible = outputVisible
        self.thinkingVisible = thinkingVisible
        self.showIdleHint = showIdleHint
        self.connection = connection
    }

    /// Projects one coalesced snapshot of the cached inputs into the render decisions, reusing
    /// `QuietHoursSuggestionLogic` so the projection is the single source of truth the model also
    /// consumes.
    public static func make(
        snapshot: QuietHoursSuggestionInputSnapshot,
        phase: QuietHoursSuggestionStreamPhase,
        hasProposal: Bool,
        streamText: String
    ) -> QuietHoursSuggestionProjection {
        let connection = snapshot.connection
        let hasText = !streamText.isEmpty
        return QuietHoursSuggestionProjection(
            renderState: QuietHoursSuggestionLogic.renderState(
                gate: snapshot.gate, gateError: snapshot.errorMessage
            ),
            canStart: QuietHoursSuggestionLogic.canStart(phase: phase),
            buttonDisabled: QuietHoursSuggestionLogic.buttonDisabled(phase: phase, connection: connection),
            isStreaming: phase == .streaming,
            isBusy: QuietHoursSuggestionLogic.isBusy(phase),
            canApply: QuietHoursSuggestionLogic.canApply(hasProposal: hasProposal, phase: phase),
            outputVisible: QuietHoursSuggestionLogic.outputVisible(phase: phase, hasText: hasText),
            thinkingVisible: QuietHoursSuggestionLogic.thinkingVisible(phase: phase, hasText: hasText),
            showIdleHint: QuietHoursSuggestionLogic.showIdleHint(
                phase: phase, hasProposal: hasProposal, hasText: hasText
            ),
            connection: connection
        )
    }
}
