//
//  ClimateControlPanelWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0026 · ClimateControlPanelWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10). The
//  view binds through `ClimatePanelModel`; no networking lives in the view. This
//  file owns the seams; the pure cached → projection logic lives in
//  ClimateControlPanelWidget.Adapter.swift + ClimateControlPanelWidget.Projection.swift.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// logs via `os.Logger`; the production app injects an adapter that forwards to the
/// shared core `Telemetry.track(.screenView(screen:…))` (ADR-016), which is
/// consent-gated and redacted there.
public protocol ClimatePanelTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogClimatePanelTelemetry: ClimatePanelTelemetry {
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
public enum ClimatePanelLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013). Drives the
/// header chip + the stale/offline banner so cached values are clearly labeled.
public enum ClimatePanelConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `ClimatePanelSource`: the cached climate row
/// + the user's temperature unit + load/connection status. The model turns this
/// into the projection.
public struct ClimatePanelUpdate: Sendable, Equatable {
    public var status: ClimatePanelLoadStatus
    public var connection: ClimatePanelConnection
    public var input: ClimatePanelInput?
    public var unit: ClimatePanelTemperatureUnit
    public var updatedAt: Date?

    public init(
        status: ClimatePanelLoadStatus = .loading,
        connection: ClimatePanelConnection = .live,
        input: ClimatePanelInput? = nil,
        unit: ClimatePanelTemperatureUnit = .celsius,
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
/// `UnitStore`); previews and tests use `InMemoryClimatePanelSource`. The view
/// never talks to the network directly.
@MainActor
public protocol ClimatePanelSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (ClimatePanelUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `ClimatePanelSource`,
/// recomputes the `ClimatePanelProjection` via the pure builder, and exposes a
/// render `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class ClimatePanelModel {
    /// The mutually-exclusive render branches (web shell loading / empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: ClimatePanelConnection = .live
    public private(set) var projection: ClimatePanelProjection = .empty
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any ClimatePanelSource
    @ObservationIgnored private let telemetry: any ClimatePanelTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any ClimatePanelSource,
        telemetry: any ClimatePanelTelemetry = OSLogClimatePanelTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ClimateControlPanelWidget.surfaceSlug)
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

    private func apply(_ update: ClimatePanelUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        if let input = update.input {
            projection = ClimatePanelProjectionBuilder.build(input: input, unit: update.unit)
        } else {
            projection = .empty
        }
        phase = Self.resolvePhase(update)
    }

    /// Resolves the render phase. The web only shows the skeleton on the initial
    /// fetch and the "No climate data" empty state when the source resolves with no
    /// row; whenever a row is known the panel renders (cached values stay visible
    /// behind refresh/errors, with the freshness chip reflecting staleness/failure).
    public static func resolvePhase(_ update: ClimatePanelUpdate) -> Phase {
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
public final class InMemoryClimatePanelSource: ClimatePanelSource {
    public var onUpdate: (@MainActor (ClimatePanelUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ClimatePanelUpdate?

    public init(initial: ClimatePanelUpdate? = nil) {
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
    public func push(_ update: ClimatePanelUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "ClimateControlPanelWidget"
/// table, folded into the app `Localizable.xcstrings` catalog at integration time;
/// they are kept in a per-surface table so each parallel surface owns its own
/// strings without editing the shared catalog.
public enum ClimatePanelStrings {
    public static let table = "ClimateControlPanelWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
