//
//  ActiveVehicleSegment.Model.swift
//  TeslaSync — P4 shared surface · 0176 · ActiveVehicleSegment (Apple)
//
//  The i18n facade (P1/S10) and the observable state-holder (P1/S8) for the footer active-vehicle segment.
//  The web `<ActiveVehicleSegment>` composes four hooks: `useTranslation` (the `statusBar.vehicle.*` keys),
//  `useSelectedVehicle()` (the `vehicles` list + the current `vehicleId` + `setVehicleId`),
//  `useVehicleState(vehicleId)` (the selected vehicle's `battery_level` + `rated_range`), and `useUnits()`
//  (the distance unit symbol). The native peer keeps that contract — the host's composed value arrives
//  through ``ActiveVehicleSegmentSource`` snapshots, and a picked row routes back out through the
//  host-supplied `onSelect` closure (the native peer of `setVehicleId`) — while the holder derives the
//  view-ready projection, drives the P4 leaf phases (loading / content / empty / error) + the freshness axis
//  (stale auto-refresh once / offline keeps the cached value), and emits `view.opened` exactly once.
//

import Foundation
import Observation

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// prose. The web source's keys are mirrored verbatim (`statusBar.vehicle.fallback` / `.none` / `.tooltip` /
/// `.aria` / `.switch`); the rest are the native chrome / a11y keys the P4 leaf states + freshness axis need.
/// Keys live in the "ActiveVehicleSegment" table, folded into the app `Localizable.xcstrings` at integration
/// time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping the labels
/// deterministic.
public enum ActiveVehicleSegmentStrings {
    public static let table = "ActiveVehicleSegment"

    public static let string: ActiveVehicleSegmentResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    // MARK: Web source keys (verbatim)

    /// The label fallback for a vehicle with no name / VIN (web `${t('statusBar.vehicle.fallback',
    /// 'Vehicle')} ${id}`), interpolated per id.
    public static func fallbackName(_ id: Int) -> String {
        "\(string("statusBar.vehicle.fallback", "Vehicle")) \(id)"
    }

    /// The "no vehicle" label (web `t('statusBar.vehicle.none', 'No vehicle')`).
    public static var none: String {
        string("statusBar.vehicle.none", "No vehicle")
    }

    /// The tooltip prefix (web `t('statusBar.vehicle.tooltip', 'Active vehicle')`).
    public static var tooltipPrefix: String {
        string("statusBar.vehicle.tooltip", "Active vehicle")
    }

    /// The listbox / menu accessible name (web `t('statusBar.vehicle.aria', 'Active vehicle')`).
    public static var menuLabel: String {
        string("statusBar.vehicle.aria", "Active vehicle")
    }

    /// The static-chip accessible name (web `${t('statusBar.vehicle.aria', 'Active vehicle')}: ${label}`).
    public static func activeVehicleAria(label: String) -> String {
        "\(string("statusBar.vehicle.aria", "Active vehicle")): \(label)"
    }

    /// The switcher-button accessible name (web `${t('statusBar.vehicle.switch', 'Switch vehicle')}
    /// (${label})`).
    public static func switchVehicleAria(label: String) -> String {
        "\(string("statusBar.vehicle.switch", "Switch vehicle")) (\(label))"
    }

    // MARK: Native chrome / a11y additions (no blank box — see the leaf states)

    public static var loadingA11y: String {
        string("activeVehicleSegment.loadingA11y", "Loading vehicles")
    }

    public static var errorTitle: String {
        string("activeVehicleSegment.errorTitle", "Couldn't load vehicles")
    }

    public static var retry: String {
        string("activeVehicleSegment.retry", "Retry")
    }

    public static var live: String {
        string("activeVehicleSegment.live", "Live")
    }

    public static var stale: String {
        string("activeVehicleSegment.stale", "Stale")
    }

    public static var offline: String {
        string("activeVehicleSegment.offline", "Offline")
    }

    public static var staleA11y: String {
        string("activeVehicleSegment.staleA11y", "Stale — tap to refresh")
    }

    public static var offlineA11y: String {
        string("activeVehicleSegment.offlineA11y", "Offline — showing the last value")
    }

    /// VoiceOver hint announced on the currently-selected switcher row (the web trailing check mark).
    public static var selectedA11y: String {
        string("activeVehicleSegment.selectedA11y", "Selected")
    }
}

// MARK: - ActiveVehicleSegmentModel (P1/S8) — fleet/selection/metrics state + derivation

/// The surface's observable state-holder. Owns the bound fleet (web `vehicles`), the current selection (web
/// `vehicleId`), the selected vehicle's live-state metrics (web `useVehicleState`), the active distance unit
/// (web `useUnits`), the P4 phase + connectivity; derives the view-ready ``ActiveVehicleSegmentProjection``;
/// routes a picked row through the host's `onSelect` (the web `pick` → `setVehicleId`); auto-refreshes once
/// on a stale transition; and emits `view.opened` exactly once.
@MainActor
@Observable
public final class ActiveVehicleSegmentModel {
    public private(set) var vehicles: [ActiveVehicleSegmentVehicle] = []
    public private(set) var selectedId: Int?
    public private(set) var metrics: ActiveVehicleSegmentMetrics = .absent
    public private(set) var distanceUnit = "mi"
    public private(set) var phase: ActiveVehicleSegmentPhase = .loading
    public private(set) var connection: ActiveVehicleSegmentConnection = .live

    @ObservationIgnored private let source: any ActiveVehicleSegmentSource
    @ObservationIgnored private let onSelect: @MainActor (Int) -> Void
    @ObservationIgnored private let telemetry: any ActiveVehicleSegmentTelemetry
    @ObservationIgnored let localize: ActiveVehicleSegmentResolve
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var didAutoRefresh = false

    public init(
        source: any ActiveVehicleSegmentSource,
        onSelect: @escaping @MainActor (Int) -> Void = { _ in },
        telemetry: any ActiveVehicleSegmentTelemetry = OSLogActiveVehicleSegmentTelemetry(),
        localize: @escaping ActiveVehicleSegmentResolve = ActiveVehicleSegmentStrings.string
    ) {
        self.source = source
        self.onSelect = onSelect
        self.telemetry = telemetry
        self.localize = localize
        source.onUpdate = { [weak self] snapshot in self?.ingest(snapshot) }
    }

    // MARK: Derived reads

    /// The resolved, view-ready projection — a pure function of the current fleet + selection + metrics (web
    /// render output). The localized `Vehicle {id}` fallback + `No vehicle` + tooltip prefix are supplied to
    /// the pure projector.
    public var projection: ActiveVehicleSegmentProjection {
        ActiveVehicleSegmentProjector.projection(
            vehicles: vehicles,
            selectedId: selectedId,
            metrics: metrics,
            distanceUnit: distanceUnit,
            copy: copy
        )
    }

    /// The localized copy the projection consumes, resolved through the bound P1/S10 facade (web `t()`).
    private var copy: ActiveVehicleSegmentCopy {
        ActiveVehicleSegmentCopy(
            fallbackName: { [localize] id in "\(localize("statusBar.vehicle.fallback", "Vehicle")) \(id)" },
            noneLabel: { [localize] in localize("statusBar.vehicle.none", "No vehicle") },
            activeVehicleText: localize("statusBar.vehicle.tooltip", "Active vehicle")
        )
    }

    // MARK: Lifecycle

    /// Begins the surface, emits `view.opened` once, and starts the source. Idempotent across appear churn.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: ActiveVehicleSegmentSurface.slug)
        }
        source.start()
    }

    /// Marks the surface inactive. The once-only `view.opened` contract is preserved.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the host's current fleet / metrics (web refetch) — the error-state retry + the freshness
    /// chip's refresh.
    public func refresh() {
        source.refresh()
    }

    // MARK: Source ingestion

    /// Folds a pushed snapshot into the fleet + selection + metrics + unit + phase + connectivity, and
    /// auto-refreshes once on a stale read (reset when the source returns to live so a later stale episode
    /// re-triggers once).
    private func ingest(_ snapshot: ActiveVehicleSegmentSnapshot) {
        vehicles = snapshot.vehicles
        selectedId = snapshot.selectedId
        metrics = snapshot.metrics
        distanceUnit = snapshot.distanceUnit
        connection = snapshot.connection
        if snapshot.isLoading {
            phase = .loading
        } else if let message = snapshot.errorMessage {
            phase = .error(message)
        } else {
            phase = snapshot.vehicles.isEmpty ? .empty : .content
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

    // MARK: Interactions (web `pick`)

    /// Commit a picked switcher row — the web `pick(id)` body: notify the host with the chosen id (the
    /// native `setVehicleId`). The popover only offers concrete fleet rows, so the id is always present.
    public func select(id: Int) {
        onSelect(id)
    }
}
