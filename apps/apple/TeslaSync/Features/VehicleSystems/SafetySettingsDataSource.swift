//
//  SafetySettingsDataSource.swift
//  TeslaSync — P4 feature view · P7 · vehicle-systems/SafetySettings (Apple) — Data Source seam
//
//  The single KMP-core seam (ADR-004). Each method keeps its web query shape so
//  the call sites in `SafetySettingsPageModel` read like the React page:
//  `useSecurityLatest` → GET /security/latest, `useSafetyLatest` → GET /safety/latest,
//  `useSafetyHistory` → GET /safety. Today the bodies resolve from a deterministic
//  in-memory fixture set; when the generated client lands (P1/S2-S3) only these
//  bodies change — the view and the derived state never touch the network.
//
//  Every distance the fixtures emit is SI (meters), exactly as the `/safety`
//  endpoints serve after Phase-42 normalisation.
//

import Foundation

// MARK: - Hook-named data methods (web parity at the call site)

extension SafetySettingsPageModel {
    /// Vehicle roster for the selector (web `useSelectedVehicle`).
    func loadVehicles() async -> [SafetyVehicle] {
        SafetySettingsMockData.vehicles
    }

    /// `useSecurityLatest` → GET /security/latest?vehicle_id={id}
    func useSecurityLatest(vehicleID: Int64) async -> SafetySecuritySnapshot? {
        guard vehicleID > 0 else { return nil }
        return SafetySettingsMockData.security(vehicleID: vehicleID)
    }

    /// `useSafetyLatest` → GET /safety/latest?vehicle_id={id}
    func useSafetyLatest(vehicleID: Int64) async -> SafetySnapshot? {
        guard vehicleID > 0 else { return nil }
        return SafetySettingsMockData.latest(vehicleID: vehicleID)
    }

    /// `useSafetyHistory` → GET /safety?vehicle_id={id}&limit=100
    func useSafetyHistory(vehicleID: Int64, limit: Int) async -> [SafetySnapshot] {
        guard vehicleID > 0 else { return [] }
        return SafetySettingsMockData.history(vehicleID: vehicleID, limit: limit)
    }
}

// MARK: - Mock fixtures (one-screen sample; replaced by the live client)

/// Deterministic fixtures so every panel, gauge, chart, table row and live-signal
/// card renders without a backend. Distances are SI meters. The latest snapshot
/// keeps a realistic mix of enabled / disabled ADAS features (≈7/9 → an amber-to-
/// green score) so the gauge, MetricCards, feature cards and badges all exercise
/// their on AND off branches; the history seeds toggling states so all three
/// step-line series move and the table shows On / Off / level cells.
enum SafetySettingsMockData {
    static let vehicles: [SafetyVehicle] = [
        SafetyVehicle(id: 1, displayName: "Model 3"),
        SafetyVehicle(id: 2, displayName: "Model Y")
    ]

    /// The latest live security signals (web `/security/latest`).
    static func security(vehicleID: Int64) -> SafetySecuritySnapshot {
        SafetySecuritySnapshot(
            driverSeatBelt: true,
            passengerSeatBelt: vehicleID == 2 ? false : true,
            driverSeatOccupied: true,
            locked: true
        )
    }

    /// The latest safety snapshot (web `/safety/latest`). Seven of nine features
    /// active → a high-but-not-perfect score so the amber/green thresholds show.
    static func latest(vehicleID: Int64) -> SafetySnapshot {
        SafetySnapshot(
            id: -1,
            vehicleID: vehicleID,
            automaticEmergencyBrakingOff: false, // → AEB enabled (inverted logic)
            automaticBlindSpotCamera: true,
            blindSpotCollisionWarning: true,
            emergencyLaneDepartureAvoidance: vehicleID == 2 ? false : true,
            forwardCollisionWarning: .text("ForwardCollisionSensitivityMedium"),
            laneDepartureAvoidance: .text("LaneAssistLevelWarning"),
            speedLimitWarning: .text("SpeedAssistLevelChime"),
            cruiseFollowDistance: .number(3),
            pinToDriveEnabled: vehicleID == 2 ? false : true,
            milesSinceReset: 482_803, // ≈ 300 mi in meters
            selfDrivingMilesSinceReset: 128_747, // ≈ 80 mi in meters
            createdAt: Date()
        )
    }

    /// A 24-point history over ~24 days (oldest first within the generator),
    /// trimmed to the requested `limit`. The three charted booleans toggle on a
    /// deterministic cadence so the step lines and the table cells move.
    static func history(vehicleID: Int64, limit: Int) -> [SafetySnapshot] {
        let calendar = Calendar.current
        let now = Date()
        let pointCount = 24

        let rows: [SafetySnapshot] = (0 ..< pointCount).compactMap { index in
            let daysAgo = pointCount - index
            guard let timestamp = calendar.date(byAdding: .day, value: -daysAgo, to: now) else {
                return nil
            }

            // Deterministic toggles so all three series exercise 0 and 1.
            let aebOn = index % 5 != 0 // mostly on, occasionally off
            let bscwOn = index % 3 != 1
            let eldaOn = index % 4 != 2

            return SafetySnapshot(
                id: Int64(index + 1),
                vehicleID: vehicleID,
                automaticEmergencyBrakingOff: !aebOn,
                automaticBlindSpotCamera: index % 2 == 0,
                blindSpotCollisionWarning: bscwOn,
                emergencyLaneDepartureAvoidance: eldaOn,
                forwardCollisionWarning: index % 6 == 0
                    ? .boolean(false)
                    : .text("ForwardCollisionSensitivityMedium"),
                laneDepartureAvoidance: .text("LaneAssistLevelWarning"),
                speedLimitWarning: index % 7 == 0
                    ? .text("SpeedAssistLevelNone")
                    : .text("SpeedAssistLevelChime"),
                cruiseFollowDistance: .number(Double((index % 7) + 1)),
                pinToDriveEnabled: true,
                milesSinceReset: 482_803 + Double(index) * 1_600,
                selfDrivingMilesSinceReset: 128_747 + Double(index) * 800,
                createdAt: timestamp
            )
        }

        guard limit > 0, rows.count > limit else { return rows }
        return Array(rows.suffix(limit))
    }
}
