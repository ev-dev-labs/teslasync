import Foundation
import Observation

// MARK: - Page phase (web `loading ? … : items error ? … : items empty ? … : content`)

/// The page's terminal phase, driven by the primary maintenance-items source (web `itemsQuery`).
/// `.empty` is a successful load that yielded no items AND no records (web's "No maintenance items");
/// `.error` is a retryable failure of the primary source; `.ready` carries content.
public enum MaintenancePhase: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case ready
}

// MARK: - Page model (ADR-004 — no networking in the view)

/// The `@Observable` state holder the page binds to. Owns the vehicle list + selection, the
/// maintenance items (the primary source driving the page phase) and the service records (secondary),
/// the category-filter + sort UI state, and derives the summary / filtered list / cost stats /
/// service projections exactly as the web page does. Reads everything through the injected
/// `MaintenanceDataSource`. A records failure degrades to empty + raises `hasSecondaryError` (web
/// `anyError` banner), never the page error.
@MainActor
@Observable
public final class MaintenancePageModel {
    public private(set) var phase: MaintenancePhase = .loading

    /// Background refetch while content is already shown (web `isFetching && !isLoading`).
    public private(set) var isRefreshing = false

    public private(set) var vehicles: [MaintenanceVehicle] = []
    public private(set) var selectedVehicleID: Int64?

    public private(set) var items: [MaintenanceItem] = []
    public private(set) var records: [ServiceRecord] = []

    /// The service-records (secondary) source failed while items succeeded (web `anyError` banner).
    public private(set) var hasSecondaryError = false

    /// Web filter + sort UI state (`categoryFilter` default "all", `sortBy` default "status").
    public var categoryFilter: String = MaintenancePageModel.allCategories
    public var sortKey: MaintenanceSortKey = .status

    /// The currency symbol applied at the cost display boundary (web `useFormatting().formatCurrency`).
    public let currencySymbol: String

    /// Sentinel for the "all categories" filter option (web `'all'`).
    public static let allCategories = "all"

    @ObservationIgnored private let dataSource: any MaintenanceDataSource

    public init(
        dataSource: any MaintenanceDataSource = SampleMaintenanceDataSource(),
        currencySymbol: String = "$"
    ) {
        self.dataSource = dataSource
        self.currencySymbol = currencySymbol
    }

    // MARK: Selection

    public var selectedVehicle: MaintenanceVehicle? {
        selectedVehicleID.flatMap { id in vehicles.first { $0.id == id } }
    }

    // MARK: Loading

    /// Loads the vehicle list then the selected vehicle's items + records, resolving the page phase
    /// from the primary items source.
    public func load() async {
        phase = .loading
        await fetchAll()
    }

    /// Re-runs the load while keeping current content visible (web refetch / pull-to-refresh).
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

    /// Selects a vehicle (web header `VehicleSelect`) and reloads its maintenance data.
    public func selectVehicle(_ id: Int64) async {
        guard id != selectedVehicleID, vehicles.contains(where: { $0.id == id }) else { return }
        selectedVehicleID = id
        phase = .loading
        await loadSelectedVehicle()
    }

    private func loadSelectedVehicle() async {
        guard let id = selectedVehicleID else {
            items = []
            records = []
            hasSecondaryError = false
            phase = .empty
            return
        }

        // Primary source (web items query) resolves the phase: throw → error region.
        do {
            items = try await dataSource.loadItems(vehicleID: id)
        } catch {
            items = []
            records = []
            hasSecondaryError = false
            phase = .error(error.localizedDescription)
            return
        }

        // Secondary records source degrades to empty on failure → raises the web `anyError` banner.
        if let loaded = try? await dataSource.loadRecords(vehicleID: id) {
            records = loaded
            hasSecondaryError = false
        } else {
            records = []
            hasSecondaryError = true
        }

        // Empty only when there is genuinely nothing to show; otherwise render every section.
        phase = items.isEmpty && records.isEmpty ? .empty : .ready
    }
}

// MARK: - Derived view-data (web `categories` / `filteredItems` / `summary` / `costStats` / `projections`)

public extension MaintenancePageModel {
    /// Web `categories` — the unique item categories, sorted (drives the filter options).
    var categories: [String] {
        Array(Set(items.map(\.category))).sorted()
    }

    /// Web `filteredItems` — items filtered by the active category then sorted by the active key.
    var filteredItems: [MaintenanceItem] {
        let base = categoryFilter == Self.allCategories
            ? items
            : items.filter { $0.category == categoryFilter }
        return base.sorted(by: Self.makeComparator(sortKey))
    }

    /// Web `summary` reduce over the raw item statuses (Total / Due-Soon / Overdue / Completed).
    var summary: MaintenanceSummary {
        var result = MaintenanceSummary()
        for item in items {
            result.total += 1
            switch item.status {
            case .soon: result.soon += 1
            case .overdue: result.overdue += 1
            case .completed: result.completed += 1
            case .good: break
            }
        }
        return result
    }

    /// Web `costStats` — nil when no records, else total / annualized / per-service-average cost.
    var costStats: MaintenanceCostStats? {
        guard !records.isEmpty else { return nil }
        let totalCost = records.reduce(0) { $0 + $1.cost }
        let times = records.map(\.date.timeIntervalSince1970)
        let perService = totalCost / Double(records.count)
        guard let earliest = times.min(), let latest = times.max(), records.count >= 2 else {
            return MaintenanceCostStats(totalCost: totalCost, annualCost: totalCost, avgPerService: perService)
        }
        let secondsPerYear = 365.25 * 24 * 3600
        let spanYears = max((latest - earliest) / secondsPerYear, 0.1)
        return MaintenanceCostStats(
            totalCost: totalCost,
            annualCost: totalCost / spanYears,
            avgPerService: perService
        )
    }

    /// Web `projections` — the upcoming (non-completed, interval-bearing) services, overdue first then
    /// by miles-remaining ascending, capped at 8.
    var projections: [MaintenanceServiceProjection] {
        items
            .filter { $0.status != .completed && ($0.intervalMiles != nil || $0.intervalMonths != nil) }
            .map { item in
                let remaining = item.dueMileage.map { max($0 - item.currentMileage, 0) }
                return MaintenanceServiceProjection(
                    id: item.id,
                    name: item.name,
                    category: item.category,
                    milesRemaining: remaining,
                    dueDate: item.dueDate,
                    status: item.status
                )
            }
            .sorted(by: Self.projectionOrder)
            .prefix(8)
            .map(\.self)
    }

    private static func makeComparator(
        _ key: MaintenanceSortKey
    ) -> (MaintenanceItem, MaintenanceItem) -> Bool {
        switch key {
        case .status:
            { $0.status.sortOrder < $1.status.sortOrder }
        case .name:
            { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        case .dueDate:
            { ($0.dueDate ?? .distantFuture) < ($1.dueDate ?? .distantFuture) }
        case .category:
            { $0.category.localizedCaseInsensitiveCompare($1.category) == .orderedAscending }
        }
    }

    private static func projectionOrder(
        _ lhs: MaintenanceServiceProjection,
        _ rhs: MaintenanceServiceProjection
    ) -> Bool {
        if lhs.status == .overdue, rhs.status != .overdue { return true }
        if rhs.status == .overdue, lhs.status != .overdue { return false }
        return (lhs.milesRemaining ?? .greatestFiniteMagnitude) < (rhs.milesRemaining ?? .greatestFiniteMagnitude)
    }
}
