//
//  AIAutoTripNameSuggestion.Model.swift
//  TeslaSync — P4 shared surface · 0007 · AIAutoTripNameSuggestion (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the
//  pure projection for the auto trip-name suggestion surface. The view binds through
//  `AITripNameModel`; no networking lives in the view. The web `InnerSection` reads `tripId` (its
//  `canStart`), reads the AI feature flag through `withAiFeature`, and owns a `useAiStream` handle;
//  the native model keeps the same data contract — a context source emits the gate + trip +
//  connectivity snapshot, a stream driver emits the accumulated `useAiStream` snapshot, and the
//  model derives the resolved view-state over both.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol AITripNameTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened`
/// event.
public struct OSLogAITripNameTelemetry: AITripNameTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound trip context — the orthogonal connectivity axis rendered as the
/// freshness chip. `live` hides the chip; `stale` / `offline` show it. `offline` also disables the
/// Generate affordance (the stream cannot be opened without a connection).
public enum AITripNameConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (gate + trip + connectivity)

/// One coalesced snapshot of the surface's non-stream inputs — whether the AI feature is enabled
/// (web `useAiEnabled('auto-trip-naming')`), the bound trip id (web `tripId` prop → `canStart`),
/// the connectivity axis, and a parent loading flag. The stream lifecycle is tracked separately
/// via the stream driver.
public struct AITripNameInput: Sendable, Equatable {
    public var featureEnabled: Bool
    public var tripID: String?
    public var connection: AITripNameConnection
    public var isLoading: Bool

    public init(
        featureEnabled: Bool = true,
        tripID: String? = nil,
        connection: AITripNameConnection = .live,
        isLoading: Bool = false
    ) {
        self.featureEnabled = featureEnabled
        self.tripID = tripID
        self.connection = connection
        self.isLoading = isLoading
    }

    /// Whether the feature has the inputs it needs to fire the stream — the native port of web
    /// `canStart = !!tripId`, additionally gated on connectivity (an offline surface cannot open
    /// the SSE connection).
    public var canStart: Bool {
        featureEnabled && tripID != nil && !(tripID?.isEmpty ?? true) && connection != .offline
    }

    /// Whether a trip is bound at all (drives the empty-hint wording).
    public var hasTrip: Bool {
        !(tripID?.isEmpty ?? true)
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — `phase` selects the output body while `canStart` / `isStreaming`
/// drive the always-present action button, so the view is a pure function of this value.
public struct AITripNameResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// Web `withAiFeature` gate off → no AI surface renders (ADR-015 AI-Off contract).
        case gatedOff
        /// Parent still resolving the trip context → skeleton card chrome.
        case loading
        /// Resolved, no suggestion requested yet → friendly idle output, never a blank box.
        case idle
        /// Stream open, first delta not yet arrived → Helix thinking indicator.
        case thinking
        /// Streamed / final propose-only name suggestion.
        case suggestion(String)
        /// Stream ended in error (web `AiOutputPanel` error branch) → retry affordance.
        case error(String)
    }

    public let phase: Phase
    public let canStart: Bool
    public let isStreaming: Bool
    public let hasTrip: Bool

    public init(phase: Phase, canStart: Bool, isStreaming: Bool, hasTrip: Bool) {
        self.phase = phase
        self.canStart = canStart
        self.isStreaming = isStreaming
        self.hasTrip = hasTrip
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

/// Pure projection from the context snapshot + the accumulated stream snapshot to the resolved
/// view-state — the native port of the web composition (`withAiFeature` gate → `AIFeatureCard`
/// header + `AiOutputPanel` body) plus the P4 leaf contract. Unit tested across every branch.
public enum AITripNameProjection {
    public static func resolve(_ input: AITripNameInput, _ stream: AiStreamSnapshot) -> AITripNameResolved {
        let phase = resolvePhase(input, stream)
        return AITripNameResolved(
            phase: phase,
            canStart: input.canStart,
            isStreaming: stream.lifecycle == .streaming,
            hasTrip: input.hasTrip
        )
    }

    private static func resolvePhase(
        _ input: AITripNameInput,
        _ stream: AiStreamSnapshot
    ) -> AITripNameResolved.Phase {
        // Web `withAiFeature`: feature off → the AI surface does not render at all.
        guard input.featureEnabled else { return .gatedOff }
        // Parent context still resolving and no stream activity yet → skeleton chrome.
        if input.isLoading, stream.lifecycle == .idle { return .loading }
        // Web `AiOutputPanel`: terminal error wins.
        if stream.lifecycle == .error {
            return .error(stream.error ?? "")
        }
        // Streamed text present (still streaming, done, or paused) → show the proposal.
        if !stream.text.isEmpty {
            return .suggestion(stream.text)
        }
        // Stream open, no delta yet → the thinking indicator (web `AIThinkingIndicator`).
        if stream.lifecycle == .streaming {
            return .thinking
        }
        // Resolved, nothing requested → friendly idle output (never a blank box).
        return .idle
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Binds an `AITripNameSource` (gate + trip + connectivity)
/// and an `AITripNameStreamDriver` (the `useAiStream` port), recomputes the resolved projection,
/// exposes a render `phase` + the `connection` axis, drives `generate()` / `cancel()` against the
/// stream, emits the `view.opened` diagnostics event, and auto-refreshes once when the context
/// transitions to stale.
@MainActor
@Observable
public final class AITripNameModel {
    public private(set) var resolved: AITripNameResolved = .init(
        phase: .loading, canStart: false, isStreaming: false, hasTrip: false
    )
    public private(set) var connection: AITripNameConnection = .live

    public var phase: AITripNameResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any AITripNameSource
    @ObservationIgnored private let streamDriver: any AITripNameStreamDriver
    @ObservationIgnored private let telemetry: any AITripNameTelemetry
    @ObservationIgnored private var input = AITripNameInput()
    @ObservationIgnored private var stream = AiStreamSnapshot.idle
    @ObservationIgnored private var started = false

    public init(
        source: any AITripNameSource,
        streamDriver: any AITripNameStreamDriver,
        telemetry: any AITripNameTelemetry = OSLogAITripNameTelemetry()
    ) {
        self.source = source
        self.streamDriver = streamDriver
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
        streamDriver.onUpdate = { [weak self] snapshot in self?.applyStream(snapshot) }
    }

    /// Begins observing the context and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: AITripNameEndpoint.surfaceSlug)
        source.start()
    }

    /// Stops observing the context and aborts any in-flight stream.
    public func stop() {
        started = false
        streamDriver.cancel()
        source.stop()
    }

    /// Opens the propose-only name stream (web `stream.start()` behind the Ask Helix button).
    /// A no-op while a stream is already in flight or when the inputs are not ready (web
    /// `canStart`/streaming guards on the button).
    public func generate() {
        guard input.canStart, stream.lifecycle != .streaming else { return }
        stream = AiStreamReducer.started()
        recompute()
        streamDriver.start(path: AITripNameEndpoint.draftPath(tripID: input.tripID))
    }

    /// Aborts the in-flight stream (web `useAiStream.cancel()`).
    public func cancel() {
        streamDriver.cancel()
    }

    /// Re-requests the context snapshot (freshness chip + offline/stale recovery).
    public func refresh() {
        source.refresh()
    }

    /// Error-tile retry → re-run the suggestion stream from a clean slate.
    public func retry() {
        generate()
    }

    private func apply(_ input: AITripNameInput) {
        self.input = input
        let previous = connection
        connection = input.connection
        recompute()
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }

    private func applyStream(_ snapshot: AiStreamSnapshot) {
        stream = snapshot
        recompute()
    }

    private func recompute() {
        resolved = AITripNameProjection.resolve(input, stream)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "AIAutoTripNameSuggestion" table (the web source keys
/// `trips.detail.aiSuggestName.*` plus the shared `helix.*` / `ai.common.*` card keys plus the
/// native P4 chrome), folded into the app `Localizable.xcstrings` catalog at integration time;
/// kept per-surface so each parallel prompt owns its own strings.
public enum AITripNameStrings {
    public static let table = "AIAutoTripNameSuggestion"

    public static let string: AITripNameResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
