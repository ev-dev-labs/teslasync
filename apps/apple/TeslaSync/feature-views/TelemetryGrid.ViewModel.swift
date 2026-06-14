//
//  TelemetryGrid.ViewModel.swift
//  TeslaSync — P4 feature view · 0285 · TelemetryGrid (Apple)
//
//  The surface's observable view-model (P1/S8). Subscribes to a `TelemetryGridSource`,
//  projects the six tiles via `TelemetryGridProjector`, owns the render phase the web
//  composition implies plus the P4 leaf contract (loading skeleton / data grid / empty /
//  error) and the live-state freshness, and exposes the refresh intent the error + stale
//  chrome call back through. No networking lives here.
//

import Foundation
import Observation

// MARK: - View model

/// The surface's observable view-model. Subscribes to a `TelemetryGridSource`, projects the
/// six tiles, derives the render phase, and tracks live-state freshness so stale / offline
/// readings are clearly labelled. No networking lives here.
@MainActor
@Observable
public final class TelemetryGridModel {
    /// The top-level render branch. `loading` is the pre-snapshot / initial-fetch skeleton;
    /// `empty` is "no vehicle state at all" once resolved; `error` is a hard parent-query
    /// failure with nothing to show; `data` renders the six-tile grid (with the stale /
    /// offline freshness chrome layered in).
    public enum Phase: Equatable {
        case loading
        case empty
        case data
        case error
    }

    public private(set) var phase: Phase = .loading
    public private(set) var projection: TelemetryGridProjection?
    public private(set) var status: TGLoadStatus = .loading
    public private(set) var connection: TelemetryGridConnection = .live
    public private(set) var isFetching = false

    @ObservationIgnored private let source: any TelemetryGridSource
    @ObservationIgnored private let telemetry: any TelemetryGridTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any TelemetryGridSource,
        telemetry: any TelemetryGridTelemetry = OSLogTelemetryGridTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: TelemetryGridSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a vehicle-state refresh (web invalidate / refetch). Wired to the error-state
    /// retry + the stale auto-refresh.
    public func refresh() {
        source.refresh()
    }

    /// Auto-refreshes once when data has gone stale but is not already fetching — the native
    /// parity of the web stale-query self-refresh.
    public func autoRefreshIfStale() {
        guard connection == .stale, !isFetching else { return }
        source.refresh()
    }

    // MARK: Derived display state

    /// The diagnostics surface slug (P1/S11 `view.opened`).
    public var surfaceSlug: String {
        TelemetryGridSurface.slug
    }

    /// Web freshness > window — drives the amber stale chip + the one guarded auto-refresh.
    public var isStale: Bool {
        connection == .stale
    }

    /// No connectivity — cached readings are shown with an offline chip.
    public var isOffline: Bool {
        connection == .offline
    }

    /// Whether the surface should show a freshness chip (stale / offline / fetching). Live +
    /// idle stays chrome-free, matching the web grid (which has no chrome at all).
    public var showsFreshnessChip: Bool {
        connection != .live || isFetching
    }

    /// The relative age label for the freshness chip (web freshness age).
    public var ageLabel: String {
        projection?.ageLabel ?? TGUnits.emptyDisplay
    }

    // MARK: Seam handler

    private func apply(_ update: TelemetryGridUpdate) {
        projection = TelemetryGridProjector.project(update: update)
        status = update.status
        connection = update.connection
        isFetching = update.isFetching
        phase = Self.computePhase(update)
        handleAutoRefresh(for: update.connection)
    }

    /// Derives the render phase from a snapshot (see `Phase`). A still-loading first fetch
    /// with no vehicle is the skeleton; a hard failure with no vehicle is the error state; a
    /// resolved snapshot with no vehicle is the empty state; otherwise the six-tile grid
    /// renders (the web grid shows its tiles as soon as a `VehicleState` is present).
    static func computePhase(_ update: TelemetryGridUpdate) -> Phase {
        switch update.status {
        case .loading:
            update.hasVehicle ? .data : .loading
        case .failed:
            update.hasVehicle ? .data : .error
        case .loaded:
            update.hasVehicle ? .data : .empty
        }
    }

    /// Stale → one guarded auto-refresh; reset once live so a later stale episode re-triggers
    /// exactly once. Offline keeps cached readings without hammering an unreachable backend.
    private func handleAutoRefresh(for connection: TelemetryGridConnection) {
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
