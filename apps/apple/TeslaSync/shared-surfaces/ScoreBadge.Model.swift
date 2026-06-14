//
//  ScoreBadge.Model.swift
//  TeslaSync — P4 shared surface · 0103 · ScoreBadge (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the
//  observable view-model for the score badge. The view binds through `ScoreBadgeModel`; no networking
//  lives in the view. A source emits the `score`/`grade` + freshness/connectivity snapshot (the web
//  props plus the host fetch lifecycle), the model recomputes the resolved projection, emits
//  `view.opened` once when the badge first presents, and fires a one-shot refresh when the value
//  crosses into the `stale` band (the P4 leaf "stale → auto-refresh" contract). The web badge is
//  prop-driven with no `setInterval`, so the model has no clock tick — it recomputes only on a new
//  snapshot.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol ScoreBadgeTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogScoreBadgeTelemetry: ScoreBadgeTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Context source seam (P1/S8 layer)

/// The seam the model binds through for the surface input — the score feed plus its fetch lifecycle
/// (web `score`/`grade` props). The production app implements this over the host's resolved score
/// (`LiveScoreBadgeSource`); previews and tests use `InMemoryScoreBadgeSource`. The feed is local +
/// synchronous (no HTTP in the view).
@MainActor
public protocol ScoreBadgeSource: AnyObject {
    var onUpdate: (@MainActor (ScoreBadgeInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The production context source. Holds the host-provided snapshot and re-emits it on
/// `start`/`refresh` — the native binding point for the web `score`/`grade` prop read. The feed is
/// local + synchronous; the host re-creates the source when the scored value changes.
@MainActor
public final class LiveScoreBadgeSource: ScoreBadgeSource {
    public var onUpdate: (@MainActor (ScoreBadgeInput) -> Void)?

    private let input: ScoreBadgeInput

    public init(input: ScoreBadgeInput) {
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
public final class InMemoryScoreBadgeSource: ScoreBadgeSource {
    public var onUpdate: (@MainActor (ScoreBadgeInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ScoreBadgeInput?

    public init(initial: ScoreBadgeInput? = nil) {
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
    public func push(_ input: ScoreBadgeInput) {
        onUpdate?(input)
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Binds a `ScoreBadgeSource` (the score feed), recomputes the
/// resolved projection on every snapshot, exposes the render `phase`, the static `config`, and the
/// `stale` / `offline` decorations, emits the `view.opened` diagnostics event exactly once when the
/// badge first presents, and fires a one-shot refresh on the transition into the `stale` band
/// (re-armed once the value leaves stale; never armed while offline — there is no connection to
/// re-fetch over).
@MainActor
@Observable
public final class ScoreBadgeModel {
    public private(set) var resolved: ScoreBadgeResolved

    public var phase: ScoreBadgeResolved.Phase {
        resolved.phase
    }

    /// Whether the snapshot is past the freshness window — surfaced so the view can decorate the
    /// ready badge and the model can arm the auto-refresh.
    public var stale: Bool {
        resolved.stale
    }

    /// Whether the snapshot is offline — surfaced so the view can decorate the cached badge.
    public var offline: Bool {
        resolved.offline
    }

    public let config: ScoreBadgeConfig

    @ObservationIgnored private let source: any ScoreBadgeSource
    @ObservationIgnored private let telemetry: any ScoreBadgeTelemetry
    @ObservationIgnored private let strings: ScoreBadgeResolve
    @ObservationIgnored private var input = ScoreBadgeInput()
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var wasStale = false

    public init(
        source: any ScoreBadgeSource,
        config: ScoreBadgeConfig = .default,
        telemetry: any ScoreBadgeTelemetry = OSLogScoreBadgeTelemetry(),
        strings: @escaping ScoreBadgeResolve = ScoreBadgeStrings.string
    ) {
        self.source = source
        self.config = config
        self.telemetry = telemetry
        self.strings = strings
        resolved = ScoreBadgeProjection.resolve(ScoreBadgeInput(), config: config, strings: strings)
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing the source feed. Idempotent; the `view.opened` event is emitted lazily the
    /// first time the badge actually presents (loading / unavailable chrome is pre-present).
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

    /// Re-requests the snapshot (manual retry + the stale auto-refresh).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: ScoreBadgeInput) {
        self.input = input
        recompute()
    }

    private func recompute() {
        resolved = ScoreBadgeProjection.resolve(input, config: config, strings: strings)

        if case .ready = resolved.phase, !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: ScoreBadgeMeta.surfaceSlug)
        }

        // Crossing into the `stale` band arms a single auto-refresh (the P4 leaf "stale →
        // auto-refresh" contract): ask the host to re-fetch the moment the value goes stale, in case
        // a fresher score is now available. `wasStale` is updated before the refresh so the re-emit it
        // triggers cannot re-arm it; the arm re-enables once the value leaves the stale band. An
        // offline snapshot never auto-refreshes — there is no connection to re-fetch over — matching
        // the offline branch of the shared P4 leaf surfaces.
        let nowStale = resolved.stale
        let crossedIntoStale = nowStale && !wasStale
        wasStale = nowStale
        if crossedIntoStale, !resolved.offline {
            source.refresh()
        }
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "ScoreBadge" table (the web `score.aria` key plus the lifted
/// grade glyphs and the native P4 chrome), folded into the app `Localizable.xcstrings` catalog at
/// integration time; kept per-surface so each parallel prompt owns its own strings.
public enum ScoreBadgeStrings {
    public static let table = "ScoreBadge"

    public static let string: ScoreBadgeResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
