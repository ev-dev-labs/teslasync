import Foundation
import Observation

// MARK: - Data source seam (web hooks: useVehicles + the `/analytics/period-stats` query)

/// Supplies every datum the page renders. The production implementation binds the shared KMP
/// repositories/use-cases (ADR-004 — the view holds no networking); previews and tests inject
/// doubles to drive the loading / empty / error / success states. Mirrors the
/// `FleetCompareDataSource` seam used by the sibling comparison page.
public protocol PeriodCompareDataSource: Sendable {
    /// Web `useVehicles` → `GET /vehicles`.
    func loadVehicles() async throws -> [PeriodCompareVehicle]
    /// Web `request('/analytics/period-stats?vehicle_id=…&days=…')`. `nil` ⇒ no data for the
    /// window (web `query.data === undefined` → the empty state).
    func loadPeriodStats(vehicleID: Int64, days: Int) async throws -> PeriodStats?
}

// MARK: - Page state (web PageContainer phases + the `!a || !b` empty branch)

/// The page's terminal content state. `.loading` / `.error` replace the whole body (web
/// `PageContainer` `loading` / `error` props); `.empty` and `.ready` both keep the banner +
/// selectors visible and differ only in the body (web renders the selectors above the `!a || !b`
/// switch). `.empty` is a successful-but-incomplete load (no vehicle selected or a missing period
/// stat → web EmptyState); `.error` is a retryable period-stats failure.
public enum PeriodCompareViewState: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case ready
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the view). Owns
/// the vehicle list, the selected vehicle + A/B period windows, both periods' stats, and the
/// disambiguation banner; derives the converted metric values, comparison rows, and insight lines
/// at the display boundary. Reads everything through the injected `PeriodCompareDataSource`.
@MainActor
@Observable
public final class PeriodComparePageModel {
    public private(set) var viewState: PeriodCompareViewState = .loading

    /// Whether a pull-to-refresh refetch is in flight (web `isFetching && !isLoading`).
    public private(set) var isRefreshing = false

    public private(set) var vehicles: [PeriodCompareVehicle] = []

    /// The selected vehicle (web `activeVehicle`, defaulting to the first vehicle).
    public private(set) var vehicleId: Int64?

    /// Period A window (web `periodA`, default '30').
    public private(set) var periodA: PeriodCompareWindow

    /// Period B window (web `periodB`, default '90').
    public private(set) var periodB: PeriodCompareWindow

    public private(set) var statsA: PeriodStats?
    public private(set) var statsB: PeriodStats?

    /// Disambiguation banner visibility (web `bannerVisible`, persisted dismissal).
    public var bannerVisible: Bool

    @ObservationIgnored private let dataSource: any PeriodCompareDataSource
    @ObservationIgnored private let onDismissBanner: (() -> Void)?

    public init(
        dataSource: any PeriodCompareDataSource = SamplePeriodCompareDataSource(),
        periodA: PeriodCompareWindow = .last30,
        periodB: PeriodCompareWindow = .last90,
        bannerVisible: Bool = true,
        onDismissBanner: (() -> Void)? = nil
    ) {
        self.dataSource = dataSource
        self.periodA = periodA
        self.periodB = periodB
        self.bannerVisible = bannerVisible
        self.onDismissBanner = onDismissBanner
    }

    // MARK: Selection

    /// The resolved selected vehicle (web `vehicles.find(activeVehicle)`).
    public var activeVehicle: PeriodCompareVehicle? {
        vehicleId.flatMap { id in vehicles.first { $0.id == id } }
    }

    // MARK: Loading

    /// Loads the vehicle list, resolves the active vehicle, then loads both periods' stats
    /// (web `useVehicles` + the two enabled `period-stats` queries).
    public func load() async {
        viewState = .loading
        await fetchVehicles()
        await reloadStats()
    }

    /// Re-runs the load while keeping current content visible (web refetch).
    public func refresh() async {
        isRefreshing = true
        await fetchVehicles()
        await reloadStats()
        isRefreshing = false
    }

    /// Selects a vehicle (web `setVehicleId`) and reloads both periods.
    public func selectVehicle(_ id: Int64) async {
        guard id != vehicleId else { return }
        vehicleId = id
        await reloadStats()
    }

    /// Selects Period A's window (web `setPeriodA`) and reloads it.
    public func selectPeriodA(_ window: PeriodCompareWindow) async {
        guard window != periodA else { return }
        periodA = window
        await reloadStats()
    }

    /// Selects Period B's window (web `setPeriodB`) and reloads it.
    public func selectPeriodB(_ window: PeriodCompareWindow) async {
        guard window != periodB else { return }
        periodB = window
        await reloadStats()
    }

    private func fetchVehicles() async {
        // Web `useVehicles` error is NOT surfaced to PageContainer — a vehicle-list failure
        // degrades to an empty selector (activeVehicle = '' → the empty state), never the error
        // state, which is reserved for period-stats failures.
        let loaded = await (try? dataSource.loadVehicles()) ?? []
        vehicles = loaded
        if vehicleId == nil || !loaded.contains(where: { $0.id == vehicleId }) {
            vehicleId = loaded.first?.id
        }
        // Web hides the disambiguation banner for single-vehicle accounts (they can't usefully
        // cross-navigate to the fleet comparison anyway).
        if loaded.count < 2 {
            bannerVisible = false
        }
    }

    private func reloadStats() async {
        guard let id = vehicleId else {
            statsA = nil
            statsB = nil
            viewState = .empty
            return
        }
        viewState = .loading
        do {
            let loadedA = try await dataSource.loadPeriodStats(vehicleID: id, days: periodA.days)
            let loadedB = try await dataSource.loadPeriodStats(vehicleID: id, days: periodB.days)
            statsA = loadedA
            statsB = loadedB
            viewState = (loadedA == nil || loadedB == nil) ? .empty : .ready
        } catch {
            viewState = .error(error.localizedDescription)
        }
    }

    // MARK: Banner

    /// Dismisses the disambiguation banner and persists the dismissal (web `dismissBanner`).
    public func dismissBanner() {
        bannerVisible = false
        onDismissBanner?()
    }

    // MARK: Derived (web `metrics` / `insights`)

    /// Both periods' stats once present, else `nil` (web `!a || !b` guard).
    public var bothStats: (statsA: PeriodStats, statsB: PeriodStats)? {
        guard let statsA, let statsB else { return nil }
        return (statsA, statsB)
    }

    /// The six display-converted metric values (web `metrics`), or empty when either period's
    /// stats are missing. Conversion happens at this display boundary via the user's preference.
    public func metricValues(_ prefs: UnitPreferences) -> [PeriodCompareMetricValue] {
        guard let both = bothStats else { return [] }
        return PeriodCompareFormat.metricValues(both.statsA, both.statsB, prefs)
    }

    /// The three insight lines (web `insights`), or empty when either period's stats are missing.
    public var insights: [String] {
        guard let both = bothStats else { return [] }
        return PeriodCompareFormat.insights(both.statsA, both.statsB)
    }
}
