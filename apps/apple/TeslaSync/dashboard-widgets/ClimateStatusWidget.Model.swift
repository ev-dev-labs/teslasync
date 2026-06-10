//
//  ClimateStatusWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0028 · ClimateStatusWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10). The
//  view binds through `ClimateStatusModel`; no networking lives in the view. This
//  file owns the seams; the pure cached → projection logic lives in
//  ClimateStatusWidget.Adapter.swift + ClimateStatusWidget.Projection.swift.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// logs via `os.Logger`; the production app injects an adapter that forwards to the
/// shared core `Telemetry.track(.screenView(screen:…))` (ADR-016), which is
/// consent-gated and redacted there.
public protocol ClimateStatusTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogClimateStatusTelemetry: ClimateStatusTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the widget's data, mirroring the shared `LoadableState`
/// cases the production source projects from the `useClimateLatest` query.
public enum ClimateStatusLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013). Drives the
/// header chip + the stale/offline banner so cached values are clearly labeled.
public enum ClimateStatusConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `ClimateStatusSource`: the cached climate row
/// + the user's temperature unit + load/connection status. The model turns this into
/// the projection.
public struct ClimateStatusUpdate: Sendable, Equatable {
    public var status: ClimateStatusLoadStatus
    public var connection: ClimateStatusConnection
    public var input: ClimateStatusInput?
    public var unit: ClimateStatusTemperatureUnit
    public var updatedAt: Date?

    public init(
        status: ClimateStatusLoadStatus = .loading,
        connection: ClimateStatusConnection = .live,
        input: ClimateStatusInput? = nil,
        unit: ClimateStatusTemperatureUnit = .celsius,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.input = input
        self.unit = unit
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (the `climate/latest` query store + the settings
/// `UnitStore`); previews and tests use `InMemoryClimateStatusSource`. The view never
/// talks to the network directly.
@MainActor
public protocol ClimateStatusSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (ClimateStatusUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `ClimateStatusSource`,
/// recomputes the `ClimateStatusProjection` via the pure builder, and exposes a
/// render `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class ClimateStatusModel {
    /// The mutually-exclusive render branches (web shell loading / empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: ClimateStatusConnection = .live
    public private(set) var projection: ClimateStatusProjection = .empty
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any ClimateStatusSource
    @ObservationIgnored private let telemetry: any ClimateStatusTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any ClimateStatusSource,
        telemetry: any ClimateStatusTelemetry = OSLogClimateStatusTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ClimateStatusWidget.surfaceSlug)
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

    private func apply(_ update: ClimateStatusUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        if let input = update.input {
            projection = ClimateStatusProjectionBuilder.build(input: input, unit: update.unit)
        } else {
            projection = .empty
        }
        phase = Self.resolvePhase(update)
    }

    /// Resolves the render phase. The web only shows the skeleton on the initial
    /// fetch and the "No climate data" empty state when the source resolves with no
    /// row; whenever a row is known the panel renders (cached values stay visible
    /// behind refresh/errors, with the freshness chip reflecting staleness/failure).
    public static func resolvePhase(_ update: ClimateStatusUpdate) -> Phase {
        let hasData = update.input != nil
        switch update.status {
        case .loading:
            return hasData ? .content : .loading
        case .empty:
            return .empty
        case .loaded:
            return hasData ? .content : .empty
        case let .failed(message):
            return hasData ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryClimateStatusSource: ClimateStatusSource {
    public var onUpdate: (@MainActor (ClimateStatusUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ClimateStatusUpdate?

    public init(initial: ClimateStatusUpdate? = nil) {
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
    public func push(_ update: ClimateStatusUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "ClimateStatusWidget" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time; they are kept in
/// a per-surface table so each parallel surface owns its own strings without editing
/// the shared catalog.
public enum ClimateStatusStrings {
    public static let table = "ClimateStatusWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
