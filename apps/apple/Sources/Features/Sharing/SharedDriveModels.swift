import Foundation

// Parity types + payload normalization for the public Shared Drive report
// (web `web/src/features/sharing/pages/SharedDrivePage.tsx` + `web/src/types/sharing.ts`).
// Everything here is SI-canonical (meters, m/s, Wh-per-meter, percent); the view converts to the
// viewer's display units at the render boundary through `Units` (ADR-005). The wire payload may
// arrive as the legacy `v1` (km / min / km·h⁻¹ / Wh·km⁻¹) shape, so `SharedDriveWire.normalized()`
// ports the web `normalizeSharedDriveData` memo into one SI `SharedDrivePayload`.

// MARK: - Boundary constants (web normalize constants)

enum SharedDriveSI {
    /// Web `METERS_PER_KM` — lifts v1 per-point distances (km) to SI meters.
    static let metersPerKm = 1000.0
    /// Web `KMH_PER_MPS` — converts v1 speeds (km/h) to SI m/s.
    static let kmhPerMps = 3.6
}

// MARK: - SI value types (web v2 `SharedDrive*`)

/// One Tesla badge (web `SharedVehicle`).
public struct SharedVehicle: Equatable, Sendable {
    public let model: String
    public let color: String

    public init(model: String, color: String) {
        self.model = model
        self.color = color
    }
}

/// One route vertex (web `SharedMapPoint`).
public struct SharedMapPoint: Equatable, Sendable {
    public let lat: Double
    public let lng: Double

    public init(lat: Double, lng: Double) {
        self.lat = lat
        self.lng = lng
    }
}

/// One elevation-profile sample, SI (web `SharedElevationPoint`).
public struct SharedElevationPoint: Equatable, Sendable {
    public let distanceM: Double
    public let elevationM: Double

    public init(distanceM: Double, elevationM: Double) {
        self.distanceM = distanceM
        self.elevationM = elevationM
    }
}

/// One speed-profile sample, SI (web `SharedSpeedPoint`).
public struct SharedSpeedPoint: Equatable, Sendable {
    public let distanceM: Double
    public let speedMps: Double

    public init(distanceM: Double, speedMps: Double) {
        self.distanceM = distanceM
        self.speedMps = speedMps
    }
}

/// One detailed telemetry sample, SI (web `SharedTelemetryPoint`).
public struct SharedTelemetryPoint: Equatable, Sendable {
    public let distanceM: Double
    public let batteryLevel: Double?
    public let powerW: Double?
    public let elevationM: Double?

    public init(distanceM: Double, batteryLevel: Double?, powerW: Double?, elevationM: Double?) {
        self.distanceM = distanceM
        self.batteryLevel = batteryLevel
        self.powerW = powerW
        self.elevationM = elevationM
    }
}

/// The drive's headline aggregates, SI (web `SharedDriveInfo`).
public struct SharedDriveInfo: Equatable, Sendable {
    public let date: String
    public let distanceM: Double
    public let durationS: Double
    public let startAddress: String?
    public let endAddress: String?
    public let startBattery: Double?
    public let endBattery: Double?
    public let elevationGainM: Double?
    public let elevationLossM: Double?
    public let maxSpeedMps: Double?
    public let avgSpeedMps: Double?
    public let efficiencyWhPerM: Double?

    public init(
        date: String,
        distanceM: Double,
        durationS: Double,
        startAddress: String?,
        endAddress: String?,
        startBattery: Double?,
        endBattery: Double?,
        elevationGainM: Double?,
        elevationLossM: Double?,
        maxSpeedMps: Double?,
        avgSpeedMps: Double?,
        efficiencyWhPerM: Double?
    ) {
        self.date = date
        self.distanceM = distanceM
        self.durationS = durationS
        self.startAddress = startAddress
        self.endAddress = endAddress
        self.startBattery = startBattery
        self.endBattery = endBattery
        self.elevationGainM = elevationGainM
        self.elevationLossM = elevationLossM
        self.maxSpeedMps = maxSpeedMps
        self.avgSpeedMps = avgSpeedMps
        self.efficiencyWhPerM = efficiencyWhPerM
    }
}

/// The fully-normalized SI report the page renders (web v2 `SharedDriveData` after
/// `normalizeSharedDriveData`).
public struct SharedDrivePayload: Equatable, Sendable {
    public let title: String
    public let description: String?
    public let drive: SharedDriveInfo
    public let vehicle: SharedVehicle?
    public let mapPoints: [SharedMapPoint]
    public let elevationProfile: [SharedElevationPoint]
    public let speedProfile: [SharedSpeedPoint]
    public let telemetry: [SharedTelemetryPoint]

    public init(
        title: String,
        description: String?,
        drive: SharedDriveInfo,
        vehicle: SharedVehicle?,
        mapPoints: [SharedMapPoint],
        elevationProfile: [SharedElevationPoint],
        speedProfile: [SharedSpeedPoint],
        telemetry: [SharedTelemetryPoint]
    ) {
        self.title = title
        self.description = description
        self.drive = drive
        self.vehicle = vehicle
        self.mapPoints = mapPoints
        self.elevationProfile = elevationProfile
        self.speedProfile = speedProfile
        self.telemetry = telemetry
    }
}

// MARK: - Legacy v1 wire shape (web `SharedDriveDataV1`)

/// One v1 elevation sample (web `{ distance_km, elevation_m }`).
public struct SharedElevationPointV1: Equatable, Sendable {
    public let distanceKm: Double
    public let elevationM: Double

    public init(distanceKm: Double, elevationM: Double) {
        self.distanceKm = distanceKm
        self.elevationM = elevationM
    }
}

/// One v1 speed sample (web `{ distance_km, speed_kmh }`).
public struct SharedSpeedPointV1: Equatable, Sendable {
    public let distanceKm: Double
    public let speedKmh: Double

    public init(distanceKm: Double, speedKmh: Double) {
        self.distanceKm = distanceKm
        self.speedKmh = speedKmh
    }
}

/// One v1 telemetry sample (web `{ distance_km, battery_level, power, elevation }`).
public struct SharedTelemetryPointV1: Equatable, Sendable {
    public let distanceKm: Double
    public let batteryLevel: Double?
    public let powerW: Double?
    public let elevationM: Double?

    public init(distanceKm: Double, batteryLevel: Double?, powerW: Double?, elevationM: Double?) {
        self.distanceKm = distanceKm
        self.batteryLevel = batteryLevel
        self.powerW = powerW
        self.elevationM = elevationM
    }
}

/// The legacy v1 payload (web `SharedDriveDataV1`). Its drive aggregates are in km / min / km·h⁻¹ /
/// Wh·km⁻¹; `normalized()` ports the web converter to SI. Elevation gain/loss already ship in
/// meters in v1, so they pass through (matching the web memo).
public struct SharedDriveV1Payload: Equatable, Sendable {
    public let title: String
    public let description: String?
    public let date: String
    public let distanceKm: Double
    public let durationMin: Double
    public let startAddress: String?
    public let endAddress: String?
    public let startBattery: Double?
    public let endBattery: Double?
    public let elevationGainM: Double?
    public let elevationLossM: Double?
    public let maxSpeedKmh: Double?
    public let avgSpeedKmh: Double?
    public let efficiencyWhKm: Double?
    public let vehicle: SharedVehicle?
    public let mapPoints: [SharedMapPoint]
    public let elevationProfile: [SharedElevationPointV1]
    public let speedProfile: [SharedSpeedPointV1]
    public let telemetry: [SharedTelemetryPointV1]

    public init(
        title: String,
        description: String?,
        date: String,
        distanceKm: Double,
        durationMin: Double,
        startAddress: String?,
        endAddress: String?,
        startBattery: Double?,
        endBattery: Double?,
        elevationGainM: Double?,
        elevationLossM: Double?,
        maxSpeedKmh: Double?,
        avgSpeedKmh: Double?,
        efficiencyWhKm: Double?,
        vehicle: SharedVehicle?,
        mapPoints: [SharedMapPoint],
        elevationProfile: [SharedElevationPointV1],
        speedProfile: [SharedSpeedPointV1],
        telemetry: [SharedTelemetryPointV1]
    ) {
        self.title = title
        self.description = description
        self.date = date
        self.distanceKm = distanceKm
        self.durationMin = durationMin
        self.startAddress = startAddress
        self.endAddress = endAddress
        self.startBattery = startBattery
        self.endBattery = endBattery
        self.elevationGainM = elevationGainM
        self.elevationLossM = elevationLossM
        self.maxSpeedKmh = maxSpeedKmh
        self.avgSpeedKmh = avgSpeedKmh
        self.efficiencyWhKm = efficiencyWhKm
        self.vehicle = vehicle
        self.mapPoints = mapPoints
        self.elevationProfile = elevationProfile
        self.speedProfile = speedProfile
        self.telemetry = telemetry
    }

    /// Web `normalizeSharedDriveData` v1 branch: lift every legacy unit to SI.
    public func normalized() -> SharedDrivePayload {
        let metersPerKm = SharedDriveSI.metersPerKm
        let kmhPerMps = SharedDriveSI.kmhPerMps
        return SharedDrivePayload(
            title: title,
            description: description,
            drive: SharedDriveInfo(
                date: date,
                distanceM: distanceKm * metersPerKm,
                durationS: (durationMin * 60).rounded(),
                startAddress: startAddress,
                endAddress: endAddress,
                startBattery: startBattery,
                endBattery: endBattery,
                elevationGainM: elevationGainM,
                elevationLossM: elevationLossM,
                maxSpeedMps: maxSpeedKmh.map { $0 / kmhPerMps },
                avgSpeedMps: avgSpeedKmh.map { $0 / kmhPerMps },
                efficiencyWhPerM: efficiencyWhKm.map { $0 / metersPerKm }
            ),
            vehicle: vehicle,
            mapPoints: mapPoints,
            elevationProfile: elevationProfile.map {
                SharedElevationPoint(distanceM: $0.distanceKm * metersPerKm, elevationM: $0.elevationM)
            },
            speedProfile: speedProfile.map {
                SharedSpeedPoint(distanceM: $0.distanceKm * metersPerKm, speedMps: $0.speedKmh / kmhPerMps)
            },
            telemetry: telemetry.map {
                SharedTelemetryPoint(
                    distanceM: $0.distanceKm * metersPerKm,
                    batteryLevel: $0.batteryLevel,
                    powerW: $0.powerW,
                    elevationM: $0.elevationM
                )
            }
        )
    }
}

// MARK: - Wire envelope (web `SharedDriveData | SharedDriveDataV1`)

/// The shape `GET /share/{token}` returns (web `useSharedDrive` response union). `normalized()`
/// collapses either version to one SI `SharedDrivePayload`, mirroring the web page's
/// `normalizeSharedDriveData` memo so every downstream reader sees SI.
public enum SharedDriveWire: Equatable, Sendable {
    case v1(SharedDriveV1Payload)
    case v2(SharedDrivePayload)

    /// Web `normalizeSharedDriveData(rawData)` — passthrough for v2, lift-to-SI for v1.
    public func normalized() -> SharedDrivePayload {
        switch self {
        case let .v2(payload): payload
        case let .v1(legacy): legacy.normalized()
        }
    }
}
