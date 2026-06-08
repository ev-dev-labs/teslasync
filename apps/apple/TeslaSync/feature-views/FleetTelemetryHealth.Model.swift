//
//  FleetTelemetryHealth.Model.swift
//  TeslaSync — P4 feature view · 0005 · FleetTelemetryHealth (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade
//  (P1/S10). The view binds through `FleetHealthModel`; no networking lives in the
//  view. SwiftUI parity of features/admin/components/devtools/FleetTelemetryHealth.tsx
//  — the admin "Fleet Telemetry Health" devtools surface that lists the vehicles with
//  fleet-telemetry configuration errors (Error VINs) and the detailed error history
//  (Error Log), with a VIN filter linking the two and Tesla-refresh actions.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.viewOpened(surface:…))`, which is
/// consent-gated and redacted there.
public protocol FleetHealthTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogFleetHealthTelemetry: FleetHealthTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for one of the surface's two queries, mirroring the shared
/// `LoadableState` cases the web source projects from the `useFleetTelemetryError*`
/// hooks (web `isLoading` skeleton / resolved rows / empty / failure).
public enum FleetHealthLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the header freshness chip + the cached-data
/// banner so cached rows are clearly labeled while reconnecting / offline.
public enum FleetHealthConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One vehicle reported by the error-VINs query (web `FleetTelemetryErrorVIN`). Only
/// the fields the web source reads are modeled; the production source projects these
/// from the shared telemetry store.
public struct FleetTelemetryErrorVINInput: Sendable, Equatable, Identifiable {
    public var vin: String
    public var firstSeenAt: Date?
    public var lastSeenAt: Date?

    public var id: String {
        vin
    }

    public init(vin: String, firstSeenAt: Date? = nil, lastSeenAt: Date? = nil) {
        self.vin = vin
        self.firstSeenAt = firstSeenAt
        self.lastSeenAt = lastSeenAt
    }
}

/// One detailed error record from the error-log query (web `FleetTelemetryError`).
/// `errorCode` / `errorMessage` are optional (web renders the em-dash sentinel when
/// absent). `id` is the web `String(r.id)` stable row identity.
public struct FleetTelemetryErrorInput: Sendable, Equatable, Identifiable {
    public var id: String
    public var vin: String
    public var errorCode: String?
    public var errorMessage: String?
    public var reportedAt: Date?

    public init(
        id: String,
        vin: String,
        errorCode: String? = nil,
        errorMessage: String? = nil,
        reportedAt: Date? = nil
    ) {
        self.id = id
        self.vin = vin
        self.errorCode = errorCode
        self.errorMessage = errorMessage
        self.reportedAt = reportedAt
    }
}

/// One coalesced snapshot pushed by a `FleetHealthSource`: both queries' rows + their
/// load status + the (shared) connection + the active VIN filter the source applied.
public struct FleetHealthUpdate: Sendable, Equatable {
    public var vinsStatus: FleetHealthLoadStatus
    public var vins: [FleetTelemetryErrorVINInput]
    public var vinsRefreshing: Bool
    public var errorsStatus: FleetHealthLoadStatus
    public var errors: [FleetTelemetryErrorInput]
    public var errorsRefreshing: Bool
    public var connection: FleetHealthConnection
    public var selectedVin: String?
    public var updatedAt: Date?

    public init(
        vinsStatus: FleetHealthLoadStatus = .loading,
        vins: [FleetTelemetryErrorVINInput] = [],
        vinsRefreshing: Bool = false,
        errorsStatus: FleetHealthLoadStatus = .loading,
        errors: [FleetTelemetryErrorInput] = [],
        errorsRefreshing: Bool = false,
        connection: FleetHealthConnection = .live,
        selectedVin: String? = nil,
        updatedAt: Date? = nil
    ) {
        self.vinsStatus = vinsStatus
        self.vins = vins
        self.vinsRefreshing = vinsRefreshing
        self.errorsStatus = errorsStatus
        self.errors = errors
        self.errorsRefreshing = errorsRefreshing
        self.connection = connection
        self.selectedVin = selectedVin
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared
/// P1/S8 state holders — composing the error-VINs query (web `useFleetTelemetryError
/// VINs`) with the VIN-filtered error-log query (web `useFleetTelemetryErrors(selected
/// Vin)`) and the two Tesla-refresh mutations. Previews + tests use
/// `InMemoryFleetHealthSource`. The view never talks to the network directly.
@MainActor
public protocol FleetHealthSource: AnyObject {
    var onUpdate: (@MainActor (FleetHealthUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Applies the active VIN filter to the error-log query (web `setSelectedVin`).
    func selectVin(_ vin: String?)
    func refreshVINs()
    func refreshErrors()
}

/// The surface's observable view-model. Subscribes to a `FleetHealthSource`, owns the
/// active VIN filter, projects both queries into view-ready rows, and exposes a render
/// `FleetHealthPhase` per section + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class FleetHealthModel {
    public private(set) var connection: FleetHealthConnection = .live
    public private(set) var selectedVin: String?
    public private(set) var vinsPhase: FleetHealthPhase = .loading
    public private(set) var errorsPhase: FleetHealthPhase = .loading
    public private(set) var vinRows: [FleetVINRow] = []
    public private(set) var errorRows: [FleetTelemetryHealthErrorRow] = []
    public private(set) var vinsRefreshing = false
    public private(set) var errorsRefreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any FleetHealthSource
    @ObservationIgnored private let telemetry: any FleetHealthTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any FleetHealthSource,
        telemetry: any FleetHealthTelemetry = OSLogFleetHealthTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: FleetTelemetryHealth.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream queries.
    public func stop() {
        started = false
        source.stop()
    }

    /// Toggles the VIN filter (web `setSelectedVin(r.vin === selectedVin ? '' : r.vin)`).
    public func toggleVin(_ vin: String) {
        selectVin(vin == selectedVin ? nil : vin)
    }

    /// Clears the active VIN filter (web `setSelectedVin('')`).
    public func clearVinFilter() {
        selectVin(nil)
    }

    /// Sets the active VIN filter and re-queries the error log through the source.
    public func selectVin(_ vin: String?) {
        selectedVin = vin
        source.selectVin(vin)
    }

    /// Refreshes the error-VINs query from Tesla (web `refreshVINs.mutate()`).
    public func refreshVINs() {
        source.refreshVINs()
    }

    /// Refreshes the error-log query from Tesla (web `refreshErrors.mutate()`).
    public func refreshErrors() {
        source.refreshErrors()
    }

    private func apply(_ update: FleetHealthUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        vinsRefreshing = update.vinsRefreshing
        errorsRefreshing = update.errorsRefreshing
        if let selected = update.selectedVin { selectedVin = selected }
        let now = Date()
        vinRows = FleetHealthProjection.vinRows(from: update.vins, now: now)
        errorRows = FleetHealthProjection.errorRows(from: update.errors, now: now)
        vinsPhase = FleetHealthProjection.resolvePhase(update.vinsStatus, hasRows: !vinRows.isEmpty)
        errorsPhase = FleetHealthProjection.resolvePhase(update.errorsStatus, hasRows: !errorRows.isEmpty)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh of both queries (prompt "stale chip + auto-
    /// refresh"); reset once live so a later stale episode re-triggers exactly once.
    private func handleAutoRefresh(for connection: FleetHealthConnection) {
        switch connection {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            source.refreshVINs()
            source.refreshErrors()
        case .live:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }
}

/// In-memory source for previews + unit tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryFleetHealthSource: FleetHealthSource {
    public var onUpdate: (@MainActor (FleetHealthUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshVINsCount = 0
    public private(set) var refreshErrorsCount = 0
    public private(set) var selectedVins: [String?] = []

    private let initial: FleetHealthUpdate?

    public init(initial: FleetHealthUpdate? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func selectVin(_ vin: String?) {
        selectedVins.append(vin)
    }

    public func refreshVINs() {
        refreshVINsCount += 1
    }

    public func refreshErrors() {
        refreshErrorsCount += 1
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ update: FleetHealthUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity + localization facade (P1/S10) — web `t(key, default)`

public extension FleetTelemetryHealth {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static let surfaceSlug = "FleetTelemetryHealth"
}

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "FleetTelemetryHealth" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time.
public enum FleetHealthStrings {
    public static let table = "FleetTelemetryHealth"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
