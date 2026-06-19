//
//  DrivingDynamicsDataSource.swift
//  TeslaSync — P4-APPLE P7 · page:driving/DrivingDynamics (Apple) — Data Source seam
//
//  The single KMP-core seam (ADR-004). Each method keeps its web TanStack hook name
//  so the call sites in `DrivingDynamicsPageModel` read like the React page:
//  `useMotorLatest` → GET /motor/latest, `useMotorHistory` → GET /motor,
//  `useDrives` → GET /drives, `useDrivingCoach` → GET /analytics/driving-coach,
//  `useDriveDynamicsLatest` → GET (drive-dynamics projection), `useAutopilot` →
//  GET /vehicles/{id}/state (+ cruise signals). Today the bodies resolve from a
//  deterministic in-memory fixture; when the generated client lands (P1/S2-S3) only
//  this file changes — the view + model never touch the network.
//

import Foundation

// MARK: - Data source contract (hook-named, web parity at the call site)

/// The Driving Dynamics data seam. Method names mirror the web hooks verbatim so
/// the model's call sites match `DrivingDynamicsPage.tsx` + its sub-components.
protocol DrivingDynamicsDataSource: Sendable {
    /// Vehicle roster for the selector (web `useSelectedVehicle`).
    func loadVehicles() async throws -> [DDynVehicle]

    /// `useMotorLatest` → GET /motor/latest?vehicle_id={id}.
    func useMotorLatest(vehicleID: Int64) async throws -> MotorSnapshot?

    /// `useMotorHistory` → GET /motor?vehicle_id={id}&limit={limit}.
    func useMotorHistory(vehicleID: Int64, limit: Int) async throws -> [MotorSnapshot]

    /// `useDrives` → GET /drives?vehicle_id={id}.
    func useDrives(vehicleID: Int64) async throws -> [DrivingDrive]

    /// `useDrivingCoach` → GET /analytics/driving-coach?vehicle_id={id}&days={days}.
    func useDrivingCoach(vehicleID: Int64, days: Int) async throws -> DDynCoachData?

    /// `useDriveDynamicsLatest` → latest G-force + pedal projection.
    func useDriveDynamicsLatest(vehicleID: Int64) async throws -> DriveDynamicsSnapshot?

    /// `useAutopilot` → GET /vehicles/{id}/state speed + cruise signal observations.
    func useAutopilot(vehicleID: Int64) async throws -> AutopilotSnapshot?
}

// MARK: - Errors (web query failure surface)

/// Failures surfaced by the seam (web query `onError`). Drives the page's
/// reachable error arm.
enum DrivingDynamicsError: LocalizedError {
    case loadFailed

    var errorDescription: String? {
        DDynStrings.text("common.loadError", "Failed to load driving data")
    }
}

// MARK: - Sample source (deterministic fixture; replaced by the live client)

/// A representative local seed used as the page / preview default until the
/// KMP-backed source is injected at composition time. It is an
/// API-response-shaped fixture (2 vehicles, a live motor snapshot, a motor-history
/// window, a month of drives, and a full driving-coach summary) so every panel,
/// gauge, chart and table renders its populated success state out of the box. All
/// measurements are SI canonical (Nm, rpm, °C, m, s, m/s, W); the view converts at
/// the boundary.
struct SampleDrivingDynamicsDataSource: DrivingDynamicsDataSource {
    private let now: Date

    init(now: Date = Date()) {
        self.now = now
    }

    func loadVehicles() async throws -> [DDynVehicle] {
        [
            DDynVehicle(id: 1, displayName: "Rocinante"),
            DDynVehicle(id: 2, displayName: "Tachi")
        ]
    }

    func useMotorLatest(vehicleID: Int64) async throws -> MotorSnapshot? {
        guard vehicleID > 0 else { return nil }
        return MotorSnapshot(
            id: 1,
            ts: now,
            torqueNmFront: 180,
            torqueNmRear: 240,
            motorRpmFront: 6400,
            motorRpmRear: 6100,
            motorTempCFront: 62,
            motorTempCRear: 58,
            shiftState: "D",
            powerKw: 96,
            regenKw: 0
        )
    }

    func useMotorHistory(vehicleID: Int64, limit: Int) async throws -> [MotorSnapshot] {
        guard vehicleID > 0 else { return [] }
        let count = min(limit, 60)
        return (0 ..< count).map { index in
            let phase = Double(index)
            let drive = max(0, 70 + 60 * sin(phase / 6))
            let regen = max(0, -40 * sin(phase / 6 + 1))
            return MotorSnapshot(
                id: Int64(index + 2),
                ts: now.addingTimeInterval(Double(index - count) * 30),
                torqueNmFront: 120 + 90 * abs(sin(phase / 5)),
                torqueNmRear: 150 + 110 * abs(cos(phase / 7)),
                motorRpmFront: 3000 + 4200 * abs(sin(phase / 8)),
                motorRpmRear: 2800 + 4000 * abs(cos(phase / 9)),
                motorTempCFront: 48 + 18 * abs(sin(phase / 11)),
                motorTempCRear: 46 + 16 * abs(cos(phase / 13)),
                shiftState: "D",
                powerKw: drive,
                regenKw: regen
            )
        }
    }

    func useDrives(vehicleID: Int64) async throws -> [DrivingDrive] {
        guard vehicleID > 0 else { return [] }
        return (0 ..< 28).map { index in
            let secondsBack = Double(index) * 26 * 3600 + Double((index * 5) % 9) * 3600
            let start = now.addingTimeInterval(-secondsBack)
            let distanceM = (6 + Double((index * 13) % 70)) * 1000
            let maxSpeedMps = 18 + Double((index * 7) % 26)
            let avgSpeedMps = maxSpeedMps * 0.66
            return DrivingDrive(
                id: Int64(vehicleID * 1000 + Int64(index)),
                startTs: start,
                durationS: distanceM / max(avgSpeedMps, 1),
                distanceM: distanceM,
                avgSpeedMps: avgSpeedMps,
                maxSpeedMps: maxSpeedMps,
                avgPowerW: 9000 + Double((index * 23) % 60) * 1000
            )
        }
    }

    func useDrivingCoach(vehicleID: Int64, days: Int) async throws -> DDynCoachData? {
        guard vehicleID > 0 else { return nil }
        return DDynCoachData(
            overallScore: 82,
            efficiencyWhKm: 168,
            bestEfficiencyWhKm: 132,
            totalDrivesAnalyzed: 24,
            styleBreakdown: ["efficient": 14, "moderate": 7, "aggressive": 3],
            patterns: CoachPatterns(
                hardAccelPct: 18,
                hardBrakePct: 12,
                highwayPct: 58,
                shortTripPct: 34,
                coldStartPct: 21
            ),
            weeklyTrend: sampleWeeklyTrend(),
            recommendations: sampleRecommendations(),
            perDriveScores: samplePerDriveScores(vehicleID: vehicleID)
        )
    }

    private func sampleWeeklyTrend() -> [CoachWeeklyTrend] {
        (0 ..< 6).map { week in
            CoachWeeklyTrend(
                week: "W\(week + 1)",
                score: 70 + Double((week * 6) % 25),
                efficiency: 150 + Double((week * 11) % 40),
                drives: 3 + week % 4
            )
        }
    }

    private func sampleRecommendations() -> [CoachRecommendation] {
        [
            CoachRecommendation(
                category: "acceleration",
                impact: .high,
                tip: DDynStrings.text(
                    "dynamics.tipEaseAccel",
                    "Ease into the accelerator — gradual inputs save energy and tire wear."
                )
            ),
            CoachRecommendation(
                category: "braking",
                impact: .medium,
                tip: DDynStrings.text("dynamics.tipBrakeEarly", "Brake earlier and lighter to improve regen capture.")
            ),
            CoachRecommendation(
                category: "consistency",
                impact: .low,
                tip: DDynStrings.text("dynamics.tipKeep", "Keep monitoring your scores — consistency is key.")
            )
        ]
    }

    private func samplePerDriveScores(vehicleID: Int64) -> [CoachDriveScore] {
        let range = 0 ..< 12
        return range.map { index in
            let driveID = Int64(vehicleID * 100 + Int64(index))
            let date = now.addingTimeInterval(Double(-index) * 86_400)
            let score = 60 + Double((index * 9) % 38)
            let styleIndex = index % CoachStyle.allCases.count
            let style = CoachStyle.allCases[styleIndex]
            let efficiency = 130 + Double((index * 13) % 90)
            let distance = 8 + Double((index * 7) % 40)
            
            return CoachDriveScore(
                driveID: driveID,
                date: date,
                score: score,
                style: style,
                efficiency: efficiency,
                distance: distance
            )
        }
    }

    func useDriveDynamicsLatest(vehicleID: Int64) async throws -> DriveDynamicsSnapshot? {
        guard vehicleID > 0 else { return nil }
        return DriveDynamicsSnapshot(
            lateralAcceleration: 0.18,
            longitudinalAcceleration: 0.32,
            pedalPosition: 24,
            brakePedalPosition: 0,
            brakePedalActive: false
        )
    }

    func useAutopilot(vehicleID: Int64) async throws -> AutopilotSnapshot? {
        guard vehicleID > 0 else { return nil }
        return AutopilotSnapshot(
            currentSpeedMps: 27.5,
            cruiseSetSpeedMps: 29.1,
            followDistance: "7"
        )
    }
}

#if DEBUG
    /// Preview/test seam with no vehicles — drives the page's empty state.
    struct EmptyDrivingDynamicsDataSource: DrivingDynamicsDataSource {
        func loadVehicles() async throws -> [DDynVehicle] { [] }
        func useMotorLatest(vehicleID _: Int64) async throws -> MotorSnapshot? { nil }
        func useMotorHistory(vehicleID _: Int64, limit _: Int) async throws -> [MotorSnapshot] { [] }
        func useDrives(vehicleID _: Int64) async throws -> [DrivingDrive] { [] }
        func useDrivingCoach(vehicleID _: Int64, days _: Int) async throws -> DDynCoachData? { nil }
        func useDriveDynamicsLatest(vehicleID _: Int64) async throws -> DriveDynamicsSnapshot? { nil }
        func useAutopilot(vehicleID _: Int64) async throws -> AutopilotSnapshot? { nil }
    }

    /// Preview/test seam whose primary load fails — drives the error state.
    struct FailingDrivingDynamicsDataSource: DrivingDynamicsDataSource {
        func loadVehicles() async throws -> [DDynVehicle] {
            throw DrivingDynamicsError.loadFailed
        }

        func useMotorLatest(vehicleID _: Int64) async throws -> MotorSnapshot? {
            throw DrivingDynamicsError.loadFailed
        }

        func useMotorHistory(vehicleID _: Int64, limit _: Int) async throws -> [MotorSnapshot] { [] }
        func useDrives(vehicleID _: Int64) async throws -> [DrivingDrive] { [] }
        func useDrivingCoach(vehicleID _: Int64, days _: Int) async throws -> DDynCoachData? { nil }
        func useDriveDynamicsLatest(vehicleID _: Int64) async throws -> DriveDynamicsSnapshot? { nil }
        func useAutopilot(vehicleID _: Int64) async throws -> AutopilotSnapshot? { nil }
    }
#endif
