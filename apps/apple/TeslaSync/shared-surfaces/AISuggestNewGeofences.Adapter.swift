//
//  AISuggestNewGeofences.Adapter.swift
//  TeslaSync — P4 shared surface · 0051 · AISuggestNewGeofences (Apple)
//
//  The testable projection core for the "Suggest a geofence for this location" Helix
//  panel — the SwiftUI parity of components/ai/AISuggestNewGeofences.tsx. Everything here
//  is pure + dependency-free (Foundation only — no SwiftUI, no Observation, no network),
//  so the typed `tool_result` → draft decode, the stream-lifecycle button logic, the
//  rounded-radius formatting, and the spoken summary are all unit tested in isolation
//  (and in the SwiftPM harness) without rendering a view.
//
//  Parity note: the web `handleEvent` only captures a `tool_result` frame whose
//  `name === 'draft_geofence'` AND `ok === true`, unwraps the envelope to `data.draft`,
//  then narrows the payload with `typeof` guards (`location_id` / `vehicle_id` /
//  `radius_m` / `centroid_lat` / `centroid_lon` numbers, `proposed_name` string,
//  wrapper `status` string, optional wrapper `validation_error` string) and drops
//  anything that fails — never throwing, never surfacing a partial draft.
//  `SuggestGeofenceDraft.from(_:)` reproduces that walk exactly.
//

import Foundation

// MARK: - Surface identity (P1/S11 slug + web `withAiFeature` id)

/// The surface's stable, non-UI identity — the diagnostics slug (P1/S11 `view.opened`)
/// and the AI feature id the web `withAiFeature` gates on. Kept here (SwiftUI-free) so
/// the state-holder can emit telemetry without depending on the view layer.
public enum SuggestGeofenceSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "AISuggestNewGeofences"
    /// The AI feature id (web `withAiFeature('suggest-new-geofences', …)`).
    public static let featureID = "suggest-new-geofences"
}

// MARK: - JSON value (the `tool_result.data` payload element)

/// A minimal, `Sendable` JSON value — the native mirror of the untyped `ev.data` object
/// the web `handleEvent` narrows with `typeof` guards. Kept deliberately small (the only
/// shapes the SSE writer emits for this tool, including the nested `draft` object) so the
/// decode stays a pure, exhaustively-tested function rather than a reflection-driven coder.
public enum SuggestGeofenceJSONValue: Equatable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: SuggestGeofenceJSONValue])
    case array([SuggestGeofenceJSONValue])
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

    /// The nested-object payload (web `wrapper.draft`), or `nil` for any other kind.
    public var objectValue: [String: SuggestGeofenceJSONValue]? {
        if case let .object(value) = self { return value }
        return nil
    }
}

// MARK: - Tool result (web `AiStreamEvent` `tool_result` case)

/// One decoded `tool_result` SSE frame — the native mirror of the web event's
/// `{ id, name, ok, data, error }` shape. The view never sees this type; the state-holder
/// forwards it to `SuggestGeofenceDraft.from(_:)`.
public struct SuggestGeofenceToolResult: Equatable, Sendable {
    public let id: String
    public let name: String
    public let ok: Bool
    public let data: [String: SuggestGeofenceJSONValue]?
    public let error: String?

    public init(
        id: String,
        name: String,
        ok: Bool,
        data: [String: SuggestGeofenceJSONValue]? = nil,
        error: String? = nil
    ) {
        self.id = id
        self.name = name
        self.ok = ok
        self.data = data
        self.error = error
    }
}

// MARK: - Geofence draft (web `GeofenceDraft` envelope)

/// The typed envelope returned by the `draft_geofence` tool — the native mirror of the
/// web `GeofenceDraft` interface (internal/ai/tools/suggest_new_geofences.go
/// `geofenceDraft`). `status` is kept as the web's open `'ok' | 'invalid' | string`, with
/// `isOK` deriving the single branch the view cares about (apply enabled / "rejected by
/// validator" hidden). Coordinates + radius are SI (meters / degrees) read straight from
/// the wire — the web source renders the raw meters, so no unit conversion happens here.
public struct SuggestGeofenceDraft: Equatable, Sendable {
    /// The synthetic visited-location id the tool echoes back.
    public let locationID: Int64
    /// The vehicle the visit pattern belongs to (echoed back by the tool).
    public let vehicleID: Int64
    /// The concise, human-readable name Helix proposes.
    public let proposedName: String
    /// The proposed geofence radius in meters (SI, rendered rounded).
    public let radiusM: Double
    /// The proposed centroid latitude (degrees).
    public let centroidLat: Double
    /// The proposed centroid longitude (degrees).
    public let centroidLon: Double
    /// The validator verdict — `"ok"` or anything else (e.g. `"invalid"`).
    public let status: String
    /// The optional validator rationale shown under the proposal.
    public let validationError: String?

    public init(
        locationID: Int64,
        vehicleID: Int64,
        proposedName: String,
        radiusM: Double,
        centroidLat: Double,
        centroidLon: Double,
        status: String,
        validationError: String? = nil
    ) {
        self.locationID = locationID
        self.vehicleID = vehicleID
        self.proposedName = proposedName
        self.radiusM = radiusM
        self.centroidLat = centroidLat
        self.centroidLon = centroidLon
        self.status = status
        self.validationError = validationError
    }

    /// Web `draft.status === 'ok'` — the only branch that enables "Apply to form" and
    /// hides the "Proposal rejected by validator" line.
    public var isOK: Bool {
        status == "ok"
    }

    /// The tool whose `tool_result` frame carries a draft (web `ev.name === 'draft_geofence'`).
    public static let toolName = "draft_geofence"

    /// Native port of the web `handleEvent` guard chain: accept the frame only when it is
    /// the draft tool, succeeded, and carries a nested `draft` object with the required
    /// numeric/string fields plus a wrapper `status` string; `validation_error` is an
    /// optional wrapper string. Any failure yields `nil` (the web `return` no-op) so a
    /// malformed frame never bleeds a partial proposal.
    public static func from(_ result: SuggestGeofenceToolResult) -> SuggestGeofenceDraft? {
        guard result.name == toolName, result.ok, let data = result.data else { return nil }
        guard let inner = data["draft"]?.objectValue else { return nil }
        guard
            let locationNumber = inner["location_id"]?.numberValue,
            let vehicleNumber = inner["vehicle_id"]?.numberValue,
            let proposedName = inner["proposed_name"]?.stringValue,
            let radiusM = inner["radius_m"]?.numberValue,
            let centroidLat = inner["centroid_lat"]?.numberValue,
            let centroidLon = inner["centroid_lon"]?.numberValue,
            let status = data["status"]?.stringValue
        else {
            return nil
        }
        return SuggestGeofenceDraft(
            locationID: Int64(locationNumber),
            vehicleID: Int64(vehicleNumber),
            proposedName: proposedName,
            radiusM: radiusM,
            centroidLat: centroidLat,
            centroidLon: centroidLon,
            status: status,
            validationError: data["validation_error"]?.stringValue
        )
    }
}

// MARK: - Apply payload (web `onApplyDraft` argument)

/// The value forwarded to the parent's "Apply to form" callback — the native mirror of
/// the web `onApplyDraft({ name, latitude, longitude, radius })`. The AI panel never
/// writes to the API; the parent copies these into the canonical Add Geofence form and
/// the existing Save button remains the sole write path.
public struct SuggestGeofenceApplication: Equatable, Sendable {
    public let name: String
    public let latitude: Double
    public let longitude: Double
    public let radius: Double

    public init(name: String, latitude: Double, longitude: Double, radius: Double) {
        self.name = name
        self.latitude = latitude
        self.longitude = longitude
        self.radius = radius
    }
}

// MARK: - Stream lifecycle (web `AiStreamState`)

/// The user-facing stream lifecycle — the native port of the web
/// `'idle' | 'streaming' | 'paused-confirm' | 'done' | 'error'`. `pausedConfirm` blocks a
/// new `start()` (web `canStart`), `streaming` flips the button to "Helix is thinking…".
public enum SuggestGeofenceStreamPhase: Equatable, Sendable {
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
public enum SuggestGeofenceConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Feature gate (web `withAiFeature` / `useAiEnabled`)

/// The AI-Off gate state (ADR-015) — the native mirror of `useAiEnabled(feature)`.
/// `loading` shows skeleton chrome while the gate resolves; `off` collapses the surface to
/// nothing (web `withAiFeature` returns `null`); `on` renders the card.
public enum SuggestGeofenceGateState: String, Sendable, Equatable, CaseIterable {
    case loading
    case on
    case off
}

// MARK: - Pure button / output logic (web `AIFeatureCard` + `AiOutputPanel` branches)

/// The pure, view-free decision logic ported from `AIFeatureCard` and `AiOutputPanel`,
/// plus the rounded-radius formatter. Each function is a direct translation of a web
/// expression so the view is a pure function of these and every branch is unit tested.
public enum SuggestGeofenceLogic {
    /// Web `isBusy = stream.state === 'streaming' || stream.state === 'paused-confirm'`.
    public static func isBusy(_ phase: SuggestGeofenceStreamPhase) -> Bool {
        phase == .streaming || phase == .pausedConfirm
    }

    /// Web `canStart={locationId > 0 && stream.state !== 'paused-confirm'}`.
    public static func canStart(locationID: Int64, phase: SuggestGeofenceStreamPhase) -> Bool {
        locationID > 0 && phase != .pausedConfirm
    }

    /// Web `buttonDisabled = !canStart || isStreaming`, widened with the native leaf
    /// contract so the action cannot fire while offline (no stream is possible).
    public static func buttonDisabled(
        locationID: Int64,
        phase: SuggestGeofenceStreamPhase,
        connection: SuggestGeofenceConnection
    ) -> Bool {
        let canStart = canStart(locationID: locationID, phase: phase)
        return !canStart || phase == .streaming || connection == .offline
    }

    /// Web `AiOutputPanel` `hasAnything = text.length > 0 || state ∈ {streaming, error, done}`.
    public static func outputVisible(phase: SuggestGeofenceStreamPhase, hasText: Bool) -> Bool {
        hasText || phase == .streaming || phase == .done || phase.isError
    }

    /// Web `text.length === 0 && state === 'streaming'` → the animated thinking indicator.
    public static func thinkingVisible(phase: SuggestGeofenceStreamPhase, hasText: Bool) -> Bool {
        !hasText && phase == .streaming
    }

    /// Whether the resting "invite" card is showing (gate on, nothing streamed yet, no
    /// draft captured) — the native friendly empty/idle state.
    public static func isIdleInvite(phase: SuggestGeofenceStreamPhase, hasDraft: Bool, hasText: Bool) -> Bool {
        !hasDraft && !hasText && phase == .idle
    }

    /// Web `{Math.round(draft.radius_m)} m` — the rounded SI-meters radius display.
    public static func formattedRadius(_ meters: Double) -> String {
        "\(Int(meters.rounded())) m"
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary for the card from already-localised parts, so the spoken
/// content is asserted without rendering the view. Mirrors the visible reading order:
/// title, the current label (when present), then the proposal (name, radius, validator
/// rationale, and the rejected verdict).
public enum SuggestGeofenceAccessibility {
    /// The already-localised label set the summary stitches together, bundled so the
    /// builder stays a small, testable function with a tidy signature.
    public struct Labels: Sendable, Equatable {
        public let title: String
        public let proposed: String
        public let radius: String
        public let rejected: String

        public init(title: String, proposed: String, radius: String, rejected: String) {
            self.title = title
            self.proposed = proposed
            self.radius = radius
            self.rejected = rejected
        }
    }

    public static func summary(
        labels: Labels,
        currentLabel: String?,
        draft: SuggestGeofenceDraft?
    ) -> String {
        var parts: [String] = [labels.title]
        if let currentLabel, !currentLabel.isEmpty {
            parts.append(currentLabel)
        }
        if let draft {
            parts.append("\(labels.proposed): \(draft.proposedName)")
            parts.append("\(labels.radius): \(SuggestGeofenceLogic.formattedRadius(draft.radiusM))")
            if let validationError = draft.validationError, !validationError.isEmpty {
                parts.append(validationError)
            }
            if !draft.isOK {
                parts.append(labels.rejected)
            }
        }
        return parts.joined(separator: ". ")
    }
}
