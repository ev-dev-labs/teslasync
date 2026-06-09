//
//  ChargingScheduleWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0023 · ChargingScheduleWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) +
//  the testable accessibility summary. The view binds through
//  `ChargingScheduleModel`; no networking lives in the view. Mirrors the
//  established `RangeEstimateModel` / `SuperchargerHistoryModel` seams so every
//  dashboard surface plugs into the same P4-core state-holder + diagnostics
//  contracts.
//
//  Parity target: features/dashboard/widgets/ChargingScheduleWidget.tsx.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for the surface. The default
/// logs via `os.Logger`; the production app injects an adapter that forwards to
/// the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016 §5), which
/// is consent-gated and redacted there.
public protocol ChargingScheduleTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogChargingScheduleTelemetry: ChargingScheduleTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the widget's data, mirroring the shared `LoadableState`
/// cases the production source projects from `Resource<T>`.
public enum ChargingScheduleLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013) and the web
/// `DataFreshness` chip the `WidgetShell` renders from `isFetching` / `isStale` /
/// `isError`. Drives the freshness chip and the stale / offline banners.
public enum ChargingScheduleConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `ChargingScheduleSource`: the parsed
/// signals + cached vehicle state, the active display preferences, and their
/// load/connection status. The model turns this into the render projection.
public struct ChargingScheduleUpdate: Sendable, Equatable {
    public var status: ChargingScheduleLoadStatus
    public var connection: ChargingScheduleConnection
    public var isFetching: Bool
    public var signals: ChargingScheduleSignals
    public var state: ChargingScheduleStateDTO?
    public var options: ChargingScheduleFormatOptions
    public var updatedAt: Date?

    public init(
        status: ChargingScheduleLoadStatus = .loading,
        connection: ChargingScheduleConnection = .live,
        isFetching: Bool = false,
        signals: ChargingScheduleSignals = ChargingScheduleSignals(),
        state: ChargingScheduleStateDTO? = nil,
        options: ChargingScheduleFormatOptions = ChargingScheduleFormatOptions(),
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.signals = signals
        self.state = state
        self.options = options
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (`useVehicleState` projected from the KMP
/// `VehicleStore` + the live `/signals/{id}/live` query, with the user `Settings`
/// supplying the locale + timezone); previews and tests use
/// `InMemoryChargingScheduleSource`. The view never talks to the network.
@MainActor
public protocol ChargingScheduleSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (ChargingScheduleUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `ChargingScheduleSource`,
/// recomputes the mode/timeline/limit projection, and exposes a render `Phase` +
/// freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class ChargingScheduleModel {
    /// The mutually-exclusive render branches (web shell loading / body empty /
    /// body shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: ChargingScheduleConnection = .live
    public private(set) var isFetching = false
    public private(set) var projection = ChargingScheduleProjection(
        mode: ChargingScheduleMode(label: "", tone: .warning),
        pending: false,
        timelineItems: [],
        compactLimitText: "—",
        hasScheduleData: false,
        hasState: false,
        batteryLevel: 0,
        isCharging: false
    )
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any ChargingScheduleSource
    @ObservationIgnored private let telemetry: any ChargingScheduleTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any ChargingScheduleSource,
        telemetry: any ChargingScheduleTelemetry = OSLogChargingScheduleTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Whether the schedule has any data to show — the web `hasScheduleData`
    /// switch (else the top-level empty state).
    public var hasScheduleData: Bool {
        projection.hasScheduleData
    }

    /// Whether a one-column, one-row instance collapses to the compact charge-limit
    /// hero — the web `size.cols <= 1 && size.rows <= 1` branch.
    public static func isCompact(for size: DashboardWidgetSize) -> Bool {
        size.cols <= 1 && size.rows <= 1
    }

    /// Whether the standard layout shows the current-level / status detail row —
    /// the web `isTall = size.rows >= 2`.
    public static func isTall(for size: DashboardWidgetSize) -> Bool {
        size.rows >= 2
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ChargingScheduleWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached value stays visible). Wired to the
    /// retry / refresh affordances.
    public func refresh() {
        source.refresh()
    }

    /// Auto-refreshes when the data has gone stale but is not already being
    /// fetched — the native parity of the web `DataFreshnessAuto` self-refresh on
    /// stale queries.
    public func autoRefreshIfStale() {
        guard connection == .stale, !isFetching else { return }
        source.refresh()
    }

    private func apply(_ update: ChargingScheduleUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        updatedAt = update.updatedAt
        projection = ChargingScheduleAdapter.project(
            signals: update.signals,
            state: update.state,
            options: update.options
        )
        phase = Self.resolvePhase(update.status, hasScheduleData: projection.hasScheduleData)
    }

    /// Resolves the render phase. Whenever there is schedule data to show the
    /// content renders and cached values stay visible behind refresh/errors. The
    /// top-level empty state is reserved for a resolved load with no schedule data
    /// — the web `hasScheduleData ? … : <EmptyState/>` switch.
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the
    /// phase logic be unit-tested from a non-isolated context under Swift 6
    /// strict concurrency.
    public nonisolated static func resolvePhase(
        _ status: ChargingScheduleLoadStatus,
        hasScheduleData: Bool
    ) -> Phase {
        switch status {
        case .loading:
            hasScheduleData ? .content : .loading
        case .loaded, .empty:
            hasScheduleData ? .content : .empty
        case let .failed(message):
            hasScheduleData ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryChargingScheduleSource: ChargingScheduleSource {
    public var onUpdate: (@MainActor (ChargingScheduleUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ChargingScheduleUpdate?

    public init(initial: ChargingScheduleUpdate? = nil) {
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
    public func push(_ update: ChargingScheduleUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "ChargingScheduleWidget"
/// table, folded into the app `Localizable.xcstrings` catalog at integration.
public enum ChargingScheduleStrings {
    public static let table = "ChargingScheduleWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    public static func count(_ key: String, _ fallbackFormat: String, _ value: Int) -> String {
        String(format: string(key, fallbackFormat), value)
    }
}
