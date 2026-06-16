import Foundation

/// A representative local seed used as the `TripPlannerPage` / preview default until the KMP-backed
/// source is injected at composition time. It is NOT production telemetry — it is an
/// API-response-shaped fixture (3 vehicles; a feasible ~612 km plan with one Supercharger stop, a
/// weather adjustment, and a SOC curve) so the surface renders its populated success state out of the
/// box. All measurements are SI canonical (meters, seconds, watt-hours, °C; SOC + cost bare); the view
/// converts at the boundary. `planTrip` derives the leg endpoints from the request so the typed
/// origin/destination round-trip into the resolved `Send to Car` target.
public struct SampleTripPlannerDataSource: TripPlannerDataSource {
    public init() {}

    public func loadVehicles() async throws -> [TripPlannerVehicle] {
        [
            TripPlannerVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001", batteryLevel: 82),
            TripPlannerVehicle(id: 2, displayName: "Tachi", vin: "5YJYGDEE1LF000002", batteryLevel: 64),
            TripPlannerVehicle(id: 3, displayName: "Razorback", vin: "5YJSA1E26MF000003", batteryLevel: nil)
        ]
    }

    public func planTrip(_ request: TripPlanRequest) async throws -> TripPlan {
        Self.plan(for: request)
    }

    public func sendToCar(vehicleID _: Int64, destination _: TripLocation) async throws {
        // No-op fixture — the production source posts the `navigation_request` command.
    }

    /// Builds the deterministic fixture plan, threading the request's typed origin/destination through
    /// the leg endpoints so the resolved destination (and `Send to Car`) reflects what the user entered.
    public static func plan(for request: TripPlanRequest) -> TripPlan {
        let origin = TripLocation(
            lat: 37.7749,
            lng: -122.4194,
            name: nonEmpty(request.origin.name, "San Francisco, CA")
        )
        let charger = TripLocation(lat: 36.6066, lng: -121.8744, name: "Supercharger — Seaside, CA")
        let destination = TripLocation(
            lat: 34.0522,
            lng: -118.2437,
            name: nonEmpty(request.destination.name, "Los Angeles, CA")
        )
        let route = sampleRoute(for: request)
        return TripPlan(
            route: route,
            legs: sampleLegs(
                origin: origin,
                charger: charger,
                destination: destination,
                request: request,
                route: route
            ),
            chargeStops: [sampleChargeStop(at: charger)],
            weatherImpact: sampleWeather(),
            socCurve: sampleSOCCurve(request: request, route: route)
        )
    }

    private static func sampleRoute(for request: TripPlanRequest) -> TripPlanRoute {
        TripPlanRoute(
            totalDistanceM: 612_000,
            totalDurationS: 27000,
            drivingDurationS: 21600,
            chargingDurationS: 5400,
            totalEnergyWh: 95400,
            estimatedCost: 28.5,
            arrivalSoc: max(request.minArrivalSoc, 22),
            feasible: true,
            isEstimate: true
        )
    }

    private static func sampleLegs(
        origin: TripLocation,
        charger: TripLocation,
        destination: TripLocation,
        request: TripPlanRequest,
        route: TripPlanRoute
    ) -> [TripLeg] {
        [
            TripLeg(
                id: 0,
                from: origin,
                to: charger,
                distanceM: 168_000,
                durationS: 6600,
                energyWh: 27200,
                startSoc: request.currentSoc,
                arrivalSoc: 24
            ),
            TripLeg(
                id: 1,
                from: charger,
                to: destination,
                distanceM: 444_000,
                durationS: 15000,
                energyWh: 68200,
                startSoc: 80,
                arrivalSoc: route.arrivalSoc
            )
        ]
    }

    private static func sampleChargeStop(at charger: TripLocation) -> TripChargeStop {
        TripChargeStop(
            id: 0,
            name: charger.name,
            location: charger,
            chargeFromSoc: 24,
            chargeToSoc: 80,
            chargeDurationS: 5400,
            energyWh: 42000,
            cost: 18.9,
            isRecommended: true
        )
    }

    private static func sampleWeather() -> TripWeatherImpact {
        TripWeatherImpact(
            avgTempC: 8,
            efficiencyFactor: 1.12,
            note: "Cold conditions along the route raise consumption by ~12%."
        )
    }

    private static func sampleSOCCurve(request: TripPlanRequest, route: TripPlanRoute) -> [TripSOCPoint] {
        [
            TripSOCPoint(id: 0, distanceM: 0, soc: request.currentSoc),
            TripSOCPoint(id: 1, distanceM: 168_000, soc: 24),
            TripSOCPoint(id: 2, distanceM: 168_001, soc: 80),
            TripSOCPoint(id: 3, distanceM: 612_000, soc: route.arrivalSoc)
        ]
    }

    private static func nonEmpty(_ value: String, _ fallback: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? fallback : trimmed
    }
}

#if DEBUG
    /// Preview/test seam that yields vehicles but is never asked to plan — drives the idle results
    /// state (web: nothing below the form until the first plan), without collapsing the form chrome.
    public struct EmptyTripPlannerDataSource: TripPlannerDataSource {
        public init() {}

        public func loadVehicles() async throws -> [TripPlannerVehicle] {
            [TripPlannerVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001", batteryLevel: 82)]
        }

        public func planTrip(_ request: TripPlanRequest) async throws -> TripPlan {
            SampleTripPlannerDataSource.plan(for: request)
        }

        public func sendToCar(vehicleID _: Int64, destination _: TripLocation) async throws {}
    }

    /// Preview/test seam whose plan request fails — drives the error data state (web `planMutation.isError`;
    /// the native results region offers a Retry).
    public struct FailingTripPlannerDataSource: TripPlannerDataSource {
        public struct Failure: Error {}
        public init() {}

        public func loadVehicles() async throws -> [TripPlannerVehicle] {
            [TripPlannerVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001", batteryLevel: 82)]
        }

        public func planTrip(_: TripPlanRequest) async throws -> TripPlan {
            throw Failure()
        }

        public func sendToCar(vehicleID _: Int64, destination _: TripLocation) async throws {}
    }
#endif
