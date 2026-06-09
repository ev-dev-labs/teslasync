//
//  SleepEfficiencyWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0090 · SleepEfficiencyWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + the cached payload DTO. The view binds through
//  `SleepEfficiencyModel`; no networking lives in the view. The production app implements
//  `SleepEfficiencySource` over the shared P1/S8 state holders (the `/analytics/sleep` store scoped by the
//  selected vehicle); previews and tests use `InMemorySleepEfficiencySource`.
//
//  Web source: features/dashboard/widgets/SleepEfficiencyWidget.tsx (data: useSleepEfficiency / useVehicles
//  / useEnergy / useTranslation).
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for a surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared diagnostics taxonomy
/// (consent-gated + redacted there).
public protocol SleepEfficiencyTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogSleepEfficiencyTelemetry: SleepEfficiencyTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the widget's data, mirroring the shared `LoadableState` cases the production
/// source projects from the sleep-analytics `Resource<SleepEfficiencyData>` query (`useSleepEfficiency`).
public enum SleepEfficiencyWidgetLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013): the freshness chip surfaces this.
public enum SleepEfficiencyWidgetConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One slice of the parked-state distribution (web `state_distribution[]`: `{ state, total_minutes }`). The
/// projection sums the `total_minutes` of the sleep-equivalent states (`asleep` / `offline`) into the
/// "Total Sleep" stat, exactly like the web `totalSleepHours` memo.
public struct SleepStateSlice: Sendable, Equatable {
    /// The parked-state name (web `state`, e.g. `asleep` / `offline` / `online` / `driving`).
    public var state: String
    /// Minutes spent in that state over the window (web `total_minutes`). Optional → the web `?? 0`.
    public var totalMinutes: Double?

    public init(state: String, totalMinutes: Double? = nil) {
        self.state = state
        self.totalMinutes = totalMinutes
    }
}

/// The raw `/analytics/sleep` payload the source hands the model. Field names mirror the web
/// `SleepEfficiencyData` wire keys (`sleep_efficiency_pct`, `sentry_off_drain_rate`, `state_distribution`,
/// `recent_events`). Optionals carry the web `?? 0` / `?? []` null-coalescing the projection applies.
public struct SleepEfficiencyInput: Sendable, Equatable {
    /// Share of parked time spent in true low-power sleep, as a percentage 0…100 (web
    /// `sleep_efficiency_pct`).
    public var sleepEfficiencyPct: Double?
    /// Sentry-off idle drain rate in percent-of-battery per hour (web `sentry_off_drain_rate`). The
    /// projection scales it ×24 into the "Avg Drain/Day" stat.
    public var sentryOffDrainRate: Double?
    /// The parked-state minute distribution (web `state_distribution`).
    public var stateDistribution: [SleepStateSlice]
    /// The number of recent wake/drain events (web `recent_events.length`).
    public var recentEventsCount: Int?

    public init(
        sleepEfficiencyPct: Double? = nil,
        sentryOffDrainRate: Double? = nil,
        stateDistribution: [SleepStateSlice] = [],
        recentEventsCount: Int? = nil
    ) {
        self.sleepEfficiencyPct = sleepEfficiencyPct
        self.sentryOffDrainRate = sentryOffDrainRate
        self.stateDistribution = stateDistribution
        self.recentEventsCount = recentEventsCount
    }
}

/// One coalesced snapshot pushed by a `SleepEfficiencySource`: the cached payload plus its load/connection
/// status, the formatting locale, and freshness. The model turns it into the `SleepProjection` the view
/// renders.
public struct SleepEfficiencyUpdate: Sendable, Equatable {
    public var status: SleepEfficiencyWidgetLoadStatus
    public var connection: SleepEfficiencyWidgetConnection
    public var payload: SleepEfficiencyInput?
    public var localeIdentifier: String?
    public var updatedAt: Date?
    public var isFetching: Bool

    public init(
        status: SleepEfficiencyWidgetLoadStatus = .loading,
        connection: SleepEfficiencyWidgetConnection = .live,
        payload: SleepEfficiencyInput? = nil,
        localeIdentifier: String? = nil,
        updatedAt: Date? = nil,
        isFetching: Bool = false
    ) {
        self.status = status
        self.connection = connection
        self.payload = payload
        self.localeIdentifier = localeIdentifier
        self.updatedAt = updatedAt
        self.isFetching = isFetching
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8 state holders
/// (`StateHolderModel<LoadableState<SleepEfficiencyData>>` from the sleep-analytics store, scoped by the
/// selected vehicle from `VehicleStore`); previews and tests use `InMemorySleepEfficiencySource`. The view
/// never talks to the network directly.
@MainActor
public protocol SleepEfficiencySource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (SleepEfficiencyUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemorySleepEfficiencySource: SleepEfficiencySource {
    public var onUpdate: (@MainActor (SleepEfficiencyUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SleepEfficiencyUpdate?

    public init(initial: SleepEfficiencyUpdate? = nil) {
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
    public func push(_ update: SleepEfficiencyUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Observable model

/// The widget's observable view-model. Subscribes to a `SleepEfficiencySource`, recomputes the
/// `SleepProjection` at the display boundary, and exposes a render `Phase` + freshness for SwiftUI to switch
/// over.
@MainActor
@Observable
public final class SleepEfficiencyModel {
    /// The mutually-exclusive render branches (web shell loading / error + body empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: SleepEfficiencyWidgetConnection = .live
    public private(set) var projection: SleepProjection = .empty
    public private(set) var updatedAt: Date?
    public private(set) var isFetching = false

    @ObservationIgnored private let source: any SleepEfficiencySource
    @ObservationIgnored private let telemetry: any SleepEfficiencyTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any SleepEfficiencySource,
        telemetry: any SleepEfficiencyTelemetry = OSLogSleepEfficiencyTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SleepEfficiencyWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (cached value stays visible). Wired to the retry / refresh affordances and the stale
    /// auto-refresh.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: SleepEfficiencyUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        isFetching = update.isFetching
        projection = SleepProjection.make(
            from: update.payload,
            locale: update.localeIdentifier.map(Locale.init(identifier:)) ?? .sleepDefault
        )
        phase = Self.resolvePhase(update, hasData: projection.hasData)
    }

    /// Resolves the render phase. Mirrors the web `WidgetShell`: a hard failure shows the error screen, the
    /// initial fetch (no cache) shows the skeleton, and otherwise the body renders the data or its empty
    /// state. Cached values stay visible behind stale/offline freshness.
    static func resolvePhase(_ update: SleepEfficiencyUpdate, hasData: Bool) -> Phase {
        switch update.status {
        case let .failed(message):
            .error(message)
        case .loading:
            hasData ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            hasData ? .content : .empty
        }
    }
}
