//
//  LiveSignalTail.Model.swift
//  TeslaSync — P4 feature view · 0263 · LiveSignalTail (Apple)
//
//  The seams that keep the SwiftUI surface declarative:
//    • P1/S11 telemetry contract (`view.opened`),
//    • P1/S8 state-holder seam (`LiveSignalTailSource` → `LiveSignalTailModel`),
//    • P1/S10 localization facade (`LiveSignalTailStrings`, in the Localization file),
//    • the live UI state the web owns via `useState` (filter, auto-scroll).
//
//  No networking lives here. The web component is pure-render — its buffer, rate,
//  and paused flag are owned by `useLiveSignalStream` (the SSE subscription) and
//  the page passes `onPauseToggle`/`onClear`. The native seam mirrors that exactly:
//  the production source wraps the shared live-signal stream over SSE and forwards
//  `pauseToggle`/`clear`/`refresh`; previews + tests drive `InMemoryLiveSignalTailSource`.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` (`screen_view`) product-analytics event for a surface.
/// The default logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared `Telemetry.track(.screenView(screen:…))` (consent-gated).
public protocol LiveSignalTailTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogLiveSignalTailTelemetry: LiveSignalTailTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the stream, mirroring the shared `LoadableState` cases
/// the production source projects from the live-signal subscription state.
public enum LiveSignalTailLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013). The web binds
/// the connection badge through the `headerExtra` slot; the native surface owns it
/// so every prompt-required state (stale / offline) renders.
public enum LiveSignalTailConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `LiveSignalTailSource`: the buffered events
/// (newest first), the live rate, the buffer cap, the paused flag, the load status,
/// and the stream freshness. The model turns this into the display projection.
public struct LiveSignalTailUpdate: Sendable, Equatable {
    public var status: LiveSignalTailLoadStatus
    public var connection: LiveSignalTailConnection
    public var entries: [SignalTailEntry]
    public var rate: Int
    public var bufferMax: Int
    public var paused: Bool
    public var updatedAt: Date?

    public init(
        status: LiveSignalTailLoadStatus = .loading,
        connection: LiveSignalTailConnection = .live,
        entries: [SignalTailEntry] = [],
        rate: Int = 0,
        bufferMax: Int = 500,
        paused: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.entries = entries
        self.rate = rate
        self.bufferMax = bufferMax
        self.paused = paused
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 live-signal stream (web `useLiveSignalStream`); the view never
/// performs transport and forwards the web `onPauseToggle`/`onClear` here. Previews
/// and tests use `InMemoryLiveSignalTailSource`.
@MainActor
public protocol LiveSignalTailSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (LiveSignalTailUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// The web `onPauseToggle` — pause/resume the SSE buffering.
    func pauseToggle()
    /// The web `onClear` — empty the buffer.
    func clear()
    /// Force a re-subscribe / retry (native retry affordance).
    func refresh()
}

// MARK: - View-model

/// The surface's observable view-model. Subscribes to a `LiveSignalTailSource`,
/// recomputes the projection via `LiveSignalTailBuilder`, and owns the live filter
/// + auto-scroll toggle the web holds in `useState`.
@MainActor
@Observable
public final class LiveSignalTailModel {
    /// The mutually-exclusive render branches for the tail area. The header + stats
    /// chrome always render (matching the web, which never hides them).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: LiveSignalTailConnection = .live
    public private(set) var projection: LiveSignalTailProjection = .empty
    public private(set) var rate: Int = 0
    public private(set) var bufferMax: Int = 500
    public private(set) var paused = false
    public private(set) var updatedAt: Date?
    public private(set) var isFetching = false

    /// Live name filter (web `filter` state, bound to the search field).
    public var filterText: String = ""
    /// Auto-scroll-to-newest toggle (web `autoScroll` state, default on).
    public var autoScroll = true

    @ObservationIgnored private let source: any LiveSignalTailSource
    @ObservationIgnored private let telemetry: any LiveSignalTailTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any LiveSignalTailSource,
        telemetry: any LiveSignalTailTelemetry = OSLogLiveSignalTailTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The filtered rows to render, in stream (newest-first) order — the web
    /// `filtered` `useMemo` (no trim; lowercased substring of the name).
    public var displayedEntries: [SignalTailEntry] {
        LiveSignalTailBuilder.filter(projection.entries, query: filterText)
    }

    /// The four header stat values (web stat cards). `filtered` reflects the live
    /// filter; the rest derive from the full buffer.
    public var stats: LiveSignalTailStats {
        LiveSignalTailBuilder.stats(
            projection: projection,
            rate: rate,
            bufferMax: bufferMax,
            filteredCount: displayedEntries.count
        )
    }

    /// Whether the filter currently hides every buffered row (web: entries exist but
    /// `filtered.length === 0` → "No signals match filter").
    public var isFilteredEmpty: Bool {
        projection.hasData && displayedEntries.isEmpty
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: LiveSignalTail.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh / re-subscribe (wired to the error-state retry).
    public func refresh() {
        source.refresh()
    }

    /// Toggles pause/resume on the upstream buffer (web `onPauseToggle`). The flag
    /// is reflected optimistically so the control updates without awaiting a push.
    public func togglePause() {
        paused.toggle()
        source.pauseToggle()
    }

    /// Clears the buffer (web `onClear`).
    public func clear() {
        source.clear()
    }

    /// Flips the auto-scroll toggle (web `setAutoScroll((a) => !a)`).
    public func toggleAutoScroll() {
        autoScroll.toggle()
    }

    private func apply(_ update: LiveSignalTailUpdate) {
        connection = update.connection
        rate = update.rate
        bufferMax = update.bufferMax
        paused = update.paused
        updatedAt = update.updatedAt
        isFetching = update.status == .loading
        projection = LiveSignalTailBuilder.buildProjection(from: update.entries)
        phase = Self.resolvePhase(status: update.status, hasData: projection.hasData)
    }

    /// Resolves the tail-area phase. The web shows the "Waiting for signals…" empty
    /// message until the first SSE event lands; once any event is buffered the table
    /// renders and stays visible behind a refresh or error. A failure with nothing
    /// buffered surfaces the native error affordance.
    static func resolvePhase(status: LiveSignalTailLoadStatus, hasData: Bool) -> Phase {
        switch status {
        case .loading:
            hasData ? .content : .loading
        case .empty:
            hasData ? .content : .empty
        case .loaded:
            hasData ? .content : .empty
        case let .failed(message):
            hasData ? .content : .error(message)
        }
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)` and
/// inspect the forwarded control calls.
@MainActor
public final class InMemoryLiveSignalTailSource: LiveSignalTailSource {
    public var onUpdate: (@MainActor (LiveSignalTailUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var pauseToggleCount = 0
    public private(set) var clearCount = 0
    public private(set) var refreshCount = 0

    private let initial: LiveSignalTailUpdate?

    public init(initial: LiveSignalTailUpdate? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func pauseToggle() {
        pauseToggleCount += 1
    }

    public func clear() {
        clearCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ update: LiveSignalTailUpdate) {
        onUpdate?(update)
    }
}
