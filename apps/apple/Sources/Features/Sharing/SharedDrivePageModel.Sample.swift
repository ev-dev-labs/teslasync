import Foundation

// Local seeds + test doubles for `SharedDrivePage` / previews. NONE of these are production data —
// they are API-response-shaped fixtures so the surface renders each state out of the box. Every
// value is SI (m, m/s, Wh-per-m, percent); the view converts at the render boundary.

/// A representative populated report (a ~24 min, ~18 km suburban drive, 78 → 64 %). Returned as the
/// SI `v2` wire shape so the success state renders without a backend.
public struct SampleSharedDriveDataSource: SharedDriveDataSource {
    public init() {}

    public func loadSharedDrive(token _: String) async throws -> SharedDriveWire {
        .v2(Self.payload)
    }

    static let payload = SharedDrivePayload(
        title: "Morning Commute",
        description: "Mountain View to Palo Alto via Foothill Expressway",
        drive: SharedDriveInfo(
            date: "Jun 16, 2026",
            distanceM: 18200,
            durationS: 24 * 60,
            startAddress: "Mountain View, CA",
            endAddress: "Palo Alto, CA",
            startBattery: 78,
            endBattery: 64,
            elevationGainM: 142,
            elevationLossM: 88,
            maxSpeedMps: 29.1,
            avgSpeedMps: 12.6,
            efficiencyWhPerM: 0.178
        ),
        vehicle: SharedVehicle(model: "Model 3", color: "Midnight Silver"),
        mapPoints: mapPoints,
        elevationProfile: elevationProfile,
        speedProfile: speedProfile,
        telemetry: []
    )

    private static let mapPoints: [SharedMapPoint] = [
        SharedMapPoint(lat: 37.4220, lng: -122.0841),
        SharedMapPoint(lat: 37.4280, lng: -122.0960),
        SharedMapPoint(lat: 37.4361, lng: -122.1080),
        SharedMapPoint(lat: 37.4452, lng: -122.1185),
        SharedMapPoint(lat: 37.4540, lng: -122.1268),
        SharedMapPoint(lat: 37.4602, lng: -122.1338)
    ]

    private static let elevationProfile: [SharedElevationPoint] = (0 ..< 24).map { step in
        let fraction = Double(step) / 23
        return SharedElevationPoint(
            distanceM: fraction * 18200,
            elevationM: 24 + 120 * sin(fraction * .pi)
        )
    }

    private static let speedProfile: [SharedSpeedPoint] = (0 ..< 24).map { step in
        let fraction = Double(step) / 23
        return SharedSpeedPoint(
            distanceM: fraction * 18200,
            speedMps: 8 + 18 * abs(sin(fraction * .pi * 1.5))
        )
    }
}

/// A report with no route / elevation / speed data — exercises the web "no map data" empty branch.
public struct NoRouteSharedDriveDataSource: SharedDriveDataSource {
    public init() {}

    public func loadSharedDrive(token _: String) async throws -> SharedDriveWire {
        .v2(
            SharedDrivePayload(
                title: "Quick Errand",
                description: nil,
                drive: SharedDriveInfo(
                    date: "Jun 16, 2026",
                    distanceM: 2400,
                    durationS: 6 * 60,
                    startAddress: nil,
                    endAddress: nil,
                    startBattery: nil,
                    endBattery: nil,
                    elevationGainM: nil,
                    elevationLossM: nil,
                    maxSpeedMps: nil,
                    avgSpeedMps: nil,
                    efficiencyWhPerM: nil
                ),
                vehicle: nil,
                mapPoints: [],
                elevationProfile: [],
                speedProfile: [],
                telemetry: []
            )
        )
    }
}

/// A legacy `v1` report — exercises the `normalizeSharedDriveData` v1 → SI lift end-to-end.
public struct LegacySharedDriveDataSource: SharedDriveDataSource {
    public init() {}

    public func loadSharedDrive(token _: String) async throws -> SharedDriveWire {
        .v1(
            SharedDriveV1Payload(
                title: "Legacy Trip",
                description: "Imported share (v1 payload)",
                date: "Jun 16, 2026",
                distanceKm: 18.2,
                durationMin: 24,
                startAddress: "Mountain View, CA",
                endAddress: "Palo Alto, CA",
                startBattery: 78,
                endBattery: 64,
                elevationGainM: 142,
                elevationLossM: 88,
                maxSpeedKmh: 104.76,
                avgSpeedKmh: 45.36,
                efficiencyWhKm: 178,
                vehicle: SharedVehicle(model: "Model Y", color: "Pearl White"),
                mapPoints: [
                    SharedMapPoint(lat: 37.4220, lng: -122.0841),
                    SharedMapPoint(lat: 37.4452, lng: -122.1185),
                    SharedMapPoint(lat: 37.4602, lng: -122.1338)
                ],
                elevationProfile: [
                    SharedElevationPointV1(distanceKm: 0, elevationM: 24),
                    SharedElevationPointV1(distanceKm: 9.1, elevationM: 144),
                    SharedElevationPointV1(distanceKm: 18.2, elevationM: 30)
                ],
                speedProfile: [
                    SharedSpeedPointV1(distanceKm: 0, speedKmh: 0),
                    SharedSpeedPointV1(distanceKm: 9.1, speedKmh: 94),
                    SharedSpeedPointV1(distanceKm: 18.2, speedKmh: 12)
                ],
                telemetry: []
            )
        )
    }
}

/// A failing source — exercises the expired / error view (web `error` branch).
public struct FailingSharedDriveDataSource: SharedDriveDataSource {
    struct ShareUnavailable: Error {}

    public init() {}

    public func loadSharedDrive(token _: String) async throws -> SharedDriveWire {
        throw ShareUnavailable()
    }
}
