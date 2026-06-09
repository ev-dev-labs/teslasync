//
//  RegenEfficiencyWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0081 · RegenEfficiencyWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + the cached payload DTO. The view binds through
//  `RegenEfficiencyModel`; no networking lives in the view. The production app implements
//  `RegenEfficiencySource` over the shared P1/S8 state holders (the regen-analytics store scoped by the
//  selected vehicle); previews and tests use `InMemoryRegenEfficiencySource`.
//
//  Web source: features/dashboard/widgets/RegenEfficiencyWidget.tsx (data: useRegenEfficiency / useVehicles
//  / useUnits).
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for a surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared diagnostics taxonomy
/// (consent-gated + redacted there).
public protocol RegenEfficiencyTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogRegenEfficiencyTelemetry: RegenEfficiencyTelemetry {
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
/// source projects from the regen-analytics `Resource<RegenEfficiencyData>` query (`useRegenEfficiency`).
public enum RegenEfficiencyWidgetLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013): the freshness chip surfaces this.
public enum RegenEfficiencyWidgetConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The raw `/analytics/regen` payload the source hands the model, in SI. Field names mirror the web
/// `RegenEfficiencyData` wire keys (`totalRegenWh`, `totalDriveWh`, `regenRatio`, `monthlyAvgRegen`,
/// `freeCharges`). Optionals carry the web `?? 0` null-coalescing the projection applies.
public struct RegenEfficiencyInput: Sendable, Equatable {
    /// Total energy recovered via regen, in watt-hours (web `totalRegenWh`).
    public var totalRegenWh: Double?
    /// Total energy used while driving, in watt-hours (web `totalDriveWh`). Carried for parity; the ratio
    /// is precomputed server-side and read via `regenRatio`.
    public var totalDriveWh: Double?
    /// Recovered / used ratio in 0…1 (web `regenRatio`).
    public var regenRatio: Double?
    /// Monthly-average regen power, in watts (web `monthlyAvgRegen`).
    public var monthlyAvgRegen: Double?
    /// Equivalent free full charges recovered (web `freeCharges`).
    public var freeCharges: Int?

    public init(
        totalRegenWh: Double? = nil,
        totalDriveWh: Double? = nil,
        regenRatio: Double? = nil,
        monthlyAvgRegen: Double? = nil,
        freeCharges: Int? = nil
    ) {
        self.totalRegenWh = totalRegenWh
        self.totalDriveWh = totalDriveWh
        self.regenRatio = regenRatio
        self.monthlyAvgRegen = monthlyAvgRegen
        self.freeCharges = freeCharges
    }
}

/// One coalesced snapshot pushed by a `RegenEfficiencySource`: the cached payload plus its load/connection
/// status, the formatting locale, and freshness. The model turns it into the `RegenProjection` the view
/// renders.
public struct RegenUpdate: Sendable, Equatable {
    public var status: RegenEfficiencyWidgetLoadStatus
    public var connection: RegenEfficiencyWidgetConnection
    public var payload: RegenEfficiencyInput?
    public var localeIdentifier: String?
    public var updatedAt: Date?
    public var isFetching: Bool

    public init(
        status: RegenEfficiencyWidgetLoadStatus = .loading,
        connection: RegenEfficiencyWidgetConnection = .live,
        payload: RegenEfficiencyInput? = nil,
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
/// (`StateHolderModel<LoadableState<RegenEfficiencyData>>` from the regen-analytics store, scoped by the
/// selected vehicle from `VehicleStore`); previews and tests use `InMemoryRegenEfficiencySource`. The view
/// never talks to the network directly.
@MainActor
public protocol RegenEfficiencySource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (RegenUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryRegenEfficiencySource: RegenEfficiencySource {
    public var onUpdate: (@MainActor (RegenUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: RegenUpdate?

    public init(initial: RegenUpdate? = nil) {
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
    public func push(_ update: RegenUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Observable model

/// The widget's observable view-model. Subscribes to a `RegenEfficiencySource`, recomputes the
/// `RegenProjection` at the display boundary, and exposes a render `Phase` + freshness for SwiftUI to switch
/// over.
@MainActor
@Observable
public final class RegenEfficiencyModel {
    /// The mutually-exclusive render branches (web shell loading / error + body empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: RegenEfficiencyWidgetConnection = .live
    public private(set) var projection: RegenProjection = .empty
    public private(set) var updatedAt: Date?
    public private(set) var isFetching = false

    @ObservationIgnored private let source: any RegenEfficiencySource
    @ObservationIgnored private let telemetry: any RegenEfficiencyTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any RegenEfficiencySource,
        telemetry: any RegenEfficiencyTelemetry = OSLogRegenEfficiencyTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: RegenEfficiencyWidget.surfaceSlug)
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

    private func apply(_ update: RegenUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        isFetching = update.isFetching
        projection = RegenProjection.make(
            from: update.payload,
            locale: update.localeIdentifier.map(Locale.init(identifier:)) ?? .regenDefault
        )
        phase = Self.resolvePhase(update, hasData: projection.hasData)
    }

    /// Resolves the render phase. Mirrors the web `WidgetShell`: a hard failure shows the error screen, the
    /// initial fetch (no cache) shows the skeleton, and otherwise the body renders the data or its empty
    /// state. Cached values stay visible behind stale/offline freshness.
    static func resolvePhase(_ update: RegenUpdate, hasData: Bool) -> Phase {
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
