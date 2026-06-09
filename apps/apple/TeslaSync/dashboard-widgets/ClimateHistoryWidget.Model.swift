//
//  ClimateHistoryWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0027 · ClimateHistoryWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) +
//  the testable accessibility summary. The view binds through
//  `ClimateHistoryModel`; no networking lives here.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// logs via `os.Logger`; the production app injects an adapter that forwards to the
/// shared core `Telemetry.track(.screenView(screen:…))` (ADR-016), which is
/// consent-gated and redacted there.
public protocol ClimateHistoryTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogClimateHistoryTelemetry: ClimateHistoryTelemetry {
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
/// cases the production source projects from `Resource<T>`.
public enum ClimateLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013).
public enum ClimateConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `ClimateHistorySource`: the cached rows + the
/// user's temperature unit + load/connection status. The model turns this into the
/// projection.
public struct ClimateHistoryUpdate: Sendable, Equatable {
    public var status: ClimateLoadStatus
    public var connection: ClimateConnection
    public var snapshots: [ClimateSnapshotInput]
    public var unit: ClimateTemperatureUnit
    public var updatedAt: Date?

    public init(
        status: ClimateLoadStatus = .loading,
        connection: ClimateConnection = .live,
        snapshots: [ClimateSnapshotInput] = [],
        unit: ClimateTemperatureUnit = .celsius,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.snapshots = snapshots
        self.unit = unit
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (`StateHolderModel<LoadableState<[ClimateState]>>` from
/// the KMP `VehicleSystemsStore`, plus the settings `UnitStore`); previews and tests
/// use `InMemoryClimateHistorySource`. The view never talks to the network directly.
@MainActor
public protocol ClimateHistorySource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (ClimateHistoryUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `ClimateHistorySource`,
/// recomputes the `ClimateHistoryProjection` via the pure builder, and exposes a
/// render `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class ClimateHistoryModel {
    /// The mutually-exclusive render branches (web shell loading / empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: ClimateConnection = .live
    public private(set) var projection: ClimateHistoryProjection = .empty
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any ClimateHistorySource
    @ObservationIgnored private let telemetry: any ClimateHistoryTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any ClimateHistorySource,
        telemetry: any ClimateHistoryTelemetry = OSLogClimateHistoryTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ClimateHistoryWidget.surfaceSlug)
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

    private func apply(_ update: ClimateHistoryUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        projection = ClimateHistoryProjectionBuilder.build(
            snapshots: update.snapshots,
            unit: update.unit
        )
        phase = Self.resolvePhase(status: update.status, hasData: projection.hasData)
    }

    /// Resolves the render phase. The web only shows the skeleton on the initial
    /// fetch and the empty state when there are no rows; whenever cached rows exist
    /// the chart renders (values stay visible behind refresh/errors).
    static func resolvePhase(status: ClimateLoadStatus, hasData: Bool) -> Phase {
        switch status {
        case .loading:
            hasData ? .content : .loading
        case .loaded:
            hasData ? .content : .empty
        case .empty:
            .empty
        case let .failed(message):
            hasData ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryClimateHistorySource: ClimateHistorySource {
    public var onUpdate: (@MainActor (ClimateHistoryUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ClimateHistoryUpdate?

    public init(initial: ClimateHistoryUpdate? = nil) {
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
    public func push(_ update: ClimateHistoryUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "ClimateHistoryWidget" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time.
public enum ClimateHistoryStrings {
    public static let table = "ClimateHistoryWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver value spoken for the chart. Pure + public so the a11y
/// content can be unit-tested without rendering the view.
public enum ClimateHistoryAccessibility {
    public static func summary(for projection: ClimateHistoryProjection) -> String {
        guard projection.hasData else {
            return ClimateHistoryStrings.string(
                "widget.climateHistory.noData",
                "No climate history"
            )
        }
        let unit = projection.temperatureUnitLabel
        let parts = ClimateSeries.allCases.map { series -> String in
            let label = ClimateHistoryStrings.string(series.labelKey, series.labelFallback)
            let value = ClimateNumberFormat.temperature(projection.latestValue(series))
            return "\(label) \(value)\(unit)"
        }
        return parts.joined(separator: ", ")
    }
}
