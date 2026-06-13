//
//  DataFreshness.Model.swift
//  TeslaSync — P4 shared surface · 0079 · DataFreshness (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the clock + time-format seams, the
//  i18n facade (P1/S10), and the observable view-model for the data-freshness chip. The view binds
//  through `DataFreshnessModel`; no networking lives in the view. A source emits the query-result
//  snapshot (the web `useQuery` result — e.g. `useChargingHistory`), the model recomputes the
//  resolved readout against an injected clock on every snapshot and every 30s tick (the web
//  `setInterval` re-render), emits `view.opened` once when the chip first presents, and fires a
//  one-shot refresh when the data ages into the stale band (the P4 leaf "stale → auto-refresh"
//  contract, gated on the surface being refreshable so a read-only chip never re-fetches).
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol DataFreshnessTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogDataFreshnessTelemetry: DataFreshnessTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Context source seam (P1/S8 layer)

/// The seam the model binds through for the surface input — the query-result feed (the web `useQuery`
/// result: `dataUpdatedAt`, `isFetching`, `isStale`, `isError`) plus its `refetch`. The production
/// app implements this over the live query store (`LiveDataFreshnessSource`); previews and tests use
/// `InMemoryDataFreshnessSource`. The feed is local + synchronous (no HTTP in the view); `refresh`
/// is the native binding point for the web `query.refetch()`.
@MainActor
public protocol DataFreshnessSource: AnyObject {
    var onUpdate: (@MainActor (DataFreshnessInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The production context source. Holds the host-provided query snapshot and re-emits it on
/// `start`/`refresh` — the native binding point for the web query-result read. The feed is local +
/// synchronous; the host re-creates the source (or pushes through a subclassable hook) when the
/// query result changes.
@MainActor
public final class LiveDataFreshnessSource: DataFreshnessSource {
    public var onUpdate: (@MainActor (DataFreshnessInput) -> Void)?

    private let input: DataFreshnessInput

    public init(input: DataFreshnessInput) {
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
public final class InMemoryDataFreshnessSource: DataFreshnessSource {
    public var onUpdate: (@MainActor (DataFreshnessInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: DataFreshnessInput?

    public init(initial: DataFreshnessInput? = nil) {
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
    public func push(_ input: DataFreshnessInput) {
        onUpdate?(input)
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Binds a `DataFreshnessSource` (the query-result feed),
/// recomputes the resolved readout against the injected clock on every snapshot and every tick,
/// exposes the render-ready `resolved` readout, emits the `view.opened` diagnostics event exactly
/// once when the chip first presents, and fires a one-shot refresh on the transition into the stale
/// band (re-armed once the data leaves stale) — gated on the surface being refreshable.
@MainActor
@Observable
public final class DataFreshnessModel {
    public private(set) var resolved: DataFreshnessReadout

    public let config: DataFreshnessConfig

    @ObservationIgnored private let source: any DataFreshnessSource
    @ObservationIgnored private let telemetry: any DataFreshnessTelemetry
    @ObservationIgnored private let clock: DataFreshnessClock
    @ObservationIgnored private let timeFormat: DataFreshnessTimeFormat
    @ObservationIgnored private let strings: DataFreshnessResolve
    @ObservationIgnored private var input = DataFreshnessInput()
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var lastStatus: DataFreshnessStatus?

    public init(
        source: any DataFreshnessSource,
        config: DataFreshnessConfig = .default,
        telemetry: any DataFreshnessTelemetry = OSLogDataFreshnessTelemetry(),
        clock: @escaping DataFreshnessClock = { Date() },
        timeFormat: @escaping DataFreshnessTimeFormat = DataFreshnessTime.shortTime,
        strings: @escaping DataFreshnessResolve = DataFreshnessStrings.string
    ) {
        self.source = source
        self.config = config
        self.telemetry = telemetry
        self.clock = clock
        self.timeFormat = timeFormat
        self.strings = strings
        resolved = DataFreshnessProjection.resolve(
            DataFreshnessInput(),
            config: config,
            now: clock(),
            timeFormat: timeFormat,
            strings: strings
        )
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing the query feed. Idempotent. The chip always presents a readout (the web has
    /// no skeleton), so the `view.opened` event is emitted on the first recompute after `start`.
    public func start() {
        guard !started else { return }
        started = true
        source.start()
        emitOpenIfNeeded()
    }

    /// Stops observing the feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the snapshot (the web `query.refetch()` — manual tap + the stale auto-refresh).
    public func refresh() {
        source.refresh()
    }

    /// Recomputes the relative-time readout from the last snapshot against the current clock — the
    /// native port of the web 30s `setInterval` re-render. Driven by the view's periodic timer.
    public func tick() {
        recompute()
    }

    private func apply(_ input: DataFreshnessInput) {
        self.input = input
        recompute()
    }

    private func recompute() {
        resolved = DataFreshnessProjection.resolve(
            input,
            config: config,
            now: clock(),
            timeFormat: timeFormat,
            strings: strings
        )
        emitOpenIfNeeded()
        armStaleAutoRefreshIfNeeded()
    }

    private func emitOpenIfNeeded() {
        guard started, !didEmitOpen else { return }
        didEmitOpen = true
        telemetry.viewOpened(surface: DataFreshnessMeta.surfaceSlug)
    }

    // Transition into the stale band arms a single auto-refresh (the P4 leaf "stale → auto-refresh"
    // contract): ask the host to re-fetch the moment the data crosses the stale threshold, but only
    // when the surface is refreshable (a read-only chip never re-fetches). `lastStatus` is updated
    // before the refresh so the re-emit it triggers cannot re-arm it; the arm re-enables once the
    // data leaves the stale band (back to fresh, or on to fetching/error).
    private func armStaleAutoRefreshIfNeeded() {
        let newStatus = resolved.status
        let wasStale = lastStatus == .stale
        lastStatus = newStatus
        guard config.refreshable, newStatus == .stale, !wasStale else { return }
        source.refresh()
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. The web source already calls `t(key, default)`; the fallbacks reproduce those
/// defaults verbatim. Keys live in the "DataFreshness" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt owns
/// its own strings.
public enum DataFreshnessStrings {
    public static let table = "DataFreshness"

    public static let string: DataFreshnessResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
