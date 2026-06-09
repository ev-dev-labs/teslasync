//
//  ChargingTelemetryWidget.Builder.swift
//  TeslaSync — P4 dashboard widget · 0025 · ChargingTelemetryWidget (Apple)
//
//  Pure cached→projection adapter — the unit-tested core. A faithful Swift port
//  of the `chargerType` and `efficiency` memos plus the `voltage`/`current`/
//  `power`/`phases` `?? 0` fallbacks in features/dashboard/widgets/
//  ChargingTelemetryWidget.tsx. No SwiftUI or transport here.
//

import Foundation

/// Derives the charging-telemetry projection from a cached snapshot. Mirrors the
/// web memoized derivations exactly so both platforms show identical readings.
public enum ChargingTelemetryBuilder {
    /// Voltage above which the charger is classified DC (web `voltage > 300`).
    public static let dcVoltageThreshold: Double = 300

    /// Builds the projection from a cached snapshot. A `nil` snapshot (no row yet)
    /// yields the not-charging projection, reproducing the web state where
    /// `data` is absent and `isCharging` is false.
    public static func buildProjection(_ snapshot: ChargingTelemetrySnapshot?) -> ChargingTelemetryProjection {
        guard let snapshot else { return .empty }

        let isCharging = snapshot.isCharging
        let voltage = snapshot.chargerVoltage ?? 0
        let current = snapshot.chargerActualCurrent ?? 0
        let power = snapshot.chargerPowerW ?? 0
        let phases = snapshot.chargerPhases ?? 0

        return ChargingTelemetryProjection(
            isCharging: isCharging,
            voltage: voltage,
            current: current,
            power: power,
            phases: phases,
            chargerType: chargerType(isCharging: isCharging, voltage: voltage),
            efficiencyPercent: efficiency(
                isCharging: isCharging,
                pilot: snapshot.chargerPilotCurrent ?? 0,
                voltage: voltage,
                phases: phases,
                power: power
            )
        )
    }

    /// The charger family from the voltage heuristic (web `chargerType` memo):
    /// `nil` when not charging, DC above the threshold, AC otherwise.
    static func chargerType(isCharging: Bool, voltage: Double) -> ChargingTelemetryChargerType? {
        guard isCharging else { return nil }
        return voltage > dcVoltageThreshold ? .dc : .ac
    }

    /// Charging efficiency as actual power over theoretical pilot capacity, capped
    /// at 100% (web `efficiency` memo). Returns `nil` when not charging or when the
    /// pilot/voltage inputs make the ratio undefined, matching the web guards.
    static func efficiency(
        isCharging: Bool,
        pilot: Double,
        voltage: Double,
        phases: Double,
        power: Double
    ) -> Double? {
        guard isCharging else { return nil }
        guard pilot > 0, voltage > 0 else { return nil }
        let theoreticalPower = (pilot * voltage * (phases > 0 ? phases : 1)) / 1000
        guard theoreticalPower > 0 else { return nil }
        return min(100, (power / theoreticalPower) * 100)
    }

    /// Appends the latest power reading to a rolling history when the snapshot
    /// timestamp advances (web `data.ts !== lastTsRef.current`), capped at
    /// `maxSamples` (web `MAX_POWER_HISTORY`). Returns the unchanged history when
    /// the timestamp is missing or has not advanced.
    public static func accumulatePower(
        history: [Double],
        snapshot: ChargingTelemetrySnapshot?,
        lastTimestamp: String?,
        maxSamples: Int
    ) -> (history: [Double], timestamp: String?) {
        guard let snapshot, let timestamp = snapshot.timestamp, timestamp != lastTimestamp else {
            return (history, lastTimestamp)
        }
        var next = history
        next.append(snapshot.chargerPowerW ?? 0)
        if next.count > maxSamples {
            next.removeFirst(next.count - maxSamples)
        }
        return (next, timestamp)
    }
}
