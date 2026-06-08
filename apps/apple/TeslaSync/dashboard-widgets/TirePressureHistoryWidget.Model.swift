//
//  TirePressureHistoryWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0101 · TirePressureHistoryWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + dashboard registry +
//  i18n facade (P1/S10) + the testable accessibility summary. The view binds
//  through `TirePressureHistoryModel`; no networking lives here.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// logs via `os.Logger`; the production app injects an adapter that forwards to
/// the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016), which is
/// consent-gated and redacted there.
public protocol TirePressureHistoryTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogTirePressureHistoryTelemetry: TirePressureHistoryTelemetry {
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
public enum TirePressureLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013).
public enum TirePressureConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `TirePressureHistorySource`: the cached rows
/// + the user's pressure unit + load/connection status. The model turns this into
/// the projection.
public struct TirePressureHistoryUpdate: Sendable, Equatable {
    public var status: TirePressureLoadStatus
    public var connection: TirePressureConnection
    public var snapshots: [TirePressureSnapshotInput]
    public var unit: TirePressureUnit
    public var updatedAt: Date?

    public init(
        status: TirePressureLoadStatus = .loading,
        connection: TirePressureConnection = .live,
        snapshots: [TirePressureSnapshotInput] = [],
        unit: TirePressureUnit = .bar,
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
/// shared P1/S8 state holders (`StateHolderModel<LoadableState<[TirePressureReading]>>`
/// from the KMP `VehicleSystemsStore`, plus the settings `UnitStore`); previews and
/// tests use `InMemoryTirePressureHistorySource`. The view never talks to the
/// network directly.
@MainActor
public protocol TirePressureHistorySource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (TirePressureHistoryUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `TirePressureHistorySource`,
/// recomputes the `TirePressureProjection` via the pure builder, and exposes a
/// render `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class TirePressureHistoryModel {
    /// The mutually-exclusive render branches (web shell loading / empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: TirePressureConnection = .live
    public private(set) var projection: TirePressureProjection = .empty
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any TirePressureHistorySource
    @ObservationIgnored private let telemetry: any TirePressureHistoryTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any TirePressureHistorySource,
        telemetry: any TirePressureHistoryTelemetry = OSLogTirePressureHistoryTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: TirePressureHistoryWidget.surfaceSlug)
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

    private func apply(_ update: TirePressureHistoryUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        projection = TirePressureProjectionBuilder.build(
            snapshots: update.snapshots,
            unit: update.unit
        )
        phase = Self.resolvePhase(status: update.status, hasData: projection.hasData)
    }

    /// Resolves the render phase. The web only shows the skeleton on the initial
    /// fetch and the empty state when there are no rows; whenever cached rows exist
    /// the chart renders (values stay visible behind refresh/errors).
    static func resolvePhase(status: TirePressureLoadStatus, hasData: Bool) -> Phase {
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
public final class InMemoryTirePressureHistorySource: TirePressureHistorySource {
    public var onUpdate: (@MainActor (TirePressureHistoryUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: TirePressureHistoryUpdate?

    public init(initial: TirePressureHistoryUpdate? = nil) {
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
    public func push(_ update: TirePressureHistoryUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Registry metadata (canonical: registry/tires.ts → "tire-pressure-history")

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "TirePressureHistoryWidget"
/// table, folded into the app `Localizable.xcstrings` catalog at integration time.
public enum TirePressureHistoryStrings {
    public static let table = "TirePressureHistoryWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver value spoken for the chart. Pure + public so the a11y
/// content can be unit-tested without rendering the view.
public enum TirePressureHistoryAccessibility {
    public static func summary(for projection: TirePressureProjection) -> String {
        guard projection.hasData else {
            return TirePressureHistoryStrings.string(
                "widget.tirePressureHistory.noData",
                "No tire pressure history"
            )
        }
        let unit = projection.pressureUnitLabel
        let parts = TireCorner.allCases.map { corner -> String in
            let label = TirePressureHistoryStrings.string(corner.labelKey, corner.labelFallback)
            let value = TirePressureNumberFormat.pressure(projection.latestValue(corner))
            return "\(label) \(value) \(unit)"
        }
        return parts.joined(separator: ", ")
    }
}
