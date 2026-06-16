import Foundation
import Observation

// MARK: - Page model

/// The `@Observable` state holder the Quick Stats page binds to (ADR-004 — no networking in the
/// view). Owns the vehicle list + the resolved first vehicle, that vehicle's live connection state,
/// and the 30-day fleet analytics summary. The view reads everything from here: the vehicle card
/// shows the populated header or the no-vehicle empty state, while the four metric cards always
/// render from `metrics` (web `analytics?.x ?? 0`).
@MainActor
@Observable
public final class QuickStatsPageModel {
    public private(set) var phase: QuickStatsPagePhase = .loading

    /// Whether a background refetch is in flight while content is already shown
    /// (web `isFetching && !isLoading`).
    public private(set) var isRefreshing = false

    public private(set) var vehicles: [QuickStatsPageVehicle] = []
    public private(set) var vehicle: QuickStatsPageVehicle?
    public private(set) var state: QuickStatsPageVehicleState?
    public private(set) var summary: QuickStatsPageSummary?

    @ObservationIgnored private let dataSource: any QuickStatsPageDataSource

    public init(dataSource: any QuickStatsPageDataSource = SampleQuickStatsPageDataSource()) {
        self.dataSource = dataSource
    }

    // MARK: Derivations (web inline)

    /// The summary the four metric cards format — the loaded summary, or a zeroed fallback so the
    /// cards always render even when analytics is unavailable (web `analytics?.x ?? 0`).
    public var metrics: QuickStatsPageSummary {
        summary ?? .zero
    }

    /// Whether the body should show the no-vehicle empty card (web `!vehicle`).
    public var hasVehicle: Bool {
        vehicle != nil
    }

    // MARK: Loading

    /// Loads the vehicle list + the analytics summary, then the first vehicle's state. Either the
    /// vehicle-list OR the analytics query failing surfaces the retryable error region (web
    /// `PageContainer error={vehiclesError || analyticsError}`); the per-vehicle state query degrades
    /// to `nil` so the page still renders (web subtitle `?? 'offline'`).
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
        do {
            vehicles = try await dataSource.loadVehicles()
            summary = try await dataSource.loadSummary(days: QuickStatsPageFormat.summaryDays)
        } catch {
            phase = .error(error.localizedDescription)
            return
        }
        vehicle = vehicles.first
        await loadState()
        phase = .ready
    }

    private func loadState() async {
        guard let id = vehicle?.id else {
            state = nil
            return
        }
        // Web `useVehicleState(vehicle?.id ?? 0)` fails soft (the subtitle reads `?? 'offline'`), so a
        // throw here degrades to `nil`, never the error region.
        state = await (try? dataSource.loadState(vehicleID: id)) ?? nil
    }
}
