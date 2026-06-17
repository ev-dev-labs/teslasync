//
//  SmartChargePlannerEngine.swift
//  TeslaSync — P4-APPLE P7 · page:charging/SmartCharge (Apple) — Sample planner
//
//  The deterministic stand-in for the `/charge-planner/optimize` backend used by
//  `SampleSmartChargeDataSource`. Builds a 24-hour time-of-use curve, sizes the
//  charge from the request (SOC delta × capacity, amps × 240 V), and selects the
//  cheapest window that completes before departure — enough to exercise every
//  panel, cost card, timeline bar, schedule field and alternative window without
//  a network. Replaced wholesale when the generated client lands (P1/S2-S3).
//

import Foundation

enum SmartChargePlannerEngine {
    private static let assumedVoltage: Double = 240

    // MARK: TOU curve

    /// The tier classification for an hour-of-day (a representative EV-TOU shape).
    static func tier(forHour hour: Int) -> SmartChargeRateTier {
        switch hour {
        case 16 ..< 21: return .onPeak
        case 15, 21, 22: return .midPeak
        case 0 ..< 6: return .superOffPeak
        default: return .offPeak
        }
    }

    /// The base ¢/kWh for an hour-of-day before the per-plan factor.
    static func baseRate(forHour hour: Int) -> Double {
        switch tier(forHour: hour) {
        case .onPeak: return 52
        case .midPeak: return 38
        case .offPeak: return 24
        case .superOffPeak: return 16
        case .unknown: return 30
        }
    }

    /// Per-plan price multiplier so switching rate plans visibly re-prices.
    static func planFactor(_ planID: String) -> Double {
        switch planID {
        case "sce-tou-d": return 1.10
        case "sdge-tou-dr1": return 0.95
        default: return 1.0
        }
    }

    /// The full 24-hour curve (web `hourly_rates`) for a plan.
    static func hourlyRates(planID: String) -> [SmartChargeHourlyRate] {
        let factor = planFactor(planID)
        return (0 ..< 24).map { hour in
            SmartChargeHourlyRate(
                hour: hour,
                rateCents: (baseRate(forHour: hour) * factor * 10).rounded() / 10,
                tier: tier(forHour: hour).wireToken
            )
        }
    }

    // MARK: Optimization

    /// The current SOC the planner assumes for a vehicle (deterministic).
    static func currentSoc(vehicleID: Int64) -> Int {
        switch vehicleID {
        case 1: return 42
        case 2: return 55
        default: return 48
        }
    }

    /// Builds the full optimize response from a request (web `useOptimizeCharge`).
    static func optimize(_ request: SmartChargeOptimizeRequest) -> SmartChargeOptimization {
        let rates = hourlyRates(planID: request.ratePlanID)
        let soc = currentSoc(vehicleID: request.vehicleID)
        let kwhNeeded = max(0, Double(request.targetSoc - soc) / 100 * request.batteryCapacityKwh)
        let powerKw = max(1, Double(request.maxAmps) * assumedVoltage / 1000)
        let durationHours = kwhNeeded / powerKw
        let windowHours = max(1, Int(durationHours.rounded(.up)))

        let ranked = rankedWindows(rates: rates, windowHours: windowHours)
        let best = ranked.first ?? (startHour: 0, avgRate: rates.first?.rateCents ?? 24)
        let chargeNowRate = rates[18].rateCents
        let schedule = window(
            startHour: best.startHour, hours: windowHours, departBy: request.departBy,
            avgRate: best.avgRate, kwhNeeded: kwhNeeded
        )
        return SmartChargeOptimization(
            planID: Int64(1000 + request.vehicleID),
            currentSoc: soc,
            targetSoc: request.targetSoc,
            kwhNeeded: (kwhNeeded * 10).rounded() / 10,
            estimatedDurationHours: (durationHours * 10).rounded() / 10,
            schedule: schedule,
            comparison: comparison(kwhNeeded: kwhNeeded, optimizedRate: best.avgRate, nowRate: chargeNowRate),
            alternativeWindows: alternatives(
                ranked: ranked, windowHours: windowHours, departBy: request.departBy, kwhNeeded: kwhNeeded
            ),
            hourlyRates: rates
        )
    }

    /// All 24 start hours ranked by the average rate over the window (cheapest first).
    private static func rankedWindows(
        rates: [SmartChargeHourlyRate], windowHours: Int
    ) -> [(startHour: Int, avgRate: Double)] {
        (0 ..< 24).map { start in
            let total = (0 ..< windowHours).reduce(0.0) { sum, offset in
                sum + rates[(start + offset) % 24].rateCents
            }
            return (startHour: start, avgRate: (total / Double(windowHours) * 10).rounded() / 10)
        }
        .sorted { $0.avgRate < $1.avgRate || ($0.avgRate == $1.avgRate && $0.startHour < $1.startHour) }
    }

    /// Cost comparison block (web `comparison`).
    private static func comparison(
        kwhNeeded: Double, optimizedRate: Double, nowRate: Double
    ) -> SmartChargeCostComparison {
        let optimized = kwhNeeded * optimizedRate / 100
        let chargeNow = kwhNeeded * nowRate / 100
        let savings = max(0, chargeNow - optimized)
        let percent = chargeNow > 0 ? savings / chargeNow * 100 : 0
        return SmartChargeCostComparison(
            chargeNowCost: round2(chargeNow),
            optimizedCost: round2(optimized),
            savings: round2(savings),
            savingsPercent: (percent * 10).rounded() / 10
        )
    }

    /// Materializes one window into a dated `SmartChargeWindow` ending by departure.
    private static func window(
        startHour: Int, hours: Int, departBy: Date, avgRate: Double, kwhNeeded: Double
    ) -> SmartChargeWindow {
        let calendar = Calendar.current
        let day = calendar.startOfDay(for: departBy)
        var start = calendar.date(byAdding: .hour, value: startHour, to: day) ?? day
        let end = calendar.date(byAdding: .hour, value: hours, to: start) ?? start
        if end > departBy { start = calendar.date(byAdding: .day, value: -1, to: start) ?? start }
        let endDate = calendar.date(byAdding: .hour, value: hours, to: start) ?? start
        return SmartChargeWindow(
            startTime: start,
            endTime: endDate,
            rateCentsKwh: avgRate,
            estimatedCost: round2(kwhNeeded * avgRate / 100),
            rateTier: tier(forHour: startHour).wireToken
        )
    }

    /// The next two cheapest windows (web `alternative_windows`).
    private static func alternatives(
        ranked: [(startHour: Int, avgRate: Double)], windowHours: Int, departBy: Date, kwhNeeded: Double
    ) -> [SmartChargeWindow] {
        ranked.dropFirst().prefix(2).map { entry in
            window(
                startHour: entry.startHour, hours: windowHours, departBy: departBy,
                avgRate: entry.avgRate, kwhNeeded: kwhNeeded
            )
        }
    }

    private static func round2(_ value: Double) -> Double { (value * 100).rounded() / 100 }

    // MARK: History

    /// One seeded history row spec (kept off the line-length budget of `history`).
    private struct HistorySpec {
        let daysAgo: Int
        let plan: String
        let status: String
        let cost: Double?
        let savings: Double?
        let startHour: Int
        let hours: Int
        let targetSoc: Int
    }

    private static let historySpecs: [HistorySpec] = [
        HistorySpec(daysAgo: 1, plan: "PG&E EV2-A", status: "scheduled",
                    cost: 3.12, savings: 4.74, startHour: 0, hours: 6, targetSoc: 80),
        HistorySpec(daysAgo: 4, plan: "PG&E EV2-A", status: "completed",
                    cost: 2.88, savings: 5.10, startHour: 1, hours: 5, targetSoc: 80),
        HistorySpec(daysAgo: 9, plan: "SCE TOU-D", status: "completed",
                    cost: 3.64, savings: 4.20, startHour: 0, hours: 6, targetSoc: 90),
        HistorySpec(daysAgo: 16, plan: "PG&E EV2-A", status: "cancelled",
                    cost: nil, savings: nil, startHour: 23, hours: 4, targetSoc: 70)
    ]

    /// Plan history rows for a vehicle (web `useChargePlans`).
    static func history(vehicleID: Int64) -> [SmartChargePlanHistoryItem] {
        let calendar = Calendar.current
        let now = Date()
        return historySpecs.enumerated().map { index, spec in
            let created = calendar.date(byAdding: .day, value: -spec.daysAgo, to: now) ?? now
            let day = calendar.startOfDay(for: created)
            let start = calendar.date(byAdding: .hour, value: spec.startHour, to: day) ?? day
            let end = calendar.date(byAdding: .hour, value: spec.hours, to: start) ?? start
            return SmartChargePlanHistoryItem(
                id: vehicleID * 100 + Int64(index + 1),
                vehicleID: vehicleID,
                targetSoc: spec.targetSoc,
                scheduledStart: start,
                scheduledEnd: end,
                ratePlan: spec.plan,
                estimatedCost: spec.cost,
                savings: spec.savings,
                status: spec.status,
                createdAt: created
            )
        }
    }
}
