import Foundation
import Observation

// MARK: - Staleness window (web `LiveStaleDataBanner`, ADR-013)

/// Live values older than this are flagged stale (ADR-013: cross-pod live values older than 2 minutes
/// are stale).
private let staleThreshold: TimeInterval = 120

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the view). Owns the
/// vehicle list + selection (web header `VehiclePicker`), the latest snapshot (web `location-latest`,
/// 15 s refetch), the snapshot history (web `location-history`), and the latest charging telemetry (web
/// `useChargingTelemetryLatest`), and derives every panel/chart value (web `useMemo` blocks). Reads
/// everything through the injected `NavigationRouteDataSource`; all SI→display conversion happens later
/// in `NavigationRouteFormat`, never here.
@MainActor
@Observable
public final class NavigationRoutePageModel {
    /// A per-feed load state (web TanStack `isLoading` / `error` / success).
    public enum LoadState: Equatable, Sendable {
        case loading
        case loaded
        case failed(String)
    }

    // Vehicles (web `useQuery(['vehicles'])`).
    public private(set) var loadState: LoadState = .loading
    public private(set) var vehicles: [NavVehicle] = []
    public private(set) var selectedVehicleID: Int64?

    // Latest snapshot (web `location-latest`).
    public private(set) var latestState: LoadState = .loading
    public private(set) var latest: NavSnapshot?

    // Snapshot history (web `location-history`).
    public private(set) var historyState: LoadState = .loading
    public private(set) var history: [NavSnapshot] = []

    /// Latest charging telemetry (web `useChargingTelemetryLatest`).
    public private(set) var chargingTelemetry: NavChargingTelemetry?

    /// When the live snapshot was last refreshed (web `dataUpdatedAt`), drives the staleness banner.
    public private(set) var lastUpdated: Date?

    /// A background refetch is in flight while content is already shown (web `isFetching && !isLoading`).
    public private(set) var isRefreshing = false

    @ObservationIgnored private let dataSource: any NavigationRouteDataSource
    @ObservationIgnored private let referenceDate: Date?

    public init(
        dataSource: any NavigationRouteDataSource = SampleNavigationRouteDataSource(),
        referenceDate: Date? = nil
    ) {
        self.dataSource = dataSource
        self.referenceDate = referenceDate
    }

    // MARK: Phase

    /// The displayed phase (web `PageContainer` phases): loading/error from the vehicles query, then
    /// empty when no vehicle is selected (web `vehicleId === null`), else ready.
    public var phase: NavigationRoutePhase {
        switch loadState {
        case .loading: .loading
        case let .failed(message): .error(message)
        case .loaded: selectedVehicleID == nil ? .empty : .ready
        }
    }

    public var selectedVehicle: NavVehicle? {
        selectedVehicleID.flatMap { id in vehicles.first { $0.id == id } }
    }

    // MARK: Loading

    /// Loads the vehicle list, then the selected vehicle's latest snapshot + history + charging
    /// telemetry (web `useQuery(['vehicles'])` → the keyed snapshot queries).
    public func load() async {
        loadState = .loading
        await fetchAll()
    }

    /// Re-runs the load while keeping current content visible (web manual refetch + the 15 s interval).
    public func refresh() async {
        isRefreshing = true
        await fetchAll()
        isRefreshing = false
    }

    private func fetchAll() async {
        do {
            vehicles = try await dataSource.loadVehicles()
            loadState = .loaded
        } catch {
            vehicles = []
            loadState = .failed(error.localizedDescription)
        }
        if selectedVehicleID == nil || !vehicles.contains(where: { $0.id == selectedVehicleID }) {
            selectedVehicleID = vehicles.first?.id
        }
        await loadSelectedVehicle()
    }

    /// Selects a vehicle (web header `VehiclePicker`) and reloads its snapshots (web queries re-key on
    /// `vehicleId`).
    public func selectVehicle(_ id: Int64) async {
        guard id != selectedVehicleID, vehicles.contains(where: { $0.id == id }) else { return }
        selectedVehicleID = id
        await loadSelectedVehicle()
    }

    private func loadSelectedVehicle() async {
        guard let id = selectedVehicleID else {
            latest = nil
            history = []
            chargingTelemetry = nil
            latestState = .loaded
            historyState = .loaded
            return
        }

        latestState = .loading
        historyState = .loading

        do {
            latest = try await dataSource.loadLatest(vehicleID: id)
            latestState = .loaded
            lastUpdated = referenceClock
        } catch {
            latest = nil
            latestState = .failed(error.localizedDescription)
        }

        do {
            history = try await dataSource.loadHistory(vehicleID: id)
            historyState = .loaded
        } catch {
            history = []
            historyState = .failed(error.localizedDescription)
        }

        chargingTelemetry = try? await dataSource.useChargingTelemetryLatest(vehicleID: id)
    }

    // MARK: Derivations (web useMemo blocks)

    /// Web `hasActiveRoute = latest?.destination_name != null`.
    public var hasActiveRoute: Bool {
        latest?.destinationName != nil
    }

    /// Web `hasValidLocation`.
    public var hasValidLocation: Bool {
        latest?.hasValidLocation ?? false
    }

    /// Web `anyError = [vehiclesError, latestError, historyError].find(Boolean)` — the first feed error,
    /// surfaced in the inline `AlertBanner`.
    public var anyErrorMessage: String? {
        for state in [loadState, latestState, historyState] {
            if case let .failed(message) = state { return message }
        }
        return nil
    }

    /// Web `buildWaypoints(latest)` — a single destination waypoint when a route is active.
    public var waypoints: [NavWaypoint] {
        guard let latest, let name = latest.destinationName else { return [] }
        return [NavWaypoint(name: name, kind: .destination, distanceM: latest.distanceToArrivalM ?? 0)]
    }

    /// Web `chartData`/`presenceChartData` source — history sorted oldest→newest.
    public var historyAscending: [NavSnapshot] {
        history.sorted { $0.createdAt < $1.createdAt }
    }

    /// Web `avgSpeed` — the mean of the positive SI speeds (display conversion happens later). Returns
    /// SI m/s.
    public var averageSpeedMps: Double {
        let speeds = history.compactMap(\.speedMps).filter { $0 > 0 }
        guard !speeds.isEmpty else { return 0 }
        return speeds.reduce(0, +) / Double(speeds.count)
    }

    /// Web `recentDestinations` — the first 20 unique destinations seen in history.
    public var recentDestinations: [NavDestination] {
        var seen = Set<String>()
        var result: [NavDestination] = []
        for snapshot in history {
            guard let name = snapshot.destinationName, !seen.contains(name) else { continue }
            seen.insert(name)
            result.append(
                NavDestination(
                    time: snapshot.createdAt,
                    destination: name,
                    distanceM: snapshot.distanceToArrivalM ?? 0,
                    etaMinutes: snapshot.minutesToArrival ?? 0
                )
            )
            if result.count >= 20 { break }
        }
        return result
    }

    /// Web `presenceChartData` — home/work/homelink flags over time.
    public var presenceSamples: [NavPresenceSample] {
        historyAscending.map { snapshot in
            NavPresenceSample(
                time: snapshot.createdAt,
                home: snapshot.locatedAtHome ?? false,
                work: snapshot.locatedAtWork ?? false,
                homelink: snapshot.homelinkNearby ?? false
            )
        }
    }

    /// Whether the live snapshot is older than the staleness window (web `LiveStaleDataBanner`,
    /// ADR-013). Unknown (never-loaded) is treated as not-stale so the banner stays hidden until the
    /// first successful load.
    public var isStale: Bool {
        guard let lastUpdated else { return false }
        return referenceClock.timeIntervalSince(lastUpdated) > staleThreshold
    }

    /// Whether a live feed is currently considered fresh (web `LiveIndicator`).
    public var isLive: Bool {
        lastUpdated != nil && !isStale
    }

    private var referenceClock: Date {
        referenceDate ?? Date()
    }
}
