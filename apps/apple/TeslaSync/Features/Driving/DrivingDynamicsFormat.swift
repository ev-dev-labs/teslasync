//
//  DDynFormat.swift
//  TeslaSync — P4-APPLE P7 · page:driving/DrivingDynamics (Apple) — Derivations + formatting
//
//  Pure, dependency-free peers of the web `driving-dynamics/helpers.ts` derivations
//  (`computeMotorStats`, `getThrottleStyle`) and the page's `fmtNumber` display
//  formatting. All math stays on SI inputs; the views apply the user's unit
//  preference at the render boundary via the shared `Units` facade.
//

import Foundation

/// Display formatting + cross-section derivations for the Driving Dynamics page.
enum DDynFormat {
    // MARK: - Number formatting (web `fmtNumber`)

    /// Web `fmtNumber(value, fractionDigits)` — grouped, fixed fraction digits.
    static func number(_ value: Double, fractionDigits: Int = 1) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        return formatter.string(from: NSNumber(value: value))
            ?? String(format: "%.\(fractionDigits)f", value)
    }

    /// Web `fmtNumber(value, digits)` + "%".
    static func percent(_ value: Double, fractionDigits: Int = 0) -> String {
        "\(number(value, fractionDigits: fractionDigits))%"
    }

    // MARK: - Motor stats (web `computeMotorStats`)

    /// Web `computeMotorStats(motorHistory)` — nil when the window is empty.
    static func computeMotorStats(_ history: [MotorSnapshot]) -> MotorStats? {
        guard !history.isEmpty else { return nil }

        let torques: [Double] = history.compactMap { snapshot in
            guard snapshot.torqueNmFront != nil || snapshot.torqueNmRear != nil else { return nil }
            return (snapshot.torqueNmFront ?? 0) + (snapshot.torqueNmRear ?? 0)
        }
        let motorTemps: [Double] = history.compactMap(\.maxMotorTempC)
        let powers: [Double] = history.compactMap(\.powerKw)
        let regens: [Double] = history.compactMap(\.regenKw)

        let highTorquePct = torques.isEmpty
            ? 0
            : Double(torques.count(where: { $0 > 200 })) / Double(torques.count) * 100

        return MotorStats(
            totalReadings: history.count,
            avgTorque: mean(torques),
            maxTorque: torques.max() ?? 0,
            avgMotorTemp: mean(motorTemps),
            maxMotorTemp: motorTemps.max() ?? 0,
            avgPower: mean(powers),
            peakPower: powers.max() ?? 0,
            minPower: powers.min() ?? 0,
            peakRegen: regens.max() ?? 0,
            highTorquePct: highTorquePct
        )
    }

    /// Web `getThrottleStyle(avgPower)` — buckets the average drive power (kW).
    static func throttleStyle(avgPowerKw: Double) -> ThrottleStyle {
        if avgPowerKw < 20 { return .conservative }
        if avgPowerKw < 80 { return .moderate }
        return .aggressive
    }

    // MARK: - Driving tips (web `DrivingTips` useMemo)

    /// Web `DrivingTips` recommendation list, derived from the motor stats. Returns
    /// `(key, fallback)` pairs so the caller localizes through the strings façade.
    static func tips(for stats: MotorStats?) -> [(key: String, fallback: String)] {
        guard let stats else {
            return [("dynamics.tipNoData", "Drive your vehicle to start collecting dynamics data.")]
        }

        var list: [(String, String)] = []
        if stats.avgPower > 80 {
            list.append(("dynamics.tipEaseAccel",
                         "Ease into the accelerator — gradual inputs save energy and tire wear."))
            list.append(("dynamics.tipBrakeEarly",
                         "Brake earlier and lighter to improve regen capture."))
        } else if stats.avgPower > 20 {
            list.append(("dynamics.tipSmoothThrottle",
                         "Smooth throttle transitions can improve efficiency by 10–15%."))
            list.append(("dynamics.tipCoast",
                         "Lift off the pedal earlier to let regen do the work."))
        } else {
            list.append(("dynamics.tipGreat",
                         "Excellent driving style! Maintaining this maximizes range and comfort."))
            list.append(("dynamics.tipKeep",
                         "Keep monitoring your scores — consistency is key."))
        }
        if stats.maxMotorTemp > 120 {
            list.append(("dynamics.tipThermal",
                         "Motor temps are running high — consider easing off sustained high power."))
        }
        return list
    }

    // MARK: - Helpers

    private static func mean(_ values: [Double]) -> Double {
        values.isEmpty ? 0 : values.reduce(0, +) / Double(values.count)
    }
}
