import CoreLocation
import Foundation
import Observation

// MARK: - Data source seam (web `useVehicles` + the page's inline position / snapshot queries)

/// Supplies every datum the Map Overview page renders. The production implementation binds the
/// shared KMP repositories / use-cases (ADR-004 — the view holds no networking); previews and
/// tests inject doubles to drive the loading / empty / error / success states. Mirrors the
/// sibling feature `*DataSource` seams.
///
/// Method ↔ web hook / endpoint map:
/// `loadVehicles` ← `useVehicles` / `GET /vehicles`;
/// `loadLatestPosition` ← `useQuery(position-latest)` / `GET /vehicles/{id}/positions?limit=1`;
/// `loadHistory` ← `useQuery(position-history)` / `GET /vehicles/{id}/positions?limit=50`;
/// `loadLocationSnapshot` ← `useQuery(location-latest)` / `GET /location-snapshots/latest?vehicle_id`.
public protocol MapOverviewDataSource: Sendable {
    func loadVehicles() async throws -> [MapOverviewVehicle]
    func loadLatestPosition(vehicleID: Int64) async throws -> MapOverviewPosition?
    func loadHistory(vehicleID: Int64) async throws -> [MapOverviewPosition]
    func loadLocationSnapshot(vehicleID: Int64) async throws -> MapOverviewLocationSnapshot?
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the view). Owns
/// the vehicle list + selection (web header `VehicleSelect`, the `useVehicles` port), the map
/// style (web `MapLayerSwitcher` URL state), and the selected vehicle's latest position, recent
/// history, and location snapshot the queries resolve to. The vehicle fetch resolves the page
/// phase (web `PageContainer loading / error`); the per-vehicle position / snapshot reads are
/// best-effort and degrade to each panel's own empty state, exactly as the web's independent
/// hooks behave. Every panel / map / row reads its data from the bound state.
@MainActor
@Observable
public final class MapOverviewPageModel {
    public private(set) var phase: MapOverviewPhase = .loading

    /// Whether a background refetch is in flight while content is already shown
    /// (web `isFetching && !isLoading`).
    public private(set) var isRefreshing = false

    /// Set when the vehicle fetch failed — fronts the retryable page error (web `anyError`).
    public private(set) var loadErrorMessage: String?

    public private(set) var vehicles: [MapOverviewVehicle] = []
    public private(set) var selectedVehicleID: Int64?

    public private(set) var latest: MapOverviewPosition?
    public private(set) var history: [MapOverviewPosition] = []
    public private(set) var snapshot: MapOverviewLocationSnapshot?

    /// Web `mapStyle` URL state — the satellite/standard/hybrid layer the switcher drives.
    public var mapStyle: TSMapStyle = .standard

    @ObservationIgnored private let dataSource: any MapOverviewDataSource

    public init(dataSource: any MapOverviewDataSource = SampleMapOverviewDataSource()) {
        self.dataSource = dataSource
    }

    // MARK: Selection

    public var selectedVehicle: MapOverviewVehicle? {
        selectedVehicleID.flatMap { id in vehicles.first { $0.id == id } }
    }

    /// The map marker callout label (web `vehicle?.display_name ?? 'Vehicle'`).
    public var vehicleName: String {
        if let name = selectedVehicle?.displayName, !name.isEmpty { return name }
        return String(localized: "mapOverview.vehicle")
    }

    // MARK: Derived (web `useMemo` geometry)

    /// Web `hasValidLocation` — the latest fix is real and not the null-island.
    public var hasValidLatest: Bool {
        latest?.hasValidLocation ?? false
    }

    /// Web `trailPositions` — the recent-history polyline (valid fixes only).
    public var trailCoordinates: [CLLocationCoordinate2D] {
        history.filter(\.hasValidLocation).map(\.coordinate)
    }

    /// Web `playbackPoints` — time-ordered ascending so replay runs forward in time.
    public var playbackCoordinates: [CLLocationCoordinate2D] {
        history
            .filter(\.hasValidLocation)
            .sorted { $0.createdAt < $1.createdAt }
            .map(\.coordinate)
    }

    /// Whether the recent-history table / playback have anything to show.
    public var hasHistory: Bool {
        !history.isEmpty
    }

    /// Live-position staleness (ADR-013): a current fix older than two minutes is stale. Takes
    /// an explicit clock so the indicator is deterministic in tests.
    public func isStale(asOf now: Date = Date()) -> Bool {
        guard let latest else { return false }
        return now.timeIntervalSince(latest.createdAt) > MapOverviewFreshness.staleAfter
    }

    // MARK: Loading

    /// Loads the vehicle list then the selected vehicle's position data (web `useVehicles` plus
    /// the per-vehicle queries). A vehicle-fetch failure surfaces the retryable error region.
    public func load() async {
        phase = .loading
        await fetchAll()
    }

    /// Re-runs the load while keeping current content visible (web refetch / 15 s poll).
    public func refresh() async {
        isRefreshing = true
        await fetchAll()
        isRefreshing = false
    }

    private func fetchAll() async {
        do {
            let loaded = try await dataSource.loadVehicles()
            vehicles = loaded
            loadErrorMessage = nil
            if selectedVehicleID == nil || !loaded.contains(where: { $0.id == selectedVehicleID }) {
                selectedVehicleID = loaded.first?.id
            }
            guard selectedVehicleID != nil else {
                clearVehicleData()
                phase = .empty
                return
            }
            await loadVehicleData()
        } catch {
            vehicles = []
            clearVehicleData()
            loadErrorMessage = error.localizedDescription
            phase = .error(error.localizedDescription)
        }
    }

    /// Selects a vehicle (web header picker `setVehicleId`) and reloads its data.
    public func selectVehicle(_ id: Int64) async {
        guard id != selectedVehicleID, vehicles.contains(where: { $0.id == id }) else { return }
        selectedVehicleID = id
        phase = .loading
        await loadVehicleData()
    }

    /// Cycles the active map layer (web `MapLayerSwitcher onChange`).
    public func setMapStyle(_ style: TSMapStyle) {
        mapStyle = style
    }

    private func loadVehicleData() async {
        guard let id = selectedVehicleID else {
            clearVehicleData()
            phase = .empty
            return
        }
        latest = try? await dataSource.loadLatestPosition(vehicleID: id)
        history = (try? await dataSource.loadHistory(vehicleID: id)) ?? []
        snapshot = try? await dataSource.loadLocationSnapshot(vehicleID: id)
        phase = .ready
    }

    private func clearVehicleData() {
        latest = nil
        history = []
        snapshot = nil
    }
}
