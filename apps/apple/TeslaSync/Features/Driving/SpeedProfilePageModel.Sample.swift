//
//  SpeedProfilePageModel.Sample.swift
//  TeslaSync — P4 feature view · P7 · driving/SpeedProfile (Apple) — Sample data
//
//  A representative local seed used as the `SpeedProfilePage` / preview default
//  until the KMP-backed source is injected at composition time. It is NOT
//  production telemetry — it is an API-response-shaped fixture (the web
//  `SpeedProfileData` + `Drive[]` shapes) so the surface renders its populated
//  success state out of the box. Speeds are m/s and consumption Wh/km, exactly as
//  the `/analytics/speed-profile` + `/drives` endpoints report (SI); the view
//  converts at the display boundary.
//

import Foundation

struct SampleSpeedProfileDataSource: SpeedProfileDataSource {
    func loadVehicles() async throws -> [SpeedProfileVehicle] {
        [
            SpeedProfileVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001"),
            SpeedProfileVehicle(id: 2, displayName: "Tachi", vin: "5YJYGDEE1LF000002"),
            SpeedProfileVehicle(id: 3, displayName: "Razorback", vin: "5YJSA1E26MF000003")
        ]
    }

    func useSpeedProfile(vehicleID: Int64, start _: Date?, end _: Date) async throws -> SpeedProfileSummary? {
        // Vehicle 2 is lightly driven — a single populated bucket — yet still a valid
        // (non-empty) response so the success state renders for every vehicle.
        if vehicleID == 2 {
            return SpeedProfileSummary(
                distribution: [
                    SpeedProfileBucket(label: "0-15", readings: 22),
                    SpeedProfileBucket(label: "15-30", readings: 64),
                    SpeedProfileBucket(label: "30-45", readings: 41)
                ],
                avgSpeedMps: 9.7,
                peakSpeedMps: 22.4,
                optimalSpeedMps: 12.5
            )
        }
        return Self.fleetSummary
    }

    func useDrives(vehicleID: Int64) async throws -> [SpeedProfileDrive] {
        vehicleID == 2 ? Self.lightDrives() : Self.fleetDrives()
    }

    /// A seven-bucket distribution spanning the full color band (0-15 … 90+) with a
    /// bell-ish reading shape, plus the avg/peak/optimal hero speeds in m/s.
    private static let fleetSummary = SpeedProfileSummary(
        distribution: [
            SpeedProfileBucket(label: "0-15", readings: 120),
            SpeedProfileBucket(label: "15-30", readings: 340),
            SpeedProfileBucket(label: "30-45", readings: 520),
            SpeedProfileBucket(label: "45-60", readings: 410),
            SpeedProfileBucket(label: "60-75", readings: 230),
            SpeedProfileBucket(label: "75-90", readings: 95),
            SpeedProfileBucket(label: "90+", readings: 40)
        ],
        avgSpeedMps: 13.9,
        peakSpeedMps: 38.9,
        optimalSpeedMps: 16.7
    )

    /// Twelve drives whose speeds spread across the buckets and whose consumption
    /// spans the efficient→high bands, so the scatter cloud (> 3 points), the
    /// per-bucket efficiency table, and the band legend all populate.
    private static func fleetDrives(now: Date = Date()) -> [SpeedProfileDrive] {
        let specs: [DriveSpec] = [
            DriveSpec(speedMps: 7.5, distanceM: 22000, energyWh: 2640), // ~27 km/h · 120 Wh/km
            DriveSpec(speedMps: 9.2, distanceM: 18500, energyWh: 2590), // ~33 km/h · 140 Wh/km
            DriveSpec(speedMps: 12.8, distanceM: 41000, energyWh: 6150), // ~46 km/h · 150 Wh/km
            DriveSpec(speedMps: 14.1, distanceM: 52000, energyWh: 8840), // ~51 km/h · 170 Wh/km
            DriveSpec(speedMps: 16.6, distanceM: 63000, energyWh: 11340), // ~60 km/h · 180 Wh/km
            DriveSpec(speedMps: 18.3, distanceM: 47500, energyWh: 9500), // ~66 km/h · 200 Wh/km
            DriveSpec(speedMps: 20.0, distanceM: 38000, energyWh: 8360), // ~72 km/h · 220 Wh/km
            DriveSpec(speedMps: 22.5, distanceM: 71000, energyWh: 16330), // ~81 km/h · 230 Wh/km
            DriveSpec(speedMps: 25.1, distanceM: 29000, energyWh: 7250), // ~90 km/h · 250 Wh/km
            DriveSpec(speedMps: 27.4, distanceM: 33500, energyWh: 9380), // ~99 km/h · 280 Wh/km
            DriveSpec(speedMps: 30.2, distanceM: 24000, energyWh: 7200), // ~109 km/h · 300 Wh/km
            DriveSpec(speedMps: 13.4, distanceM: 56000, energyWh: 8400) // ~48 km/h · 150 Wh/km
        ]
        return drives(from: specs, idBase: 1000, startBattery: 88, stride: 3, now: now)
    }

    /// A handful of low-speed drives for the lightly-driven vehicle (still > 3 so the
    /// scatter renders).
    private static func lightDrives(now: Date = Date()) -> [SpeedProfileDrive] {
        let specs: [DriveSpec] = [
            DriveSpec(speedMps: 6.8, distanceM: 12000, energyWh: 1560),
            DriveSpec(speedMps: 8.4, distanceM: 16500, energyWh: 2310),
            DriveSpec(speedMps: 9.9, distanceM: 19000, energyWh: 2850),
            DriveSpec(speedMps: 11.2, distanceM: 22500, energyWh: 3825),
            DriveSpec(speedMps: 12.6, distanceM: 14000, energyWh: 2520)
        ]
        return drives(from: specs, idBase: 2000, startBattery: 72, stride: 4, now: now)
    }

    /// One fixture drive shape (SI): average speed, distance, and energy used.
    private struct DriveSpec {
        let speedMps: Double
        let distanceM: Double
        let energyWh: Double
    }

    /// Materializes fixture drives spaced `stride` days apart back from `now`.
    private static func drives(
        from specs: [DriveSpec],
        idBase: Int,
        startBattery: Double,
        stride: Int,
        now: Date
    ) -> [SpeedProfileDrive] {
        specs.enumerated().map { index, spec in
            SpeedProfileDrive(
                id: Int64(idBase + index),
                startTs: now.addingTimeInterval(Double(-index * stride) * 86400),
                distanceM: spec.distanceM,
                energyUsedWh: spec.energyWh,
                startBatteryPct: startBattery,
                endBatteryPct: startBattery - (spec.energyWh / 750),
                avgSpeedMps: spec.speedMps
            )
        }
    }
}

#if DEBUG
    /// Preview/test seam yielding no speed-profile response — drives the page's empty
    /// state (web `data` falsy → the `speedProfile.noData` `EmptyState`).
    struct EmptySpeedProfileDataSource: SpeedProfileDataSource {
        func loadVehicles() async throws -> [SpeedProfileVehicle] {
            [SpeedProfileVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        func useSpeedProfile(vehicleID _: Int64, start _: Date?, end _: Date) async throws -> SpeedProfileSummary? {
            nil
        }

        func useDrives(vehicleID _: Int64) async throws -> [SpeedProfileDrive] {
            []
        }
    }

    /// Preview/test seam whose speed-profile load fails — drives the error state
    /// (web `useSpeedProfile.error` → `PageContainer error`).
    struct FailingSpeedProfileDataSource: SpeedProfileDataSource {
        struct Failure: Error {}

        func loadVehicles() async throws -> [SpeedProfileVehicle] {
            [SpeedProfileVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        func useSpeedProfile(vehicleID _: Int64, start _: Date?, end _: Date) async throws -> SpeedProfileSummary? {
            throw Failure()
        }

        func useDrives(vehicleID _: Int64) async throws -> [SpeedProfileDrive] {
            []
        }
    }
#endif
