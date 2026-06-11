//
//  FreshnessIndicator.Model.swift
//  TeslaSync — P4 shared surface · 0090 · FreshnessIndicator (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the clock seam, the i18n facade
//  (P1/S10), and the observable view-model for the freshness indicator. The view binds through
//  `FreshnessIndicatorModel`; no networking lives in the view. A source emits the timestamp snapshot
//  (the web `timestamp` prop / `useIsStale` input), the model recomputes the resolved readout against
//  an injected clock on every snapshot and every 10s tick (the web `setInterval` re-render), emits
//  `view.opened` once when the readout first presents, and fires a one-shot refresh when the datum
//  ages into the stale band (the P4 leaf "stale → auto-refresh" contract).
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol FreshnessTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogFreshnessTelemetry: FreshnessTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Context source seam (P1/S8 layer)

/// The seam the model binds through for the surface input — the timestamp feed plus its fetch
/// lifecycle (web `timestamp` prop / `useIsStale` input). The production app implements this over the
/// live datum store (`LiveFreshnessIndicatorSource`); previews and tests use
/// `InMemoryFreshnessIndicatorSource`. The feed is local + synchronous (no HTTP in the view).
@MainActor
public protocol FreshnessIndicatorSource: AnyObject {
    var onUpdate: (@MainActor (FreshnessInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The production context source. Holds the host-provided timestamp snapshot and re-emits it on
/// `start`/`refresh` — the native binding point for the web `timestamp` prop read. The feed is local
/// + synchronous; the host re-creates the source (or pushes through a subclassable hook) when the
/// datum's timestamp changes.
@MainActor
public final class LiveFreshnessIndicatorSource: FreshnessIndicatorSource {
    public var onUpdate: (@MainActor (FreshnessInput) -> Void)?

    private let input: FreshnessInput

    public init(input: FreshnessInput) {
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
public final class InMemoryFreshnessIndicatorSource: FreshnessIndicatorSource {
    public var onUpdate: (@MainActor (FreshnessInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: FreshnessInput?

    public init(initial: FreshnessInput? = nil) {
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

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ input: FreshnessInput) {
        onUpdate?(input)
    }
}

// MARK: - Clock seam

/// The "now" source the projection ages timestamps against — injected so tests advance time
/// deterministically instead of waiting on a wall clock. Defaults to the system clock.
public typealias FreshnessClock = @Sendable () -> Date

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Binds a `FreshnessIndicatorSource` (the timestamp feed),
/// recomputes the resolved readout against the injected clock on every snapshot and every tick,
/// exposes the render `phase` plus the `useIsStale` verdict, emits the `view.opened` diagnostics
/// event exactly once when the readout first presents, and fires a one-shot refresh on the fresh→
/// stale transition (re-armed once the datum leaves the stale band).
@MainActor
@Observable
public final class FreshnessIndicatorModel {
    public private(set) var resolved: FreshnessResolved

    public var phase: FreshnessResolved.Phase {
        resolved.phase
    }

    /// The `useIsStale` verdict for the current snapshot — surfaced for host warning banners.
    public var stale: FreshnessStaleReadout {
        resolved.stale
    }

    public let config: FreshnessConfig

    @ObservationIgnored private let source: any FreshnessIndicatorSource
    @ObservationIgnored private let telemetry: any FreshnessTelemetry
    @ObservationIgnored private let clock: FreshnessClock
    @ObservationIgnored private let strings: FreshnessResolve
    @ObservationIgnored private var input = FreshnessInput()
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var lastStatus: FreshnessStatus?

    public init(
        source: any FreshnessIndicatorSource,
        config: FreshnessConfig = .default,
        telemetry: any FreshnessTelemetry = OSLogFreshnessTelemetry(),
        clock: @escaping FreshnessClock = { Date() },
        strings: @escaping FreshnessResolve = FreshnessStrings.string
    ) {
        self.source = source
        self.config = config
        self.telemetry = telemetry
        self.clock = clock
        self.strings = strings
        resolved = FreshnessProjection.resolve(FreshnessInput(), config: config, now: clock(), strings: strings)
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing the timestamp feed. Idempotent; the `view.opened` event is emitted lazily the
    /// first time the readout actually presents (loading / unavailable chrome is pre-present).
    public func start() {
        guard !started else { return }
        started = true
        source.start()
    }

    /// Stops observing the feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the snapshot (manual retry + the freshness auto-refresh).
    public func refresh() {
        source.refresh()
    }

    /// Recomputes the relative-time readout from the last snapshot against the current clock — the
    /// native port of the web 10s `setInterval` re-render. Driven by the view's periodic task.
    public func tick() {
        recompute()
    }

    private func apply(_ input: FreshnessInput) {
        self.input = input
        recompute()
    }

    private func recompute() {
        resolved = FreshnessProjection.resolve(input, config: config, now: clock(), strings: strings)

        if case .ready = resolved.phase, !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: FreshnessIndicatorMeta.surfaceSlug)
        }

        // Fresh → stale transition arms a single auto-refresh (the P4 leaf "stale → auto-refresh"
        // contract): ask the host to re-fetch the datum the moment it crosses the stale threshold.
        // `lastStatus` is updated before the refresh so the re-emit it triggers cannot re-arm it; the
        // arm re-enables once the datum leaves the stale band (back to fresh, or on to offline).
        let newStatus = resolved.readyStatus
        let wasStale = lastStatus == .stale
        lastStatus = newStatus
        if newStatus == .stale, !wasStale {
            source.refresh()
        }
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. The web source is anonymous (hardcoded literals like "just now" / "—"); the
/// fallbacks reproduce those verbatim. Keys live in the "FreshnessIndicator" table, folded into the
/// app `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt
/// owns its own strings.
public enum FreshnessStrings {
    public static let table = "FreshnessIndicator"

    public static let string: FreshnessResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
