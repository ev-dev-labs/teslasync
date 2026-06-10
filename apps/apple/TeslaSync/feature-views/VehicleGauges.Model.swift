//
//  VehicleGauges.Model.swift
//  TeslaSync — P4 feature view · 0304 · VehicleGauges (Apple)
//
//  The state-holder seam (P1/S8) for the vehicle-detail gauges cluster. The web source is a
//  pure presentational leaf fed `vehicle` + `state` by its parent (the Vehicle Detail page)
//  and reads `useUnits()`, so the input snapshot here carries that vehicle + state + the
//  active unit preferences plus the parent's loading / error / connectivity state rather than
//  issuing HTTP itself. The view binds through `VehicleGaugesModel`; no networking lives here.
//
//  States: the web leaf always renders its gauges from the `state` prop. On top of that, this
//  surface honours the P4 leaf contract: a `phase` (loading / empty / error / data) fed by the
//  parent's query state, and an orthogonal `connection` axis (live / stale / offline) surfaced
//  as a freshness banner with a one-shot auto-refresh on the stale transition. Cached content
//  stays visible behind a refresh / failure / offline window (web parity — the parent keeps
//  the last good state) so the cluster never blanks once it has data.
//
//  Vendor-agnostic + SwiftUI-free (Foundation + Observation + OSLog only) so the model + the
//  projection it drives compile and unit-test on a plain host; the SwiftUI chrome layers on top.
//

import Foundation
import Observation

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound data — the orthogonal connectivity axis rendered as the banner.
/// `live` hides the banner; `stale` / `offline` show it.
public enum VehicleGaugesConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (web props from the vehicle-detail page)

/// One coalesced snapshot of the cluster's inputs — the native mirror of the web props
/// (`vehicle`, `state`) plus the active unit preferences (web `useUnits`) and the parent
/// surface's lifecycle (`isLoading`, an error message, and connectivity).
public struct VehicleGaugesInput: Sendable, Equatable {
    public var vehicle: VehicleGaugesVehicle?
    public var state: VehicleGaugesState?
    public var isLoading: Bool
    public var errorMessage: String?
    public var units: VehicleGaugesUnits
    public var connection: VehicleGaugesConnection

    public init(
        vehicle: VehicleGaugesVehicle? = nil,
        state: VehicleGaugesState? = nil,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        units: VehicleGaugesUnits = .metric,
        connection: VehicleGaugesConnection = .live
    ) {
        self.vehicle = vehicle
        self.state = state
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.units = units
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render + P4 leaf contract)

/// The resolved, view-ready state — the native mirror of the cluster's render. `phase` selects
/// the body; for the data phase the pre-projected `content` (car viz + gauges + bars + chips)
/// is carried so the view is a pure function of this value.
public struct VehicleGaugesResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let content: VehicleGaugesContent?

    public init(phase: Phase, content: VehicleGaugesContent?) {
        self.phase = phase
        self.content = content
    }
}

// MARK: - Phase projection (web render + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the
/// web component's render plus the P4 leaf contract. Cached content stays visible: once a
/// vehicle state is present the cluster renders `.data` even while refreshing / stale / offline;
/// the loading / empty / error phases only show when there is no state yet. Unit tested across
/// all four phases.
public enum VehicleGaugesPhaseProjection {
    public static func resolve(_ input: VehicleGaugesInput) -> VehicleGaugesResolved {
        if let state = input.state {
            let content = VehicleGaugesContentProjection.build(
                state: state,
                vehicle: input.vehicle,
                units: input.units
            )
            return VehicleGaugesResolved(phase: .data, content: content)
        }
        // No snapshot yet — pick the chrome phase from the parent's lifecycle flags.
        if let message = input.errorMessage, !message.isEmpty {
            return VehicleGaugesResolved(phase: .error(message), content: nil)
        }
        if input.isLoading {
            return VehicleGaugesResolved(phase: .loading, content: nil)
        }
        return VehicleGaugesResolved(phase: .empty, content: nil)
    }
}

// MARK: - View-model (P1/S8 binding)

/// The cluster's observable view-model. Subscribes to a `VehicleGaugesSource`, recomputes the
/// resolved projection (re-projecting whenever the bound unit preferences change), exposes a
/// render `phase` + the resolved content and the `connection` axis, forwards the refresh
/// intent to its seam, and auto-refreshes once when the feed transitions to stale.
@MainActor
@Observable
public final class VehicleGaugesModel {
    public private(set) var resolved: VehicleGaugesResolved =
        VehicleGaugesPhaseProjection.resolve(VehicleGaugesInput(isLoading: true))
    public private(set) var connection: VehicleGaugesConnection = .live

    public var phase: VehicleGaugesResolved.Phase {
        resolved.phase
    }

    public var content: VehicleGaugesContent? {
        resolved.content
    }

    @ObservationIgnored private let source: any VehicleGaugesSource
    @ObservationIgnored private let telemetry: any VehicleGaugesTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any VehicleGaugesSource,
        telemetry: any VehicleGaugesTelemetry = OSLogVehicleGaugesTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: VehicleGaugesSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (banner refresh button + error retry).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: VehicleGaugesInput) {
        resolved = VehicleGaugesPhaseProjection.resolve(input)
        connection = input.connection
        handleAutoRefresh(for: input.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live
    /// so a later stale episode re-triggers exactly once. Offline keeps the cached content
    /// without hammering an unreachable backend.
    private func handleAutoRefresh(for connection: VehicleGaugesConnection) {
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
