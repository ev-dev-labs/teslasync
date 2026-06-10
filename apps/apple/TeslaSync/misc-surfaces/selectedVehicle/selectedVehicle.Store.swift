//
//  selectedVehicle.Store.swift
//  TeslaSync — P4 misc surface · 0003 · selectedVehicle (Apple)
//
//  The persistent selected-vehicle store — the native parity of the web
//  `SelectedVehicleProvider` + `useSelectedVehicleStore` in store/selectedVehicle.tsx. It
//  holds the focused vehicle id, hydrates it from durable storage on init (web `loadInitial`
//  via `useState` initializer), persists every change (web `persist`), stays in sync across
//  scenes / processes (web cross-tab `storage` event), and exposes a `.disconnected()`
//  no-op variant for the web `useSelectedVehicleStore` outside-provider fallback. Foundation
//  + Observation only — no SwiftUI, no `Shared` — so it binds into any surface and unit-tests
//  without a rendered view.
//

import Foundation
import Observation

/// The `@Observable` selected-vehicle store. Owns the persisted id, mirrors it into durable
/// storage, tracks whether the selection is durably persisted / in-session / untracked, and
/// republishes cross-scene mutations. The view-model owns one of these and renders `vehicleId`.
@MainActor
@Observable
public final class SelectedVehicleStore {
    /// The focused vehicle id (web `vehicleId: number | null`). `nil` when nothing is selected.
    public private(set) var vehicleId: Int?

    /// Where the current selection is stored (web localStorage reality).
    public private(set) var persistence: SelectedVehicleStorePersistence

    @ObservationIgnored private let storage: any SelectedVehicleStorage
    /// Whether a real store is connected. `false` is the web no-provider fallback: reads stay
    /// `nil` and `setVehicleId` is a no-op.
    @ObservationIgnored private let isConnected: Bool
    @ObservationIgnored private var observing = false

    /// Builds a store over the given persisted-id storage, hydrating the initial selection the
    /// way the web `loadInitial()` seeds `useState` (a finite, positive persisted id; `nil`
    /// otherwise).
    public init(storage: any SelectedVehicleStorage = UserDefaultsSelectedVehicleStorage()) {
        self.storage = storage
        isConnected = true
        vehicleId = storage.read()
        persistence = storage.isAvailable ? .persisted : .ephemeral
    }

    private init(disconnectedStorage: any SelectedVehicleStorage) {
        storage = disconnectedStorage
        isConnected = false
        vehicleId = nil
        persistence = .disconnected
    }

    /// The web `useSelectedVehicleStore()` no-provider fallback —
    /// `{ vehicleId: null, setVehicleId: () => {} }` — so a surface mounted before its store is
    /// installed degrades gracefully instead of crashing on a benign read.
    public static func disconnected() -> SelectedVehicleStore {
        SelectedVehicleStore(disconnectedStorage: UnavailableSelectedVehicleStorage())
    }

    /// Updates + persists the selection (web `setVehicleId`). A `nil` clears it (web
    /// `removeItem`). On a disconnected store this is a no-op (web fallback). When durable
    /// storage is unavailable the value still updates in-session and `persistence` drops to
    /// `.ephemeral` (web private-browsing / quota parity).
    public func setVehicleId(_ id: Int?) {
        guard isConnected else { return }
        vehicleId = id
        let durable = storage.write(id)
        persistence = durable ? .persisted : .ephemeral
    }

    /// Begins mirroring cross-scene / cross-process mutations of the same key (web cross-tab
    /// `storage` listener). Idempotent.
    public func startObservingExternalChanges() {
        guard isConnected, !observing else { return }
        observing = true
        storage.beginObserving { [weak self] in self?.reloadFromStorage() }
    }

    /// Stops mirroring cross-scene mutations.
    public func stopObservingExternalChanges() {
        observing = false
        storage.endObserving()
    }

    /// Re-reads durable storage and adopts the new value when it differs (web cross-tab
    /// `storage` event handler: a new value hydrates, a cleared value resets to `nil`).
    private func reloadFromStorage() {
        guard isConnected else { return }
        let latest = storage.read()
        guard latest != vehicleId else { return }
        vehicleId = latest
    }
}
