//
//  FleetSummary.ViewModel.swift
//  TeslaSync — P4 feature view · 0276 · FleetSummary (Apple)
//
//  The surface's observable view-model (P1/S8). Subscribes to a `FleetSummarySource`,
//  projects the four stat tiles via `FleetSummaryProjector`, owns the render phase the
//  web component implies (loading skeleton / content / empty / error) plus the live-state
//  freshness, and exposes the refresh intent the error + stale chrome call back through.
//  No networking lives here.
//

import Foundation
import Observation

// MARK: - View model

/// The surface's observable view-model. Subscribes to a `FleetSummarySource`, projects
/// the four tiles (Vehicles / Avg Battery / Total Range / Charging-Online) via
/// `FleetSummaryProjector`, derives the render phase, and tracks live-state freshness so
/// stale / offline readings are clearly labelled. No networking lives here.
@MainActor
@Observable
public final class FleetSummaryModel {
    /// The top-level render branch. `loading` is the pre-snapshot / initial-fetch
    /// skeleton; `empty` is the no-vehicles state (web `enabled: vehicles.length > 0`);
    /// `error` is a hard fleet-state query failure with no usable readings; `content`
    /// renders the four tiles (with the stale / offline freshness chrome layered in).
    public enum Phase: Equatable {
        case loading
        case empty
        case error
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var projection: FleetSummaryProjection?
    public private(set) var status: FleetLoadStatus = .loading
    public private(set) var connection: FleetSummaryConnection = .live
    public private(set) var isFetching = false

    @ObservationIgnored private let source: any FleetSummarySource
    @ObservationIgnored private let telemetry: any FleetSummaryTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any FleetSummarySource,
        telemetry: any FleetSummaryTelemetry = OSLogFleetSummaryTelemetry()
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
        telemetry.viewOpened(surface: FleetSummarySurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a fleet-state refresh (web invalidate / `refetchInterval`). Wired to the
    /// error-state retry + the stale auto-refresh.
    public func refresh() {
        source.refresh()
    }

    /// Auto-refreshes once when data has gone stale but is not already fetching — the
    /// native parity of the web stale-query self-refresh.
    public func autoRefreshIfStale() {
        guard connection == .stale, !isFetching else { return }
        source.refresh()
    }

    // MARK: Derived display state

    /// The diagnostics surface slug (P1/S11 `view.opened`).
    public var surfaceSlug: String {
        FleetSummarySurface.slug
    }

    /// The four tiles (web GlassPanel stat row), or an empty list before the first
    /// snapshot.
    public var metrics: [FleetMetric] {
        projection?.metrics ?? []
    }

    /// Web freshness > window — drives the amber stale chip + the one guarded
    /// auto-refresh.
    public var isStale: Bool {
        connection == .stale
    }

    /// No connectivity — cached readings are shown with an offline chip.
    public var isOffline: Bool {
        connection == .offline
    }

    /// Whether the content header should show a freshness chip (stale / offline /
    /// fetching). Live + idle stays chrome-free, matching the web tile row.
    public var showsFreshnessChip: Bool {
        connection != .live || isFetching
    }

    /// The relative age label for the freshness chip (web freshness age).
    public var ageLabel: String {
        projection?.ageLabel ?? "—"
    }

    // MARK: Seam handler

    private func apply(_ update: FleetSummaryUpdate) {
        projection = FleetSummaryProjector.project(update: update)
        status = update.status
        connection = update.connection
        isFetching = update.isFetching
        phase = Self.computePhase(update)
        handleAutoRefresh(for: update.connection)
    }

    /// Derives the render phase from a snapshot (see `Phase`). Vehicles-empty wins over
    /// everything (web disabled query); a hard failure with no readings is the error
    /// state; a still-loading first fetch is the skeleton; otherwise the tiles render —
    /// the web component shows the tiles (with zeros) as soon as it has the vehicle list.
    static func computePhase(_ update: FleetSummaryUpdate) -> Phase {
        if update.vehicles.isEmpty {
            return .empty
        }
        switch update.status {
        case .loading:
            return update.resolvedStates.isEmpty ? .loading : .content
        case .failed:
            return update.resolvedStates.isEmpty ? .error : .content
        case .loaded:
            return .content
        }
    }

    /// Stale → one guarded auto-refresh; reset once live so a later stale episode
    /// re-triggers exactly once. Offline keeps cached readings without hammering an
    /// unreachable backend.
    private func handleAutoRefresh(for connection: FleetSummaryConnection) {
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
