//
//  VehicleHeader.Model.swift
//  TeslaSync — P4 feature view · 0305 · VehicleHeader (Apple)
//
//  The state-holder seam (P1/S8) for the vehicle header. The web source
//  (features/vehicles/components/VehicleHeader.tsx) takes `vehicle`, `state`, and
//  `onRefetchState`, derives `status = vehicle ? getVehicleStatus(state) : 'offline'`,
//  and owns the wake mutation (`useWakeVehicle`) internally — re-fetching state after a
//  wake lands. The input snapshot here carries that vehicle + derived status + the
//  wake-in-flight flag plus the parent query's loading / error / connectivity state
//  rather than issuing HTTP itself.
//
//  States: the web leaf always renders. On top of that, this surface honours the P4
//  leaf contract: a `phase` (loading / empty / error / data) fed by the query state, and
//  an orthogonal `connection` axis (live / stale / offline) surfaced as a freshness chip
//  with a one-shot auto-refresh on the stale transition (web `onRefetchState`). The view
//  binds through `VehicleHeaderModel`; no networking lives here.
//

import Foundation
import Observation
import OSLog

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound data — the orthogonal connectivity axis rendered as the
/// freshness chip. `live` hides the chip; `stale` / `offline` show it.
public enum VehicleHeaderConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (web props from the parent surface)

/// One coalesced snapshot of the header's inputs — the native mirror of the web props
/// (`vehicle`, `status`, `waking`) plus the parent surface's lifecycle (`isLoading`, an
/// error message, and connectivity). `status` defaults to `.offline`, matching the web
/// `vehicle ? deriveStatus(state) : 'offline'`.
public struct VehicleHeaderInput: Sendable, Equatable {
    public var vehicle: VehicleHeaderVehicle?
    public var status: VehicleHeaderStatus
    public var waking: Bool
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: VehicleHeaderConnection

    public init(
        vehicle: VehicleHeaderVehicle? = nil,
        status: VehicleHeaderStatus = .offline,
        waking: Bool = false,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: VehicleHeaderConnection = .live
    ) {
        self.vehicle = vehicle
        self.status = status
        self.waking = waking
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render + P4 leaf contract)

/// The resolved, view-ready state — the native mirror of the header's render plus the
/// P4 leaf contract. `phase` selects the body; for the data phase the status variant,
/// the title (`display_name || vin`), the composed "model + trim" subtitle, and the VIN
/// are pre-computed so the view is a pure function of this value.
public struct VehicleHeaderResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let vehicle: VehicleHeaderVehicle?
    public let status: VehicleHeaderStatus
    public let variant: VehicleHeaderBadgeVariant
    public let title: String
    public let modelLine: String
    public let vin: String
    public let waking: Bool

    public init(
        phase: Phase,
        vehicle: VehicleHeaderVehicle?,
        status: VehicleHeaderStatus,
        variant: VehicleHeaderBadgeVariant,
        title: String,
        modelLine: String,
        vin: String,
        waking: Bool
    ) {
        self.phase = phase
        self.vehicle = vehicle
        self.status = status
        self.variant = variant
        self.title = title
        self.modelLine = modelLine
        self.vin = vin
        self.waking = waking
    }
}

// MARK: - Projection (web render + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port
/// of the web component's derived values plus the P4 leaf contract. Unit tested across
/// loading / empty / error / data and the status / waking branches.
public enum VehicleHeaderProjection {
    public static func resolve(_ input: VehicleHeaderInput) -> VehicleHeaderResolved {
        // P4 contract: a parent query failure surfaces at the leaf as `error`.
        if let message = input.errorMessage, !message.isEmpty {
            return base(.error(message), input: input)
        }
        // Initial fetch (web parent `isLoading`).
        if input.isLoading {
            return base(.loading, input: input)
        }
        // Resolved with no vehicle → friendly empty state (never a blank box).
        guard input.vehicle != nil else {
            return base(.empty, input: input)
        }
        return base(.data, input: input)
    }

    private static func base(
        _ phase: VehicleHeaderResolved.Phase,
        input: VehicleHeaderInput
    ) -> VehicleHeaderResolved {
        VehicleHeaderResolved(
            phase: phase,
            vehicle: input.vehicle,
            status: input.status,
            variant: VehicleHeaderStatusMap.variant(input.status),
            title: VehicleHeaderFormat.title(input.vehicle),
            modelLine: VehicleHeaderFormat.modelLine(input.vehicle),
            vin: VehicleHeaderFormat.vin(input.vehicle),
            waking: input.waking
        )
    }
}

// MARK: - View-model (P1/S8 binding)

/// The header's observable view-model. Subscribes to a `VehicleHeaderSource`, recomputes
/// the resolved projection, exposes a render `phase` + the resolved view-state and the
/// `connection` axis, forwards the wake + back-navigation intents to their seams, and
/// auto-refreshes once when the feed transitions to stale.
@MainActor
@Observable
public final class VehicleHeaderModel {
    public private(set) var resolved: VehicleHeaderResolved =
        VehicleHeaderProjection.resolve(VehicleHeaderInput(isLoading: true))
    public private(set) var connection: VehicleHeaderConnection = .live

    public var phase: VehicleHeaderResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any VehicleHeaderSource
    @ObservationIgnored private let telemetry: any VehicleHeaderTelemetry
    @ObservationIgnored private let navigator: any VehicleHeaderNavigator
    @ObservationIgnored private let wakeCommand: any VehicleHeaderWakeCommand
    @ObservationIgnored private var started = false

    public init(
        source: any VehicleHeaderSource,
        telemetry: any VehicleHeaderTelemetry = OSLogVehicleHeaderTelemetry(),
        navigator: any VehicleHeaderNavigator = OSLogVehicleHeaderNavigator(),
        wakeCommand: any VehicleHeaderWakeCommand = OSLogVehicleHeaderWakeCommand()
    ) {
        self.source = source
        self.telemetry = telemetry
        self.navigator = navigator
        self.wakeCommand = wakeCommand
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: VehicleHeaderSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (freshness chip + error retry).
    public func refresh() {
        source.refresh()
    }

    /// Forwards the wake intent (web `onWake`). The resulting pending flag flows back as
    /// `waking` in the next snapshot.
    public func wake() {
        wakeCommand.wake()
    }

    /// Forwards the back-navigation intent (web `<Link to="/vehicles">`).
    public func goBack() {
        navigator.openVehicleList()
    }

    private func apply(_ input: VehicleHeaderInput) {
        resolved = VehicleHeaderProjection.resolve(input)
        let previous = connection
        connection = input.connection
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }
}
