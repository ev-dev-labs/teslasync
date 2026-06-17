import Foundation

// Value types for the Trips feature's "Trips" list surface — the native SwiftUI parity of
// `web/src/features/trips/pages/TripListPage.tsx` (route `/trips`). The page reports multi-drive
// trips: four summary stat cards, a top-trips-by-distance bar chart, and the scrollable trip list.
// Every aggregate is stored SI canonical (phase-48: metres, watt-hours, seconds) and converted only
// at the SwiftUI render boundary via `Units` (ADR-005). The list, the data states, and the derived
// summaries bind through the `@Observable` `TripListPageModel`; networking lives behind the
// `TripListDataSource` seam (ADR-004 — no networking in the view).
//
// Types are `TripList…`-prefixed so this Trips-feature parity unit composes alongside the sibling
// `TripsReplay*` replay port in the SAME `TeslaSync` module without symbol collision (the repo's
// established dedupe convention; the bare `TripSummary*` names are already owned by the dashboard
// widget bundle).

// MARK: - Trip (web `useTrips` → GET /trips → `Trip`)

/// One trip row (web `Trip`). `name` is `nil` for an auto-generated trip, which the row renders as
/// the `Trip #{id}` fallback (web `trip.name ?? …`). `endDate` is `nil` while a trip is still open,
/// which the duration formatter surfaces as the "In progress" sentinel (web `formatDuration`).
/// `totalDistanceM`/`totalEnergyWh`/`totalDurationS` are SI; `totalCost` is in the user's currency
/// (the API performs no FX, exactly as the web does not); `driveCount`/`chargeCount` are counts.
public struct TripListItem: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let vehicleID: Int64
    public let name: String?
    public let startDate: Date
    public let endDate: Date?
    public let totalDistanceM: Double
    public let totalEnergyWh: Double
    public let totalDurationS: Double
    public let totalCost: Double
    public let driveCount: Int
    public let chargeCount: Int

    public init(
        id: Int64,
        vehicleID: Int64,
        name: String?,
        startDate: Date,
        endDate: Date?,
        totalDistanceM: Double,
        totalEnergyWh: Double,
        totalDurationS: Double,
        totalCost: Double,
        driveCount: Int,
        chargeCount: Int = 0
    ) {
        self.id = id
        self.vehicleID = vehicleID
        self.name = name
        self.startDate = startDate
        self.endDate = endDate
        self.totalDistanceM = totalDistanceM
        self.totalEnergyWh = totalEnergyWh
        self.totalDurationS = totalDurationS
        self.totalCost = totalCost
        self.driveCount = driveCount
        self.chargeCount = chargeCount
    }
}

// MARK: - Page status (web `useTrips` `isLoading` → list states)

/// The page status. `.ready` is the resolved web body (the stat cards, chart, and list render — or
/// their empty states when there are no trips); `.loading` is the initial fetch (web `isLoading`
/// skeletons); `.error` is a retryable fetch failure (kept robust per ADR-011 — never a blank
/// region — though the web page itself declares loading / empty / success).
public enum TripListState: Equatable, Sendable {
    case loading
    case error(String)
    case ready
}

// MARK: - Data source seam (web `useTrips`)

/// Supplies the trips the page lists. The production implementation binds the shared KMP
/// repositories / use-cases (ADR-004 — the view holds no networking); previews and tests inject
/// doubles to drive the loading / empty / error states. Method ↔ web map:
/// `loadTrips` ← `useTrips({ vehicle_id, limit, offset, start, end })` /
/// `GET /trips?vehicle_id=&limit=&offset=&start=&end=`.
public protocol TripListDataSource: Sendable {
    func loadTrips(query: TripListQuery) async throws -> [TripListItem]
}

// MARK: - Query (web `UseTripParams`)

/// The fetch parameters the page issues — the native peer of the web `UseTripParams`. `vehicleID`
/// scopes to the active vehicle (web `useSelectedVehicle().vehicleId`); `limit`/`offset` page the
/// list (web `pageSize` / `(page-1)*pageSize`); `start`/`end` bound the window as `YYYY-MM-DD`
/// strings (web `from` / `to`, defaulting to the last 365 days).
public struct TripListQuery: Equatable, Sendable {
    public let vehicleID: Int64?
    public let limit: Int
    public let offset: Int
    public let start: String?
    public let end: String?

    public init(
        vehicleID: Int64? = nil,
        limit: Int = 50,
        offset: Int = 0,
        start: String? = nil,
        end: String? = nil
    ) {
        self.vehicleID = vehicleID
        self.limit = limit
        self.offset = offset
        self.start = start
        self.end = end
    }
}
