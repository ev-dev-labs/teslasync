import Foundation
import Observation

// MARK: - Data source seam (web `useSelectedVehicle` + the five `useSignalObservations`)

/// Supplies every datum the page renders. The production implementation binds the shared
/// KMP repositories/use-cases (ADR-004 — the view holds no networking); previews and
/// tests inject doubles to drive the loading / empty / error / success states. Mirrors
/// the sibling feature `*DataSource` seams.
///
/// Method ↔ web map: `loadVehicles` ← `useSelectedVehicle` / `GET /vehicles`;
/// `loadSnapshot` aggregates the page's five `useSignalObservations(vehicleId,
/// { signal_name, limit: 1 })` calls → `GET /signals/observations?vehicle_id&field&limit=1`
/// for PowershareStatus / PowershareType / PowershareStopReason / PowershareHoursLeft /
/// PowershareInstantaneousPowerKW, each reduced to its latest value.
public protocol PowershareDataSource: Sendable {
    func loadVehicles() async throws -> [PowershareVehicle]
    func loadSnapshot(vehicleID: Int64) async throws -> PowershareSnapshot
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the
/// view). Owns the vehicle list + selection (web header `VehicleSelect` /
/// `useSelectedVehicle`) and the latest Powershare snapshot the five signal queries
/// resolve to (web `status` / `shareType` / `stopReason` / `hoursLeft` / `powerKw`).
/// Every panel reads its data from the bound snapshot; the panels always render, each
/// resolving success vs. empty itself, exactly as the web page does.
@MainActor
@Observable
public final class PowersharePageModel {
    public private(set) var phase: PowersharePhase = .loading

    /// Whether a background refetch is in flight while content is already shown
    /// (web `isFetching && !isLoading`).
    public private(set) var isRefreshing = false

    public private(set) var vehicles: [PowershareVehicle] = []
    public private(set) var selectedVehicleID: Int64?
    public private(set) var snapshot: PowershareSnapshot = .empty

    @ObservationIgnored private let dataSource: any PowershareDataSource

    public init(dataSource: any PowershareDataSource = SamplePowershareDataSource()) {
        self.dataSource = dataSource
    }

    // MARK: Selection

    public var selectedVehicle: PowershareVehicle? {
        selectedVehicleID.flatMap { id in vehicles.first { $0.id == id } }
    }

    // MARK: Loading

    /// Loads the vehicle list then the selected vehicle's snapshot (web `useVehicles` +
    /// the five per-vehicle observation queries).
    public func load() async {
        phase = .loading
        await fetchAll()
    }

    /// Re-runs the load while keeping current content visible (web refetch).
    public func refresh() async {
        isRefreshing = true
        await fetchAll()
        isRefreshing = false
    }

    private func fetchAll() async {
        vehicles = await (try? dataSource.loadVehicles()) ?? []
        if selectedVehicleID == nil || !vehicles.contains(where: { $0.id == selectedVehicleID }) {
            selectedVehicleID = vehicles.first?.id
        }
        await loadSnapshot()
    }

    /// Selects a vehicle (web header picker `setVehicleId`) and reloads its snapshot.
    public func selectVehicle(_ id: Int64) async {
        guard id != selectedVehicleID, vehicles.contains(where: { $0.id == id }) else { return }
        selectedVehicleID = id
        phase = .loading
        await loadSnapshot()
    }

    private func loadSnapshot() async {
        // No vehicle → the web queries are disabled and every value is undefined, so the
        // panels render their empty states (a ready page with an all-nil snapshot).
        guard let id = selectedVehicleID else {
            snapshot = .empty
            phase = .ready
            return
        }

        // The observation fetch resolves the phase: throw → retryable error region (web
        // `PageContainer error`); value → ready (each panel then resolves its own
        // success/empty from the snapshot, web's always-rendered panels).
        do {
            snapshot = try await dataSource.loadSnapshot(vehicleID: id)
            phase = .ready
        } catch {
            snapshot = .empty
            phase = .error(error.localizedDescription)
        }
    }
}
