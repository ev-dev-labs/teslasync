import Foundation
import Observation

// MARK: - Data source seam (web hooks: useSelectedVehicle / period-stats useQuery /

// useBatteryHealthAnalytics / useMileageStats / useStateSummary / useFleetAnalytics)

/// Supplies every datum the page renders. The production implementation binds the shared KMP
/// repositories/use-cases (ADR-004 — the view holds no networking); previews and tests inject
/// doubles to drive the loading / empty / error / success states. Mirrors the
/// `FleetCompareDataSource` seam used by the sibling analytics page.
///
/// Method ↔ web hook map (names kept at the Swift call sites per the parity manifest):
/// `loadVehicles` ← `useSelectedVehicle`/`GET /vehicles`; `loadPeriodStats` ← the inline
/// `useQuery(['period-stats'])`; `loadBatteryHealth` ← `useBatteryHealthAnalytics`;
/// `loadMileageStats` ← `useMileageStats`; `loadStateSummary` ← `useStateSummary`;
/// `loadFleetAnalytics` ← `useFleetAnalytics`.
public protocol StatisticsDataSource: Sendable {
    func loadVehicles() async throws -> [StatisticsVehicle]
    func loadPeriodStats(vehicleID: Int64) async throws -> StatisticsPeriodStats?
    func loadBatteryHealth(vehicleID: Int64) async throws -> StatisticsBatteryHealth?
    func loadMileageStats(vehicleID: Int64) async throws -> StatisticsMileage?
    func loadStateSummary(vehicleID: Int64) async throws -> [StatisticsStateEntry]
    func loadFleetAnalytics() async throws -> [StatisticsVehicleComparison]
}

// MARK: - Page phase (web `isLoading ? Skeleton : !stats ? EmptyState : content`, + error prop)

/// The page's terminal phase, driven by the primary period-stats source (web `statsQuery`).
/// `.empty` is a successful load that yielded no stats (web `!stats` → no-data EmptyState);
/// `.error` is a retryable failure (web `PageContainer error` region); `.ready` carries stats.
public enum StatisticsPhase: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case ready
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the view). Owns
/// the vehicle list + selection, the primary period stats (driving the page phase), each
/// secondary section's data (battery health, mileage, state distribution, fleet comparison), and
/// derives the state-distribution pie slices (web `stateData`) and the comparison visibility
/// (web `compData.length > 1`). Reads everything through the injected `StatisticsDataSource`.
@MainActor
@Observable
public final class StatisticsPageModel {
    public private(set) var phase: StatisticsPhase = .loading

    /// Whether a background refetch is in flight while content is already shown (web
    /// `isFetching && !isLoading`).
    public private(set) var isRefreshing = false

    public private(set) var vehicles: [StatisticsVehicle] = []
    public private(set) var selectedVehicleID: Int64?

    public private(set) var periodStats: StatisticsPeriodStats?
    public private(set) var batteryHealth: StatisticsBatteryHealth?
    public private(set) var mileage: StatisticsMileage?
    public private(set) var stateEntries: [StatisticsStateEntry] = []
    public private(set) var comparison: [StatisticsVehicleComparison] = []

    @ObservationIgnored private let dataSource: any StatisticsDataSource

    public init(dataSource: any StatisticsDataSource = SampleStatisticsDataSource()) {
        self.dataSource = dataSource
    }

    // MARK: Selection

    public var selectedVehicle: StatisticsVehicle? {
        selectedVehicleID.flatMap { id in vehicles.first { $0.id == id } }
    }

    // MARK: Loading

    /// Loads the vehicle list, fleet comparison, then the selected vehicle's stats (web
    /// `useVehicles` + the per-vehicle queries). Resolves the page phase from the primary source.
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
        // The vehicle list + fleet comparison are fleet-wide; per-source failures degrade to
        // empty (web TanStack → undefined → section empty state), never the page error.
        vehicles = await (try? dataSource.loadVehicles()) ?? []
        if selectedVehicleID == nil || !vehicles.contains(where: { $0.id == selectedVehicleID }) {
            selectedVehicleID = vehicles.first?.id
        }
        comparison = await (try? dataSource.loadFleetAnalytics()) ?? []
        await loadSelectedVehicle()
    }

    /// Selects a vehicle (web `setVehicleId`) and reloads its per-vehicle stats; the fleet
    /// comparison is fleet-wide and stays put.
    public func selectVehicle(_ id: Int64) async {
        guard id != selectedVehicleID, vehicles.contains(where: { $0.id == id }) else { return }
        selectedVehicleID = id
        phase = .loading
        await loadSelectedVehicle()
    }

    private func loadSelectedVehicle() async {
        guard let id = selectedVehicleID else {
            periodStats = nil
            batteryHealth = nil
            mileage = nil
            stateEntries = []
            phase = .empty
            return
        }

        // The primary source (web `statsQuery`) resolves the page phase: throw → error region,
        // nil → no-data empty, value → ready.
        do {
            let stats = try await dataSource.loadPeriodStats(vehicleID: id)
            periodStats = stats
            phase = stats == nil ? .empty : .ready
        } catch {
            periodStats = nil
            phase = .error(error.localizedDescription)
        }

        // Secondary sources degrade to nil/empty on failure (web per-section empty states).
        batteryHealth = try? await dataSource.loadBatteryHealth(vehicleID: id)
        mileage = try? await dataSource.loadMileageStats(vehicleID: id)
        stateEntries = await (try? dataSource.loadStateSummary(vehicleID: id)) ?? []
    }

    // MARK: Derived — state distribution (web `stateData`)

    /// The pie slices: each state's share of total time as a whole percent, colored by a stable
    /// per-state palette index (web `stateData` useMemo + `STATE_COLORS`). Empty when no data.
    public var stateSlices: [StatisticsStateSlice] {
        guard !stateEntries.isEmpty else { return [] }
        let total = stateEntries.reduce(0) { $0 + $1.totalMinutes }
        let denominator = max(total, 1)
        return stateEntries.map { entry in
            StatisticsStateSlice(
                state: entry.state,
                percent: Int((entry.totalMinutes / denominator * 100).rounded()),
                colorIndex: StatisticsStateColor.colorIndex(for: entry.state)
            )
        }
    }

    /// Whether the fleet comparison chart renders (web `compData.length > 1`); below two vehicles
    /// the section shows its single-vehicle empty state instead.
    public var showsComparison: Bool {
        comparison.count > 1
    }
}
