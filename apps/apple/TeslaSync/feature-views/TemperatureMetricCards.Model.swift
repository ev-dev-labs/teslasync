//
//  TemperatureMetricCards.Model.swift
//  TeslaSync — P4 feature view · 0161 · TemperatureMetricCards (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade (P1/S10)
//  for the Temperature Metric Cards surface. The view binds through
//  `TemperatureMetricCardsModel`; no networking lives in the view. SwiftUI parity of
//  features/driving/components/drivetrain-health/TemperatureMetricCards.tsx — the drivetrain
//  thermal summary that renders the four sensor temperatures + the overall health score + the
//  peak drive power as six unit-aware metric cards.
//
//  The web source is a pure presentational leaf fed its four props by the parent
//  `DrivetrainHealthPage` (which reads `useDrivetrainHealth` + `useUnits`). The native surface
//  owns the full query lifecycle through this seam, so the same data the web parent's hook
//  resolves (loading / loaded / empty / failure) plus live-stream freshness (ADR-013 stale /
//  offline) all surface here.
//
//  Vendor-agnostic and SwiftUI-free so the model + projection compile and run on a plain host
//  (the surface view layers SwiftUI chrome on top in TemperatureMetricCards.swift).
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation
/// logs via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated and redacted there.
public protocol TemperatureMetricsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened`
/// event. The slug is a static, non-identifying constant logged verbatim; no payload, VIN, or
/// location is ever recorded.
public struct OSLogTemperatureMetricsTelemetry: TemperatureMetricsTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the surface's drivetrain-health query, mirroring the shared
/// `LoadableState` cases the web parent projects from `useDrivetrainHealth` (web `isLoading`
/// skeleton / resolved payload / empty / failure).
public enum TemperatureMetricsLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the header freshness chip + the cached-data banner
/// so cached cards are clearly labeled while reconnecting / offline.
public enum TemperatureMetricsConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `TemperatureMetricsSource`: the drivetrain-health load
/// status + the four-sensor/health/power payload + the display-unit preferences + the (shared)
/// connection + the in-flight refresh flag.
public struct TemperatureMetricsUpdate: Sendable, Equatable {
    public var status: TemperatureMetricsLoadStatus
    public var input: TemperatureMetricsInput?
    public var unitPrefs: TemperatureMetricsUnitPrefs
    public var refreshing: Bool
    public var connection: TemperatureMetricsConnection
    public var updatedAt: Date?

    public init(
        status: TemperatureMetricsLoadStatus = .loading,
        input: TemperatureMetricsInput? = nil,
        unitPrefs: TemperatureMetricsUnitPrefs = TemperatureMetricsUnitPrefs(),
        refreshing: Bool = false,
        connection: TemperatureMetricsConnection = .live,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.input = input
        self.unitPrefs = unitPrefs
        self.refreshing = refreshing
        self.connection = connection
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8
/// state holders — composing the drivetrain-health query (web `useDrivetrainHealth`) with the
/// unit-preference holder (web `useUnits`) and a refresh affordance. Previews + tests use
/// `InMemoryTemperatureMetricsSource`. The view never talks to the network directly.
@MainActor
public protocol TemperatureMetricsSource: AnyObject {
    var onUpdate: (@MainActor (TemperatureMetricsUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-fetches the drivetrain-health query from the backend (web `refetch()`).
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `TemperatureMetricsSource`, projects
/// the payload + unit preferences into the six view-ready cards, and exposes a render
/// `TemperatureMetricsPhase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class TemperatureMetricCardsModel {
    public private(set) var connection: TemperatureMetricsConnection = .live
    public private(set) var phase: TemperatureMetricsPhase = .loading
    public private(set) var cards: [TemperatureMetricCardModel] = []
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any TemperatureMetricsSource
    @ObservationIgnored private let telemetry: any TemperatureMetricsTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any TemperatureMetricsSource,
        telemetry: any TemperatureMetricsTelemetry = OSLogTemperatureMetricsTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: TemperatureMetricCardsSurface.slug)
        source.start()
    }

    /// Stops observing the upstream query.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-fetches the drivetrain-health query (web `refetch()`), used by the error-state retry.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: TemperatureMetricsUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        refreshing = update.refreshing
        cards = TemperatureMetricsProjection.cards(from: update.input, prefs: update.unitPrefs)
        phase = TemperatureMetricsProjection.resolvePhase(update.status, hasValue: update.input != nil)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh of the query (prompt "stale chip + auto-refresh"); reset
    /// once live so a later stale episode re-triggers exactly once. Offline keeps the cached
    /// cards without hammering an unreachable backend.
    private func handleAutoRefresh(for connection: TemperatureMetricsConnection) {
        switch connection {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            source.refresh()
        case .live:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }
}

/// In-memory source for previews + unit tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryTemperatureMetricsSource: TemperatureMetricsSource {
    public var onUpdate: (@MainActor (TemperatureMetricsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: TemperatureMetricsUpdate?

    public init(initial: TemperatureMetricsUpdate? = nil) {
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
    public func push(_ update: TemperatureMetricsUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity + localization facade (P1/S10) — web `t(key, default)`

/// Stable, non-identifying identity for the surface. The slug is emitted with the P1/S11
/// `view.opened` diagnostics contract and is referenced by both the view and its tests so the
/// two never drift.
public enum TemperatureMetricCardsSurface {
    /// The diagnostics slug emitted with the `view.opened` event.
    public static let slug = "TemperatureMetricCards"
}

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "TemperatureMetricCards" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept in a per-surface table so each
/// parallel surface prompt owns its own strings without editing the shared catalog. `string` is
/// Foundation-only so the model/adapter can use it; the SwiftUI `text(_:_:)` helper lives in
/// the view file.
public enum TemperatureMetricsStrings {
    public static let table = "TemperatureMetricCards"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
