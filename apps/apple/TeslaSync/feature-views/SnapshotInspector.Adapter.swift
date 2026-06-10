//
//  SnapshotInspector.Adapter.swift
//  TeslaSync — P4 feature view · 0234 · SnapshotInspector (Apple)
//
//  The domain shapes for the FSM-debugger snapshot inspector — the native parity of the
//  web `FSMTransition` + `SignalSnapshotResponse` + `SourceLayerBadge` `SignalSource`.
//  Pure and dependency-free (Foundation only) so they unit-test without a bundle. The
//  render-decision projection lives in SnapshotInspector.Projection.swift; the JSON value
//  model in SnapshotInspector.JSON.swift.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable, non-identifying diagnostics slug emitted with the `view.opened` event, in
/// the dependency-free core so the projection's unit tests can reach it.
public enum SnapshotInspectorSurface {
    /// The diagnostics slug emitted with the `view.opened` event.
    public static let slug = "SnapshotInspector"

    /// Reports the surface becoming visible. Factored out so the open path is unit testable
    /// without a rendering host (the model calls this from `start()`).
    public static func reportOpen(to telemetry: any SnapshotInspectorTelemetry) {
        telemetry.viewOpened(surface: slug)
    }
}

// MARK: - Source layer (web `SourceLayerBadge` `SignalSource`)

/// Where a signal value came from — the native parity of the web `SignalSource`
/// (`l1 | l2 | log | stale | unknown`). Drives the inline source-layer badge so power
/// users can tell a hot L1 read from an L2 cross-pod read or a replayed history value.
public enum SignalSourceLayer: String, Sendable, Equatable, CaseIterable {
    case l1
    case l2
    case log
    case stale
    case unknown

    /// Maps the raw backend layer string (case-insensitive) to a case, with `unknown` as
    /// the fallback (web `STYLE[key] ?? STYLE.unknown`).
    public init(raw: String?) {
        switch raw?.lowercased() {
        case "l1": self = .l1
        case "l2": self = .l2
        case "log": self = .log
        case "stale": self = .stale
        default: self = .unknown
        }
    }

    /// The badge glyph (web `STYLE.label`).
    public var badgeLabel: String {
        switch self {
        case .l1: "L1"
        case .l2: "L2"
        case .log: "LOG"
        case .stale: "STALE"
        case .unknown: "—"
        }
    }

    /// The tooltip / VoiceOver description key (web `STYLE.descKey`).
    public var descriptionKey: String {
        switch self {
        case .l1: "sourceLayer.l1.desc"
        case .l2: "sourceLayer.l2.desc"
        case .log: "sourceLayer.log.desc"
        case .stale: "sourceLayer.stale.desc"
        case .unknown: "sourceLayer.unknown.desc"
        }
    }

    /// The English fallback for ``descriptionKey`` (web `STYLE.descFallback`).
    public var descriptionFallback: String {
        switch self {
        case .l1: "Read from the in-process SignalStore (hot path, freshest)."
        case .l2: "Read from Redis cross-pod cache (legacy entry; freshness unknown)."
        case .log: "Replayed from signal_log (durable history)."
        case .stale: "Redis-backed value older than the 2-minute freshness window."
        case .unknown: "Source layer unknown."
        }
    }
}

/// Formats a signal age in ms as a coarse magnitude — the faithful port of the web
/// `SourceLayerBadge.formatAge` (ms / s / min / h / d). `nil` for an absent / non-finite
/// age. The unit abbreviations are non-prose symbols, hardcoded in the web source too.
public enum SnapshotAge {
    public static func format(_ milliseconds: Double?) -> String? {
        guard let milliseconds, milliseconds.isFinite else { return nil }
        if milliseconds < 1000 { return "\(Int(milliseconds.rounded())) ms" }
        if milliseconds < 60000 { return String(format: "%.1f s", milliseconds / 1000) }
        if milliseconds < 3_600_000 { return "\(Int((milliseconds / 60000).rounded())) min" }
        if milliseconds < 86_400_000 { return String(format: "%.1f h", milliseconds / 3_600_000) }
        return String(format: "%.1f d", milliseconds / 86_400_000)
    }
}

// MARK: - Domain shape (web `FSMTransition` / `SignalSnapshotResponse`)

/// One FSM transition — the native parity of the web `FSMTransition`. `details` carries the
/// raw transition details object so the duration cell + the copy payload reproduce the web
/// shape exactly; `durationInStateMs` extracts the one field the header reads.
public struct SnapshotTransition: Sendable, Equatable {
    public let id: Int
    public let vehicleID: Int
    public let ts: String
    public let fsmName: String
    public let fromState: String
    public let toState: String
    public let trigger: String
    public let details: SnapshotValue?

    public init(
        id: Int,
        vehicleID: Int,
        ts: String,
        fsmName: String,
        fromState: String,
        toState: String,
        trigger: String,
        details: SnapshotValue? = nil
    ) {
        self.id = id
        self.vehicleID = vehicleID
        self.ts = ts
        self.fsmName = fsmName
        self.fromState = fromState
        self.toState = toState
        self.trigger = trigger
        self.details = details
    }

    /// Web `transition.details?.duration_in_state_ms` — only when it is a number.
    public var durationInStateMs: Double? {
        guard case let .object(members)? = details else { return nil }
        for member in members where member.key == "duration_in_state_ms" {
            if case let .number(magnitude) = member.value { return magnitude }
        }
        return nil
    }

    /// The web `FSMTransition` JSON object (ordered), for the copy payload.
    var jsonValue: SnapshotValue {
        var members: [SnapshotMember] = [
            SnapshotMember("id", .number(Double(id))),
            SnapshotMember("vehicle_id", .number(Double(vehicleID))),
            SnapshotMember("ts", .string(ts)),
            SnapshotMember("fsm_name", .string(fsmName)),
            SnapshotMember("from_state", .string(fromState)),
            SnapshotMember("to_state", .string(toState)),
            SnapshotMember("trigger", .string(trigger))
        ]
        if let details {
            members.append(SnapshotMember("details", details))
        }
        return .object(members)
    }
}

/// One captured signal — the native parity of the web `SignalSnapshotEntry`
/// (`{ value, timestamp?, source?, age_ms? }`).
public struct SnapshotSignalEntry: Sendable, Equatable {
    public let value: SnapshotValue
    public let timestamp: String?
    public let source: SignalSourceLayer?
    public let ageMs: Double?

    public init(
        value: SnapshotValue,
        timestamp: String? = nil,
        source: SignalSourceLayer? = nil,
        ageMs: Double? = nil
    ) {
        self.value = value
        self.timestamp = timestamp
        self.source = source
        self.ageMs = ageMs
    }

    /// The web `SignalSnapshotEntry` JSON object (ordered, undefined fields omitted), for
    /// the copy payload.
    var jsonValue: SnapshotValue {
        var members: [SnapshotMember] = [SnapshotMember("value", value)]
        if let timestamp { members.append(SnapshotMember("timestamp", .string(timestamp))) }
        if let source { members.append(SnapshotMember("source", .string(source.rawValue))) }
        if let ageMs { members.append(SnapshotMember("age_ms", .number(ageMs))) }
        return .object(members)
    }
}

/// A point-in-time signal snapshot — the native parity of the web `SignalSnapshotResponse`
/// (the inspector reads `signals` + `at`).
public struct SnapshotSignalSet: Sendable, Equatable {
    public let vehicleID: Int
    public let at: String?
    public let signals: [String: SnapshotSignalEntry]

    public init(vehicleID: Int, at: String? = nil, signals: [String: SnapshotSignalEntry]) {
        self.vehicleID = vehicleID
        self.at = at
        self.signals = signals
    }
}
