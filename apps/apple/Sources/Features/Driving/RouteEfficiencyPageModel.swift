import Foundation
import Observation

// MARK: - Vehicle (web `useSelectedVehicle` → `GET /vehicles`)

/// One selectable vehicle (web `vehicle.display_name || vehicle.vin`). Identity + label strings,
/// not SI measurements, so they round-trip verbatim.
public struct RouteEfficiencyVehicle: Identifiable, Hashable, Sendable {
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

// MARK: - Route (web `RouteSummary`)

/// One aggregated route the analytics endpoint returns (web `RouteSummary`): the start/end places,
/// the trip count, the mean per-trip distance (kilometers, as the analytics endpoint reports), and
/// the average / best / worst consumption (`Wh/km`). Efficiency + distance convert to the user's
/// unit at the display boundary (`RouteEfficiencyFormat`), never here.
public struct RouteEfficiencyRoute: Identifiable, Hashable, Sendable {
    public let startLocation: String
    public let endLocation: String
    public let tripCount: Int
    public let avgDistanceKm: Double
    public let avgEfficiency: Double
    public let bestEfficiency: Double
    public let worstEfficiency: Double

    public init(
        startLocation: String,
        endLocation: String,
        tripCount: Int,
        avgDistanceKm: Double,
        avgEfficiency: Double,
        bestEfficiency: Double,
        worstEfficiency: Double
    ) {
        self.startLocation = startLocation
        self.endLocation = endLocation
        self.tripCount = tripCount
        self.avgDistanceKm = avgDistanceKm
        self.avgEfficiency = avgEfficiency
        self.bestEfficiency = bestEfficiency
        self.worstEfficiency = worstEfficiency
    }

    /// Stable identity (web `key={`${route.startLocation}-${route.endLocation}`}`).
    public var id: String {
        "\(startLocation)→\(endLocation)"
    }

    /// Web per-trip mean distance in SI meters (`route.avgDistanceKm * 1000`), converted at display.
    public var avgDistanceM: Double {
        avgDistanceKm * 1000
    }
}

// MARK: - Data source seam (web hooks: useSelectedVehicle / useRouteEfficiency)

/// Supplies every datum the page renders. The production implementation binds the shared KMP
/// repositories/use-cases (ADR-004 — the view holds no networking); previews and tests inject
/// doubles to drive the loading / empty / error / success states.
///
/// Method ↔ web hook map (names kept at the Swift call sites per the parity manifest):
/// `loadVehicles` ← `useSelectedVehicle`/`GET /vehicles`;
/// `useRouteEfficiency` ← `GET /analytics/route-efficiency?vehicle_id&start&end`.
public protocol RouteEfficiencyDataSource: Sendable {
    func loadVehicles() async throws -> [RouteEfficiencyVehicle]
    func useRouteEfficiency(vehicleID: Int64, start: Date, end: Date) async throws -> [RouteEfficiencyRoute]
}

// MARK: - Page phase (web `isLoading ? Skeleton : error ? Error : routes.length ? content : EmptyState`)

/// The page's terminal phase. `.empty` is a successful load whose date-filtered route set is empty
/// (web `routes.length === 0` — the summary reads zeros and the metrics panel shows the `common.noData`
/// `EmptyState`); `.error` is a retryable load failure (web `PageContainer error` region); `.ready`
/// carries routes.
public enum RouteEfficiencyPhase: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case ready
}

// MARK: - Top routes plotted (web `.slice(0, 10)`)

private let maxChartRoutes = 10

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the view). Owns the
/// vehicle list + selection (web `useSelectedVehicle`), the date-range filter (web `RangePicker`), and
/// the route-efficiency result (web `useRouteEfficiency`), and derives every panel/chart value (web
/// `useMemo` blocks). Reads everything through the injected `RouteEfficiencyDataSource`.
@MainActor
@Observable
public final class RouteEfficiencyPageModel {
    /// The load state (web TanStack `isLoading` / `error` / success for `useRouteEfficiency`).
    public enum LoadState: Equatable, Sendable {
        case loading
        case loaded
        case failed(String)
    }

    public private(set) var loadState: LoadState = .loading

    /// Whether a background refetch is in flight while content is already shown (web
    /// `isFetching && !isLoading`).
    public private(set) var isRefreshing = false

    public private(set) var vehicles: [RouteEfficiencyVehicle] = []
    public private(set) var selectedVehicleID: Int64?

    /// Web `useRouteEfficiency` result — the routes for the selected vehicle + window.
    public private(set) var routes: [RouteEfficiencyRoute] = []

    // Date filter (web `startDate` / `endDate`, default last 30 days).
    public private(set) var startDate: Date
    public private(set) var endDate: Date

    @ObservationIgnored private let dataSource: any RouteEfficiencyDataSource
    @ObservationIgnored private let referenceDate: Date?

    public init(
        dataSource: any RouteEfficiencyDataSource = SampleRouteEfficiencyDataSource(),
        referenceDate: Date? = nil
    ) {
        self.dataSource = dataSource
        self.referenceDate = referenceDate
        let clock = referenceDate ?? Date()
        endDate = clock
        startDate = Calendar.current.date(byAdding: .day, value: -30, to: clock) ?? clock
    }

    // MARK: Phase

    /// The displayed phase (web `PageContainer` phases): loading/error from the source, then empty
    /// when the route set is empty (web `routes.length === 0`), else ready.
    public var phase: RouteEfficiencyPhase {
        switch loadState {
        case .loading: .loading
        case let .failed(message): .error(message)
        case .loaded: routes.isEmpty ? .empty : .ready
        }
    }

    // MARK: Selection

    public var selectedVehicle: RouteEfficiencyVehicle? {
        selectedVehicleID.flatMap { id in vehicles.first { $0.id == id } }
    }

    // MARK: Loading

    /// Loads the vehicle list, then the selected vehicle's route efficiency (web `useSelectedVehicle`
    /// + `useRouteEfficiency`).
    public func load() async {
        loadState = .loading
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

    /// Selects a vehicle (web global `VehicleSelect`) and reloads its routes (web
    /// `useRouteEfficiency` keyed on `vehicleId`).
    public func selectVehicle(_ id: Int64) async {
        guard id != selectedVehicleID, vehicles.contains(where: { $0.id == id }) else { return }
        selectedVehicleID = id
        loadState = .loading
        await loadSelectedVehicle()
    }

    private func loadSelectedVehicle() async {
        guard let id = selectedVehicleID else {
            routes = []
            loadState = .loaded
            return
        }
        do {
            routes = try await dataSource.useRouteEfficiency(vehicleID: id, start: startDate, end: endDate)
            loadState = .loaded
        } catch {
            routes = []
            loadState = .failed(error.localizedDescription)
        }
    }

    // MARK: Filters (web `RangePicker.onChange` → `setRangeBatch`)

    /// Applies a new date range and reloads (web `RangePicker.onChange` updates the URL window, which
    /// re-keys `useRouteEfficiency`).
    public func setDateRange(start: Date, end: Date) async {
        startDate = start
        endDate = end
        loadState = .loading
        await loadSelectedVehicle()
    }

    // MARK: Derivations (web useMemo blocks)

    /// Web `totalTrips = routes.reduce((s, r) => s + r.tripCount, 0)`.
    public var totalTrips: Int {
        routes.reduce(0) { $0 + $1.tripCount }
    }

    /// Web `bestEff = routes.length ? Math.min(...bestEfficiency) : 0` (lower Wh/km is better).
    public var bestEfficiency: Double {
        routes.map(\.bestEfficiency).min() ?? 0
    }

    /// Web `worstEff = routes.length ? Math.max(...worstEfficiency) : 0`.
    public var worstEfficiency: Double {
        routes.map(\.worstEfficiency).max() ?? 0
    }

    /// Web `avgEff = routes.length ? mean(avgEfficiency) : 0`.
    public var averageEfficiency: Double {
        guard !routes.isEmpty else { return 0 }
        return routes.reduce(0.0) { $0 + $1.avgEfficiency } / Double(routes.count)
    }

    /// Web `routes[0]?.tripCount ?? 0` — the most-driven route's trip count (Most Driven metric bar).
    public var mostDrivenTripCount: Int {
        routes.first?.tripCount ?? 0
    }

    /// Web `chartData`: routes sorted by `avgEfficiency` ascending, capped at the first ten — the set
    /// plotted in the comparison chart (and the threshold for showing it, web `chartData.length > 1`).
    public var comparisonRoutes: [RouteEfficiencyRoute] {
        Array(routes.sorted { $0.avgEfficiency < $1.avgEfficiency }.prefix(maxChartRoutes))
    }
}
