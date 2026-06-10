//
//  AIFeatureCard.Model.swift
//  TeslaSync — P4 shared surface · 0018 · AIFeatureCard (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the
//  observable view-model for the reusable AI-feature scaffold. The view binds through
//  `AIFeatureCardModel`; no networking lives in the view. The web `AIFeatureCard` only reads
//  `useTranslation` and is driven by an injected `stream` slice + `canStart`; the native model keeps
//  the same data contract — a source pushes the coalesced lifecycle snapshot, the model derives the
//  resolved view-state, emits `view.opened` once when the card first appears (the scaffold is not
//  gated, so it always presents), auto-refreshes once when the snapshot goes stale, and forwards the
//  action tap to the source (web `stream.start()` / `onAction`).
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol AIFeatureCardTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogAIFeatureCardTelemetry: AIFeatureCardTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Context source seam (P1/S8 layer)

/// The seam the model binds through for the card lifecycle — the injected stream slice (web
/// `useAiStream` `state` / `text` / `error`), `canStart`, and the P4 connectivity axis, coalesced
/// into one snapshot. The production app implements this over the per-feature stream
/// (`LiveAIFeatureCardSource`); previews and tests use `InMemoryAIFeatureCardSource`. `act()` is the
/// native port of `stream.start()` / the `onAction` override — the card owns no networking, so it
/// forwards the tap to the source that owns the stream.
@MainActor
public protocol AIFeatureCardSource: AnyObject {
    var onUpdate: (@MainActor (AIFeatureCardInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
    func act()
}

/// The production context source. Holds the host-provided lifecycle snapshot and an `onAct` closure
/// (web `stream.start()` / `onAction`), re-emitting the snapshot on `start` / `refresh`. The host
/// re-creates the source (or pushes through a subclassable hook) as the stream progresses.
@MainActor
public final class LiveAIFeatureCardSource: AIFeatureCardSource {
    public var onUpdate: (@MainActor (AIFeatureCardInput) -> Void)?

    private let input: AIFeatureCardInput
    private let onAct: @MainActor () -> Void

    public init(input: AIFeatureCardInput, onAct: @escaping @MainActor () -> Void) {
        self.input = input
        self.onAct = onAct
    }

    public func start() {
        emit()
    }

    public func stop() {}

    public func refresh() {
        emit()
    }

    public func act() {
        onAct()
    }

    private func emit() {
        onUpdate?(input)
    }
}

/// In-memory context source for previews + unit/UI tests. Seeds an optional initial snapshot on
/// `start()` and lets a test push further snapshots via `push(_:)`, while counting every seam call.
@MainActor
public final class InMemoryAIFeatureCardSource: AIFeatureCardSource {
    public var onUpdate: (@MainActor (AIFeatureCardInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var actCount = 0

    private let initial: AIFeatureCardInput?

    public init(initial: AIFeatureCardInput? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    public func act() {
        actCount += 1
    }

    /// Pushes a lifecycle snapshot to the bound model (test/preview affordance).
    public func push(_ input: AIFeatureCardInput) {
        onUpdate?(input)
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Binds an `AIFeatureCardSource`, recomputes the resolved
/// projection, exposes the lifecycle phase + derived render flags + the connectivity axis, emits the
/// `view.opened` diagnostics event exactly once when the card first appears (the scaffold always
/// presents — unlike the gated per-feature surfaces), auto-refreshes once when the snapshot
/// transitions to stale, and forwards the action tap to the source.
@MainActor
@Observable
public final class AIFeatureCardModel {
    public private(set) var resolved: AIFeatureCardResolved = AIFeatureCardProjection
        .resolve(AIFeatureCardInput())

    @ObservationIgnored private let source: any AIFeatureCardSource
    @ObservationIgnored private let telemetry: any AIFeatureCardTelemetry
    @ObservationIgnored private var input = AIFeatureCardInput()
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        source: any AIFeatureCardSource,
        telemetry: any AIFeatureCardTelemetry = OSLogAIFeatureCardTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    // MARK: Derived render state (web `stream` slice + `AiOutputPanel`)

    /// The stream lifecycle (web `stream.state`).
    public var phase: AIFeatureStreamPhase {
        resolved.phase
    }

    /// The P4 connectivity axis decorating the card.
    public var connection: AIFeatureCardConnection {
        resolved.connection
    }

    /// Web `disabled = !canStart || streaming` (+ offline, native leaf contract).
    public var buttonDisabled: Bool {
        resolved.buttonDisabled
    }

    /// Web `stream.state === 'streaming'` — flips the button to "Helix is thinking…".
    public var isStreaming: Bool {
        resolved.isStreaming
    }

    /// The resolved output-panel branch (web `AiOutputPanel`).
    public var output: AIFeatureOutputState {
        resolved.output
    }

    /// Whether the action can fire (web `canStart`) — drives the empty-hint visibility.
    public var canStart: Bool {
        resolved.canStart
    }

    // MARK: Lifecycle

    /// Begins observing the lifecycle source and emits `view.opened` once (the scaffold always
    /// presents). Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        source.start()
        emitOpenOnce()
    }

    /// Stops observing the source.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the lifecycle snapshot (freshness chip + offline/stale recovery).
    public func refresh() {
        source.refresh()
    }

    /// Fires the universal Helix action (web `onAction ?? stream.start()`), forwarded to the source
    /// that owns the stream. No-ops while the action is disabled so the card can't double-fire.
    public func action() {
        guard !resolved.buttonDisabled else { return }
        source.act()
    }

    private func apply(_ input: AIFeatureCardInput) {
        let previous = self.input
        self.input = input
        resolved = AIFeatureCardProjection.resolve(input)
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch); offline never
        // auto-refreshes (there is no connection to re-fetch over).
        if input.connection == .stale, previous.connection != .stale {
            source.refresh()
        }
    }

    private func emitOpenOnce() {
        guard !didEmitOpen else { return }
        didEmitOpen = true
        telemetry.viewOpened(surface: AIFeatureCardMeta.surfaceSlug)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "AIFeatureCard" table (the web source keys `helix.*` plus
/// the native P4 chrome), folded into the app `Localizable.xcstrings` catalog at integration time;
/// kept per-surface so each parallel prompt owns its own strings.
public enum AIFeatureCardStrings {
    public static let table = "AIFeatureCard"

    public static let string: AIFeatureCardResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
