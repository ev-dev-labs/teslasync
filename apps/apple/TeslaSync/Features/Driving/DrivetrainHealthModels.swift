import SwiftUI

// Value types for the Drivetrain Health surface (web
// `web/src/features/driving/pages/DrivetrainHealthPage.tsx`, route `/drivetrain-health`). Every
// measurement is SI canonical — degrees Celsius, meters, m/s, watts, watt-hours, kilograms — exactly as
// Phase-42 stores it; the user's unit preference is applied only at the SwiftUI render boundary via the
// shared `Units` facade + `DrivetrainHealthPageFormat` (ADR-005, SI-cutover instructions). Power values
// that the backend already derives in kilowatts (`/motor` `power_kw` / `regen_kw`) stay kW — the web
// shows them verbatim with a `kW` label. Names are prefixed to avoid colliding with the dashboard
// widget's `Drivetrain*` types.

// MARK: - Health grade (web `HealthStatus = 'good' | 'warning' | 'critical'`)

/// The overall drivetrain condition (web `health.overallHealth`). Carries the web `HEALTH_SCORE`,
/// `HEALTH_COLOR`, badge tone, and panel-glow palette so every consumer derives from one source.
public enum DrivetrainHealthGrade: String, CaseIterable, Sendable {
    case good
    case warning
    case critical

    /// Web `HEALTH_SCORE[overallHealth]` (good 95 / warning 60 / critical 25).
    public var score: Int {
        switch self {
        case .good: 95
        case .warning: 60
        case .critical: 25
        }
    }

    /// Web `healthBadgeVariant` (good→success / warning→warning / critical→danger).
    public var tone: TSTone {
        switch self {
        case .good: .success
        case .warning: .warning
        case .critical: .danger
        }
    }

    /// Web `getAlertVariant` for the overview banner (warning→warning, else danger).
    public var alertTone: TSTone {
        self == .warning ? .warning : .danger
    }

    /// The brand-palette slot used to tint the health-score gauge ring.
    public var paletteIndex: Int {
        switch self {
        case .good: 2
        case .warning: 1
        case .critical: 5
        }
    }
}

// MARK: - Vehicle (web `useSelectedVehicle` → `GET /vehicles`)

/// One selectable vehicle (web `vehicle.display_name || vehicle.vin`). Identity + label strings, not SI
/// measurements, so they round-trip verbatim.
public struct DrivetrainVehicle: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let displayName: String
    public let vin: String

    public init(id: Int64, displayName: String, vin: String) {
        self.id = id
        self.displayName = displayName
        self.vin = vin
    }

    /// Web `vehicle.display_name || vehicle.vin` — the label shown in the selector.
    public var name: String {
        displayName.isEmpty ? vin : displayName
    }
}

// MARK: - Drivetrain health (web `useDrivetrainHealth` → `DrivetrainHealthData`)

/// The drivetrain thermal/condition roll-up (web `DrivetrainHealthData`). Temperatures are SI °C and may
/// be `nil` when the sensor has not reported.
public struct DrivetrainHealthSummary: Hashable, Sendable {
    public let frontMotorTempC: Double?
    public let rearMotorTempC: Double?
    public let inverterTempC: Double?
    public let batteryTempC: Double?
    public let motorStatus: String
    public let overallHealth: DrivetrainHealthGrade

    public init(
        frontMotorTempC: Double?,
        rearMotorTempC: Double?,
        inverterTempC: Double?,
        batteryTempC: Double?,
        motorStatus: String,
        overallHealth: DrivetrainHealthGrade
    ) {
        self.frontMotorTempC = frontMotorTempC
        self.rearMotorTempC = rearMotorTempC
        self.inverterTempC = inverterTempC
        self.batteryTempC = batteryTempC
        self.motorStatus = motorStatus
        self.overallHealth = overallHealth
    }
}

// MARK: - Driving stats (web `useDrivingStats` → `DrivingStats`)

/// The backend driving roll-up (web `useDrivingStats` → `DrivingStats`). Powers the drive-statistics
/// KVList, the thermal-load inline metrics, and the power-summary card. Stored SI: distance in meters,
/// speeds in m/s, regen energy in Wh, CO₂ in kg, regen ratio as a 0…1 fraction.
public struct DrivetrainDrivingStats: Hashable, Sendable {
    public let totalDrives: Int
    public let totalDistanceM: Double
    public let avgSpeedMps: Double
    public let topSpeedMps: Double
    public let regenRatio: Double
    public let regenEnergyWh: Double
    public let co2SavedKg: Double

    public init(
        totalDrives: Int,
        totalDistanceM: Double,
        avgSpeedMps: Double,
        topSpeedMps: Double,
        regenRatio: Double,
        regenEnergyWh: Double,
        co2SavedKg: Double
    ) {
        self.totalDrives = totalDrives
        self.totalDistanceM = totalDistanceM
        self.avgSpeedMps = avgSpeedMps
        self.topSpeedMps = topSpeedMps
        self.regenRatio = regenRatio
        self.regenEnergyWh = regenEnergyWh
        self.co2SavedKg = co2SavedKg
    }
}

// MARK: - Drive (web `useDrives` → `Drive`, trimmed)

/// One driving session (web `Drive`), trimmed to the fields the per-drive charts read. Measurements are
/// SI canonical (meters, watts, °C); the view converts at the render boundary.
public struct DrivetrainDrive: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let vehicleID: Int64
    public let startTs: Date
    public let distanceM: Double
    public let avgPowerW: Double?
    public let outsideTempAvgC: Double?

    public init(
        id: Int64,
        vehicleID: Int64,
        startTs: Date,
        distanceM: Double,
        avgPowerW: Double? = nil,
        outsideTempAvgC: Double? = nil
    ) {
        self.id = id
        self.vehicleID = vehicleID
        self.startTs = startTs
        self.distanceM = distanceM
        self.avgPowerW = avgPowerW
        self.outsideTempAvgC = outsideTempAvgC
    }
}

// MARK: - Motor snapshot (web `useMotorLatest` / `useMotorHistory` → `MotorSnapshot`)

/// One `/motor` pivot row (web `MotorSnapshot`), trimmed to the fields the live panel + history charts
/// read. Temperatures are SI °C; torque is Nm; rpm is rev/min; `powerKw` / `regenKw` are the backend's
/// derived kW (web `power_kw` / `regen_kw`). Any field may be `nil` when its backing signal is absent.
public struct DrivetrainMotorSnapshot: Identifiable, Hashable, Sendable {
    public let id: String
    public let ts: Date?
    public let shiftState: String?
    public let source: String?
    public let powerKw: Double?
    public let regenKw: Double?
    public let motorRpmFront: Double?
    public let motorRpmRear: Double?
    public let torqueNmFront: Double?
    public let torqueNmRear: Double?
    public let motorTempCFront: Double?
    public let motorTempCRear: Double?
    public let inverterTempC: Double?
    public let batteryTempC: Double?

    public init(
        id: String,
        ts: Date?,
        shiftState: String? = nil,
        source: String? = nil,
        powerKw: Double? = nil,
        regenKw: Double? = nil,
        motorRpmFront: Double? = nil,
        motorRpmRear: Double? = nil,
        torqueNmFront: Double? = nil,
        torqueNmRear: Double? = nil,
        motorTempCFront: Double? = nil,
        motorTempCRear: Double? = nil,
        inverterTempC: Double? = nil,
        batteryTempC: Double? = nil
    ) {
        self.id = id
        self.ts = ts
        self.shiftState = shiftState
        self.source = source
        self.powerKw = powerKw
        self.regenKw = regenKw
        self.motorRpmFront = motorRpmFront
        self.motorRpmRear = motorRpmRear
        self.torqueNmFront = torqueNmFront
        self.torqueNmRear = torqueNmRear
        self.motorTempCFront = motorTempCFront
        self.motorTempCRear = motorTempCRear
        self.inverterTempC = inverterTempC
        self.batteryTempC = batteryTempC
    }

    /// Web `s.torque_nm_front ?? s.torque_nm_rear` — the torque plotted in the history chart.
    public var torqueNm: Double? {
        torqueNmFront ?? torqueNmRear
    }
}

// MARK: - Temperature sensor (web `sensors` array)

/// One thermal sensor (web `TempSensor`): a labeled °C reading with its critical ceiling, an SF Symbol,
/// and a palette slot. The severity / display conversion is derived at the render boundary.
public struct DrivetrainTempSensor: Identifiable, Hashable, Sendable {
    public let id: String
    public let labelKey: String
    public let valueC: Double?
    public let maxTempC: Double
    public let systemImage: String
    public let paletteIndex: Int

    public init(id: String, labelKey: String, valueC: Double?, maxTempC: Double,
                systemImage: String, paletteIndex: Int) {
        self.id = id
        self.labelKey = labelKey
        self.valueC = valueC
        self.maxTempC = maxTempC
        self.systemImage = systemImage
        self.paletteIndex = paletteIndex
    }

    /// Web `tempSeverityColor` / `tempNeonColor`: 0…1 thermal load, the severity tone driver.
    public var loadFraction: Double {
        guard let valueC, maxTempC > 0 else { return 0 }
        return min(max(valueC / maxTempC, 0), 1)
    }

    /// Web `tempSeverityColor`: ≥85 % critical, ≥65 % warning, else good; missing → neutral.
    public var severity: TSTone {
        guard valueC != nil else { return .neutral }
        let ratio = loadFraction
        if ratio >= 0.85 { return .danger }
        if ratio >= 0.65 { return .warning }
        return .success
    }
}

// MARK: - Chart points (web `MotorChartDataPoint` / `ChartDataPoint`, display-converted)

/// One motor-history sample (web `MotorChartDataPoint`), already converted to the user's temperature
/// unit; torque stays Nm. `time` is the pre-formatted timestamp tick.
public struct DrivetrainMotorChartPoint: Identifiable, Hashable, Sendable {
    public let id: String
    public let index: Int
    public let time: String
    public let stator: Double?
    public let statorRearLeft: Double?
    public let statorRearRight: Double?
    public let torque: Double?

    public init(
        index: Int,
        time: String,
        stator: Double?,
        statorRearLeft: Double?,
        statorRearRight: Double?,
        torque: Double?
    ) {
        id = "motor-\(index)"
        self.index = index
        self.time = time
        self.stator = stator
        self.statorRearLeft = statorRearLeft
        self.statorRearRight = statorRearRight
        self.torque = torque
    }
}

/// One per-drive sample (web `ChartDataPoint`). `powerMaxKw` / `powerMinKw` are kW; `outsideTemp` is in
/// the user's temperature unit (web labels the axis with it); `date` is the pre-formatted day tick.
public struct DrivetrainDriveChartPoint: Identifiable, Hashable, Sendable {
    public let id: String
    public let index: Int
    public let date: String
    public let powerMaxKw: Double
    public let powerMinKw: Double
    public let outsideTemp: Double?

    public init(index: Int, date: String, powerMaxKw: Double, powerMinKw: Double, outsideTemp: Double?) {
        id = "drive-\(index)"
        self.index = index
        self.date = date
        self.powerMaxKw = powerMaxKw
        self.powerMinKw = powerMinKw
        self.outsideTemp = outsideTemp
    }
}

// MARK: - Recommendation (web `HealthRecommendations` tips)

/// One health recommendation (web `Recommendation`): a localized tip keyed by priority tier.
public struct DrivetrainRecommendation: Identifiable, Hashable, Sendable {
    public enum Priority: String, Sendable {
        case high
        case medium
        case low
    }

    public let id: String
    public let textKey: String
    public let priority: Priority

    public init(id: String, textKey: String, priority: Priority) {
        self.id = id
        self.textKey = textKey
        self.priority = priority
    }

    /// The banner tone for the tip card (high→danger, medium→warning, low→neutral).
    public var tone: TSTone {
        switch priority {
        case .high: .danger
        case .medium: .warning
        case .low: .neutral
        }
    }

    /// The leading SF Symbol (high/medium→warning triangle, low→trend arrow).
    public var systemImage: String {
        priority == .low ? "chart.line.uptrend.xyaxis" : "exclamationmark.triangle.fill"
    }
}
