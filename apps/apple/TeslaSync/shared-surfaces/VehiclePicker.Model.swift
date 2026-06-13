//
//  VehiclePicker.Model.swift
//  TeslaSync — P4 shared surface · 0183 · VehiclePicker (Apple)
//
//  The i18n facade (P1/S10) and the observable state-holder (P1/S8) for the persistent app-wide vehicle
//  selector. The web `<VehiclePicker>` composes three hooks: `useTranslation` (the `vehiclePicker.aria` key),
//  `useSelectedVehicle()` (the `vehicles` list + the current `vehicleId` + `setVehicleId`), and
//  `usePinned('vehicle')` (the pins that float to the top). The native peer keeps that contract — the host's
//  composed value arrives through ``VehiclePickerSource`` snapshots, and a picked row routes back out through
//  the host-supplied `onSelect` closure (the native peer of `setVehicleId`) — while the holder derives the
//  view-ready projection, drives the P4 leaf phases (loading / content / empty / error) + the freshness axis
//  (stale auto-refresh once / offline keeps the cached value), and emits `view.opened` exactly once.
//

import Foundation
import Observation

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// prose. The web source's one key is mirrored verbatim (`vehiclePicker.aria` → "Select vehicle"); the
/// `vehiclePicker.fallback` key holds the "Vehicle" word the web hardcodes in `\`Vehicle ${id}\``, and the
/// rest are the native chrome / a11y keys the P4 leaf states + freshness axis + pin/selection markers need.
/// Keys live in the "VehiclePicker" table, folded into the app `Localizable.xcstrings` at integration time;
/// in test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping the labels
/// deterministic.
public enum VehiclePickerStrings {
    public static let table = "VehiclePicker"

    public static let string: VehiclePickerResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    // MARK: Web source key (verbatim)

    /// The picker's accessible name (web `t('vehiclePicker.aria', 'Select vehicle')`).
    public static var aria: String {
        string("vehiclePicker.aria", "Select vehicle")
    }

    /// The `Vehicle {id}` fallback name (web hardcodes `\`Vehicle ${v.id}\``), interpolated per id and routed
    /// through the facade so native code holds no English literal.
    public static func fallbackName(_ id: Int) -> String {
        "\(string("vehiclePicker.fallback", "Vehicle")) \(id)"
    }

    // MARK: Native chrome / a11y additions (no blank box — see the leaf states)

    /// The collapsed-selector placeholder shown when nothing is selected (web empty `<Select value="">`).
    public static var placeholder: String {
        string("vehiclePicker.placeholder", "Select vehicle")
    }

    public static var loadingA11y: String {
        string("vehiclePicker.loadingA11y", "Loading vehicles")
    }

    public static var emptyTitle: String {
        string("vehiclePicker.empty", "No vehicles")
    }

    public static var errorTitle: String {
        string("vehiclePicker.errorTitle", "Couldn't load vehicles")
    }

    public static var retry: String {
        string("vehiclePicker.retry", "Retry")
    }

    /// VoiceOver hint announced on a pinned row — the native peer of the web `📌` label prefix.
    public static var pinnedA11y: String {
        string("vehiclePicker.pinnedA11y", "Pinned")
    }

    /// VoiceOver hint announced on the currently-selected row.
    public static var selectedA11y: String {
        string("vehiclePicker.selectedA11y", "Selected")
    }

    public static var live: String {
        string("vehiclePicker.live", "Live")
    }

    public static var stale: String {
        string("vehiclePicker.stale", "Stale")
    }

    public static var offline: String {
        string("vehiclePicker.offline", "Offline")
    }

    public static var staleA11y: String {
        string("vehiclePicker.staleA11y", "Stale — tap to refresh")
    }

    public static var offlineA11y: String {
        string("vehiclePicker.offlineA11y", "Offline — showing the last value")
    }
}

// MARK: - VehiclePickerModel (P1/S8) — fleet/pins/selection state + derivation

/// The surface's observable state-holder. Owns the bound fleet (web `vehicles`), the user's pins (web
/// `usePinned`), the current selection (web `vehicleId`), the P4 phase + connectivity; derives the view-ready
/// ``VehiclePickerProjection``; routes a picked row through the host's `onSelect` (the web `onChange` →
/// `setVehicleId`); auto-refreshes once on a stale transition; and emits `view.opened` exactly once.
@MainActor
@Observable
public final class VehiclePickerModel {
    public private(set) var vehicles: [VehiclePickerVehicle] = []
    public private(set) var pins: [VehiclePickerPin] = []
    public private(set) var selectedId: Int?
    public private(set) var phase: VehiclePickerPhase = .loading
    public private(set) var connection: VehiclePickerConnection = .live

    @ObservationIgnored private let source: any VehiclePickerSource
    @ObservationIgnored private let onSelect: @MainActor (Int) -> Void
    @ObservationIgnored private let telemetry: any VehiclePickerTelemetry
    @ObservationIgnored let localize: VehiclePickerResolve
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var didAutoRefresh = false

    public init(
        source: any VehiclePickerSource,
        onSelect: @escaping @MainActor (Int) -> Void = { _ in },
        telemetry: any VehiclePickerTelemetry = OSLogVehiclePickerTelemetry(),
        localize: @escaping VehiclePickerResolve = VehiclePickerStrings.string
    ) {
        self.source = source
        self.onSelect = onSelect
        self.telemetry = telemetry
        self.localize = localize
        source.onUpdate = { [weak self] snapshot in self?.ingest(snapshot) }
    }

    // MARK: Derived reads

    /// The resolved, view-ready projection — a pure function of the current fleet + pins + selection (web
    /// render output). The localized `Vehicle {id}` fallback + collapsed placeholder are supplied to the pure
    /// projector.
    public var projection: VehiclePickerProjection {
        VehiclePickerProjector.projection(
            vehicles: vehicles,
            pins: pins,
            selectedId: selectedId,
            copy: copy
        )
    }

    /// The localized copy the projection consumes, resolved through the bound P1/S10 facade (web `t()`).
    private var copy: VehiclePickerCopy {
        VehiclePickerCopy(
            fallbackName: { [localize] id in "\(localize("vehiclePicker.fallback", "Vehicle")) \(id)" },
            placeholder: localize("vehiclePicker.placeholder", "Select vehicle")
        )
    }

    // MARK: Lifecycle

    /// Begins the surface, emits `view.opened` once, and starts the source. Idempotent across appear churn.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: VehiclePickerSurface.slug)
        }
        source.start()
    }

    /// Marks the surface inactive. The once-only `view.opened` contract is preserved.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the host's current fleet / pins (web refetch) — the error-state retry + the freshness
    /// chip's refresh.
    public func refresh() {
        source.refresh()
    }

    // MARK: Source ingestion

    /// Folds a pushed snapshot into the fleet + pins + selection + phase + connectivity, and auto-refreshes
    /// once on a stale read (reset when the source returns to live so a later stale episode re-triggers once).
    private func ingest(_ snapshot: VehiclePickerSnapshot) {
        vehicles = snapshot.vehicles
        pins = snapshot.pins
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

    // MARK: Interactions (web `onChange` → `setVehicleId`)

    /// Commit a picked row — the web `onChange` body: notify the host with the chosen id (the native
    /// `setVehicleId`). The picker only offers concrete fleet rows, so the id is always a finite, positive
    /// vehicle id.
    public func select(id: Int) {
        onSelect(id)
    }
}
