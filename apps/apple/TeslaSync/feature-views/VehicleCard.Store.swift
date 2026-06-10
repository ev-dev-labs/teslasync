//
//  VehicleCard.Store.swift
//  TeslaSync — P4 feature view · 0302 · VehicleCard (Apple)
//
//  The P1/S8 state-holder binding for the VehicleCard surface. The view binds
//  through `VehicleCardModel`; no networking lives in the view. The model
//  subscribes to a `VehicleCardSource` — in production wired over the shared
//  `useVehicles` + `useVehicleState(id)` holders, in previews/tests the
//  `InMemoryVehicleCardSource` — recomputes the `VehicleCardData` projection, and
//  exposes a render `VehicleCardPhase` + freshness for SwiftUI to switch over.
//

import Foundation
import Observation

// MARK: - Source seam (P1/S8 — web `useVehicles` + `useVehicleState`)

/// The seam the model binds through. The production app implements this over the
/// shared P1/S8 state holders (the vehicles list query + the per-vehicle
/// `vehicles/{id}/state` query, coalesced); previews and tests use
/// `InMemoryVehicleCardSource`. The view never talks to the network.
@MainActor
public protocol VehicleCardSource: AnyObject {
    var onUpdate: (@MainActor (VehicleCardUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

// MARK: - Model (binds the source, projects, exposes the render phase)

/// The surface's observable view-model. Subscribes to a `VehicleCardSource`,
/// recomputes the `VehicleCardData` projection through the injected `useUnits`
/// formatting + i18n facade, and exposes a render `VehicleCardPhase` + freshness.
@MainActor
@Observable
public final class VehicleCardModel {
    public private(set) var phase: VehicleCardPhase = .loading
    public private(set) var connection: VehicleCardConnection = .live
    public private(set) var data: VehicleCardData?
    /// The raw vehicle behind the current projection (web `onDelete(vehicle)` arg).
    public private(set) var vehicle: VehicleCardVehicle?
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any VehicleCardSource
    @ObservationIgnored private let formatting: VehicleCardUnitsFormatting
    @ObservationIgnored private let localize: VehicleCardLocalizer
    @ObservationIgnored private let telemetry: any VehicleCardTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any VehicleCardSource,
        formatting: VehicleCardUnitsFormatting = .metricPreview,
        localize: VehicleCardLocalizer = .bundle,
        telemetry: any VehicleCardTelemetry = OSLogVehicleCardTelemetry()
    ) {
        self.source = source
        self.formatting = formatting
        self.localize = localize
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        VehicleCardSurface.reportOpen(to: telemetry)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (cached card stays visible). Wired to the retry affordance.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: VehicleCardUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        vehicle = update.vehicle
        data = update.vehicle.map { vehicle in
            VehicleCardProjection.project(
                vehicle: vehicle,
                state: update.state,
                formatting: formatting,
                localize: localize
            )
        }
        phase = Self.resolvePhase(update)
        handleAutoRefresh(for: update.connection)
    }

    /// Resolves the render phase. A known vehicle keeps the card visible through
    /// loading / refresh / errors (cached content persists, freshness reflects
    /// staleness or failure); with no cached vehicle the surface falls back to the
    /// empty state (resolved) or the error state (failed).
    public nonisolated static func resolvePhase(_ update: VehicleCardUpdate) -> VehicleCardPhase {
        let hasVehicle = update.vehicle != nil
        switch update.status {
        case .loading:
            return hasVehicle ? .content : .loading
        case .empty:
            return hasVehicle ? .content : .empty
        case .loaded:
            return hasVehicle ? .content : .empty
        case let .failed(message):
            return hasVehicle ? .content : .error(message)
        }
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset
    /// once live so a later stale episode re-triggers exactly once. Offline does
    /// not auto-refresh (there is no connectivity to retry over).
    private func handleAutoRefresh(for connection: VehicleCardConnection) {
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

// MARK: - In-memory source (previews + unit/UI tests)

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryVehicleCardSource: VehicleCardSource {
    public var onUpdate: (@MainActor (VehicleCardUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: VehicleCardUpdate?

    public init(initial: VehicleCardUpdate? = nil) {
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

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: VehicleCardUpdate) {
        onUpdate?(update)
    }
}
