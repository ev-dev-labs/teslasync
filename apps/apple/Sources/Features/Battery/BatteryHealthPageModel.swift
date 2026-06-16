import Foundation
import Observation

// MARK: - Data source seam (web `useSelectedVehicle` + the four `useQuery`s)

/// Supplies every datum the Battery Health page renders. The production implementation
/// binds the shared KMP repositories/use-cases (ADR-004 — the view holds no networking);
/// previews and tests inject doubles to drive the loading / empty / error / success
/// states. Mirrors the sibling Battery `*DataSource` seams.
///
/// Method ↔ web map: `loadVehicles` ← `useSelectedVehicle` / `GET /vehicles`;
/// `loadAnalytics` ← `useBatteryHealthAnalytics` → `GET /analytics/battery-health`;
/// `loadPrediction` ← `useBatteryDegradation` → `GET /analytics/battery-degradation`;
/// `loadSessions` ← `useChargingSessionsPaginated`;
/// `loadLive` ← `useChargingTelemetryLatest` → `GET /charging-telemetry/latest`.
public protocol BatteryHealthDataSource: Sendable {
    func loadVehicles() async throws -> [BatteryVehicle]
    func loadAnalytics(vehicleID: Int64) async throws -> BatteryHealthAnalytics?
    func loadPrediction(vehicleID: Int64) async throws -> BatteryHealthPrediction?
    func loadSessions(vehicleID: Int64) async throws -> [BatteryHealthChargingSession]
    func loadLive(vehicleID: Int64) async throws -> BatteryHealthLive?
}

// MARK: - Page phase (web `isLoading ? Skeleton : !data ? empty : body`, error on top)

/// The page's terminal phase, driven by the primary analytics source (web `healthQuery`).
/// `.empty` is a successful load that yielded no data (web `!health`); `.error` is a
/// retryable failure (web `PageContainer error`); `.ready` carries the analytics snapshot.
/// The prediction / sessions / live sources are independent (web separate queries): they
/// only populate their sections and never set `.error`.
public enum BatteryHealthPhase: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case ready
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the view).
/// Owns the vehicle list + selection (web header `VehicleSelect` / `useSelectedVehicle`),
/// the per-vehicle analytics snapshot (web `health`, which drives the phase), and the
/// optional prediction / sessions / live telemetry. Every panel / chart reads its derived
/// data from the bound state (the web `useMemo`s, now pure model derivations).
@MainActor
@Observable
public final class BatteryHealthPageModel {
    public private(set) var phase: BatteryHealthPhase = .loading

    /// Whether a background refetch is in flight while content is already shown
    /// (web `isFetching && !isLoading`).
    public private(set) var isRefreshing = false

    public private(set) var vehicles: [BatteryVehicle] = []
    public private(set) var selectedVehicleID: Int64?

    public private(set) var analytics: BatteryHealthAnalytics?
    public private(set) var prediction: BatteryHealthPrediction?
    public private(set) var sessions: [BatteryHealthChargingSession] = []
    public private(set) var live: BatteryHealthLive?

    @ObservationIgnored private let dataSource: any BatteryHealthDataSource

    public init(dataSource: any BatteryHealthDataSource = SampleBatteryHealthDataSource()) {
        self.dataSource = dataSource
    }

    // MARK: Selection

    public var selectedVehicle: BatteryVehicle? {
        selectedVehicleID.flatMap { id in vehicles.first { $0.id == id } }
    }

    // MARK: Derived (web `useMemo`s — prefs-free; insights need prefs so they live in the view)

    /// Web `predictionChartData` — actual history joined to the trustworthy projection.
    public var trendRows: [BatteryHealthTrendRow] {
        guard let analytics else { return [] }
        return BatteryHealthDerivations.trendRows(analytics: analytics, prediction: prediction)
    }

    /// Web `rangeTrend` — per-snapshot SI-kilometre range rows (empty if all zero).
    public var rangeRows: [BatteryHealthRangeRow] {
        guard let analytics else { return [] }
        return BatteryHealthDerivations.rangeRows(analytics: analytics)
    }

    /// Web `chargeLevelDist` — ten start/end SOC buckets.
    public var chargeBuckets: [BatteryHealthChargeBucket] {
        BatteryHealthDerivations.chargeBuckets(sessions: sessions)
    }

    /// Web `chargingHabits` — average start/end SOC + Supercharger / DC-fast tallies.
    public var habits: BatteryHealthHabits? {
        BatteryHealthDerivations.habits(sessions: sessions)
    }

    /// Web `energyBreakdown` — aggregate AC vs DC energy (kWh) + counts.
    public var energyBreakdown: BatteryHealthEnergyBreakdown? {
        BatteryHealthDerivations.energyBreakdown(sessions: sessions)
    }

    /// Web new-vs-now scalars (capacity + first/last range).
    public var newVsNow: BatteryHealthNewVsNow? {
        analytics.map(BatteryHealthDerivations.newVsNow)
    }

    /// Web `buildRecommendations` keys (the view localizes).
    public var recommendationKeys: [String] {
        analytics.map(BatteryHealthDerivations.recommendationKeys) ?? []
    }

    /// Web `yearsTo80` display — `fmtNumber(years, 1)` or em dash when not trustworthy.
    public var yearsTo80Text: String {
        BatteryHealthFormat.yearsTo80(prediction?.yearsTo80Pct, trustworthy: prediction?.isTrustworthy ?? false)
    }

    /// Web `buildInsights` — needs the user's units for the fast-charge percent string.
    public func insights(prefs: UnitPreferences) -> [BatteryHealthInsight] {
        guard let analytics else { return [] }
        return BatteryHealthDerivations.insights(analytics: analytics, sessions: sessions, prefs: prefs)
    }

    /// Whether the live charging telemetry is present and fresh (ADR-013) — drives the
    /// header live indicator (web `<LiveIndicator>`).
    public var isLiveCharging: Bool {
        guard let live, live.hasData else { return false }
        return live.isFresh()
    }

    // MARK: Loading

    /// Loads the vehicle list then the selected vehicle's analytics + prediction + sessions
    /// + live telemetry. The primary analytics source resolves the page phase.
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
            resetVehicleData()
            phase = .empty
            return
        }

        // The analytics source resolves the page phase: throw → error region (web `error`),
        // nil → no-data empty (web `!health`), value → ready. The prediction / sessions /
        // live sources are independent (web separate queries): their failure/absence leaves
        // the per-section empty states, never the page-level error.
        do {
            let snapshot = try await dataSource.loadAnalytics(vehicleID: id)
            analytics = snapshot
            prediction = await (try? dataSource.loadPrediction(vehicleID: id)) ?? nil
            sessions = await (try? dataSource.loadSessions(vehicleID: id)) ?? []
            live = await (try? dataSource.loadLive(vehicleID: id)) ?? nil
            phase = snapshot == nil ? .empty : .ready
        } catch {
            resetVehicleData()
            phase = .error(error.localizedDescription)
        }
    }

    private func resetVehicleData() {
        analytics = nil
        prediction = nil
        sessions = []
        live = nil
    }
}
