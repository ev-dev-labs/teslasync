import Foundation
import Observation

// MARK: - Data source seam (web hooks: useSelectedVehicle / useCostBreakdown)

/// Supplies every datum the page renders. The production implementation binds the shared KMP
/// repositories/use-cases (ADR-004 — the view holds no networking); previews and tests inject
/// doubles to drive the loading / empty / error / success states. Mirrors the
/// `StatisticsDataSource` / `FleetCompareDataSource` seams used by the sibling analytics pages.
///
/// Method ↔ web hook map (names kept at the Swift call sites per the parity manifest):
/// `loadVehicles` ← `useSelectedVehicle`/`GET /vehicles`; `loadCostBreakdown` ← `useCostBreakdown`
/// (`GET /analytics/tco?vehicle_id`).
public protocol TrueCostDataSource: Sendable {
    func loadVehicles() async throws -> [TrueCostVehicle]
    func loadCostBreakdown(vehicleID: Int64) async throws -> CostBreakdown?
}

// MARK: - Page phase (web `PageContainer` loading/error + `tco ? content : !isLoading ? empty`)

/// The page's terminal phase, driven by the cost-breakdown source (web `tcoQuery`). `.empty` is a
/// successful load that yielded no breakdown (web `!tco && !isLoading` → no-data EmptyState);
/// `.error` is a retryable failure (web `PageContainer error` region); `.ready` carries the
/// breakdown (web `tco ?` content).
public enum TrueCostPhase: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case ready
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the view). Owns the
/// vehicle list + selection (web `useSelectedVehicle` / `VehicleSelect`), the cost breakdown
/// driving the page phase (web `useCostBreakdown`), and the display preferences the web reads from
/// settings (`gas_unit`, `currency_symbol`). Reads everything through the injected
/// `TrueCostDataSource`.
@MainActor
@Observable
public final class TrueCostPageModel {
    public private(set) var phase: TrueCostPhase = .loading

    /// Whether a background refetch is in flight while content is already shown (web
    /// `isFetching && !isLoading`).
    public private(set) var isRefreshing = false

    public private(set) var vehicles: [TrueCostVehicle] = []
    public private(set) var selectedVehicleID: Int64?
    public private(set) var breakdown: CostBreakdown?

    /// Web `settings.gas_unit ?? 'gallon'` — drives the equivalent-gas-cost card's `…/{unit}` label.
    public let gasUnit: TrueCostGasUnit

    /// Web `settings.currency_symbol` (default `'$'`) — the prefix `formatCurrency` applies.
    public let currencySymbol: String

    @ObservationIgnored private let dataSource: any TrueCostDataSource

    public init(
        dataSource: any TrueCostDataSource = SampleTrueCostDataSource(),
        gasUnit: TrueCostGasUnit = .gallon,
        currencySymbol: String = "$"
    ) {
        self.dataSource = dataSource
        self.gasUnit = gasUnit
        self.currencySymbol = currencySymbol
    }

    // MARK: Selection

    public var selectedVehicle: TrueCostVehicle? {
        selectedVehicleID.flatMap { id in vehicles.first { $0.id == id } }
    }

    /// Web `tco.monthly_breakdown ?? []` — the monthly series the charts iterate.
    public var monthlyBreakdown: [MonthlyCostEntry] {
        breakdown?.monthlyBreakdown ?? []
    }

    /// Web `monthlyBreakdown.length > 0` — whether the cumulative + monthly charts render their data
    /// (vs. each chart's own `tco.noMonthlyData` empty state).
    public var hasMonthlyData: Bool {
        !monthlyBreakdown.isEmpty
    }

    // MARK: Loading

    /// Loads the vehicle list, then the selected vehicle's cost breakdown (web `useVehicles` +
    /// `useCostBreakdown`). Resolves the page phase from the breakdown source.
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

    /// Selects a vehicle (web `VehicleSelect` → `setVehicleId`) and reloads its cost breakdown.
    public func selectVehicle(_ id: Int64) async {
        guard id != selectedVehicleID, vehicles.contains(where: { $0.id == id }) else { return }
        selectedVehicleID = id
        phase = .loading
        await loadSelectedVehicle()
    }

    private func loadSelectedVehicle() async {
        guard let id = selectedVehicleID else {
            breakdown = nil
            phase = .empty
            return
        }

        // The cost-breakdown source (web `tcoQuery`) resolves the page phase: throw → error region,
        // nil → no-data empty, value → ready (web `tco ?` content).
        do {
            let result = try await dataSource.loadCostBreakdown(vehicleID: id)
            breakdown = result
            phase = result == nil ? .empty : .ready
        } catch {
            breakdown = nil
            phase = .error(error.localizedDescription)
        }
    }
}
