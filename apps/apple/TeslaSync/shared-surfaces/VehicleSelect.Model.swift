//
//  VehicleSelect.Model.swift
//  TeslaSync — P4 shared surface · 0164 · VehicleSelect (Apple)
//
//  The i18n facade (P1/S10), and the observable state-holder (P1/S8) for the canonical per-page vehicle
//  scope picker. The web `<VehicleSelect>` composes two hooks: `useTranslation` (the single `t()` key
//  `vehicleSelect.aria`) and `useSelectedVehicle()` (the `vehicles` list + the current `vehicleId` +
//  `setVehicleId`). The native peer keeps that contract — the host's current fleet + selection arrive
//  through ``VehicleSelectSource`` snapshots, and a chosen option routes back out through the host-supplied
//  `onSelect` closure (the native peer of `setVehicleId`) — while the holder derives the view-ready
//  projection, drives the P4 leaf phases (loading / content / empty / error) + the freshness axis (stale
//  auto-refresh once / offline keeps the cached fleet), and emits `view.opened` exactly once.
//

import Foundation
import Observation

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// prose. The only key the web source uses is `vehicleSelect.aria`; the rest are the native chrome / a11y
/// keys the P4 leaf states + freshness axis need. Keys live in the "VehicleSelect" table, folded into the
/// app `Localizable.xcstrings` at integration time; in test / preview bundles `NSLocalizedString` returns
/// the `value:` fallback, keeping the labels deterministic.
public enum VehicleSelectStrings {
    public static let table = "VehicleSelect"

    public static let string: VehicleSelectResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// THE web key — the accessible name of the control (web `t('vehicleSelect.aria', 'Select vehicle')`).
    public static var aria: String {
        string("vehicleSelect.aria", "Select vehicle")
    }

    /// The label fallback for a vehicle with no name / VIN (web `Vehicle ${v.id}`), interpolated per id.
    public static func fallbackName(_ id: Int) -> String {
        string("vehicleSelect.fallbackName", "Vehicle {{id}}")
            .replacingOccurrences(of: "{{id}}", with: String(id))
    }

    public static var loadingA11y: String {
        string("vehicleSelect.loadingA11y", "Loading vehicles")
    }

    public static var emptyTitle: String {
        string("vehicleSelect.empty", "No vehicles")
    }

    public static var emptyMessage: String {
        string("vehicleSelect.emptyMessage", "Add a vehicle to your fleet to choose one.")
    }

    public static var errorTitle: String {
        string("vehicleSelect.errorTitle", "Couldn't load vehicles")
    }

    public static var retry: String {
        string("vehicleSelect.retry", "Retry")
    }

    public static var live: String {
        string("vehicleSelect.live", "Live")
    }

    public static var stale: String {
        string("vehicleSelect.stale", "Stale")
    }

    public static var offline: String {
        string("vehicleSelect.offline", "Offline")
    }

    public static var staleA11y: String {
        string("vehicleSelect.staleA11y", "Stale — tap to refresh")
    }

    public static var offlineA11y: String {
        string("vehicleSelect.offlineA11y", "Offline — showing the last fleet")
    }
}

// MARK: - VehicleSelectModel (P1/S8) — fleet/selection state + derivation

/// The surface's observable state-holder. Owns the bound fleet (web `vehicles`), the current selection (web
/// `vehicleId`), the P4 phase + connectivity; derives the view-ready ``VehicleSelectProjection``; routes a
/// chosen option through the host's `onSelect` (the web `onChange` → `setVehicleId`); auto-refreshes once on
/// a stale transition; and emits `view.opened` exactly once.
@MainActor
@Observable
public final class VehicleSelectModel {
    public private(set) var vehicles: [VehicleSelectVehicle] = []
    public private(set) var selectedId: Int?
    public private(set) var phase: VehicleSelectPhase = .loading
    public private(set) var connection: VehicleSelectConnection = .live

    @ObservationIgnored private let source: any VehicleSelectSource
    @ObservationIgnored private let onSelect: @MainActor (Int?) -> Void
    @ObservationIgnored private let telemetry: any VehicleSelectTelemetry
    @ObservationIgnored let localize: VehicleSelectResolve
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var didAutoRefresh = false

    public init(
        source: any VehicleSelectSource,
        onSelect: @escaping @MainActor (Int?) -> Void = { _ in },
        telemetry: any VehicleSelectTelemetry = OSLogVehicleSelectTelemetry(),
        localize: @escaping VehicleSelectResolve = VehicleSelectStrings.string
    ) {
        self.source = source
        self.onSelect = onSelect
        self.telemetry = telemetry
        self.localize = localize
        source.onUpdate = { [weak self] snapshot in self?.ingest(snapshot) }
    }

    // MARK: Derived reads

    /// The resolved, view-ready picker — a pure function of the current fleet + selection (web render
    /// output). The localized `Vehicle {id}` fallback is supplied to the pure projector.
    public var projection: VehicleSelectProjection {
        VehicleSelectProjector.projection(
            vehicles: vehicles,
            selectedId: selectedId,
            fallbackName: { [localize] id in
                localize("vehicleSelect.fallbackName", "Vehicle {{id}}")
                    .replacingOccurrences(of: "{{id}}", with: String(id))
            }
        )
    }

    /// The default accessible name (web `t('vehicleSelect.aria', 'Select vehicle')`), used when the host
    /// supplies no override.
    public var ariaLabel: String {
        localize("vehicleSelect.aria", "Select vehicle")
    }

    /// The display name of the currently selected vehicle — the accessibility value of the control. `nil`
    /// when nothing is selected (or the selection is no longer in the fleet).
    public var selectedVehicleName: String? {
        guard let selectedId else { return nil }
        return projection.options.first { $0.id == selectedId }?.label
    }

    // MARK: Lifecycle

    /// Begins the surface, emits `view.opened` once, and starts the source. Idempotent across appear churn.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: VehicleSelectSurface.slug)
        }
        source.start()
    }

    /// Marks the surface inactive. The once-only `view.opened` contract is preserved.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the host's current fleet (web refetch) — the error-state retry + the freshness chip's
    /// refresh.
    public func refresh() {
        source.refresh()
    }

    // MARK: Source ingestion

    /// Folds a pushed snapshot into the fleet + selection + phase + connectivity, and auto-refreshes once on
    /// a stale read (reset when the source returns to live so a later stale episode re-triggers once).
    private func ingest(_ snapshot: VehicleSelectSnapshot) {
        vehicles = snapshot.vehicles
        selectedId = snapshot.selectedId
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

    // MARK: Interactions (web `onChange`)

    /// Commit a chosen control value — the web `onChange` body: parse the value and notify the host with the
    /// new id (or `nil` to clear). Routes through `onSelect` (the native `setVehicleId`).
    public func select(value: String) {
        onSelect(VehicleSelectProjector.parseSelection(value))
    }

    /// Commit a specific id directly (convenience for non-string callers, e.g. programmatic selection).
    public func select(id: Int?) {
        onSelect(id)
    }
}
