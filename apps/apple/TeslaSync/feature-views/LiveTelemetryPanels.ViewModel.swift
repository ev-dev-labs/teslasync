//
//  LiveTelemetryPanels.ViewModel.swift
//  TeslaSync — P4 feature view · 0281 · LiveTelemetryPanels (Apple)
//
//  The surface's observable view-model (P1/S8). Subscribes to a
//  `LiveTelemetryPanelsSource`, projects the seven panels via
//  `LiveTelemetryPanelsProjector`, owns the render phase the web composition implies plus
//  the P4 leaf contract (loading skeleton / data grid / empty / error) and the live-state
//  freshness, and exposes the refresh intent the error + stale chrome call back through.
//  No networking lives here.
//

import Foundation
import Observation

// MARK: - View model

/// The surface's observable view-model. Subscribes to a `LiveTelemetryPanelsSource`,
/// projects the seven panels, derives the render phase, and tracks live-state freshness so
/// stale / offline readings are clearly labelled. No networking lives here.
@MainActor
@Observable
public final class LiveTelemetryPanelsModel {
    /// The top-level render branch. `loading` is the pre-snapshot / initial-fetch skeleton;
    /// `empty` is "no telemetry at all" once resolved; `error` is a hard parent-query
    /// failure with nothing to show; `data` renders the seven-panel grid (with the stale /
    /// offline freshness chrome layered in). Each panel still renders its own per-source
    /// empty fallback inside `data`, matching the web `data ? content : EmptyState` panels.
    public enum Phase: Equatable {
        case loading
        case empty
        case data
        case error
    }

    public private(set) var phase: Phase = .loading
    public private(set) var projection: LiveTelemetryPanelsProjection?
    public private(set) var status: LTPLoadStatus = .loading
    public private(set) var connection: LiveTelemetryPanelsConnection = .live
    public private(set) var isFetching = false

    @ObservationIgnored private let source: any LiveTelemetryPanelsSource
    @ObservationIgnored private let telemetry: any LiveTelemetryPanelsTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any LiveTelemetryPanelsSource,
        telemetry: any LiveTelemetryPanelsTelemetry = OSLogLiveTelemetryPanelsTelemetry()
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
        telemetry.viewOpened(surface: LiveTelemetryPanelsSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a telemetry refresh (web invalidate / refetch). Wired to the error-state
    /// retry + the stale auto-refresh.
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
        LiveTelemetryPanelsSurface.slug
    }

    /// Web freshness > window — drives the amber stale chip + the one guarded auto-refresh.
    public var isStale: Bool {
        connection == .stale
    }

    /// No connectivity — cached readings are shown with an offline chip.
    public var isOffline: Bool {
        connection == .offline
    }

    /// Whether the header should show a freshness chip (stale / offline / fetching). Live +
    /// idle stays chrome-free, matching the web section header.
    public var showsFreshnessChip: Bool {
        connection != .live || isFetching
    }

    /// The relative age label for the freshness chip (web freshness age).
    public var ageLabel: String {
        projection?.ageLabel ?? LTPUnits.emptyDisplay
    }

    // MARK: Seam handler

    private func apply(_ update: LiveTelemetryPanelsUpdate) {
        projection = LiveTelemetryPanelsProjector.project(update: update)
        status = update.status
        connection = update.connection
        isFetching = update.isFetching
        phase = Self.computePhase(update)
        handleAutoRefresh(for: update.connection)
    }

    /// Derives the render phase from a snapshot (see `Phase`). A still-loading first fetch
    /// with no telemetry is the skeleton; a hard failure with no telemetry is the error
    /// state; a resolved snapshot with no telemetry at all is the empty state; otherwise
    /// the seven-panel grid renders — the web composition shows the panels (each with its
    /// own empty fallback) as soon as there is anything to show.
    static func computePhase(_ update: LiveTelemetryPanelsUpdate) -> Phase {
        switch update.status {
        case .loading:
            update.hasAnyTelemetry ? .data : .loading
        case .failed:
            update.hasAnyTelemetry ? .data : .error
        case .loaded:
            update.hasAnyTelemetry ? .data : .empty
        }
    }

    /// Stale → one guarded auto-refresh; reset once live so a later stale episode
    /// re-triggers exactly once. Offline keeps cached readings without hammering an
    /// unreachable backend.
    private func handleAutoRefresh(for connection: LiveTelemetryPanelsConnection) {
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
