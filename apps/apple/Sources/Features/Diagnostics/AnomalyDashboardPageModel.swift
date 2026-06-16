import Foundation
import Observation

// MARK: - Data source seam (web hooks: `useSelectedVehicle` + `useAnomalies`)

/// Supplies every datum the page renders. The production implementation binds the shared KMP
/// repositories/use-cases (ADR-004 — the view holds no networking); previews and tests inject
/// doubles to drive the loading / empty / error / success states. Mirrors the
/// `StatisticsDataSource` seam used by the sibling analytics pages.
///
/// Method ↔ web hook map (the hook names are kept here at the Swift call site per the parity
/// manifest): `loadVehicles` ← `useSelectedVehicle` / `GET /vehicles`; `loadAnomalies` ←
/// `useAnomalies` / `GET /analytics/anomalies?vehicle_id&days`.
public protocol AnomalyDashboardDataSource: Sendable {
    func loadVehicles() async throws -> [AnomalyVehicle]
    func loadAnomalies(vehicleID: Int64, days: Int) async throws -> AnomalyData?
}

// MARK: - Page phase (web `PageContainer loading`/`error` + the `!data` no-vehicle gap)

/// The page's terminal phase, driven by the `useAnomalies` query. `.empty` is a successful state
/// that yielded no payload (web query disabled until a vehicle is selected → `data` undefined);
/// `.error` is a retryable failure (web `PageContainer error` region); `.ready` carries the data,
/// where each section renders its own per-source empty (web per-`GlassPanel` `EmptyState`).
public enum AnomalyDashboardPhase: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case ready
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the view). Owns
/// the vehicle list + selection (web `useSelectedVehicle` + the `VehicleSelect`) and the
/// `useAnomalies` payload that drives the four summary cards, the system-health grid, the anomaly
/// timeline, and the signal-frequency chart. Reads everything through the injected data source.
@MainActor
@Observable
public final class AnomalyDashboardPageModel {
    public private(set) var phase: AnomalyDashboardPhase = .loading

    /// Whether a background refetch is in flight while content is already shown (web
    /// `isFetching && !isLoading`).
    public private(set) var isRefreshing = false

    public private(set) var vehicles: [AnomalyVehicle] = []
    public private(set) var selectedVehicleID: Int64?

    public private(set) var data: AnomalyData?

    /// Web `useAnomalies(vehicleId, days = 7)` — the lookback window is fixed at 7 days on this
    /// page (the web surface has no day selector and relies on the hook default).
    public let days = 7

    @ObservationIgnored private let dataSource: any AnomalyDashboardDataSource

    public init(dataSource: any AnomalyDashboardDataSource = SampleAnomalyDashboardDataSource()) {
        self.dataSource = dataSource
    }

    // MARK: Selection

    public var selectedVehicle: AnomalyVehicle? {
        selectedVehicleID.flatMap { id in vehicles.first { $0.id == id } }
    }

    // MARK: Loading

    /// Loads the vehicle list, then the selected vehicle's anomalies (web `useSelectedVehicle` +
    /// `useAnomalies`). Resolves the page phase from the anomaly query.
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
        await loadAnomalies()
    }

    /// Selects a vehicle (web `setSelectedVehicle`) and reloads its anomalies.
    public func selectVehicle(_ id: Int64) async {
        guard id != selectedVehicleID, vehicles.contains(where: { $0.id == id }) else { return }
        selectedVehicleID = id
        phase = .loading
        await loadAnomalies()
    }

    /// The `useAnomalies` fetch. Web enables the query only once a vehicle is selected — with no
    /// vehicle the payload is undefined, which we surface as the top-level `.empty` state; a thrown
    /// error maps to the retryable `.error` region; a payload (even with no anomalies) is `.ready`.
    private func loadAnomalies() async {
        guard let id = selectedVehicleID else {
            data = nil
            phase = .empty
            return
        }
        do {
            let payload = try await dataSource.loadAnomalies(vehicleID: id, days: days)
            data = payload
            phase = payload == nil ? .empty : .ready
        } catch {
            data = nil
            phase = .error(error.localizedDescription)
        }
    }
}
