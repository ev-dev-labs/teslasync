//
//  ChartLegend.Model.swift
//  TeslaSync — P4 shared surface · 0068 · ChartLegend (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the
//  observable view-model for the chart legend. The view binds through `ChartLegendModel`; no
//  networking lives in the view. The web component's toggle source is `useChartHiddenSeries` (a
//  `HiddenSeriesState` or `null`): the native model OWNS the authoritative hidden-series set (the
//  `useChartHiddenSeries` `hidden`), exposes `toggle` / `reset` over it (the `HiddenSeriesState`
//  mutations, delegated to the pure `ChartLegendHidden` algebra), forwards each toggle to the host
//  (so URL / localStorage persistence stays in sync, the web `toggle` side effect), derives the
//  resolved projection, emits `view.opened` once when the legend first presents content, and
//  auto-refreshes once when the series snapshot goes stale.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol ChartLegendTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogChartLegendTelemetry: ChartLegendTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Context source seam (P1/S8 layer)

/// The seam the model binds through for the surface feed — the parent chart's resolved series (the
/// Recharts legend payload) plus the P4 connectivity / interactivity / alignment axes. The production
/// app implements this over the live chart-series store (`LiveChartLegendSource`); previews and tests
/// use `InMemoryChartLegendSource`. The feed is local + synchronous (no HTTP in the view). The feed's
/// `hidden` field is unused at runtime — the model owns the authoritative hidden set (it is the
/// native `useChartHiddenSeries`); `hidden` exists on the input only so the pure projection is
/// testable across visibility states.
@MainActor
public protocol ChartLegendSource: AnyObject {
    var onUpdate: (@MainActor (ChartLegendInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The production context source. Holds the host-provided feed and re-emits it on `start`/`refresh` —
/// the native binding point for the parent chart's resolved series. The feed is local + synchronous;
/// the host re-creates the source (or pushes through a subclass) when the series set changes.
@MainActor
public final class LiveChartLegendSource: ChartLegendSource {
    public var onUpdate: (@MainActor (ChartLegendInput) -> Void)?

    private let input: ChartLegendInput

    public init(input: ChartLegendInput) {
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
public final class InMemoryChartLegendSource: ChartLegendSource {
    public var onUpdate: (@MainActor (ChartLegendInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ChartLegendInput?

    public init(initial: ChartLegendInput? = nil) {
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
    public func push(_ input: ChartLegendInput) {
        onUpdate?(input)
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Binds a `ChartLegendSource` (series + connectivity +
/// interactivity), OWNS the authoritative hidden-series set (the native `useChartHiddenSeries`
/// `hidden`), recomputes the resolved projection, exposes the resolved view-state, toggles / resets
/// visibility over the pure `ChartLegendHidden` algebra (the `HiddenSeriesState` mutations), forwards
/// each toggle to the host (the web `toggle` persistence side effect), emits the `view.opened`
/// diagnostics event exactly once when the legend first presents its content (never while loading /
/// errored / withdrawn), and auto-refreshes once when the snapshot transitions to stale.
@MainActor
@Observable
public final class ChartLegendModel {
    public private(set) var resolved: ChartLegendResolved

    public var phase: ChartLegendResolved.Phase {
        resolved.phase
    }

    /// The current hidden-series set — the native `useChartHiddenSeries` `hidden`.
    public private(set) var hidden: Set<String>

    @ObservationIgnored private let source: any ChartLegendSource
    @ObservationIgnored private let telemetry: any ChartLegendTelemetry
    @ObservationIgnored private let onToggle: (@MainActor (String) -> Void)?
    @ObservationIgnored private var feed = ChartLegendInput()
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        source: any ChartLegendSource,
        onToggle: (@MainActor (String) -> Void)? = nil,
        initialHidden: Set<String> = [],
        telemetry: any ChartLegendTelemetry = OSLogChartLegendTelemetry()
    ) {
        self.source = source
        self.onToggle = onToggle
        self.telemetry = telemetry
        hidden = initialHidden
        resolved = ChartLegendProjection.resolve(ChartLegendInput())
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing the context. Idempotent; the `view.opened` event is emitted lazily the first
    /// time the legend actually presents content (not here — the surface may resolve to loading first
    /// or, when empty under `.withdraw`, to nothing at all).
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

    /// Re-requests the series feed (freshness chip + offline/stale recovery).
    public func refresh() {
        source.refresh()
    }

    /// Toggles a series' visibility — the native parity of the web `resolved.toggle(key)`. No-op when
    /// the legend is passive (web `resolved == null`). Mutates the owned hidden set, recomputes, and
    /// forwards to the host so its persisted toggle state (URL / localStorage) stays in sync.
    public func toggle(_ key: String) {
        guard feed.interactivity.isInteractive else { return }
        hidden = ChartLegendHidden.toggling(hidden, key)
        recompute()
        onToggle?(key)
    }

    /// Clears every hidden flag — the native parity of the web `HiddenSeriesState.reset()`. No-op when
    /// passive or already empty.
    public func reset() {
        guard feed.interactivity.isInteractive, !hidden.isEmpty else { return }
        hidden = []
        recompute()
    }

    private func apply(_ input: ChartLegendInput) {
        let previous = feed
        feed = input
        recompute()
        // Stale → one-shot auto-refresh on the transition (parent re-fetch); offline never
        // auto-refreshes (there is no connection to re-fetch over).
        if input.connection == .stale, previous.connection != .stale {
            source.refresh()
        }
    }

    private func recompute() {
        resolved = ChartLegendProjection.resolve(feed.replacingHidden(hidden))
        // `view.opened` fires once, the first time the legend actually shows content (populated
        // entries or the friendly empty state). Loading is pre-content; the empty-payload collapse
        // (withdrawn) means the surface was never opened.
        if resolved.presentsContent, !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: ChartLegendMeta.surfaceSlug)
        }
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the English fallback, so the views hold no hardcoded
/// literals. The web `ChartLegend` renders its entry values verbatim (no `t()` — the surface is
/// anonymous), so every key here is native P4 leaf chrome (loading / empty / error / freshness) or
/// VoiceOver scaffolding for the colour-only swatch. Keys live in the "ChartLegend" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time; kept per-surface so each
/// parallel prompt owns its own strings.
public enum ChartLegendStrings {
    public static let table = "ChartLegend"

    public static let string: ChartLegendResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
