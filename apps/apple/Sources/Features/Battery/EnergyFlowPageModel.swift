import Foundation
import Observation

// MARK: - Data source seam (web `useSelectedVehicle` + the energy `useQuery`s)

/// Supplies every datum the Energy-Flow page renders. The production implementation binds the
/// shared KMP repositories/use-cases (ADR-004 — the view holds no networking); previews and tests
/// inject doubles to drive the loading / empty / error / success states. Mirrors the sibling
/// `EnergyDataSource` seam.
///
/// Method ↔ web map: `loadVehicles` ← `useSelectedVehicle` / `GET /vehicles`;
/// `loadStats` ← the energy-stats `useQuery` → `GET /vehicles/{id}/energy?days=N`;
/// `loadFlow` ← `useEnergyFlow` → `GET /vehicles/{id}/energy/flow` (the manifest-declared source).
public protocol EnergyFlowDataSource: Sendable {
    func loadVehicles() async throws -> [BatteryVehicle]
    func loadStats(vehicleID: Int64, days: Int) async throws -> EnergyFlowStats?
    func loadFlow(vehicleID: Int64) async throws -> EnergyFlowSnapshot?
}

// MARK: - Page phase (web `isLoading` / `!stats` / `statsError` / body)

/// The page's terminal phase, driven by the historical energy-stats source. The web returns the
/// honest empty state when there is no stats payload (`!stats && !isLoading`) and surfaces the
/// stats error through the page container; both are modelled as distinct phases here so the page
/// renders a dedicated loading / empty / error / success surface (every data state implemented).
public enum EnergyFlowPhase: Equatable, Sendable {
    case loading
    case empty
    case error
    case ready
}

// MARK: - Page model

/// The `@Observable` state holder the Energy-Flow page binds to (ADR-004 — no networking in the
/// view). Owns the vehicle list + selection (web header `VehicleSelect` / `useSelectedVehicle`),
/// the selected trailing window (web `RangePicker`), the per-vehicle historical stats, and the
/// live `/energy/flow` snapshot which the page polls in real time (web `refetchInterval:
/// REALTIME`) with a staleness guard (ADR-013).
@MainActor
@Observable
public final class EnergyFlowPageModel {
    public private(set) var phase: EnergyFlowPhase = .loading

    /// Whether a background refetch is in flight while content is already shown (web
    /// `isFetching && !isLoading`).
    public private(set) var isRefreshing = false

    /// The stats-source failure message surfaced by the `.error` phase; nil clears it.
    public private(set) var errorMessage: String?

    public private(set) var vehicles: [BatteryVehicle] = []
    public private(set) var selectedVehicleID: Int64?

    public private(set) var stats: EnergyFlowStats?

    /// The live energy-flow snapshot (web `useEnergyFlow`) and the wall-clock instant it last
    /// arrived, used to drive the staleness indicator.
    public private(set) var flow: EnergyFlowSnapshot?
    public private(set) var flowUpdatedAt: Date?

    /// The selected trailing window in days (web `RangePicker`, default `7d`).
    public private(set) var rangeDays = EnergyFlowDerivations.defaultRangeDays

    /// The live-poll cadence the view's lifecycle task uses (web `INTERVALS.REALTIME`).
    public let liveRefreshInterval: Duration = .seconds(5)

    /// The freshness window beyond which the live snapshot is treated as stale (ADR-013: 2 min).
    private let stalenessThreshold: TimeInterval = 120

    @ObservationIgnored private let dataSource: any EnergyFlowDataSource
    @ObservationIgnored private let now: @Sendable () -> Date

    public init(
        dataSource: any EnergyFlowDataSource = SampleEnergyFlowDataSource(),
        now: @escaping @Sendable () -> Date = Date.init
    ) {
        self.dataSource = dataSource
        self.now = now
    }

    // MARK: Selection

    public var selectedVehicle: BatteryVehicle? {
        selectedVehicleID.flatMap { id in vehicles.first { $0.id == id } }
    }

    // MARK: Loading

    /// Loads the vehicle list then the selected vehicle's stats + live flow (web `useVehicles`
    /// plus the two per-vehicle queries).
    public func load() async {
        phase = .loading
        await fetchAll()
    }

    /// Re-runs the load while keeping current content visible (web refetch / `onRetry`).
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

    /// Changes the trailing window (web `RangePicker` → recomputed `days`) and reloads stats.
    public func setRangeDays(_ days: Int) async {
        guard days != rangeDays, days > 0 else { return }
        rangeDays = days
        phase = .loading
        await loadSelectedVehicle()
    }

    private func loadSelectedVehicle() async {
        guard let id = selectedVehicleID else {
            stats = nil
            flow = nil
            flowUpdatedAt = nil
            errorMessage = nil
            phase = .empty
            return
        }

        // The stats source drives the page phase (web `isLoading` → `!stats` empty / `statsError`):
        // a throw surfaces the error phase, a nil payload the empty phase, a value the ready phase.
        do {
            let loaded = try await dataSource.loadStats(vehicleID: id, days: rangeDays)
            stats = loaded
            errorMessage = nil
            phase = loaded == nil ? .empty : .ready
        } catch {
            stats = nil
            errorMessage = error.localizedDescription
            phase = .error
        }

        // The live flow is an independent source (web separate query): its absence simply leaves
        // the diagram in its honest "no live data" state, never a page-level failure.
        await refreshFlow()
    }

    /// Re-fetches only the live `/energy/flow` snapshot (web `refetchInterval: REALTIME`), stamping
    /// the arrival time for the staleness guard. Failures keep the last snapshot.
    public func refreshFlow() async {
        guard let id = selectedVehicleID else { return }
        if let snapshot = try? await dataSource.loadFlow(vehicleID: id) {
            flow = snapshot
            flowUpdatedAt = now()
        }
    }

    // MARK: Derived (web memos / inline reads)

    public var dailyBreakdown: [EnergyFlowDailyPoint] { stats?.dailyBreakdown ?? [] }

    /// Web `sortedDailyRows` (default newest-first) for the history table.
    public var sortedDailyRows: [EnergyFlowDailyPoint] {
        EnergyFlowDerivations.sortedByDate(dailyBreakdown)
    }

    public var chargePowerKw: Double { EnergyFlowDerivations.chargePowerKw(flow) }
    public var batterySocPercent: Double { EnergyFlowDerivations.batterySocPercent(flow) }
    public var chargeState: String? { flow?.chargeState }
    public var isCharging: Bool { (flow?.chargeState ?? "") == "Charging" }
    public var hasLiveFlow: Bool { flow != nil }
    public var avgEnergyPerDayWh: Double { EnergyFlowDerivations.avgEnergyPerDayWh(stats) }

    /// Whether the live snapshot has aged past the freshness window (ADR-013). A never-loaded
    /// flow is not "stale" — it is simply absent (handled by the diagram's no-live-data state).
    public var flowIsStale: Bool {
        guard let flowUpdatedAt else { return false }
        return now().timeIntervalSince(flowUpdatedAt) > stalenessThreshold
    }
}
