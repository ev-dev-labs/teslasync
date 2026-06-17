import Foundation

// Value types for the Vehicles feature's "Fleet" list surface — the native SwiftUI parity of
// `web/src/features/vehicles/pages/VehicleListPage.tsx` (route `/vehicles`). The page lists every
// vehicle with a fleet summary (total / avg-battery / total-range / charging-online), a per-vehicle
// battery-status panel, and a card per vehicle (status, battery, range, odometer, charge power,
// lock / sentry, pin / open / delete). Every measurement is stored SI canonical (phase-48: metres,
// watt-hours, watts, m/s) and converted only at the SwiftUI render boundary via the shared `Units`
// facade (ADR-005). The list, the data states, the fleet aggregates, and the pin order bind through
// the `@Observable` `VehicleListPageModel`; networking lives behind the `VehicleListDataSource` seam
// (ADR-004 — no networking in the view).
//
// Types are `VehicleList…`-prefixed so this list parity unit composes alongside the sibling
// `VehicleDetail*` port in the SAME `TeslaSync` module without symbol collision (the repo's
// established dedupe convention; the bare `VehicleStatus` / `BatteryTone` axes are already owned by
// the `VehicleCard` feature view and are REUSED here, not duplicated).

// MARK: - Vehicle (web `useQuery(['vehicles']) → GET /vehicles → Vehicle`)

/// One vehicle row (web `Vehicle`). Holds the identity + descriptor fields the list renders: the
/// header shows `displayName` (falling back to `vin`), the sub-line shows `model` + `trimBadging`
/// + the monospaced `vin`. `id` keys the per-vehicle state fetch, the pin order, the detail
/// deep-link, and the delete mutation.
public struct VehicleListItem: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let vin: String
    public let displayName: String
    public let model: String
    public let trimBadging: String

    public init(
        id: Int64,
        vin: String,
        displayName: String,
        model: String,
        trimBadging: String
    ) {
        self.id = id
        self.vin = vin
        self.displayName = displayName
        self.model = model
        self.trimBadging = trimBadging
    }

    /// Web `vehicle.display_name || vehicle.vin` — the row title + battery-panel label.
    public var title: String {
        displayName.isEmpty ? vin : displayName
    }
}

// MARK: - Vehicle state (web `fetchVehicleState(id) → GET /vehicles/{id}/state → VehicleState`)

/// The live state snapshot the page reads per vehicle (web `VehicleState`, reduced to the fields the
/// list renders). All measurements are SI: `ratedRangeM` / `odometerM` are metres, `chargerPowerW`
/// is watts, `speedMps` is m/s — converted to the user's units only at the render boundary. `state`
/// is the raw FSM string and `speedMps` / `isCharging` drive `deriveVehicleStatus`.
public struct VehicleStateSnapshot: Hashable, Sendable {
    public let state: String
    public let batteryLevel: Int
    public let ratedRangeM: Double
    public let odometerM: Double
    public let chargerPowerW: Double
    public let speedMps: Double
    public let isCharging: Bool
    public let isLocked: Bool
    public let sentryMode: Bool

    public init(
        state: String,
        batteryLevel: Int,
        ratedRangeM: Double,
        odometerM: Double,
        chargerPowerW: Double,
        speedMps: Double = 0,
        isCharging: Bool = false,
        isLocked: Bool = false,
        sentryMode: Bool = false
    ) {
        self.state = state
        self.batteryLevel = batteryLevel
        self.ratedRangeM = ratedRangeM
        self.odometerM = odometerM
        self.chargerPowerW = chargerPowerW
        self.speedMps = speedMps
        self.isCharging = isCharging
        self.isLocked = isLocked
        self.sentryMode = sentryMode
    }
}

// MARK: - Vehicle + state entry (web `fleet.entries` element)

/// A vehicle paired with its resolved live state (web `{ vehicle, state }`). Only vehicles whose
/// state resolved appear in the fleet aggregates + the battery-status panel (web
/// `fleetStates.filter(e => e.state !== null)`).
public struct VehicleListEntry: Identifiable, Hashable, Sendable {
    public var id: Int64 { vehicle.id }
    public let vehicle: VehicleListItem
    public let state: VehicleStateSnapshot

    public init(vehicle: VehicleListItem, state: VehicleStateSnapshot) {
        self.vehicle = vehicle
        self.state = state
    }
}

// MARK: - Pin (web `usePinned('vehicle') → GET /pinned?type=vehicle → PinnedItem`)

/// One pinned reference for the `vehicle` bucket (web `PinnedItem`, reduced to what the list reads):
/// `itemID` matches a `VehicleListItem.id` and `position` orders the pinned rows to the top of the
/// list (web `vehiclePins` sort).
public struct VehicleListPin: Hashable, Sendable {
    public let itemID: String
    public let position: Int

    public init(itemID: String, position: Int) {
        self.itemID = itemID
        self.position = position
    }
}

// MARK: - Page status (web `vehiclesQuery` isLoading / error → list states)

/// The four data states the web page renders. `.loading` is the initial fetch (web `isLoading`
/// skeleton); `.error` is the retryable fetch failure (web `error` → load-error panel); `.empty` is
/// a resolved-but-no-vehicles fleet (web `vehicleList.length === 0` → EmptyState); `.success` is the
/// populated body (summary + battery panel + vehicle cards).
public enum VehicleListState: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case success
}

// MARK: - Data source seam (web hooks, kept by name)

/// Supplies the fleet data the page binds. The production implementation binds the shared KMP
/// repositories / use-cases (ADR-004 — the view holds no networking); previews and tests inject
/// doubles to drive the loading / empty / error / success states. Method ↔ web map:
///   `loadVehicles`      ← `useQuery(['vehicles']) / GET /vehicles`
///   `fetchVehicleState` ← `fetchVehicleState(id) / GET /vehicles/{id}/state`   (web hook name kept)
///   `usePinned`         ← `usePinned(type, context) / GET /pinned?type=&context=` (web hook name kept)
///   `syncVehicles`      ← `syncMutation / POST /vehicles/sync`
///   `deleteVehicle`     ← `deleteMutation / DELETE /vehicles/{id}`
///   `togglePin`         ← `useTogglePin('vehicle') / POST|DELETE /pinned`
public protocol VehicleListDataSource: Sendable {
    func loadVehicles() async throws -> [VehicleListItem]
    func fetchVehicleState(vehicleID: Int64) async throws -> VehicleStateSnapshot?
    func usePinned(type: String, context: String?) async throws -> [VehicleListPin]
    func syncVehicles() async throws -> Int
    func deleteVehicle(id: Int64) async throws
    func togglePin(vehicleID: Int64, pinned: Bool) async throws
}
