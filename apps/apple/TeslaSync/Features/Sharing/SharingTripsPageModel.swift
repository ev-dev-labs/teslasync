import Foundation
import Observation

// MARK: - Page model (web `useTrips` + selected-trip state)

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the view). Owns the
/// recent-trips list (web `useTrips({ vehicle_id, limit: 20 })`) plus the single selection the AI
/// share-card drafter consumes (web `selectedTripId`). The recent-trips list is the only selector
/// on the page; selecting a row swaps `selectedTripID`, which the AI card reads via its `tripID`
/// prop. SI values flow through unchanged; conversion happens at the SwiftUI render boundary.
@MainActor
@Observable
public final class SharingTripsPageModel {
    /// The active vehicle scope (web `useSelectedVehicle().vehicleId`); `nil` = all vehicles.
    public let vehicleID: Int64?
    /// The recent-trips page size (web `limit: 20`).
    public let limit: Int

    public private(set) var state: SharingTripsState = .loading
    /// Whether a background refetch is in flight while content already shows (web refetch).
    public private(set) var isRefreshing = false
    public private(set) var trips: [SharingTrip] = []
    /// The picked trip id — the AI card's input (web `selectedTripId`); `nil` until one is chosen.
    public private(set) var selectedTripID: Int64?

    @ObservationIgnored private let dataSource: any SharingTripsDataSource

    public init(
        vehicleID: Int64? = nil,
        limit: Int = 20,
        dataSource: any SharingTripsDataSource = SampleSharingTripsDataSource()
    ) {
        self.vehicleID = vehicleID
        self.limit = limit
        self.dataSource = dataSource
    }

    // MARK: Derived (web memos)

    /// Whether the fetch yielded any shareable trips (web `allTrips.length > 0`).
    public var hasTrips: Bool { !trips.isEmpty }

    /// The currently selected trip, if any (web `selectedTripId` resolved against the list).
    public var selectedTrip: SharingTrip? {
        guard let selectedTripID else { return nil }
        return trips.first { $0.id == selectedTripID }
    }

    // MARK: Loading

    /// Loads the recent trips (web `useTrips`). A failure surfaces the retryable error region.
    public func load() async {
        state = .loading
        await fetch()
    }

    /// Re-runs the load while keeping current content visible (web refetch / pull-to-refresh).
    public func refresh() async {
        isRefreshing = true
        await fetch()
        isRefreshing = false
    }

    // MARK: Selection (web `setSelectedTripId`)

    /// Picks a trip as the AI card's input (web row `onClick`); re-tapping the same row keeps it.
    public func select(tripID: Int64) {
        selectedTripID = tripID
    }

    private func fetch() async {
        do {
            let loaded = try await dataSource.loadTrips(vehicleID: vehicleID, limit: limit)
            trips = loaded
            if let selectedTripID, !loaded.contains(where: { $0.id == selectedTripID }) {
                self.selectedTripID = nil
            }
            state = .ready
        } catch {
            state = .error(error.localizedDescription)
        }
    }
}
