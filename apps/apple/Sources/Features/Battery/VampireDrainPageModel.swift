import Foundation
import Observation

// MARK: - Data source seam (web `useSelectedVehicle` + the vampire-drain-stats query)

/// Supplies every datum the page renders. The production implementation binds the shared
/// KMP repositories/use-cases (ADR-004 — the view holds no networking); previews and tests
/// inject doubles to drive the loading / empty / error / success states. Mirrors the
/// sibling Battery `*DataSource` seams.
///
/// Method ↔ web map: `loadVehicles` ← `useSelectedVehicle` / `GET /vehicles`;
/// `loadStats` ← `useQuery(['vampire-drain-stats', id])` → `GET /vampire-drain/stats?vehicle_id`.
public protocol VampireDrainDataSource: Sendable {
    func loadVehicles() async throws -> [BatteryVehicle]
    func loadStats(vehicleID: Int64) async throws -> VampireDrainData?
}

// MARK: - Page phase (web `isLoading ? Skeleton : error ? errorRegion : !data ? empty : body`)

/// The page's terminal phase, driven by the vampire-drain-stats query. `.empty` is a
/// successful load that yielded no data (web `!data && !isLoading`); `.error` is a
/// retryable failure (web `PageContainer error`); `.ready` carries the snapshot.
public enum VampireDrainPhase: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case ready
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the view).
/// Owns the vehicle list + selection (web header `VehicleSelect` / `useSelectedVehicle`) and
/// the per-vehicle drain snapshot (web `data`, which drives the phase). Every panel / chart /
/// table reads its derived data from the bound state (web's inline `useMemo`s, now pure model
/// + `VampireDrainData` derivations).
@MainActor
@Observable
public final class VampireDrainPageModel {
    public private(set) var phase: VampireDrainPhase = .loading

    /// Whether a background refetch is in flight while content is already shown
    /// (web `isFetching && !isLoading`, surfaced by `DataFreshnessAuto`).
    public private(set) var isRefreshing = false

    public private(set) var vehicles: [BatteryVehicle] = []
    public private(set) var selectedVehicleID: Int64?
    public private(set) var data: VampireDrainData?

    @ObservationIgnored private let dataSource: any VampireDrainDataSource

    public init(dataSource: any VampireDrainDataSource = SampleVampireDrainDataSource()) {
        self.dataSource = dataSource
    }

    // MARK: Selection

    public var selectedVehicle: BatteryVehicle? {
        selectedVehicleID.flatMap { id in vehicles.first { $0.id == id } }
    }

    // MARK: Loading

    /// Loads the vehicle list then the selected vehicle's drain snapshot (web `useVehicles`
    /// + the per-vehicle query). The stats source resolves the page phase.
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
        await loadStats()
    }

    /// Selects a vehicle (web header picker `setVehicleId`) and reloads its snapshot.
    public func selectVehicle(_ id: Int64) async {
        guard id != selectedVehicleID, vehicles.contains(where: { $0.id == id }) else { return }
        selectedVehicleID = id
        phase = .loading
        await loadStats()
    }

    private func loadStats() async {
        guard let id = selectedVehicleID else {
            data = nil
            phase = .empty
            return
        }

        // The stats source resolves the page phase: throw → error region (web `error`),
        // nil → no-data empty (web `!data`), value → ready.
        do {
            let snapshot = try await dataSource.loadStats(vehicleID: id)
            data = snapshot
            phase = snapshot == nil ? .empty : .ready
        } catch {
            data = nil
            phase = .error(error.localizedDescription)
        }
    }
}
