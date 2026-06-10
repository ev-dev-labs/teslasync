//
//  AIChatbotIndicator.Model.swift
//  TeslaSync — P4 shared surface · 0012 · AIChatbotIndicator (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the
//  observable view-model for the chatbot AI-mode indicator. The view binds through
//  `AIChatbotIndicatorModel`; no networking lives in the view. The web `InnerIndicator` only reads
//  `useTranslation` and is gated by `withAiFeature`/`useAiEnabled` (which folds `useSettings`); the
//  native model keeps the same data contract — a source emits the gate + connectivity snapshot and
//  the model derives the resolved view-state, emits `view.opened` once when the badge actually
//  presents, and auto-refreshes once when the snapshot goes stale.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol AIChatbotTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogAIChatbotTelemetry: AIChatbotTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Context source seam (P1/S8 layer)

/// The seam the model binds through for the surface inputs — the settings-backed gate (web
/// `useAiEnabled('chatbot-llm')`) and the P4 connectivity axis. The production app implements this
/// over the live settings store (`LiveAIChatbotIndicatorSource`); previews and tests use
/// `InMemoryAIChatbotIndicatorSource`. The feed is local + synchronous (no HTTP in the view).
@MainActor
public protocol AIChatbotIndicatorSource: AnyObject {
    var onUpdate: (@MainActor (AIChatbotIndicatorInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The production context source. Holds the host-provided settings snapshot and re-emits it on
/// `start`/`refresh` — the native binding point for the web `useSettings` → `useAiEnabled` read. The
/// feed is local + synchronous; the host re-creates the source (or pushes through a subclassable
/// hook) when settings change.
@MainActor
public final class LiveAIChatbotIndicatorSource: AIChatbotIndicatorSource {
    public var onUpdate: (@MainActor (AIChatbotIndicatorInput) -> Void)?

    private let input: AIChatbotIndicatorInput

    public init(input: AIChatbotIndicatorInput) {
        self.input = input
    }

    public func start() {
        emit()
    }

    public func stop() {}

    public func refresh() {
        emit()
    }

    private func emit() {
        onUpdate?(input)
    }
}

/// In-memory context source for previews + unit/UI tests. Seeds an optional initial snapshot on
/// `start()` and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryAIChatbotIndicatorSource: AIChatbotIndicatorSource {
    public var onUpdate: (@MainActor (AIChatbotIndicatorInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: AIChatbotIndicatorInput?

    public init(initial: AIChatbotIndicatorInput? = nil) {
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

    /// Pushes a context snapshot to the bound model (test/preview affordance).
    public func push(_ input: AIChatbotIndicatorInput) {
        onUpdate?(input)
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Binds an `AIChatbotIndicatorSource` (gate + connectivity),
/// recomputes the resolved projection, exposes a render `phase` + the `connection` axis, emits the
/// `view.opened` diagnostics event exactly once when the badge first presents (never while gated
/// off), and auto-refreshes once when the snapshot transitions to stale.
@MainActor
@Observable
public final class AIChatbotIndicatorModel {
    public private(set) var resolved: AIChatbotResolved = .init(phase: .loading, connection: .live)

    public var phase: AIChatbotResolved.Phase {
        resolved.phase
    }

    public var connection: AIChatbotConnection {
        resolved.connection
    }

    @ObservationIgnored private let source: any AIChatbotIndicatorSource
    @ObservationIgnored private let telemetry: any AIChatbotTelemetry
    @ObservationIgnored private var input = AIChatbotIndicatorInput()
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        source: any AIChatbotIndicatorSource,
        telemetry: any AIChatbotTelemetry = OSLogAIChatbotTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing the context. Idempotent; the `view.opened` event is emitted lazily the first
    /// time the badge actually presents (not here — the surface may resolve to gated-off).
    public func start() {
        guard !started else { return }
        started = true
        source.start()
    }

    /// Stops observing the context.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the context snapshot (freshness chip + offline/stale recovery).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: AIChatbotIndicatorInput) {
        let previous = self.input
        self.input = input
        recompute()
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch); offline never
        // auto-refreshes (there is no connection to re-fetch over).
        if input.connection == .stale, previous.connection != .stale {
            source.refresh()
        }
    }

    private func recompute() {
        resolved = AIChatbotProjection.resolve(input)
        // `view.opened` fires once, the first time the AI badge is actually shown (web `null` while
        // gated means the surface was never "opened"; loading / unavailable chrome is pre-present).
        if resolved.phase == .presented, !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: AIChatbotIndicatorMeta.surfaceSlug)
        }
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "AIChatbotIndicator" table (the web source keys `helix.*`
/// plus the native P4 chrome), folded into the app `Localizable.xcstrings` catalog at integration
/// time; kept per-surface so each parallel prompt owns its own strings.
public enum AIChatbotStrings {
    public static let table = "AIChatbotIndicator"

    public static let string: AIChatbotResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
