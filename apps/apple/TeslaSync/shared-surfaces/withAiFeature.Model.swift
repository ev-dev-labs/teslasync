//
//  withAiFeature.Model.swift
//  TeslaSync — P4 shared surface · 0062 · withAiFeature (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the
//  observable view-model for the AI-Off visibility gate. The view binds through
//  `WithAiFeatureGateModel`; no networking lives in the view. The web HOC reads
//  `useAiEnabled(feature)` (which folds `useSettings`); the native model keeps the same data
//  contract — a source emits the gate + connectivity snapshot, the model derives the resolved
//  outcome, emits `view.opened` exactly once the first time the surface actually presents (mirroring
//  the web `data-ai-feature` marker, which is absent in off mode), and auto-refreshes once when the
//  snapshot transitions to stale.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the English fallback, so the Swift sources hold no
/// hardcoded prose. The web HOC carries no user-facing copy of its own (it is anonymous and
/// transparent), so the only entries are the DEBUG sample inner used by the previews; production
/// callers supply their own already-localized inner content. Keys live in the "withAiFeature"
/// table, folded into the app `Localizable.xcstrings` catalog at integration time; in test / preview
/// bundles `NSLocalizedString` returns the `value:` fallback, keeping the projection deterministic.
public enum WithAiFeatureStrings {
    public static let table = "withAiFeature"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol WithAiFeatureTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened`
/// event. The slug is a static, non-identifying constant.
public struct OSLogWithAiFeatureTelemetry: WithAiFeatureTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Context source seam (P1/S8 layer)

/// The seam the model binds through for the gate inputs — the settings-backed gate (web
/// `useAiEnabled(feature)`) and the P4 connectivity axis. The production app implements this over
/// the live settings store (`LiveWithAiFeatureGateSource`); previews and tests use
/// `InMemoryWithAiFeatureGateSource`. The feed is local + synchronous (no HTTP in the view).
@MainActor
public protocol WithAiFeatureGateSource: AnyObject {
    var onUpdate: (@MainActor (AiFeatureGateInput) -> Void)? { get set }
    func start()
    func stop()
    /// Re-requests the gate snapshot (stale / offline recovery + manual refresh).
    func refresh()
}

/// The production context source. Holds the host-provided gate snapshot and re-emits it on
/// `start`/`refresh` — the native binding point for the web `useSettings` → `useAiEnabled` read. The
/// feed is local + synchronous; the host re-creates the source when settings change.
@MainActor
public final class LiveWithAiFeatureGateSource: WithAiFeatureGateSource {
    public var onUpdate: (@MainActor (AiFeatureGateInput) -> Void)?

    private let input: AiFeatureGateInput

    public init(input: AiFeatureGateInput) {
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

/// In-memory context source for previews + unit / UI tests. Seeds an optional initial snapshot on
/// `start()` and lets a test push further snapshots via `push(_:)`. The call counters let the wiring
/// + delegation be asserted without a network.
@MainActor
public final class InMemoryWithAiFeatureGateSource: WithAiFeatureGateSource {
    public var onUpdate: (@MainActor (AiFeatureGateInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: AiFeatureGateInput?

    public init(initial: AiFeatureGateInput? = nil) {
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

    /// Pushes a gate snapshot to the bound model (test / preview affordance).
    public func push(_ input: AiFeatureGateInput) {
        onUpdate?(input)
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The gate's observable view-model. Binds a `WithAiFeatureGateSource` (gate + connectivity),
/// recomputes the resolved projection, exposes `isPresented` + the gate verdict + the `connection`
/// axis + the marker identifier, emits `view.opened` exactly once the first time the surface
/// presents (never while withdrawn — web `null` means the surface was never opened), and
/// auto-refreshes once when the snapshot transitions to stale.
@MainActor
@Observable
public final class WithAiFeatureGateModel {
    public private(set) var resolved: AiFeatureGateResolved

    /// `true` when the wrapped inner content renders (web `useAiEnabled` → `true`).
    public var isPresented: Bool {
        resolved.isPresented
    }

    /// The precise fail-closed verdict (diagnostics + tests).
    public var gate: AiFeatureGate {
        resolved.gate
    }

    /// The P4 connectivity axis carried by the latest snapshot.
    public var connection: AiFeatureGateConnection {
        resolved.connection
    }

    /// The accessibility identifier stamped on the presented inner (web `data-testid`).
    public var markerIdentifier: String {
        resolved.markerIdentifier
    }

    @ObservationIgnored private let source: any WithAiFeatureGateSource
    @ObservationIgnored private let telemetry: any WithAiFeatureTelemetry
    @ObservationIgnored private let testID: String?
    @ObservationIgnored private var input: AiFeatureGateInput
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        feature: String,
        source: any WithAiFeatureGateSource,
        telemetry: any WithAiFeatureTelemetry = OSLogWithAiFeatureTelemetry(),
        testID: String? = nil
    ) {
        self.source = source
        self.telemetry = telemetry
        self.testID = testID
        input = AiFeatureGateInput(featureID: feature)
        resolved = AiFeatureGateProjection.resolve(input, testID: testID)
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing the context. Idempotent; the `view.opened` event is emitted lazily the first
    /// time the surface actually presents (not here — the gate may resolve to withdrawn).
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

    /// Re-requests the context snapshot (stale / offline recovery + manual refresh).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: AiFeatureGateInput) {
        let previous = self.input
        self.input = input
        resolved = AiFeatureGateProjection.resolve(input, testID: testID)
        maybeEmitOpen()
        // Stale → one-shot auto-refresh on the transition; offline never auto-refreshes (there is no
        // connection to re-fetch over); returning to live re-arms the next stale episode.
        if input.connection == .stale, previous.connection != .stale {
            source.refresh()
        }
    }

    /// Emits `view.opened` exactly once, and only when the surface is actually presented — mirroring
    /// the web `data-ai-feature` marker, which is absent in off mode.
    private func maybeEmitOpen() {
        guard !didEmitOpen, resolved.isPresented else { return }
        didEmitOpen = true
        telemetry.viewOpened(surface: AiFeatureGateSurface.slug)
    }
}
