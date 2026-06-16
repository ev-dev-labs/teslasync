import Foundation

/// A representative local seed used as the `RouteEfficiencyPage` / preview default until the
/// KMP-backed source is injected at composition time. It is NOT production telemetry — it is an
/// API-response-shaped fixture (the web `RouteSummary[]` shape) so the surface renders its populated
/// success state out of the box. Efficiencies are `Wh/km` and distances kilometers, exactly as the
/// `/analytics/route-efficiency` endpoint reports; the view converts at the display boundary.
public struct SampleRouteEfficiencyDataSource: RouteEfficiencyDataSource {
    public init() {}

    public func loadVehicles() async throws -> [RouteEfficiencyVehicle] {
        [
            RouteEfficiencyVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001"),
            RouteEfficiencyVehicle(id: 2, displayName: "Tachi", vin: "5YJYGDEE1LF000002"),
            RouteEfficiencyVehicle(id: 3, displayName: "Razorback", vin: "5YJSA1E26MF000003")
        ]
    }

    public func useRouteEfficiency(
        vehicleID: Int64,
        start _: Date,
        end _: Date
    ) async throws -> [RouteEfficiencyRoute] {
        // Vehicle 2 is a lightly-driven car with a single route; the others span the full
        // success/info/warning/danger efficiency-variant range so every panel + the chart populate.
        if vehicleID == 2 {
            return [
                RouteEfficiencyRoute(
                    startLocation: "Home",
                    endLocation: "Office",
                    tripCount: 6,
                    avgDistanceKm: 18.4,
                    avgEfficiency: 158,
                    bestEfficiency: 132,
                    worstEfficiency: 191
                )
            ]
        }
        return Self.fleetRoutes
    }

    /// Six aggregated routes covering the full efficiency-variant spread (best < 140 → worst ≥ 220).
    private static let fleetRoutes: [RouteEfficiencyRoute] = [
        RouteEfficiencyRoute(
            startLocation: "Market St, San Francisco",
            endLocation: "Sand Hill Rd, Menlo Park",
            tripCount: 42,
            avgDistanceKm: 58.2,
            avgEfficiency: 152,
            bestEfficiency: 128,
            worstEfficiency: 188
        ),
        RouteEfficiencyRoute(
            startLocation: "Embarcadero, San Francisco",
            endLocation: "Page Mill Rd, Palo Alto",
            tripCount: 31,
            avgDistanceKm: 61.7,
            avgEfficiency: 171,
            bestEfficiency: 139,
            worstEfficiency: 214
        ),
        RouteEfficiencyRoute(
            startLocation: "Bay Bridge, Oakland",
            endLocation: "Shoreline Blvd, Mountain View",
            tripCount: 24,
            avgDistanceKm: 47.9,
            avgEfficiency: 134,
            bestEfficiency: 112,
            worstEfficiency: 169
        ),
        RouteEfficiencyRoute(
            startLocation: "Mission District, San Francisco",
            endLocation: "Tahoe City, Lake Tahoe",
            tripCount: 9,
            avgDistanceKm: 312.5,
            avgEfficiency: 205,
            bestEfficiency: 168,
            worstEfficiency: 248
        ),
        RouteEfficiencyRoute(
            startLocation: "Presidio, San Francisco",
            endLocation: "Santa Cruz Wharf",
            tripCount: 14,
            avgDistanceKm: 121.3,
            avgEfficiency: 226,
            bestEfficiency: 184,
            worstEfficiency: 271
        ),
        RouteEfficiencyRoute(
            startLocation: "SoMa, San Francisco",
            endLocation: "Berkeley Marina",
            tripCount: 18,
            avgDistanceKm: 22.6,
            avgEfficiency: 147,
            bestEfficiency: 121,
            worstEfficiency: 182
        )
    ]
}

#if DEBUG
    /// Preview/test seam yielding a vehicle with no routes — drives the page's empty state (web
    /// `routes.length === 0`: the summary reads zeros and the metrics panel shows `common.noData`).
    public struct EmptyRouteEfficiencyDataSource: RouteEfficiencyDataSource {
        public init() {}

        public func loadVehicles() async throws -> [RouteEfficiencyVehicle] {
            [RouteEfficiencyVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func useRouteEfficiency(
            vehicleID _: Int64,
            start _: Date,
            end _: Date
        ) async throws -> [RouteEfficiencyRoute] {
            []
        }
    }

    /// Preview/test seam whose load fails — drives the error state (web `useRouteEfficiency.error` →
    /// `PageContainer error`).
    public struct FailingRouteEfficiencyDataSource: RouteEfficiencyDataSource {
        public struct Failure: Error {}
        public init() {}

        public func loadVehicles() async throws -> [RouteEfficiencyVehicle] {
            [RouteEfficiencyVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func useRouteEfficiency(
            vehicleID _: Int64,
            start _: Date,
            end _: Date
        ) async throws -> [RouteEfficiencyRoute] {
            throw Failure()
        }
    }
#endif
