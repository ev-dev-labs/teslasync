//
//  AreaChartWrapper.Model.swift
//  TeslaSync — P4 shared surface · 0064 · AreaChartWrapper (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the
//  observable view-model for the gradient area chart. The view binds through `AreaChartWrapperModel`;
//  no networking lives in the view. The web component is purely presentational (it takes `data` +
//  `series` and renders), so the native model's job is the P4 leaf contract around it: it binds a
//  context source for the resolved payload + connectivity, derives the resolved projection, emits
//  `view.opened` once when the chart first presents content, and auto-refreshes once when the snapshot
//  goes stale.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol AreaChartTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogAreaChartTelemetry: AreaChartTelemetry {
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
/// `series` + `height` + formatters) plus the P4 connectivity axis. The production app implements this
/// over the live data store (`LiveAreaChartSource`); previews and tests use `InMemoryAreaChartSource`.
/// The feed is local + synchronous (no HTTP in the view).
@MainActor
public protocol AreaChartSource: AnyObject {
    var onUpdate: (@MainActor (AreaChartInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The production context source. Holds the host-provided feed and re-emits it on `start`/`refresh` —
/// the native binding point for the host's resolved payload. The feed is local + synchronous; the host
/// re-creates the source (or pushes through a subclass) when the payload changes.
@MainActor
public final class LiveAreaChartSource: AreaChartSource {
    public var onUpdate: (@MainActor (AreaChartInput) -> Void)?

    private let input: AreaChartInput

    public init(input: AreaChartInput) {
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

/// In-memory context source for previews + unit/UI tests. Seeds an optional initial feed on `start()`
/// and lets a test push further feeds via `push(_:)`.
@MainActor
public final class InMemoryAreaChartSource: AreaChartSource {
    public var onUpdate: (@MainActor (AreaChartInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: AreaChartInput?

    public init(initial: AreaChartInput? = nil) {
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
    public func push(_ input: AreaChartInput) {
        onUpdate?(input)
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Binds an `AreaChartSource` (payload + connectivity), recomputes
/// the resolved projection, exposes the resolved view-state, emits the `view.opened` diagnostics event
/// exactly once when the chart first presents its content (never while loading / errored / withdrawn),
/// and auto-refreshes once when the snapshot transitions to stale.
@MainActor
@Observable
public final class AreaChartWrapperModel {
    public private(set) var resolved: AreaChartResolved

    public var phase: AreaChartResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any AreaChartSource
    @ObservationIgnored private let telemetry: any AreaChartTelemetry
    @ObservationIgnored private var feed = AreaChartInput()
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        source: any AreaChartSource,
        telemetry: any AreaChartTelemetry = OSLogAreaChartTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        resolved = AreaChartProjection.resolve(AreaChartInput())
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing the context. Idempotent; the `view.opened` event is emitted lazily the first
    /// time the chart actually presents content (not here — the surface may resolve to loading first
    /// or, when data-less under `.withdraw`, to nothing at all).
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

    private func apply(_ input: AreaChartInput) {
        let previous = feed
        feed = input
        recompute()
        // Stale → one-shot auto-refresh on the transition (host re-fetch); offline never auto-refreshes
        // (there is no connection to re-fetch over).
        if input.connection == .stale, previous.connection != .stale {
            source.refresh()
        }
    }

    private func recompute() {
        resolved = AreaChartProjection.resolve(feed)
        // `view.opened` fires once, the first time the chart actually shows content (the area chart or
        // the friendly empty state). Loading is pre-content; the host-hidden collapse (withdrawn) means
        // the surface was never opened.
        if resolved.presentsContent, !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: AreaChartMeta.surfaceSlug)
        }
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the English fallback, so the views hold no hardcoded
/// literals. The web `AreaChartWrapper` is anonymous + presentational (no `t()` calls of its own), so
/// every key here is native P4 leaf chrome (loading / empty / error / freshness) or VoiceOver
/// scaffolding. Keys live in the "AreaChartWrapper" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; kept per-surface so each parallel prompt owns its own strings.
public enum AreaChartWrapperStrings {
    public static let table = "AreaChartWrapper"

    public static let string: AreaChartResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
