import SwiftUI

// Value types for the Trip Planner surface (web `web/src/features/driving/pages/TripPlannerPage.tsx`,
// route `/trip-planner`). Every measurement is SI canonical — meters, seconds, watt-hours — exactly as
// the `POST /trip-planner/plan` backend returns it (web `TripPlan`); the user's unit preference is
// applied only at the SwiftUI render boundary via `Units` / `TripPlannerFormat` (ADR-005). `estimatedCost`
// is a bare currency amount, formatted with the user's currency symbol at the boundary (web
// `useFormatting().formatCurrency`). Identity/label strings round-trip verbatim.

// MARK: - Geographic location (web `TripLocation`)

/// A geocoded point on the planned route (web `TripLocation` — `{ lat, lng, name }`).
public struct TripLocation: Hashable, Sendable {
    public let lat: Double
    public let lng: Double
    public let name: String

    public init(lat: Double, lng: Double, name: String) {
        self.lat = lat
        self.lng = lng
        self.name = name
    }
}

// MARK: - Vehicle (web `useSelectedVehicle` → `GET /vehicles`)

/// One selectable vehicle (web `vehicle.display_name || vehicle.vin`) plus the current battery level
/// (web `vehicle.battery_level`, a 0–100 percent or `nil` when unknown).
public struct TripPlannerVehicle: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let displayName: String
    public let vin: String
    public let batteryLevel: Double?

    public init(id: Int64, displayName: String, vin: String, batteryLevel: Double? = nil) {
        self.id = id
        self.displayName = displayName
        self.vin = vin
        self.batteryLevel = batteryLevel
    }

    /// Web `vehicle.display_name || vehicle.vin` — the label shown in the selector.
    public var name: String {
        displayName.isEmpty ? vin : displayName
    }
}

// MARK: - Driving-speed preference (web `speedOptions`)

/// The driving-speed factor the planner applies to the baseline ETA (web `speedOptions` — the
/// `Relaxed (−20%) / Normal / Brisk (+10%) / Fast (+20%)` select). The `factor` matches the web
/// `value` strings (`0.8 / 1.0 / 1.1 / 1.2`); `titleKey` keeps the web i18n key names.
public enum TripSpeedOption: String, CaseIterable, Identifiable, Sendable {
    case relaxed
    case normal
    case brisk
    case fast

    public var id: String {
        rawValue
    }

    /// Web `speed_factor` value (`0.8 / 1.0 / 1.1 / 1.2`).
    public var factor: Double {
        switch self {
        case .relaxed: 0.8
        case .normal: 1.0
        case .brisk: 1.1
        case .fast: 1.2
        }
    }

    /// The web option label key (`tripPlanner.speed.*`).
    public var titleKey: LocalizedStringKey {
        switch self {
        case .relaxed: "tripPlanner.speed.relaxed"
        case .normal: "tripPlanner.speed.normal"
        case .brisk: "tripPlanner.speed.brisk"
        case .fast: "tripPlanner.speed.fast"
        }
    }

    /// Closest match for a raw `speed_factor` (used when seeding from a restored request).
    public static func from(factor: Double) -> TripSpeedOption {
        allCases.min(by: { abs($0.factor - factor) < abs($1.factor - factor) }) ?? .normal
    }
}

// MARK: - Plan request (web `TripPlanRequest`)

/// The body posted to `POST /trip-planner/plan` (web `TripPlanRequest`). SOC values are 0–100 percent;
/// `speedFactor` is the chosen `TripSpeedOption.factor`. `chargeLimitSoc` is fixed at 90 (web literal),
/// and `includeWeather` / `preferSuperchargers` are always on (web `preferences`).
public struct TripPlanRequest: Hashable, Sendable {
    public let vehicleID: Int64
    public let origin: TripLocation
    public let destination: TripLocation
    public let currentSoc: Double
    public let chargeLimitSoc: Double
    public let minArrivalSoc: Double
    public let speedFactor: Double
    public let includeWeather: Bool
    public let preferSuperchargers: Bool

    public init(
        vehicleID: Int64,
        origin: TripLocation,
        destination: TripLocation,
        currentSoc: Double,
        chargeLimitSoc: Double,
        minArrivalSoc: Double,
        speedFactor: Double,
        includeWeather: Bool,
        preferSuperchargers: Bool
    ) {
        self.vehicleID = vehicleID
        self.origin = origin
        self.destination = destination
        self.currentSoc = currentSoc
        self.chargeLimitSoc = chargeLimitSoc
        self.minArrivalSoc = minArrivalSoc
        self.speedFactor = speedFactor
        self.includeWeather = includeWeather
        self.preferSuperchargers = preferSuperchargers
    }
}

// MARK: - Plan response (web `TripPlan`)

/// The trip-level roll-up (web `TripPlanRoute`). All durations are seconds, distance meters, energy
/// watt-hours, `estimatedCost` a bare currency amount, `arrivalSoc` a 0–100 percent. `feasible` gates
/// the not-feasible warning; `isEstimate` gates the straight-line disclaimer.
public struct TripPlanRoute: Hashable, Sendable {
    public let totalDistanceM: Double
    public let totalDurationS: Double
    public let drivingDurationS: Double
    public let chargingDurationS: Double
    public let totalEnergyWh: Double
    public let estimatedCost: Double
    public let arrivalSoc: Double
    public let feasible: Bool
    public let isEstimate: Bool

    public init(
        totalDistanceM: Double,
        totalDurationS: Double,
        drivingDurationS: Double,
        chargingDurationS: Double,
        totalEnergyWh: Double,
        estimatedCost: Double,
        arrivalSoc: Double,
        feasible: Bool,
        isEstimate: Bool
    ) {
        self.totalDistanceM = totalDistanceM
        self.totalDurationS = totalDurationS
        self.drivingDurationS = drivingDurationS
        self.chargingDurationS = chargingDurationS
        self.totalEnergyWh = totalEnergyWh
        self.estimatedCost = estimatedCost
        self.arrivalSoc = arrivalSoc
        self.feasible = feasible
        self.isEstimate = isEstimate
    }
}

/// One driving segment between two points (web `TripLeg`). Carried in the response model for fidelity;
/// the resolved endpoints feed the `Send to Car` destination + the sibling `TripLegList` / map parity
/// units. SI canonical (meters, seconds, watt-hours; SOC percent).
public struct TripLeg: Identifiable, Hashable, Sendable {
    public let id: Int
    public let from: TripLocation
    public let to: TripLocation
    public let distanceM: Double
    public let durationS: Double
    public let energyWh: Double
    public let startSoc: Double
    public let arrivalSoc: Double

    public init(
        id: Int,
        from: TripLocation,
        to: TripLocation,
        distanceM: Double,
        durationS: Double,
        energyWh: Double,
        startSoc: Double,
        arrivalSoc: Double
    ) {
        self.id = id
        self.from = from
        self.to = to
        self.distanceM = distanceM
        self.durationS = durationS
        self.energyWh = energyWh
        self.startSoc = startSoc
        self.arrivalSoc = arrivalSoc
    }
}

/// A recommended charging stop along the route (web `TripChargeStop`). Carried for fidelity; surfaced
/// by the sibling `TripLegList` / map units. SI canonical (seconds, watt-hours; SOC percent; bare cost).
public struct TripChargeStop: Identifiable, Hashable, Sendable {
    public let id: Int
    public let name: String
    public let location: TripLocation
    public let chargeFromSoc: Double
    public let chargeToSoc: Double
    public let chargeDurationS: Double
    public let energyWh: Double
    public let cost: Double
    public let isRecommended: Bool

    public init(
        id: Int,
        name: String,
        location: TripLocation,
        chargeFromSoc: Double,
        chargeToSoc: Double,
        chargeDurationS: Double,
        energyWh: Double,
        cost: Double,
        isRecommended: Bool
    ) {
        self.id = id
        self.name = name
        self.location = location
        self.chargeFromSoc = chargeFromSoc
        self.chargeToSoc = chargeToSoc
        self.chargeDurationS = chargeDurationS
        self.energyWh = energyWh
        self.cost = cost
        self.isRecommended = isRecommended
    }
}

/// The weather adjustment applied to the energy estimate (web `TripWeatherImpact`). `avgTempC` is SI
/// Celsius (`nil` when unknown), `efficiencyFactor` a multiplier (`1.0` == no impact → panel hidden,
/// web `weather.efficiency_factor !== 1.0`), `note` a backend-authored human sentence (rendered verbatim).
public struct TripWeatherImpact: Hashable, Sendable {
    public let avgTempC: Double?
    public let efficiencyFactor: Double
    public let note: String

    public init(avgTempC: Double?, efficiencyFactor: Double, note: String) {
        self.avgTempC = avgTempC
        self.efficiencyFactor = efficiencyFactor
        self.note = note
    }
}

/// One sample of the state-of-charge-vs-distance curve (web `TripSOCPoint`). Carried for fidelity;
/// surfaced by the sibling `SOCRouteChart` parity unit.
public struct TripSOCPoint: Identifiable, Hashable, Sendable {
    public let id: Int
    public let distanceM: Double
    public let soc: Double

    public init(id: Int, distanceM: Double, soc: Double) {
        self.id = id
        self.distanceM = distanceM
        self.soc = soc
    }
}

/// The full `POST /trip-planner/plan` response (web `TripPlan`). The page surfaces `route` +
/// `weatherImpact`; `legs` / `chargeStops` / `socCurve` are carried for fidelity and consumed by the
/// sibling map / chart / leg-list parity units.
public struct TripPlan: Hashable, Sendable {
    public let route: TripPlanRoute
    public let legs: [TripLeg]
    public let chargeStops: [TripChargeStop]
    public let weatherImpact: TripWeatherImpact
    public let socCurve: [TripSOCPoint]

    public init(
        route: TripPlanRoute,
        legs: [TripLeg],
        chargeStops: [TripChargeStop],
        weatherImpact: TripWeatherImpact,
        socCurve: [TripSOCPoint]
    ) {
        self.route = route
        self.legs = legs
        self.chargeStops = chargeStops
        self.weatherImpact = weatherImpact
        self.socCurve = socCurve
    }

    /// The route's resolved destination — the last leg's `to`, else the last charge stop, used as the
    /// `Send to Car` target (web `handleSendToCar` uses the geocoded destination coordinates).
    public var resolvedDestination: TripLocation? {
        legs.last?.to ?? chargeStops.last?.location
    }
}

// MARK: - Plan phase (web `usePlanTrip` mutation lifecycle)

/// The plan-result region's phase, mirroring the web `usePlanTrip` mutation (`idle` before the first
/// plan, `planning` == `isPending`, `failed` == `isError`, `loaded` == `data`). The form panel is
/// always shown above this region (web never hides the chrome); only this region switches.
public enum TripPlanPhase: Equatable, Sendable {
    case idle
    case planning
    case failed(String)
    case loaded(TripPlan)
}

// MARK: - Data source seam (web hook: `usePlanTrip` / `useSelectedVehicle` / navigation command)

/// Supplies every datum the page needs. The production implementation binds the shared KMP
/// repositories/use-cases (ADR-004 — the view holds no networking); previews and tests inject doubles
/// to drive the idle / loading / error / success states.
///
/// Method ↔ web hook map (names kept at the Swift call sites per the parity manifest):
/// `planTrip` ← `usePlanTrip` (`POST /trip-planner/plan`); `loadVehicles` ← `useSelectedVehicle` /
/// `GET /vehicles`; `sendToCar` ← `POST /vehicles/{id}/command` (`navigation_request`).
public protocol TripPlannerDataSource: Sendable {
    func loadVehicles() async throws -> [TripPlannerVehicle]
    func planTrip(_ request: TripPlanRequest) async throws -> TripPlan
    func sendToCar(vehicleID: Int64, destination: TripLocation) async throws
}
