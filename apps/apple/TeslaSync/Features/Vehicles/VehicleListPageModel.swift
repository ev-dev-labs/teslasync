import Foundation
import Observation
import SwiftUI

// MARK: - Sync feedback (web `syncMut.isSuccess` / `isError` banners)

/// The persistent sync-result banner (web GlassPanel2 / GlassPanel3): success shows
/// `vehicles.syncSuccess`, failure shows `vehicles.syncError`. Cleared when a new sync begins.
public enum VehicleListSyncFeedback: Equatable, Sendable {
    case success
    case failure

    /// The banner copy key (web `vehicles.syncSuccess` / `vehicles.syncError`).
    public var messageKey: LocalizedStringKey {
        self == .success ? VehicleListStrings.syncSuccess : VehicleListStrings.syncError
    }

    /// The banner tone — emerald success / rose failure.
    public var tone: TSTone {
        self == .success ? .success : .danger
    }
}

// MARK: - Toast (web `toast.success` / `toast.error`)

/// One transient toast (web `toast.success(syncToast)` / `toast.error(syncFailed)` and the delete
/// equivalents). Identifiable so the overlay can animate it and an auto-dismiss can target this exact
/// instance.
public struct VehicleListToast: Identifiable {
    public let id = UUID()
    public let messageKey: LocalizedStringKey
    public let tone: TSTone
}

// MARK: - Page model (web `useQuery(['vehicles'])` + fleet memos + mutations)

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the view). Owns the
/// vehicle list (web `useQuery(['vehicles'])`), the per-vehicle live states (web batch
/// `fetchVehicleState`), and the pin order (web `usePinned('vehicle')`); derives the four fleet
/// aggregates (web `fleet` memo: `avgBattery` / `totalRange` / `chargingCount` / `onlineCount`) and
/// the pinned-first sort (web `sortedVehicleList`); and runs the sync (web `syncMut`) + delete (web
/// `deleteMut`) + pin-toggle mutations with their banner / toast feedback. Every measurement stays SI;
/// unit conversion happens at the SwiftUI render boundary via `Units` / `VehicleListFormat`.
@MainActor
@Observable
public final class VehicleListPageModel {
    public private(set) var state: VehicleListState = .loading
    /// Whether a sync is in flight (web `syncMut.isPending`) — disables the Sync button.
    public private(set) var isSyncing = false
    /// The persistent sync-result banner (web GlassPanel2 / GlassPanel3); `nil` hides both banners.
    public private(set) var syncFeedback: VehicleListSyncFeedback?
    /// The transient toast (web `toast.*`); `nil` shows nothing.
    public private(set) var toast: VehicleListToast?
    /// The vehicle queued for deletion (web `deleteTarget`); non-nil presents the confirm dialog.
    public var deleteTarget: VehicleListItem?

    public private(set) var vehicles: [VehicleListItem] = []
    @ObservationIgnored private var states: [Int64: VehicleStateSnapshot] = [:]
    @ObservationIgnored private var pinnedPositions: [String: Int] = [:]

    @ObservationIgnored private let dataSource: any VehicleListDataSource

    public init(dataSource: any VehicleListDataSource = SampleVehicleListDataSource()) {
        self.dataSource = dataSource
    }

    // MARK: Derived (web memos)

    /// The number of vehicles (web `vehicleList.length`) — the Total-Vehicles card value.
    public var vehicleCount: Int { vehicles.count }

    /// The resolved vehicle+state entries in fleet (original) order — web `fleet.entries`
    /// (`fleetStates.filter(e => e.state !== null)`). Feeds the aggregates + the battery panel.
    public var resolvedEntries: [VehicleListEntry] {
        vehicles.compactMap { vehicle in
            states[vehicle.id].map { VehicleListEntry(vehicle: vehicle, state: $0) }
        }
    }

    /// Mean state of charge across resolved vehicles (web `fleet.avgBattery`); `0` when none resolved.
    public var avgBattery: Double {
        let entries = resolvedEntries
        guard !entries.isEmpty else { return 0 }
        return entries.reduce(0) { $0 + Double($1.state.batteryLevel) } / Double(entries.count)
    }

    /// Sum of SI rated range across resolved vehicles (web `fleet.totalRange`).
    public var totalRangeM: Double {
        resolvedEntries.reduce(0) { $0 + $1.state.ratedRangeM }
    }

    /// Number of resolved vehicles currently charging (web `fleet.chargingCount`).
    public var chargingCount: Int {
        resolvedEntries.filter { $0.state.isCharging }.count
    }

    /// Number of resolved (online) vehicles (web `fleet.onlineCount`).
    public var onlineCount: Int { resolvedEntries.count }

    /// Whether the battery panel has anything to plot (web `fleet.entries.length > 0`).
    public var hasFleetState: Bool { !resolvedEntries.isEmpty }

    /// The vehicle list with pinned rows floated to the top in pin order, the rest keeping their
    /// original order (web `sortedVehicleList` — a stable sort by pin `position`).
    public var sortedVehicles: [VehicleListItem] {
        guard !pinnedPositions.isEmpty else { return vehicles }
        return vehicles.enumerated().sorted { lhs, rhs in
            let lp = pinnedPositions[String(lhs.element.id)]
            let rp = pinnedPositions[String(rhs.element.id)]
            switch (lp, rp) {
            case let (left?, right?): return left == right ? lhs.offset < rhs.offset : left < right
            case (.some, .none): return true
            case (.none, .some): return false
            case (.none, .none): return lhs.offset < rhs.offset
            }
        }.map(\.element)
    }

    /// Whether there are at least two vehicles (web `vehicleList.length >= 2`) — the Compare action.
    public var canCompare: Bool { vehicles.count >= 2 }

    /// The first two vehicle ids for the pre-filled comparison (web `vehicleList[0]/[1]`).
    public var compareIDs: (Int64, Int64)? {
        guard vehicles.count >= 2 else { return nil }
        return (vehicles[0].id, vehicles[1].id)
    }

    /// The resolved live state for a vehicle, if any (web `fleet.entries.find(...)?.state`).
    public func state(for vehicle: VehicleListItem) -> VehicleStateSnapshot? {
        states[vehicle.id]
    }

    /// Whether a vehicle is currently pinned (web `vehiclePins.some(...)`).
    public func isPinned(_ vehicle: VehicleListItem) -> Bool {
        pinnedPositions[String(vehicle.id)] != nil
    }

    // MARK: Loading

    /// Loads the fleet (web `useQuery(['vehicles'])` + the batched states + the pin set). An empty
    /// fleet projects `.empty`; a fetch failure projects `.error`; otherwise `.success`.
    public func load() async {
        state = .loading
        await fetch()
    }

    /// Pull-to-refresh / Retry: re-runs the load while keeping the current content visible.
    public func refresh() async {
        await fetch()
    }

    private func fetch() async {
        do {
            let fetched = try await dataSource.loadVehicles()
            vehicles = fetched
            guard !fetched.isEmpty else {
                states = [:]
                pinnedPositions = [:]
                state = .empty
                return
            }
            async let pins = loadPins()
            let resolved = await loadStates(for: fetched)
            states = resolved
            pinnedPositions = await pins
            state = .success
        } catch {
            state = .error(error.localizedDescription)
        }
    }

    /// Batch-fetches each vehicle's live state concurrently (web `Promise.all(... fetchVehicleState)`);
    /// a per-vehicle failure resolves to no state (web per-entry `try/catch → null`).
    private func loadStates(for vehicles: [VehicleListItem]) async -> [Int64: VehicleStateSnapshot] {
        await withTaskGroup(of: (Int64, VehicleStateSnapshot?).self) { group in
            for vehicle in vehicles {
                let id = vehicle.id
                group.addTask { [dataSource] in
                    let snapshot = (try? await dataSource.fetchVehicleState(vehicleID: id)) ?? nil
                    return (id, snapshot)
                }
            }
            var result: [Int64: VehicleStateSnapshot] = [:]
            for await (id, snapshot) in group {
                if let snapshot { result[id] = snapshot }
            }
            return result
        }
    }

    /// Loads the `vehicle` pin bucket (web `usePinned('vehicle')`); a failure leaves the list unpinned.
    private func loadPins() async -> [String: Int] {
        guard let pins = try? await dataSource.usePinned(type: "vehicle", context: nil) else { return [:] }
        return Dictionary(pins.map { ($0.itemID, $0.position) }, uniquingKeysWith: { first, _ in first })
    }

    // MARK: Sync (web `syncMut`)

    /// Syncs vehicles from Tesla (web `syncMut.mutate()` → `POST /vehicles/sync`). On success it
    /// re-fetches the fleet and raises the success banner + toast; on failure the error banner + toast.
    public func sync() async {
        guard !isSyncing else { return }
        isSyncing = true
        syncFeedback = nil
        defer { isSyncing = false }
        do {
            _ = try await dataSource.syncVehicles()
            await fetch()
            syncFeedback = .success
            showToast(VehicleListStrings.syncToast, tone: .success)
        } catch {
            syncFeedback = .failure
            showToast(VehicleListStrings.syncFailed, tone: .danger)
        }
    }

    // MARK: Delete (web `deleteMut` + `ConfirmDialog`)

    /// Queues a vehicle for deletion (web `setDeleteTarget(vehicle)`), presenting the confirm dialog.
    public func requestDelete(_ vehicle: VehicleListItem) {
        deleteTarget = vehicle
    }

    /// Dismisses the confirm dialog without deleting (web `onCancel`).
    public func cancelDelete() {
        deleteTarget = nil
    }

    /// Confirms the deletion (web `deleteMut.mutate(id)` → `DELETE /vehicles/{id}`). On success it
    /// re-fetches the fleet and raises the removed toast; on failure the failure toast.
    public func confirmDelete() async {
        guard let target = deleteTarget else { return }
        deleteTarget = nil
        do {
            try await dataSource.deleteVehicle(id: target.id)
            await fetch()
            showToast(VehicleListStrings.deleteSuccess, tone: .success)
        } catch {
            showToast(VehicleListStrings.deleteFailed, tone: .danger)
        }
    }

    // MARK: Pin (web `useTogglePin('vehicle')`)

    /// Toggles a vehicle's pin (web `toggle.mutate({ itemId, pin: !isPinned })`), then re-reads the
    /// pin bucket so the list re-sorts. A failure leaves the order unchanged.
    public func togglePin(_ vehicle: VehicleListItem) async {
        let pinned = isPinned(vehicle)
        do {
            try await dataSource.togglePin(vehicleID: vehicle.id, pinned: !pinned)
            pinnedPositions = await loadPins()
        } catch {
            // Pin failures are non-fatal — the list keeps its current order (web toast-only error).
        }
    }

    // MARK: Toast plumbing

    /// Raises a transient toast and auto-dismisses it after a short delay (web toast auto-close).
    private func showToast(_ key: LocalizedStringKey, tone: TSTone) {
        let next = VehicleListToast(messageKey: key, tone: tone)
        toast = next
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(3))
            guard let self, self.toast?.id == next.id else { return }
            self.toast = nil
        }
    }

    /// Dismisses the current toast immediately (tap-to-dismiss).
    public func dismissToast() {
        toast = nil
    }
}
