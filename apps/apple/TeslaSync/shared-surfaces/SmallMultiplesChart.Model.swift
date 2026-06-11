//
//  SmallMultiplesChart.Model.swift
//  TeslaSync — P4 shared surface · 0073 · SmallMultiplesChart (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the
//  observable view-model for the small-multiples grid. The view binds through
//  `SmallMultiplesChartModel`; no networking lives in the view. The web component is purely
//  presentational (it takes `data` + `series` and renders), so the native model's job is the P4 leaf
//  contract around it: it binds a context source for the resolved payload + connectivity, derives the
//  resolved projection, forwards each cell drill-in to the host (the web `onCellClick` side effect),
//  emits `view.opened` once when the grid first presents content, and auto-refreshes once when the
//  snapshot goes stale.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol SmallMultiplesTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogSmallMultiplesTelemetry: SmallMultiplesTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Context source seam (P1/S8 layer)

/// The seam the model binds through for the surface feed — the host's resolved payload (web `data` +
/// `series`) plus the P4 connectivity axis. The production app implements this over the live data
/// store (`LiveSmallMultiplesSource`); previews and tests use `InMemorySmallMultiplesSource`. The
/// feed is local + synchronous (no HTTP in the view).
@MainActor
public protocol SmallMultiplesSource: AnyObject {
    var onUpdate: (@MainActor (SmallMultiplesInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The production context source. Holds the host-provided feed and re-emits it on `start`/`refresh` —
/// the native binding point for the host's resolved payload. The feed is local + synchronous; the
/// host re-creates the source (or pushes through a subclass) when the payload changes.
@MainActor
public final class LiveSmallMultiplesSource: SmallMultiplesSource {
    public var onUpdate: (@MainActor (SmallMultiplesInput) -> Void)?

    private let input: SmallMultiplesInput

    public init(input: SmallMultiplesInput) {
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

/// In-memory context source for previews + unit/UI tests. Seeds an optional initial feed on
/// `start()` and lets a test push further feeds via `push(_:)`.
@MainActor
public final class InMemorySmallMultiplesSource: SmallMultiplesSource {
    public var onUpdate: (@MainActor (SmallMultiplesInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SmallMultiplesInput?

    public init(initial: SmallMultiplesInput? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial {
            onUpdate?(initial)
        }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a feed to the bound model (test/preview affordance).
    public func push(_ input: SmallMultiplesInput) {
        onUpdate?(input)
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Binds a `SmallMultiplesSource` (payload + connectivity),
/// recomputes the resolved projection, exposes the resolved view-state, forwards each cell drill-in
/// to the host (the web `onCellClick` side effect), emits the `view.opened` diagnostics event exactly
/// once when the grid first presents its content (never while loading / errored / withdrawn), and
/// auto-refreshes once when the snapshot transitions to stale.
@MainActor
@Observable
public final class SmallMultiplesChartModel {
    public private(set) var resolved: SmallMultiplesResolved

    public var phase: SmallMultiplesResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any SmallMultiplesSource
    @ObservationIgnored private let telemetry: any SmallMultiplesTelemetry
    @ObservationIgnored private let onCellClick: (@MainActor (String) -> Void)?
    @ObservationIgnored private var feed = SmallMultiplesInput()
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        source: any SmallMultiplesSource,
        onCellClick: (@MainActor (String) -> Void)? = nil,
        telemetry: any SmallMultiplesTelemetry = OSLogSmallMultiplesTelemetry()
    ) {
        self.source = source
        self.onCellClick = onCellClick
        self.telemetry = telemetry
        resolved = SmallMultiplesProjection.resolve(SmallMultiplesInput())
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing the context. Idempotent; the `view.opened` event is emitted lazily the first
    /// time the grid actually presents content (not here — the surface may resolve to loading first
    /// or, when series-less under `.withdraw`, to nothing at all).
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

    /// Re-requests the data feed (freshness chip + offline/stale recovery).
    public func refresh() {
        source.refresh()
    }

    /// Drills into a cell's series — the native parity of the web `onCellClick(series)`. No-op when
    /// the grid is passive (web `onCellClick == undefined`); forwards the series id to the host.
    public func selectCell(_ series: String) {
        guard feed.interactivity.isInteractive else { return }
        onCellClick?(series)
    }

    private func apply(_ input: SmallMultiplesInput) {
        let previous = feed
        feed = input
        recompute()
        // Stale → one-shot auto-refresh on the transition (host re-fetch); offline never
        // auto-refreshes (there is no connection to re-fetch over).
        if input.connection == .stale, previous.connection != .stale {
            source.refresh()
        }
    }

    private func recompute() {
        resolved = SmallMultiplesProjection.resolve(feed)
        // `view.opened` fires once, the first time the grid actually shows content (the cell grid or
        // the friendly empty state). Loading is pre-content; the empty-grid collapse (withdrawn)
        // means the surface was never opened.
        if resolved.presentsContent, !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: SmallMultiplesMeta.surfaceSlug)
        }
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the English fallback, so the views hold no hardcoded
/// literals. The web `SmallMultiplesChart` localizes only its empty-cell label (`t('smallMultiples.
/// noData', 'No data')`); every other key here is native P4 leaf chrome (loading / empty / error /
/// freshness) or VoiceOver scaffolding. Keys live in the "SmallMultiplesChart" table, folded into the
/// app `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt
/// owns its own strings.
public enum SmallMultiplesStrings {
    public static let table = "SmallMultiplesChart"

    public static let string: SmallMultiplesResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
