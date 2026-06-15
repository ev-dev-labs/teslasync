import Foundation
import Observation

// MARK: - Data source seam (web `useSelectedVehicle` + `useLifetimeStats`)

/// Supplies every datum the page renders. The production implementation binds the shared KMP
/// repositories/use-cases (ADR-004 — the view holds no networking); previews and tests inject
/// doubles to drive the loading / empty / error / success states. Mirrors the sibling analytics
/// `*DataSource` seams.
///
/// Method ↔ web map: `loadVehicles` ← `useSelectedVehicle` / `GET /vehicles`;
/// `loadStats(vehicleID:)` ← `useLifetimeStats(vehicleId)` →
/// `GET /analytics/lifetime{?vehicle_id}` (a `nil` vehicle queries the whole fleet, exactly like
/// the web hook's `vehicleId ? "?vehicle_id=…" : ""`). The keyed Swift method name preserves the
/// web hook name at the call site per the parity manifest.
public protocol LifetimeStatsDataSource: Sendable {
    func loadVehicles() async throws -> [LifetimeStatsVehicle]
    func loadStats(vehicleID: Int64?) async throws -> LifetimeStats?
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the view). Owns
/// the vehicle list + selection (web header `VehicleSelect` / `useSelectedVehicle`) and the single
/// lifetime roll-up the `useLifetimeStats` query resolves to. The hero and the four headline stat
/// cards always render (with zero fallbacks); every sub-panel reads its data from the optional
/// `stats` and resolves its own success vs. empty itself, exactly as the web page does
/// (`stats ? … : <EmptyState>`). The lifetime query works with or without a selected vehicle, so a
/// `nil` selection is a valid fleet-wide load rather than a blocked one.
@MainActor
@Observable
public final class LifetimeStatsPageModel {
    public private(set) var phase: LifetimeStatsPhase = .loading

    /// Whether a background refetch is in flight while content is already shown
    /// (web `isFetching && !isLoading`).
    public private(set) var isRefreshing = false

    public private(set) var vehicles: [LifetimeStatsVehicle] = []
    public private(set) var selectedVehicleID: Int64?
    public private(set) var stats: LifetimeStats?

    @ObservationIgnored private let dataSource: any LifetimeStatsDataSource

    public init(dataSource: any LifetimeStatsDataSource = SampleLifetimeStatsDataSource()) {
        self.dataSource = dataSource
    }

    // MARK: Selection

    public var selectedVehicle: LifetimeStatsVehicle? {
        selectedVehicleID.flatMap { id in vehicles.first { $0.id == id } }
    }

    // MARK: Derived (web `achievements` / `unlockedCount` / `SavingsBar` props)

    /// Web `stats?.achievements ?? []` — the achievement gallery's badges.
    public var achievements: [LifetimeAchievement] {
        stats?.achievements ?? []
    }

    /// Web `achievements.filter(a => a.unlocked).length`.
    public var unlockedCount: Int {
        stats?.unlockedCount ?? 0
    }

    /// Web `stats && stats.gas_equivalent_cost > 0` → the `SavingsBar` props, else `nil` (its empty
    /// state). Built here so the section is a pure render of derived data.
    public var savingsBar: LifetimeSavingsBar? {
        guard let stats, stats.hasSavingsData else { return nil }
        return LifetimeSavingsBar(
            evCost: stats.totalChargingCost,
            gasCost: stats.gasEquivalentCost,
            savings: stats.totalSavings,
            co2Kg: stats.co2OffsetKg
        )
    }

    // MARK: Loading

    /// Loads the vehicle list then the lifetime roll-up (web `useVehicles` + `useLifetimeStats`).
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
        // The vehicle list is fleet-wide; a failure degrades to an empty picker (web TanStack →
        // undefined → no selector), never the page error.
        vehicles = await (try? dataSource.loadVehicles()) ?? []
        if selectedVehicleID == nil || !vehicles.contains(where: { $0.id == selectedVehicleID }) {
            // No prior (or now-stale) selection → default to the first vehicle, or `nil` (fleet-wide
            // lifetime stats) when there are no vehicles. Both are valid lifetime queries.
            selectedVehicleID = vehicles.first?.id
        }
        await loadStats()
    }

    /// Selects a vehicle (web header picker `setVehicleId`) and reloads the lifetime roll-up.
    public func selectVehicle(_ id: Int64) async {
        guard id != selectedVehicleID, vehicles.contains(where: { $0.id == id }) else { return }
        selectedVehicleID = id
        phase = .loading
        await loadStats()
    }

    private func loadStats() async {
        // The lifetime fetch resolves the phase: throw → retryable error region (web `PageContainer
        // error`); value (or `nil`) → ready. On a `nil` value the hero + stat cards render zeros and
        // every sub-panel renders its own empty state — the web body with `stats` undefined.
        do {
            stats = try await dataSource.loadStats(vehicleID: selectedVehicleID)
            phase = .ready
        } catch {
            stats = nil
            phase = .error(error.localizedDescription)
        }
    }
}
