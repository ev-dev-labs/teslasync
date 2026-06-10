//
//  selectedVehicle.Model.swift
//  TeslaSync — P4 misc surface · 0003 · selectedVehicle (Apple)
//
//  The state holder (P1/S8) the view binds through — the native parity of the composed web
//  `useSelectedVehicle()` reading the `useSelectedVehicleStore` context + `useVehicles()`. It
//  owns a `SelectedVehicleStore`, subscribes to a fleet source for the vehicles list + URL
//  selection, resolves the render projection (URL > store > first vehicle), reproduces the
//  hook's write-back effects (adopt a URL id, default to the first vehicle on load), exposes
//  the resolved copy, drives the store's write operations, runs the stale auto-refresh, and
//  emits the P1/S11 `view.opened` event once. No networking lives in the view.
//

import Foundation
import Observation

/// The surface's observable view-model. Composes the persisted `SelectedVehicleStore` with a
/// fleet source, resolves the selection projection, exposes the resolved copy + actions, and
/// emits the P1/S11 `view.opened` event once.
@MainActor
@Observable
public final class SelectedVehicleStoreModel {
    // Bound inputs (drive the computed projection)
    public private(set) var fleet: SelectedVehicleStoreFleetState = .loading
    public private(set) var urlVehicleId: Int?
    public private(set) var connection: SelectedVehicleStoreConnection = .live
    public private(set) var updatedAt: Date?

    /// The persisted selection store (web `useSelectedVehicleStore`).
    public let store: SelectedVehicleStore

    @ObservationIgnored private let source: any SelectedVehicleStoreFleetSource
    @ObservationIgnored private let telemetry: any SelectedVehicleStoreTelemetry
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        store: SelectedVehicleStore = SelectedVehicleStore(),
        source: any SelectedVehicleStoreFleetSource,
        telemetry: any SelectedVehicleStoreTelemetry = OSLogSelectedVehicleStoreTelemetry(),
        localize: @escaping (String, String) -> String = SelectedVehicleStoreStrings.string
    ) {
        self.store = store
        self.source = source
        self.telemetry = telemetry
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Resolved projection (web `useSelectedVehicle()` value)

    /// The render-ready projection, recomputed from the store selection + the bound fleet /
    /// URL. Pure: reading it never mutates the store (the write-back effects run in `apply`).
    public var projection: SelectedVehicleStoreProjection {
        SelectedVehicleStoreResolver.build(
            storedId: store.vehicleId,
            urlId: urlVehicleId,
            fleet: fleet
        )
    }

    public var phase: SelectedVehicleStorePhase {
        projection.phase
    }

    public var selected: SelectedVehicleStoreSummary? {
        projection.selected
    }

    public var candidate: SelectedVehicleStoreSummary? {
        projection.candidate
    }

    public var effectiveId: Int? {
        projection.effectiveId
    }

    public var persistence: SelectedVehicleStorePersistence {
        store.persistence
    }

    public var errorMessage: String? {
        projection.errorMessage
    }

    // MARK: Resolved copy (web `t(key, default)`)

    public var pageTitle: String {
        localize("selectedVehicle.title", "Selected vehicle")
    }

    public var contentTitle: String {
        localize("selectedVehicle.content.title", "Selected vehicle")
    }

    public var idLabel: String {
        localize("selectedVehicle.content.id", "Vehicle ID")
    }

    public var clearLabel: String {
        localize("selectedVehicle.content.clear", "Clear selection")
    }

    public var emptyTitle: String {
        localize("selectedVehicle.empty.title", "No vehicle selected")
    }

    public var loadingLabel: String {
        localize("selectedVehicle.loading", "Loading your vehicles…")
    }

    public var retryLabel: String {
        localize("selectedVehicle.retry", "Try again")
    }

    public var emptyDescription: String {
        localize("selectedVehicle.empty.desc", "Add a vehicle to your fleet to choose one.")
    }

    public var errorTitle: String {
        localize("selectedVehicle.error.title", "Couldn't load your vehicles")
    }

    public var errorBody: String {
        if let errorMessage, !errorMessage.isEmpty { return errorMessage }
        return localize("selectedVehicle.error.body", "We couldn't load your vehicles. Try again.")
    }

    public var contentBody: String {
        SelectedVehicleStoreCopy.selectionBody(name: selected?.displayName ?? "", localize: localize)
    }

    public var selectCandidateLabel: String {
        SelectedVehicleStoreCopy.selectCandidateLabel(name: candidate?.displayName ?? "", localize: localize)
    }

    public var persistenceNote: String {
        SelectedVehicleStoreCopy.persistenceNote(persistence, localize: localize)
    }

    public var accessibilitySummary: String {
        SelectedVehicleStoreAccessibility.summary(for: projection, localize: localize)
    }

    // MARK: Lifecycle

    /// Begins observing the store + fleet source and emits the `view.opened` diagnostics event.
    /// Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SelectedVehicleStoreSurface.slug)
        store.startObservingExternalChanges()
        source.start()
    }

    /// Stops observing the store + fleet source.
    public func stop() {
        started = false
        store.stopObservingExternalChanges()
        source.stop()
    }

    /// Re-reads the fleet (web refetch) — the error-state retry + the stale auto-refresh.
    public func refresh() {
        source.refresh()
    }

    // MARK: Selection actions (web `setVehicleId`)

    /// Selects a specific vehicle (web `setVehicleId(id)`).
    public func select(_ id: Int) {
        store.setVehicleId(id)
    }

    /// Selects the default candidate — the first vehicle in the fleet (web empty-state action).
    public func selectCandidate() {
        guard let id = candidate?.id else { return }
        store.setVehicleId(id)
    }

    /// Clears the selection (web `setVehicleId(null)`). The selection stays cleared until the
    /// next fleet update re-applies the first-vehicle default, so the action is never a silent
    /// no-op for the user.
    public func clearSelection() {
        store.setVehicleId(nil)
    }

    // MARK: Snapshot application

    private func apply(_ update: SelectedVehicleStoreUpdate) {
        fleet = update.fleet
        urlVehicleId = update.urlVehicleId
        connection = update.connection
        updatedAt = update.updatedAt
        syncStoreFromResolution()
        handleAutoRefresh(for: update.connection)
    }

    /// Reproduces the web `useSelectedVehicle()` write-back effects: adopt a URL id that
    /// differs from the store so sidebar navigation stays scoped, then default to the first
    /// vehicle when the store is empty and the fleet has loaded.
    private func syncStoreFromResolution() {
        if let adopt = SelectedVehicleStoreResolver.urlAdoption(urlId: urlVehicleId, storedId: store.vehicleId) {
            store.setVehicleId(adopt)
        }
        guard case let .loaded(vehicles) = fleet else { return }
        let fallback = SelectedVehicleStoreResolver.firstVehicleDefault(
            storedId: store.vehicleId,
            firstVehicleId: vehicles.first?.id
        )
        if let fallback {
            store.setVehicleId(fallback)
        }
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live
    /// so a later stale episode re-triggers exactly once. Offline keeps the cached selection on
    /// screen and does not refetch.
    private func handleAutoRefresh(for connection: SelectedVehicleStoreConnection) {
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
