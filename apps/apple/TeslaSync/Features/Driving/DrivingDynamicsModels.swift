//
//  DrivingDynamicsModels.swift
//  TeslaSync — P4-APPLE P7 · page:driving/DrivingDynamics (Apple) — Data Models
//
//  Wire-faithful Swift peers of the Driving Dynamics contract. Field names + JSON
//  keys mirror `web/src/api/types.ts` (`MotorSnapshot`, `DriveDynamicsSnapshot`)
//  and `web/src/types/driving.ts` (`Drive`, `DDynCoachData` + sub-shapes)
//  exactly — snake_case on the wire. Every physical quantity stays SI canonical
//  (Nm, rpm, °C, m, s, m/s, W, Wh); the views convert to the user's unit only at
//  the render boundary via the shared `Units` facade (ADR-005). Timestamps decode
//  as ISO-8601 `Date`s at the data seam.
//

import Foundation

// MARK: - Vehicle identity (web `useSelectedVehicle` roster)

/// Minimal vehicle identity for the picker (web `display_name`).
struct DDynVehicle: Codable, Identifiable, Equatable, Sendable {
    let id: Int64
    let displayName: String

    enum CodingKeys: String, CodingKey {
        case id
        case displayName = "display_name"
    }
}

// MARK: - Motor snapshot (web `MotorSnapshot` from /motor + /motor/latest)

/// One motor-telemetry sample (web `MotorSnapshot`). Torque is Nm, temperatures
/// °C, power/regen kW (derived SI), rpm is raw axle speed; `shiftState` is the
/// raw gear token (`P` / `R` / `N` / `D`).
struct MotorSnapshot: Codable, Identifiable, Equatable, Sendable {
    let id: Int64?
    let ts: Date
    let torqueNmFront: Double?
    let torqueNmRear: Double?
    let motorRpmFront: Double?
    let motorRpmRear: Double?
    let motorTempCFront: Double?
    let motorTempCRear: Double?
    let shiftState: String?
    let powerKw: Double?
    let regenKw: Double?

    enum CodingKeys: String, CodingKey {
        case id
        case ts
        case torqueNmFront = "torque_nm_front"
        case torqueNmRear = "torque_nm_rear"
        case motorRpmFront = "motor_rpm_front"
        case motorRpmRear = "motor_rpm_rear"
        case motorTempCFront = "motor_temp_c_front"
        case motorTempCRear = "motor_temp_c_rear"
        case shiftState = "shift_state"
        case powerKw = "power_kw"
        case regenKw = "regen_kw"
    }

    /// Web `(torque_nm_front ?? 0) + (torque_nm_rear ?? 0)`.
    var torqueTotalNm: Double {
        (torqueNmFront ?? 0) + (torqueNmRear ?? 0)
    }

    /// Web `max(motor_temp_c_front, motor_temp_c_rear)` — nil when both absent.
    var maxMotorTempC: Double? {
        switch (motorTempCFront, motorTempCRear) {
        case let (front?, rear?): max(front, rear)
        case let (front?, nil): front
        case let (nil, rear?): rear
        default: nil
        }
    }
}

// MARK: - Drive dynamics snapshot (web `DriveDynamicsSnapshot`)

/// Latest G-force + pedal projection (web `DriveDynamicsSnapshot` via
/// `useDriveDynamicsLatest`). Accelerations are g; pedal positions are 0…100 %.
struct DriveDynamicsSnapshot: Codable, Equatable, Sendable {
    let lateralAcceleration: Double?
    let longitudinalAcceleration: Double?
    let pedalPosition: Double?
    let brakePedalPosition: Double?
    let brakePedalActive: Bool?

    enum CodingKeys: String, CodingKey {
        case lateralAcceleration = "lateral_acceleration"
        case longitudinalAcceleration = "longitudinal_acceleration"
        case pedalPosition = "pedal_position"
        case brakePedalPosition = "brake_pedal_position"
        case brakePedalActive = "brake_pedal_active"
    }

    /// Web `sqrt(lateral² + longitudinal²)` — nil unless both axes present.
    var combinedMagnitude: Double? {
        guard let lateral = lateralAcceleration, let longitudinal = longitudinalAcceleration else {
            return nil
        }
        return (lateral * lateral + longitudinal * longitudinal).squareRoot()
    }

    /// Web `lateral != null || longitudinal != null`.
    var hasAcceleration: Bool {
        lateralAcceleration != nil || longitudinalAcceleration != nil
    }

    /// Web `throttle != null || brakePos != null || brakeActive != null`.
    var hasPedal: Bool {
        pedalPosition != nil || brakePedalPosition != nil || brakePedalActive != nil
    }
}

// MARK: - Autopilot snapshot (web AutopilotSection: state.speed + cruise signals)

/// Cruise / autopilot live values (web `AutopilotSection`). Speeds are SI m/s
/// (`VehicleSpeed` / `CruiseSetSpeed`); `followDistance` is the parsed bar count.
struct AutopilotSnapshot: Codable, Equatable, Sendable {
    let currentSpeedMps: Double?
    let cruiseSetSpeedMps: Double?
    let followDistance: String?

    enum CodingKeys: String, CodingKey {
        case currentSpeedMps = "current_speed_mps"
        case cruiseSetSpeedMps = "cruise_set_speed_mps"
        case followDistance = "follow_distance"
    }

    /// Web `speedMps != null || cruiseSetMps != null || followDistance != null`.
    var hasData: Bool {
        currentSpeedMps != nil || cruiseSetSpeedMps != nil || followDistance != nil
    }
}

// MARK: - Drive (web `Drive` — SI canonical)

/// One drive (web `Drive`). All quantities SI: meters, seconds, m/s, watts.
struct DrivingDrive: Codable, Identifiable, Equatable, Sendable {
    let id: Int64
    let startTs: Date
    let durationS: Double
    let distanceM: Double
    let avgSpeedMps: Double?
    let maxSpeedMps: Double?
    let avgPowerW: Double?
}

// MARK: - Driving coach (web `DrivingCoachData` + sub-shapes)

/// A drive's style classification (web union `'efficient' | 'moderate' | 'aggressive'`).
enum CoachStyle: String, Codable, Equatable, Sendable, CaseIterable {
    case efficient
    case moderate
    case aggressive
}

/// A recommendation's impact (web union `'high' | 'medium' | 'low'`).
enum DDynCoachImpact: String, Codable, Equatable, Sendable {
    case high
    case medium
    case low
}

/// Behavior-pattern percentages (web `CoachPatterns`).
struct CoachPatterns: Codable, Equatable, Sendable {
    let hardAccelPct: Double
    let hardBrakePct: Double
    let highwayPct: Double
    let shortTripPct: Double
    let coldStartPct: Double

    enum CodingKeys: String, CodingKey {
        case hardAccelPct = "hard_accel_pct"
        case hardBrakePct = "hard_brake_pct"
        case highwayPct = "highway_pct"
        case shortTripPct = "short_trip_pct"
        case coldStartPct = "cold_start_pct"
    }
}

/// One weekly score-trend point (web `CoachWeeklyTrend`).
struct CoachWeeklyTrend: Codable, Identifiable, Equatable, Sendable {
    let week: String
    let score: Double
    let efficiency: Double
    let drives: Int

    var id: String { week }
}

/// One coaching recommendation (web `CoachRecommendation`).
struct CoachRecommendation: Codable, Identifiable, Equatable, Sendable {
    let category: String
    let impact: DDynCoachImpact
    let tip: String

    var id: String { "\(category)-\(tip)" }
}

/// One per-drive coach score (web `CoachDriveScore`). `efficiency` is Wh/km,
/// `distance` is km — already display-shaped by the `/analytics/driving-coach`
/// endpoint (a coaching summary, not raw telemetry).
struct CoachDriveScore: Codable, Identifiable, Equatable, Sendable {
    let driveID: Int64
    let date: Date
    let score: Double
    let style: CoachStyle
    let efficiency: Double
    let distance: Double

    var id: Int64 { driveID }

    enum CodingKeys: String, CodingKey {
        case driveID = "drive_id"
        case date
        case score
        case style
        case efficiency
        case distance
    }
}

/// The driving-coach summary (web `DrivingCoachData` from `/analytics/driving-coach`).
struct DDynCoachData: Codable, Equatable, Sendable {
    let overallScore: Double
    let efficiencyWhKm: Double
    let bestEfficiencyWhKm: Double
    let totalDrivesAnalyzed: Int
    let styleBreakdown: [String: Int]
    let patterns: CoachPatterns
    let weeklyTrend: [CoachWeeklyTrend]
    let recommendations: [CoachRecommendation]
    let perDriveScores: [CoachDriveScore]

    enum CodingKeys: String, CodingKey {
        case overallScore = "overall_score"
        case efficiencyWhKm = "efficiency_wh_km"
        case bestEfficiencyWhKm = "best_efficiency_wh_km"
        case totalDrivesAnalyzed = "total_drives_analyzed"
        case styleBreakdown = "style_breakdown"
        case patterns
        case weeklyTrend = "weekly_trend"
        case recommendations
        case perDriveScores = "per_drive_scores"
    }

    /// Web `style_breakdown[style] ?? 0`.
    func styleCount(_ style: CoachStyle) -> Int {
        styleBreakdown[style.rawValue] ?? 0
    }
}

// MARK: - Throttle style (web `ThrottleStyle`)

/// Throttle aggressiveness bucket (web `ThrottleStyle`).
enum ThrottleStyle: String, Equatable, Sendable {
    case conservative
    case moderate
    case aggressive
}

// MARK: - Motor stats (web `MotorStats`, computed from the history window)

/// Aggregated motor statistics (web `MotorStats`), all SI. Avg/peak power + regen
/// are kW; torque Nm; temperatures °C. `highTorquePct` is the share of samples
/// above 200 Nm.
struct MotorStats: Equatable, Sendable {
    let totalReadings: Int
    let avgTorque: Double
    let maxTorque: Double
    let avgMotorTemp: Double
    let maxMotorTemp: Double
    let avgPower: Double
    let peakPower: Double
    let minPower: Double
    let peakRegen: Double
    let highTorquePct: Double
}
