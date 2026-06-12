import Foundation
import Observation

// MARK: - Data source seam (web hooks: useVehicles / useVehicleState / useDrivingStats / useCostBreakdown / useMonthlyMileage)

/// Supplies every datum the page renders. The production implementation binds the shared KMP
/// repositories/use-cases (ADR-004 — the view holds no networking); previews and tests inject
/// doubles to drive the loading / empty / error / success states. Mirrors the
/// `FleetTelemetryCoverageDataSource` seam used by the sibling pages.
public protocol FleetCompareDataSource: Sendable {
    func loadVehicles() async throws -> [FleetCompareVehicle]
    func loadState(vehicleID: Int64) async throws -> FleetCompareVehicleState?
    func loadDrivingStats(vehicleID: Int64) async throws -> FleetCompareDrivingStats?
    func loadCostBreakdown(vehicleID: Int64) async throws -> FleetCompareCostBreakdown?
    func loadMonthlyMileage(vehicleID: Int64) async throws -> [FleetCompareMonthlyBucket]
}

// MARK: - Page states (web PageContainer phases + single-vehicle empty)

/// The vehicle-list source's terminal state (web `useVehicles`). `.single` is a successful load
/// with fewer than two vehicles (web `vehicleList.length < 2` → single-vehicle EmptyState);
/// `.error` is a retryable failure (HIG error + Retry); `.ready` carries 2+.
public enum FleetCompareListState: Equatable, Sendable {
    case loading
    case single
    case error(String)
    case ready
}

/// One side's loaded data + in-flight flags (web per-side `stateLoading` / `dStatsLoad`).
public struct FleetCompareSide: Sendable {
    public var state: FleetCompareVehicleState?
    public var stats: FleetCompareDrivingStats?
    public var cost: FleetCompareCostBreakdown?
    public var monthly: [FleetCompareMonthlyBucket] = []
    public var isLoadingState = false
    public var isLoadingStats = false

    public init() {}
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the view). Owns
/// the vehicle list state, the A/B selection, each side's live + lifetime data, and the
/// disambiguation banner; derives the comparison rows (web `comparisonRows` + `getWinner`), the
/// merged monthly chart series (web `monthlyChartData` / `drivesChartData`), and the
/// cross-disabled selector options. Reads everything through the injected `FleetCompareDataSource`.
@MainActor
@Observable
public final class FleetComparePageModel {
    public private(set) var listState: FleetCompareListState = .loading

    /// Whether a background refetch is in flight while content is already shown (web
    /// `isFetching && !isLoading`).
    public private(set) var isRefreshing = false

    public private(set) var vehicles: [FleetCompareVehicle] = []

    public private(set) var vehicleIdA: Int64?
    public private(set) var vehicleIdB: Int64?

    public private(set) var sideA = FleetCompareSide()
    public private(set) var sideB = FleetCompareSide()

    /// Disambiguation banner visibility (web `bannerVisible`, persisted dismissal).
    public var bannerVisible: Bool

    @ObservationIgnored private let dataSource: any FleetCompareDataSource
    @ObservationIgnored private let onDismissBanner: (() -> Void)?

    public init(
        dataSource: any FleetCompareDataSource = SampleFleetCompareDataSource(),
        bannerVisible: Bool = true,
        onDismissBanner: (() -> Void)? = nil
    ) {
        self.dataSource = dataSource
        self.bannerVisible = bannerVisible
        self.onDismissBanner = onDismissBanner
    }

    // MARK: Selected vehicles

    public var vehicleA: FleetCompareVehicle? {
        vehicleIdA.flatMap { id in vehicles.first { $0.id == id } }
    }

    public var vehicleB: FleetCompareVehicle? {
        vehicleIdB.flatMap { id in vehicles.first { $0.id == id } }
    }

    /// Selector options for side A with the side-B pick removed (web cross-disable).
    public var optionsA: [FleetCompareVehicle] {
        vehicles.filter { $0.id != vehicleIdB }
    }

    /// Selector options for side B with the side-A pick removed (web cross-disable).
    public var optionsB: [FleetCompareVehicle] {
        vehicles.filter { $0.id != vehicleIdA }
    }

    // MARK: Loading

    /// Loads the vehicle list, resolves the list state, and (when 2+) auto-selects the first two
    /// vehicles and loads both sides (web `useVehicles` + the auto-select `useEffect`).
    public func load() async {
        listState = .loading
        await fetchVehicles()
    }

    /// Re-runs the load while keeping current content visible (web refetch).
    public func refresh() async {
        isRefreshing = true
        await fetchVehicles()
        isRefreshing = false
    }

    private func fetchVehicles() async {
        do {
            let loaded = try await dataSource.loadVehicles()
            vehicles = loaded
            guard loaded.count >= 2 else {
                vehicleIdA = loaded.first?.id
                vehicleIdB = nil
                listState = .single
                return
            }
            if vehicleIdA == nil || !loaded.contains(where: { $0.id == vehicleIdA }) {
                vehicleIdA = loaded[0].id
            }
            if vehicleIdB == nil || vehicleIdB == vehicleIdA || !loaded.contains(where: { $0.id == vehicleIdB }) {
                vehicleIdB = loaded.first { $0.id != vehicleIdA }?.id
            }
            listState = .ready
            await loadBothSides()
        } catch {
            listState = .error(error.localizedDescription)
        }
    }

    private func loadBothSides() async {
        if let idA = vehicleIdA { await loadSide(idA, into: \.sideA) }
        if let idB = vehicleIdB { await loadSide(idB, into: \.sideB) }
    }

    /// Selects side A (web `setVehicleIdA`) and reloads its data, swapping sides if the picked
    /// vehicle is currently on side B (web cross-disable keeps the two distinct).
    public func selectA(_ id: Int64) async {
        guard id != vehicleIdA else { return }
        if id == vehicleIdB { vehicleIdB = vehicleIdA }
        vehicleIdA = id
        await loadSide(id, into: \.sideA)
        if let idB = vehicleIdB, sideB.state == nil, sideB.stats == nil {
            await loadSide(idB, into: \.sideB)
        }
    }

    /// Selects side B (web `setVehicleIdB`) and reloads its data, swapping sides if needed.
    public func selectB(_ id: Int64) async {
        guard id != vehicleIdB else { return }
        if id == vehicleIdA { vehicleIdA = vehicleIdB }
        vehicleIdB = id
        await loadSide(id, into: \.sideB)
        if let idA = vehicleIdA, sideA.state == nil, sideA.stats == nil {
            await loadSide(idA, into: \.sideA)
        }
    }

    private func loadSide(
        _ id: Int64,
        into keyPath: ReferenceWritableKeyPath<FleetComparePageModel, FleetCompareSide>
    ) async {
        self[keyPath: keyPath].isLoadingState = true
        self[keyPath: keyPath].isLoadingStats = true

        // Per-source failures degrade gracefully to nil/empty (web TanStack defaults to 0/—); the
        // page's required `error` state is surfaced by the top-level vehicle-list load.
        let state = try? await dataSource.loadState(vehicleID: id)
        self[keyPath: keyPath].state = state
        self[keyPath: keyPath].isLoadingState = false

        let stats = try? await dataSource.loadDrivingStats(vehicleID: id)
        let cost = try? await dataSource.loadCostBreakdown(vehicleID: id)
        let monthly = await (try? dataSource.loadMonthlyMileage(vehicleID: id)) ?? []
        self[keyPath: keyPath].stats = stats
        self[keyPath: keyPath].cost = cost
        self[keyPath: keyPath].monthly = monthly
        self[keyPath: keyPath].isLoadingStats = false
    }

    // MARK: Banner

    /// Dismisses the disambiguation banner and persists the dismissal (web `dismissBanner`).
    public func dismissBanner() {
        bannerVisible = false
        onDismissBanner?()
    }

    // MARK: Derived — table (web `comparisonRows`)

    /// Whether the lifetime comparison table is still loading either side's stats (web
    /// `statsLoading = dStatsLoadA || dStatsLoadB`).
    public var statsLoading: Bool {
        sideA.isLoadingStats || sideB.isLoadingStats
    }

    /// The ten comparison rows with raw SI values for both sides (web `comparisonRows`).
    public var comparisonRows: [FleetCompareRow] {
        FleetCompareMetric.allCases.map { metric in
            FleetCompareRow(metric: metric, rawA: rawValue(metric, sideA), rawB: rawValue(metric, sideB))
        }
    }

    private func rawValue(_ metric: FleetCompareMetric, _ side: FleetCompareSide) -> Double {
        switch metric {
        case .totalDrives: Double(side.stats?.totalDrives ?? 0)
        case .totalDistance: side.stats?.totalDistanceM ?? 0
        case .avgEfficiency: side.stats?.avgEfficiencyWhKm ?? 0
        case .avgSpeed: side.stats?.avgSpeedMps ?? 0
        case .topSpeed: side.stats?.topSpeedMps ?? 0
        case .regenRatio: side.stats?.regenRatio ?? 0
        case .co2Saved: side.stats?.co2SavedKg ?? 0
        case .chargingCost: side.cost?.totalChargingCost ?? 0
        case .totalEnergy: side.cost?.totalWh ?? 0
        case .chargeSessions: Double(side.cost?.totalSessions ?? 0)
        }
    }

    // MARK: Derived — charts (web `monthlyChartData` / `drivesChartData`)

    /// Merged, month-aligned series across both vehicles, sorted ascending by month (web
    /// `monthlyChartData`). Drives the line chart (distance) and bar chart (drives).
    public var monthlyChartData: [FleetCompareMonthlyPoint] {
        var byMonth: [String: FleetCompareMonthlyPoint] = [:]
        for bucket in sideA.monthly {
            byMonth[bucket.yearMonth] = FleetCompareMonthlyPoint(
                month: bucket.yearMonth,
                distanceAM: bucket.distanceM,
                distanceBM: 0,
                drivesA: bucket.driveCount,
                drivesB: 0
            )
        }
        for bucket in sideB.monthly {
            if let existing = byMonth[bucket.yearMonth] {
                byMonth[bucket.yearMonth] = FleetCompareMonthlyPoint(
                    month: existing.month,
                    distanceAM: existing.distanceAM,
                    distanceBM: bucket.distanceM,
                    drivesA: existing.drivesA,
                    drivesB: bucket.driveCount
                )
            } else {
                byMonth[bucket.yearMonth] = FleetCompareMonthlyPoint(
                    month: bucket.yearMonth,
                    distanceAM: 0,
                    distanceBM: bucket.distanceM,
                    drivesA: 0,
                    drivesB: bucket.driveCount
                )
            }
        }
        return byMonth.values.sorted { $0.month < $1.month }
    }
}
