//
//  VehicleHeroCard.Model.swift
//  TeslaSync — P4 shared surface · 0233 · VehicleHeroCard (Apple)
//
//  The observable state-holder (P1/S8) for the vehicle hero card. The web `<VehicleHeroCard>` is a
//  presentational component fed `vehicle` + `vehicleState` + `photoUrl` props and two hooks (`useTranslation`,
//  `useUnits`); the native peer keeps that contract — the host's composed value arrives through
//  ``VehicleHeroCardSource`` snapshots — while the holder derives the view-ready ``VehicleHeroCardProjection``,
//  drives the P4 leaf phases (loading / content / empty / error) + the freshness axis (stale auto-refresh
//  once / offline keeps the cached values), routes the three navigation actions back out through the
//  host-supplied `onNavigate` closure (the web `<Link to=…>`), and emits `view.opened` exactly once.
//

import Foundation
import Observation

// MARK: - VehicleHeroCardRoute (web `<Link to=…>` destinations)

/// The three navigation destinations the action bar routes to — the native peers of the web
/// `/vehicles/:id`, `/vehicles/:id/commands`, `/vehicles/:id/map` links. The host maps these onto its
/// navigation stack; the view never builds a URL.
public enum VehicleHeroCardRoute: Sendable, Equatable {
    case details(vehicleID: Int)
    case commands(vehicleID: Int)
    case liveMap(vehicleID: Int)
}

// MARK: - VehicleHeroCardModel (P1/S8) — state + derivation

/// The surface's observable state-holder. Owns the bound vehicle (web `vehicle`), the live state (web
/// `vehicleState`), the photo URL (web `photoUrl`), the active unit labels (web `useUnits`), the P4 phase +
/// connectivity; derives the view-ready ``VehicleHeroCardProjection``; routes the action bar through the
/// host's `onNavigate`; auto-refreshes once on a stale transition; and emits `view.opened` exactly once.
@MainActor
@Observable
public final class VehicleHeroCardModel {
    public private(set) var vehicle: VehicleHeroCardVehicle?
    public private(set) var liveState: VehicleHeroCardLiveState?
    public private(set) var photoURL: URL?
    public private(set) var unitPrefs: VehicleHeroCardUnitPrefs = .imperial
    public private(set) var phase: VehicleHeroCardPhase = .loading
    public private(set) var connection: VehicleHeroCardConnection = .live

    @ObservationIgnored private let source: any VehicleHeroCardSource
    @ObservationIgnored private let onNavigate: @MainActor (VehicleHeroCardRoute) -> Void
    @ObservationIgnored private let telemetry: any VehicleHeroCardTelemetry
    @ObservationIgnored let localize: VehicleHeroCardResolve
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var didAutoRefresh = false

    public init(
        source: any VehicleHeroCardSource,
        onNavigate: @escaping @MainActor (VehicleHeroCardRoute) -> Void = { _ in },
        telemetry: any VehicleHeroCardTelemetry = OSLogVehicleHeroCardTelemetry(),
        localize: @escaping VehicleHeroCardResolve = VehicleHeroCardStrings.string
    ) {
        self.source = source
        self.onNavigate = onNavigate
        self.telemetry = telemetry
        self.localize = localize
        source.onUpdate = { [weak self] snapshot in self?.ingest(snapshot) }
    }

    // MARK: Derived reads

    /// The resolved, view-ready projection — a pure function of the current vehicle + live state + units (web
    /// render output). `nil` until a vehicle resolves (the loading / empty leaf states render instead).
    public var projection: VehicleHeroCardProjection? {
        guard let vehicle else { return nil }
        return VehicleHeroCardProjector.projection(
            vehicle: vehicle,
            liveState: liveState,
            prefs: unitPrefs,
            hasPhoto: photoURL != nil,
            copy: VehicleHeroCardStrings.makeCopy(localize)
        )
    }

    // MARK: Lifecycle

    /// Begins the surface, emits `view.opened` once, and starts the source. Idempotent across appear churn.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: VehicleHeroCardSurface.slug)
        }
        source.start()
    }

    /// Marks the surface inactive. The once-only `view.opened` contract is preserved.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the host's current vehicle / state (web refetch) — the error-state retry + the freshness
    /// chip's refresh.
    public func refresh() {
        source.refresh()
    }

    // MARK: Interactions (web `<Link>`)

    /// Routes an action-bar tap to the host (the web `<Link to=…>` navigation).
    public func navigate(_ route: VehicleHeroCardRoute) {
        onNavigate(route)
    }

    // MARK: Source ingestion

    /// Folds a pushed snapshot into the vehicle + state + photo + units + phase + connectivity, and
    /// auto-refreshes once on a stale read (reset when the source returns to live so a later stale episode
    /// re-triggers once).
    private func ingest(_ snapshot: VehicleHeroCardSnapshot) {
        vehicle = snapshot.vehicle
        liveState = snapshot.liveState
        photoURL = snapshot.photoURL
        unitPrefs = snapshot.unitPrefs
        connection = snapshot.connection
        if snapshot.isLoading {
            phase = .loading
        } else if let message = snapshot.errorMessage {
            phase = .error(message)
        } else {
            phase = snapshot.vehicle == nil ? .empty : .content
        }
        switch snapshot.connection {
        case .stale:
            guard !didAutoRefresh else { return }
            didAutoRefresh = true
            source.refresh()
        case .live:
            didAutoRefresh = false
        case .offline:
            break
        }
    }
}
