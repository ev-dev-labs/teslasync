import Foundation
import Observation

// MARK: - Data source seam (web `useSelectedVehicle` + the two analytics `useQuery`s)

/// Supplies every datum the page renders. The production implementation binds the
/// shared KMP repositories/use-cases (ADR-004 — the view holds no networking);
/// previews and tests inject doubles to drive the loading / empty / error / success
/// states. Mirrors the sibling analytics `*DataSource` seams.
///
/// Method ↔ web map: `loadVehicles` ← `useSelectedVehicle` / `GET /vehicles`;
/// `loadHealth` ← `useBatteryHealthAnalytics` → `GET /analytics/battery-health`;
/// `loadDegradation` ← `useBatteryDegradation` → `GET /analytics/battery-degradation`.
public protocol BatteryDegradationDataSource: Sendable {
    func loadVehicles() async throws -> [BatteryVehicle]
    func loadHealth(vehicleID: Int64) async throws -> BatteryHealthData?
    func loadDegradation(vehicleID: Int64) async throws -> BatteryDegradationDetail?
}

// MARK: - Page phase (web `isLoading ? Skeleton : error ? errorRegion : !data ? empty : body`)

/// The page's terminal phase, driven by the primary health analytics source (web
/// `healthQuery`). `.empty` is a successful load that yielded no data (web `!data`);
/// `.error` is a retryable failure (web `PageContainer error`); `.ready` carries the
/// health snapshot. The secondary degradation source never sets `.error` — it only
/// populates the prediction / risk / recommendation sections (web independent query).
public enum BatteryDegradationPhase: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case ready
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the
/// view). Owns the vehicle list + selection (web header `VehicleSelect` /
/// `useSelectedVehicle`), the per-vehicle health snapshot (web `data`, which drives
/// the phase), and the optional degradation detail (web `degradation`). Every panel /
/// chart / table reads its derived data from the bound state (web's `useMemo`s, now
/// pure model derivations).
@MainActor
@Observable
public final class BatteryDegradationPageModel {
    public private(set) var phase: BatteryDegradationPhase = .loading

    /// Whether a background refetch is in flight while content is already shown
    /// (web `isFetching && !isLoading`).
    public private(set) var isRefreshing = false

    public private(set) var vehicles: [BatteryVehicle] = []
    public private(set) var selectedVehicleID: Int64?

    public private(set) var health: BatteryHealthData?
    public private(set) var detail: BatteryDegradationDetail?

    @ObservationIgnored private let dataSource: any BatteryDegradationDataSource

    public init(dataSource: any BatteryDegradationDataSource = SampleBatteryDegradationDataSource()) {
        self.dataSource = dataSource
    }

    // MARK: Selection

    public var selectedVehicle: BatteryVehicle? {
        selectedVehicleID.flatMap { id in vehicles.first { $0.id == id } }
    }

    /// Web `projectionChartData` useMemo — actual history + predicted future joined.
    public var projectionRows: [BatteryProjectionRow] {
        BatteryDegradationDerivations.projectionRows(health: health, detail: detail)
    }

    // MARK: Loading

    /// Loads the vehicle list then the selected vehicle's health + degradation
    /// snapshots (web `useVehicles` + the two per-vehicle queries). The primary health
    /// source resolves the page phase.
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

    /// Selects a vehicle (web header picker `setVehicleId`) and reloads its snapshots.
    public func selectVehicle(_ id: Int64) async {
        guard id != selectedVehicleID, vehicles.contains(where: { $0.id == id }) else { return }
        selectedVehicleID = id
        phase = .loading
        await loadSelectedVehicle()
    }

    private func loadSelectedVehicle() async {
        guard let id = selectedVehicleID else {
            health = nil
            detail = nil
            phase = .empty
            return
        }

        // The health source resolves the page phase: throw → error region (web
        // `error`), nil → no-data empty (web `!data`), value → ready. The degradation
        // source is independent (web separate query): its failure/absence leaves
        // `detail` nil so the prediction / risk / recommendation sections show their
        // own empty states, never the page-level error.
        do {
            let snapshot = try await dataSource.loadHealth(vehicleID: id)
            health = snapshot
            detail = await (try? dataSource.loadDegradation(vehicleID: id)) ?? nil
            phase = snapshot == nil ? .empty : .ready
        } catch {
            health = nil
            detail = nil
            phase = .error(error.localizedDescription)
        }
    }
}
