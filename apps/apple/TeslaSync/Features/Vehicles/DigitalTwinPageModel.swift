//
//  DigitalTwinPageModel.swift
//  TeslaSync — P4-APPLE P7 · page:vehicles/DigitalTwin (Apple) — View model
//
//  The `@MainActor @Observable` state holder for `DigitalTwinPage`. It consumes the
//  `DigitalTwinDataSource` seam (the KMP-core binding point, ADR-004), keeping each web hook name at
//  the call site, and projects the four feeds into the loading / empty / error / ready states the web
//  page renders. The three per-vehicle feeds (`useVehicleState`, `useSecurityLatest`,
//  `useChargingTelemetryLatest`) are merged into one `VehicleTwinState` through the module's
//  `TwinStateBuilder.buildTwinState` (the reused port of `lib/vehicleState.ts`); the badge status is
//  derived exactly as the web `badgeStatus` memo. The per-vehicle paint override store (web
//  `useVehiclePaint`) is held here and re-seeded on selection change. No view logic lives here.
//

import Observation
import SwiftUI

// MARK: - Page data state (web `vehiclesLoading` / `noVehicles` / body)

/// The four data states the page renders. `loading` is the initial `useVehicles` fetch (web
/// `vehiclesLoading`); `empty` is "no vehicles" (web `!vehicle && !vehiclesLoading`); `error` is a
/// failed fetch + Retry; `ready` is a selected vehicle → the twin + detail panels.
enum DigitalTwinStatus: Equatable {
    case loading
    case empty
    case error(String)
    case ready
}

// MARK: - Model

@MainActor
@Observable
final class DigitalTwinPageModel {
    /// Web `REFRESH_INTERVAL` (5s) — the live-state poll cadence for the per-vehicle feeds.
    static let refreshInterval: Duration = .seconds(5)

    @ObservationIgnored private let dataSource: any DigitalTwinDataSource

    private(set) var status: DigitalTwinStatus = .loading
    private(set) var vehicles: [DigitalTwinWidgetTwinVehicle] = []
    private(set) var selectedVehicleID: Int?

    /// The merged physical state for the illustration + detail rows (web `twinState`).
    private(set) var twin: VehicleTwinState = .empty
    /// Whether `useSecurityLatest` returned a row (web `securityData` truthiness → doors / windows panels).
    private(set) var securityPresent = false
    /// The single source-of-truth badge status (web `badgeStatus`).
    private(set) var badge: DigitalTwinVehicleStatus = .offline

    /// The per-vehicle paint override store (web `useVehiclePaint`), re-seeded on selection change.
    private(set) var paintStore: InMemoryVehiclePaintStore?
    /// The paint picker props (web `vehicleId` / `exteriorColor`).
    private(set) var paintInput: VehiclePaintPickerInput?

    init(dataSource: any DigitalTwinDataSource = SampleDigitalTwinDataSource()) {
        self.dataSource = dataSource
    }

    // MARK: Derived

    /// The vehicle whose twin is shown (web `useSelectedVehicle().vehicle`).
    var selectedVehicle: DigitalTwinWidgetTwinVehicle? {
        guard let selectedVehicleID else { return nil }
        return vehicles.first { $0.id == selectedVehicleID }
    }

    /// The last-updated timestamp for the freshness caption (web `twinState.lastUpdated`).
    var lastUpdated: Date? {
        twin.lastUpdated
    }

    // MARK: Loading (web `useVehicles` → selection → per-vehicle feeds)

    /// Loads the fleet, resolves the selection, then merges the per-vehicle feeds. Projects the
    /// result into loading → empty | error | ready.
    func load() async {
        status = .loading
        do {
            let fleet = try await dataSource.useVehicles()
            vehicles = fleet
            guard let vehicle = resolveSelection(in: fleet) else {
                selectedVehicleID = nil
                status = .empty
                return
            }
            selectedVehicleID = vehicle.id
            seedPaint(for: vehicle)
            status = .ready
            await loadSignals(for: vehicle.id)
        } catch {
            status = .error(error.localizedDescription)
        }
    }

    /// Pull-to-refresh / live poll / Retry: re-reads the per-vehicle feeds when ready, else the fleet.
    func refresh() async {
        if case .ready = status, let id = selectedVehicleID {
            await loadSignals(for: id)
        } else {
            await load()
        }
    }

    /// Switches the active vehicle (web `VehicleSelect`): re-seed the paint store + reload the feeds.
    func select(_ id: Int) async {
        guard id != selectedVehicleID, let vehicle = vehicles.first(where: { $0.id == id }) else { return }
        selectedVehicleID = id
        twin = .empty
        securityPresent = false
        badge = .offline
        seedPaint(for: vehicle)
        await loadSignals(for: id)
    }

    // MARK: Private

    /// Concurrently reads the three per-vehicle feeds and rebuilds the merged twin + badge. A
    /// per-feed failure degrades to "no data" (the panels show their empty / `'—'` states) rather
    /// than failing the whole page — faithful to the web's independent queries.
    private func loadSignals(for vehicleID: Int) async {
        async let stateFeed = dataSource.useVehicleState(vehicleID: vehicleID)
        async let securityFeed = dataSource.useSecurityLatest(vehicleID: vehicleID)
        async let chargingFeed = dataSource.useChargingTelemetryLatest(vehicleID: vehicleID)

        let snapshot = (try? await stateFeed) ?? .absent
        let security = (try? await securityFeed) ?? nil
        let charging = (try? await chargingFeed) ?? nil

        guard selectedVehicleID == vehicleID else { return }

        securityPresent = security != nil
        twin = TwinStateBuilder.buildTwinState(
            security: security, vehicleState: snapshot.state, charging: charging
        )
        let hasLiveSignal = snapshot.live || security != nil || charging != nil
        badge = DigitalTwinVehicleStatus.badge(
            twin: twin, vehicleState: snapshot.state, hasLiveSignal: hasLiveSignal
        )
    }

    /// Keeps the current selection if it still exists, else picks the first vehicle (web default).
    private func resolveSelection(in fleet: [DigitalTwinWidgetTwinVehicle]) -> DigitalTwinWidgetTwinVehicle? {
        if let id = selectedVehicleID, let kept = fleet.first(where: { $0.id == id }) {
            return kept
        }
        return fleet.first
    }

    /// Re-seeds the per-vehicle paint store + picker props from the vehicle's exterior colour.
    private func seedPaint(for vehicle: DigitalTwinWidgetTwinVehicle) {
        paintStore = InMemoryVehiclePaintStore(exteriorColor: vehicle.exteriorColor)
        paintInput = VehiclePaintPickerInput(vehicleID: vehicle.id, exteriorColor: vehicle.exteriorColor)
    }
}
