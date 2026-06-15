import Foundation
import Observation

// MARK: - Data source seam (web hooks: useSelectedVehicle / useMileageStats / useDailyMileage /

// useMonthlyMileage)

/// Supplies every datum the page renders. The production implementation binds the shared KMP
/// repositories/use-cases (ADR-004 — the view holds no networking); previews and tests inject
/// doubles to drive the loading / empty / error / success states. Mirrors the
/// `StatisticsDataSource` seam used by the sibling analytics page.
///
/// Method ↔ web hook map (names kept at the Swift call sites per the parity manifest):
/// `loadVehicles` ← `useSelectedVehicle`/`GET /vehicles`; `loadMileageStats` ← `useMileageStats`;
/// `loadDailyMileage` ← `useDailyMileage`; `loadMonthlyMileage` ← `useMonthlyMileage`.
public protocol MileageDataSource: Sendable {
    func loadVehicles() async throws -> [MileagePageVehicle]
    func loadMileageStats(vehicleID: Int64) async throws -> MileageStats?
    func loadDailyMileage(vehicleID: Int64, days: Int) async throws -> [MileageDailyPoint]
    func loadMonthlyMileage(vehicleID: Int64) async throws -> [MileageMonthPoint]
}

// MARK: - Page phase (web `isLoading ? loading : !stats ? empty : content`, + error)

/// The page's terminal phase, driven by the primary mileage-stats source (web `statsQuery`).
/// `.empty` is a successful load that yielded no stats (web `!stats`); `.error` is a retryable
/// failure of the primary source; `.ready` carries stats.
public enum MileagePhase: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case ready
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the view). Owns the
/// vehicle list + selection, the primary stats (driving the page phase), the daily + monthly
/// buckets, and derives the odometer series (web `odometerData`, days with a non-null odometer).
/// Reads everything through the injected `MileageDataSource`. The daily / monthly sources are
/// secondary: their failures degrade to empty + raise `hasSecondaryError` (web `anyError` banner),
/// never the page error.
@MainActor
@Observable
public final class MileagePageModel {
    public private(set) var phase: MileagePhase = .loading

    /// Whether a background refetch is in flight while content is already shown (web
    /// `isFetching && !isLoading`).
    public private(set) var isRefreshing = false

    public private(set) var vehicles: [MileagePageVehicle] = []
    public private(set) var selectedVehicleID: Int64?

    public private(set) var stats: MileageStats?
    public private(set) var dailyPoints: [MileageDailyPoint] = []
    public private(set) var monthlyPoints: [MileageMonthPoint] = []

    /// A daily or monthly source failed while the primary stats succeeded (web `anyError` →
    /// `AlertBanner`, shown above content that still renders).
    public private(set) var hasSecondaryError = false

    /// Web `useDailyMileage(activeId, 90)` — the daily window the page requests.
    public static let dailyWindowDays = 90

    @ObservationIgnored private let dataSource: any MileageDataSource

    public init(dataSource: any MileageDataSource = SampleMileageDataSource()) {
        self.dataSource = dataSource
    }

    // MARK: Selection

    public var selectedVehicle: MileagePageVehicle? {
        selectedVehicleID.flatMap { id in vehicles.first { $0.id == id } }
    }

    // MARK: Loading

    /// Loads the vehicle list then the selected vehicle's mileage (web `useVehicles` + per-vehicle
    /// queries). Resolves the page phase from the primary stats source.
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

    /// Selects a vehicle (web header `VehicleSelect`) and reloads its per-vehicle mileage.
    public func selectVehicle(_ id: Int64) async {
        guard id != selectedVehicleID, vehicles.contains(where: { $0.id == id }) else { return }
        selectedVehicleID = id
        phase = .loading
        await loadSelectedVehicle()
    }

    private func loadSelectedVehicle() async {
        guard let id = selectedVehicleID else {
            stats = nil
            dailyPoints = []
            monthlyPoints = []
            hasSecondaryError = false
            phase = .empty
            return
        }

        // The primary source (web `statsQuery`) resolves the page phase: throw → error region,
        // nil → no-data empty, value → ready.
        do {
            let loaded = try await dataSource.loadMileageStats(vehicleID: id)
            stats = loaded
            phase = loaded == nil ? .empty : .ready
        } catch {
            stats = nil
            phase = .error(error.localizedDescription)
        }

        // Secondary sources degrade to empty on failure; a failure raises the web `anyError` banner
        // (`statsError || dailyError || monthlyError`) while each section shows its own empty state.
        var secondaryFailed = false
        if let daily = try? await dataSource.loadDailyMileage(vehicleID: id, days: Self.dailyWindowDays) {
            dailyPoints = daily.sorted { $0.date < $1.date }
        } else {
            dailyPoints = []
            secondaryFailed = true
        }
        if let monthly = try? await dataSource.loadMonthlyMileage(vehicleID: id) {
            monthlyPoints = monthly
        } else {
            monthlyPoints = []
            secondaryFailed = true
        }
        hasSecondaryError = secondaryFailed
    }

    // MARK: Derived — odometer series (web `odometerData`)

    /// The odometer-over-time points (web `odometerData`): the daily buckets that carry a non-null
    /// end-of-day odometer reading, in chronological order. Empty when no day has an odometer value.
    public var odometerPoints: [MileageDailyPoint] {
        dailyPoints.filter { $0.endOdometerM != nil }
    }

    /// Whether the daily distance series has any data (web `dailyData.length > 0`).
    public var hasDailyData: Bool {
        !dailyPoints.isEmpty
    }
}
