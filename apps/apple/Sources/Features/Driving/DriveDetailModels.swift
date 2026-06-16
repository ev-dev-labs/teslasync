import Foundation

// Value types + pure derivations for the Driving detail surface (web
// `web/src/features/driving/pages/DriveDetailPage.tsx`, route `/drives/:id`). The page reads
// one drive (web hooks `useDrive` + `useVehicle`, plus the lazy `useDriveWhyEnded`) and
// renders the header, hero gauges, timeline, eight stat cards, the more-details / energy /
// cost / journey panels, the route map, six time-series charts + a speed histogram, and the
// why-ended diagnostic.
//
// Everything is stored SI (m, m/s, Wh, W, °C, kPa — phase-42/48 canonical) and converted only
// at the SwiftUI render boundary via `Units` (ADR-005). The pure derivations the web computes
// inline in `useDriveDetailData` — the unified chart/route sample set, the aggregate `DriveStats`,
// the meaningful-telemetry gate, the speed histogram, and the route speed bands — live here as
// SwiftUI-free, unit-tested functions.

// MARK: - Vehicle (web `useVehicle` → `GET /vehicles/{id}`)

/// The owning vehicle (web `vehicle.display_name`). Identity + label only.
public struct DriveDetailVehicle: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let displayName: String

    public init(id: Int64, displayName: String) {
        self.id = id
        self.displayName = displayName
    }
}

// MARK: - Telemetry / position sample (web `drive.telemetry[]` / `drive.positions[]`)

/// One per-second drive sample. Every measurement is SI (m, m/s, Wh, W, °C, kPa); the legacy
/// `_mph`/`Pa` suffixes the backend mappings carry are misleading (ADR-004 #6), so the data
/// source normalizes them to SI here and the view converts at the render boundary.
public struct DriveTelemetrySample: Identifiable, Hashable, Sendable {
    public let id: String
    public let createdAt: Date
    public let latitude: Double?
    public let longitude: Double?
    public let speedMps: Double?
    public let batteryPct: Double?
    public let elevationM: Double?
    public let powerW: Double?
    public let outsideTempC: Double?
    public let insideTempC: Double?
    public let driverTempC: Double?
    public let passengerTempC: Double?
    public let idealRangeM: Double?
    public let ratedRangeM: Double?
    public let estRangeM: Double?
    public let odometerM: Double?
    public let socPct: Double?
    public let usableSocPct: Double?
    public let tireFlKpa: Double?
    public let tireFrKpa: Double?
    public let tireRlKpa: Double?
    public let tireRrKpa: Double?
    public let climateOn: Bool?
    public let fanStatus: Double?

    public init(
        id: String,
        createdAt: Date,
        latitude: Double? = nil,
        longitude: Double? = nil,
        speedMps: Double? = nil,
        batteryPct: Double? = nil,
        elevationM: Double? = nil,
        powerW: Double? = nil,
        outsideTempC: Double? = nil,
        insideTempC: Double? = nil,
        driverTempC: Double? = nil,
        passengerTempC: Double? = nil,
        idealRangeM: Double? = nil,
        ratedRangeM: Double? = nil,
        estRangeM: Double? = nil,
        odometerM: Double? = nil,
        socPct: Double? = nil,
        usableSocPct: Double? = nil,
        tireFlKpa: Double? = nil,
        tireFrKpa: Double? = nil,
        tireRlKpa: Double? = nil,
        tireRrKpa: Double? = nil,
        climateOn: Bool? = nil,
        fanStatus: Double? = nil
    ) {
        self.id = id
        self.createdAt = createdAt
        self.latitude = latitude
        self.longitude = longitude
        self.speedMps = speedMps
        self.batteryPct = batteryPct
        self.elevationM = elevationM
        self.powerW = powerW
        self.outsideTempC = outsideTempC
        self.insideTempC = insideTempC
        self.driverTempC = driverTempC
        self.passengerTempC = passengerTempC
        self.idealRangeM = idealRangeM
        self.ratedRangeM = ratedRangeM
        self.estRangeM = estRangeM
        self.odometerM = odometerM
        self.socPct = socPct
        self.usableSocPct = usableSocPct
        self.tireFlKpa = tireFlKpa
        self.tireFrKpa = tireFrKpa
        self.tireRlKpa = tireRlKpa
        self.tireRrKpa = tireRrKpa
        self.climateOn = climateOn
        self.fanStatus = fanStatus
    }
}

// MARK: - Drive (web `useDrive` → `GET /drives/{id}`)

/// One drive. Aggregates are SI (m, s, Wh, W, m/s); the per-sample `telemetry`/`positions`
/// feed the charts + route. `positions` is the fallback coordinate source when telemetry is
/// empty, mirroring the web `useDriveDetailData` route/chart precedence.
public struct DriveDetailRecord: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let vehicleID: Int64
    public let startedAt: Date
    public let endedAt: Date?
    public let durationS: Double
    public let distanceM: Double
    public let startAddress: String?
    public let endAddress: String?
    public let startLat: Double?
    public let startLon: Double?
    public let endLat: Double?
    public let endLon: Double?
    public let startBatteryPct: Double?
    public let endBatteryPct: Double?
    public let energyUsedWh: Double?
    public let regenEnergyWh: Double?
    public let avgSpeedMps: Double?
    public let maxSpeedMps: Double?
    public let avgPowerW: Double?
    public let telemetry: [DriveTelemetrySample]
    public let positions: [DriveTelemetrySample]

    public init(
        id: Int64,
        vehicleID: Int64,
        startedAt: Date,
        endedAt: Date?,
        durationS: Double,
        distanceM: Double,
        startAddress: String?,
        endAddress: String?,
        startLat: Double?,
        startLon: Double?,
        endLat: Double?,
        endLon: Double?,
        startBatteryPct: Double?,
        endBatteryPct: Double?,
        energyUsedWh: Double?,
        regenEnergyWh: Double?,
        avgSpeedMps: Double?,
        maxSpeedMps: Double?,
        avgPowerW: Double?,
        telemetry: [DriveTelemetrySample],
        positions: [DriveTelemetrySample]
    ) {
        self.id = id
        self.vehicleID = vehicleID
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.durationS = durationS
        self.distanceM = distanceM
        self.startAddress = startAddress
        self.endAddress = endAddress
        self.startLat = startLat
        self.startLon = startLon
        self.endLat = endLat
        self.endLon = endLon
        self.startBatteryPct = startBatteryPct
        self.endBatteryPct = endBatteryPct
        self.energyUsedWh = energyUsedWh
        self.regenEnergyWh = regenEnergyWh
        self.avgSpeedMps = avgSpeedMps
        self.maxSpeedMps = maxSpeedMps
        self.avgPowerW = avgPowerW
        self.telemetry = telemetry
        self.positions = positions
    }
}

// MARK: - Why-ended diagnostic (web `useDriveWhyEnded` → `GET /drives/{id}/why-ended`)

/// Server-validated diagnostic window (web `DriveDiagnosticWindow`).
public enum DriveDetailDiagnosticWindow: String, CaseIterable, Identifiable, Sendable {
    case s30 = "30s"
    case s60 = "60s"
    case m5 = "5m"
    case m15 = "15m"

    public var id: String {
        rawValue
    }
}

/// One FSM transition row (web `DriveDiagnosticTransition`).
public struct DriveFsmTransition: Identifiable, Hashable, Sendable {
    public let id: String
    public let fsmName: String
    public let fromState: String
    public let toState: String
    public let trigger: String
    public let timestamp: Date

    public init(id: String, fsmName: String, fromState: String, toState: String, trigger: String, timestamp: Date) {
        self.id = id
        self.fsmName = fsmName
        self.fromState = fromState
        self.toState = toState
        self.trigger = trigger
        self.timestamp = timestamp
    }
}

/// One raw signal row near the drive end (web `DriveDiagnosticSignal`).
public struct DriveSignalRow: Identifiable, Hashable, Sendable {
    public let id: String
    public let timestamp: Date
    public let field: String
    public let value: String

    public init(id: String, timestamp: Date, field: String, value: String) {
        self.id = id
        self.timestamp = timestamp
        self.field = field
        self.value = value
    }
}

/// The why-ended diagnostic payload (web `why.data`).
public struct DriveWhyEnded: Hashable, Sendable {
    public let transitions: [DriveFsmTransition]
    public let signals: [DriveSignalRow]

    public init(transitions: [DriveFsmTransition], signals: [DriveSignalRow]) {
        self.transitions = transitions
        self.signals = signals
    }
}

// MARK: - Climate status (web `stats.climateStatus`)

/// Aggregate climate state across the drive (web `'On' | 'Mostly Off' | 'Off'`).
public enum DriveClimateStatus: Equatable, Sendable {
    case on
    case mostlyOff
    case off

    /// Whether climate read as actively on (drives the web green vs. muted tone).
    public var isOn: Bool {
        self == .on
    }
}

// MARK: - Derived aggregates (web `useDriveDetailData` `stats`)

/// SI aggregate metrics derived from the drive + its samples, mirroring the web `DriveStats`.
/// Speeds m/s, power W, energy Wh, elevation/range/odometer m, temps °C; ratios stay as
/// Wh-per-km and convert at the render boundary like the web page.
public struct DriveStats: Equatable, Sendable {
    public let maxSpeedMps: Double
    public let avgSpeedMps: Double
    public let minSpeedMps: Double
    public let powerMaxW: Double
    public let powerMinW: Double
    public let avgPowerW: Double
    public let energyWh: Double
    public let regenWh: Double
    public let consumptionWhPerKm: Double
    public let elevGainM: Double
    public let elevLossM: Double
    public let avgOutsideTempC: Double?
    public let avgInsideTempC: Double?
    public let avgDriverTempC: Double?
    public let avgPassengerTempC: Double?
    public let hasAnyTemp: Bool
    public let outsideTempCount: Int
    public let insideTempCount: Int
    public let driverTempCount: Int
    public let passengerTempCount: Int
    public let climateStatus: DriveClimateStatus?
    public let avgFanSpeed: Double?
    public let maxFanSpeed: Double?
    public let startRangeM: Double?
    public let endRangeM: Double?
    public let odometerStartM: Double
    public let odometerEndM: Double
    public let hasTirePressure: Bool
    public let batteryUsedPct: Double?
}

// MARK: - Route + histogram value types

/// A route vertex (web `RoutePoint`). `speedMps` drives the colour band.
public struct DriveRouteCoordinate: Hashable, Sendable {
    public let latitude: Double
    public let longitude: Double
    public let speedMps: Double

    public init(latitude: Double, longitude: Double, speedMps: Double) {
        self.latitude = latitude
        self.longitude = longitude
        self.speedMps = speedMps
    }
}

/// Speed-colour band for a route segment (web `SpeedSegment.color`). The palette index keeps
/// the map content on the design-token palette instead of raw hex.
public enum DriveSpeedBand: Sendable {
    case low, medium, high, veryHigh

    /// Token palette index (cyan / emerald / amber / rose) matching the web legend order.
    public var colorIndex: Int {
        switch self {
        case .low: 2
        case .medium: 0
        case .high: 3
        case .veryHigh: 7
        }
    }
}

/// One speed-distribution bucket (web `SpeedHistogramBucket`). `range` is a display-unit label.
public struct SpeedHistogramBucket: Identifiable, Hashable, Sendable {
    public let id: String
    public let range: String
    public let pct: Double

    public init(range: String, pct: Double) {
        id = range
        self.range = range
        self.pct = pct
    }
}

// MARK: - Page phase (web `isLoading ? Skeleton : (error ? error : body)`)

/// The page's terminal phase. `.ready` is the web body (drive + stats resolved; every section
/// renders its own success/empty). `.error` is a retryable failure of the drive fetch (web
/// `PageContainer error`); `.loading` is the initial fetch (web `DriveDetailSkeleton`).
public enum DriveDetailPhase: Equatable, Sendable {
    case loading
    case error(String)
    case ready
}

// MARK: - Section identity (web per-section `SectionErrorBoundary`)

/// The drive-detail sections, each fronted by its own error boundary in the web page. The
/// `failedTitleKey` is the localized fallback title the boundary shows (web `fallbackTitle`).
public enum DriveDetailSectionID: String, CaseIterable, Sendable {
    case header, heroGauges, timeline, statCards, aiCoaching, moreDetails, energySummary
    case costSavings, routeMap, journeyDetails, overviewChart, socChart, elevationChart
    case temperature, speedHistogram, aiSpeedProfileInsights, powerProfile, tirePressure, whyEnded
}
