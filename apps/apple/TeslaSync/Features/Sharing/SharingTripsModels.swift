import Foundation

// Value types for the Sharing feature's "Share a trip" surface — the native SwiftUI parity of
// `web/src/features/sharing/pages/SharingTripsPage.tsx`. The page surfaces recent trips eligible
// for sharing, the static share-card hint, and the propose-only AI image-prompt drafter. Every
// aggregate is stored SI canonical (phase-48: metres, watt-hours, seconds) and converted only at
// the SwiftUI render boundary via `Units` (ADR-005). The trip list, the data states, and the
// selection model bind through the `@Observable` `SharingTripsPageModel`; networking lives behind
// the `SharingTripsDataSource` seam (ADR-004 — no networking in the view).
//
// Types are `SharingTrips…`-prefixed so this Sharing-feature parity unit composes alongside the
// sibling public-share port (`Sources/Features/Sharing/SharedDrive*`) in the SAME `TeslaSync`
// module without symbol collision (the repo's established dedupe convention).

// MARK: - Trip (web `useTrips` → GET /trips → `Trip`)

/// One shareable trip row (web `Trip`). `name` is `nil` for an auto-generated trip, which the row
/// renders as the `Trip #{id}` fallback (web `trip.name ?? …`). `endDate` is `nil` while a trip is
/// still open, which the duration formatter surfaces as the em-dash sentinel (web `formatDuration`).
/// `totalDistanceM`/`totalEnergyWh`/`totalDurationS` are SI; `driveCount`/`chargeCount` are counts.
public struct SharingTrip: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let vehicleID: Int64
    public let name: String?
    public let startDate: Date
    public let endDate: Date?
    public let totalDistanceM: Double
    public let totalEnergyWh: Double
    public let totalDurationS: Double
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
        self.driveCount = driveCount
        self.chargeCount = chargeCount
    }
}

// MARK: - Page status (web `useTrips` `isLoading` → list states)

/// The recent-trips list status. `.ready` is the resolved web body (the list renders, or the empty
/// state when no trips exist); `.loading` is the initial fetch (web `isLoading` skeletons); `.error`
/// is a retryable fetch failure (kept robust per ADR-011 — never a blank region — though the web
/// list itself only declares loading/empty/success).
public enum SharingTripsState: Equatable, Sendable {
    case loading
    case error(String)
    case ready
}

// MARK: - Data source seam (web `useTrips`)

/// Supplies the recent trips the page shares. The production implementation binds the shared KMP
/// repositories/use-cases (ADR-004 — the view holds no networking); previews and tests inject
/// doubles to drive the loading / empty / error states. Method ↔ web map:
/// `loadTrips` ← `useTrips({ vehicle_id, limit })` / `GET /trips?vehicle_id=&limit=`.
public protocol SharingTripsDataSource: Sendable {
    func loadTrips(vehicleID: Int64?, limit: Int) async throws -> [SharingTrip]
}
