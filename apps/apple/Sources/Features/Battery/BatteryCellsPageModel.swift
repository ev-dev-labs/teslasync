import Foundation
import Observation

// MARK: - Vehicle (web `useSelectedVehicle` → `GET /vehicles`)

/// One selectable vehicle (web `vehicle.display_name || vehicle.vin`). Identity +
/// label strings only, so they round-trip verbatim (no SI measurements here).
public struct BatteryVehicle: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let displayName: String
    public let vin: String

    public init(id: Int64, displayName: String, vin: String) {
        self.id = id
        self.displayName = displayName
        self.vin = vin
    }

    /// Web `vehicle.display_name || vehicle.vin` — the label shown in the selector.
    public var name: String {
        displayName.isEmpty ? vin : displayName
    }
}

// MARK: - Data source seam (web `useSelectedVehicle` + the inline cells `useQuery`)

/// Supplies every datum the page renders. The production implementation binds the
/// shared KMP repositories/use-cases (ADR-004 — the view holds no networking);
/// previews and tests inject doubles to drive the loading / empty / error / success
/// states. Mirrors the sibling analytics `*DataSource` seams.
///
/// Method ↔ web map: `loadVehicles` ← `useSelectedVehicle` / `GET /vehicles`;
/// `loadCellData` ← the inline `useQuery(['battery-cells', id])` →
/// `GET /analytics/battery-cells?vehicle_id`.
public protocol BatteryCellsDataSource: Sendable {
    func loadVehicles() async throws -> [BatteryVehicle]
    func loadCellData(vehicleID: Int64) async throws -> BatteryCellData?
}

// MARK: - Page phase (web `isLoading ? Skeleton : error ? errorRegion : !data ? empty : body`)

/// The page's terminal phase, driven by the cells source (web `useQuery`).
/// `.empty` is a successful load that yielded no data (web `!data`); `.error` is a
/// retryable failure (web `PageContainer error` region); `.ready` carries the snapshot.
public enum BatteryCellsPhase: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case ready
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the
/// view). Owns the vehicle list + selection (web `useSelectedVehicle`) and the
/// per-vehicle cell snapshot (web `data`), which drives the phase. Every chart /
/// table / insight reads its derived data from the bound `BatteryCellData` (web's
/// `useMemo`s, now pure model derivations).
@MainActor
@Observable
public final class BatteryCellsPageModel {
    public private(set) var phase: BatteryCellsPhase = .loading

    /// Whether a background refetch is in flight while content is already shown
    /// (web `isFetching && !isLoading`).
    public private(set) var isRefreshing = false

    public private(set) var vehicles: [BatteryVehicle] = []
    public private(set) var selectedVehicleID: Int64?

    public private(set) var data: BatteryCellData?

    @ObservationIgnored private let dataSource: any BatteryCellsDataSource

    public init(dataSource: any BatteryCellsDataSource = SampleBatteryCellsDataSource()) {
        self.dataSource = dataSource
    }

    // MARK: Selection

    public var selectedVehicle: BatteryVehicle? {
        selectedVehicleID.flatMap { id in vehicles.first { $0.id == id } }
    }

    // MARK: Loading

    /// Loads the vehicle list then the selected vehicle's cell snapshot (web
    /// `useVehicles` + the per-vehicle query). Resolves the page phase from the
    /// primary cells source.
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
        await loadSelectedVehicle()
    }

    /// Selects a vehicle (web header picker `setVehicleId`) and reloads its snapshot.
    public func selectVehicle(_ id: Int64) async {
        guard id != selectedVehicleID, vehicles.contains(where: { $0.id == id }) else { return }
        selectedVehicleID = id
        phase = .loading
        await loadSelectedVehicle()
    }

    private func loadSelectedVehicle() async {
        guard let id = selectedVehicleID else {
            data = nil
            phase = .empty
            return
        }

        // The cells source resolves the page phase: throw → error region (web
        // `error`), nil → no-data empty (web `!data` — query disabled / no scope),
        // value → ready. A value with no cells is still ready (sections show their
        // own empty states, matching the web per-section `EmptyState`s).
        do {
            let snapshot = try await dataSource.loadCellData(vehicleID: id)
            data = snapshot
            phase = snapshot == nil ? .empty : .ready
        } catch {
            data = nil
            phase = .error(error.localizedDescription)
        }
    }
}
