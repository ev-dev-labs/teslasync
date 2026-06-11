//
//  InsightsEngine.Analyzers.swift
//  TeslaSync — P4 shared surface · 0092 · InsightsEngine (Apple)
//
//  The eight insight analyzers — the pure Foundation port of the analysis helpers in
//  web/src/components/data-display/InsightsEngine.tsx, reproduced verbatim (Honesty Covenant rule 5:
//  no parity shortcuts). Each returns a structured `InsightsEngineComputation?` carrying the exact
//  numbers + branch the web prose interpolates; localization / formatting happens later in the
//  projection. `analyze(_:)` reproduces the main component's build order + presence gates and the
//  `insights.length === 0 → null` empty result.
//
//  No SwiftUI, no localization, no number formatting here — so the math is unit-tested against the
//  exact web expressions (see InsightsEngine.AdapterTests.swift).
//

import Foundation

public enum InsightsEngineAnalyzers {}

// MARK: - Aggregator + shared helpers (web main component build order)

public extension InsightsEngineAnalyzers {
    /// Builds the ordered insight list — the native port of the `useMemo` body. The presence gates
    /// (`chargingSessions?.length`, `drives?.length`, `batteryReport`, …) and the push order are
    /// reproduced exactly. An empty result is the web `insights.length === 0 → null`.
    static func analyze(_ data: InsightsEngineData, calendar: Calendar = .current) -> [InsightsEngineComputation] {
        var results: [InsightsEngineComputation] = []
        if !data.chargingSessions.isEmpty, let insight = chargingCost(data.chargingSessions) {
            results.append(insight)
        }
        if !data.drives.isEmpty, let insight = efficiencyTrend(data.drives) {
            results.append(insight)
        }
        if let report = data.batteryReport, let insight = batteryHealth(report) {
            results.append(insight)
        }
        if !data.chargingSessions.isEmpty, let insight = optimalCharging(data.chargingSessions) {
            results.append(insight)
        }
        if let stats = data.vampireDrainStats, let insight = vampireDrain(stats) {
            results.append(insight)
        }
        if !data.drives.isEmpty, let insight = drivingPatterns(data.drives, calendar: calendar) {
            results.append(insight)
        }
        if let energy = data.energyStats, let insight = costSavings(energy) {
            results.append(insight)
        }
        if let energy = data.energyStats, let insight = rangeOptimization(energy, battery: data.batteryReport) {
            results.append(insight)
        }
        return results
    }

    /// JavaScript truthiness of a `string | null` charger-type field (non-nil + non-empty).
    internal static func truthy(_ value: String?) -> Bool {
        guard let value else { return false }
        return !value.isEmpty
    }

    /// First index achieving the maximum — the port of `arr.indexOf(Math.max(...arr))` (ties resolve
    /// to the lowest index, matching JS).
    internal static func argmaxFirst(_ counts: [Int]) -> Int {
        guard let maximum = counts.max() else { return 0 }
        return counts.firstIndex(of: maximum) ?? 0
    }
}

// MARK: - Charging cost · efficiency · battery health · optimal charging

public extension InsightsEngineAnalyzers {
    /// `analyzeChargingCost` — average cost/kWh and the home-vs-Supercharger comparison.
    static func chargingCost(_ sessions: [InsightsEngineCharging]) -> InsightsEngineComputation? {
        let withCost = sessions.filter { $0.cost != nil && $0.chargeEnergyAdded > 0 }
        guard withCost.count >= 2 else { return nil }

        let supercharger = withCost.filter { truthy($0.fastChargerType) }
        let home = withCost.filter { !truthy($0.fastChargerType) }

        let avgCost: ([InsightsEngineCharging]) -> Double = { arr in
            let totalCost = arr.reduce(0.0) { $0 + ($1.cost ?? 0) }
            let totalEnergy = arr.reduce(0.0) { $0 + $1.chargeEnergyAdded }
            return totalEnergy > 0 ? totalCost / totalEnergy : 0
        }

        let overall = avgCost(withCost)
        let homeCost = home.isEmpty ? nil : avgCost(home)
        let scCost = supercharger.isEmpty ? nil : avgCost(supercharger)

        var branch: InsightsEngineFacts.ChargingCostBranch = .overallOnly
        var trend: InsightsEngineTrend = .neutral
        var trendGood = true
        if let homeCost, let scCost, scCost > 0 {
            let savings = ((scCost - homeCost) / scCost) * 100
            if savings > 0 {
                branch = .homeSaves(savingsPct: savings)
                trend = .up
            } else {
                branch = .homeHigher
                trend = .down
                trendGood = false
            }
        }

        return InsightsEngineComputation(
            id: "charging-cost",
            icon: .chargingCost,
            severity: .info,
            trend: trend,
            trendGood: trendGood,
            facts: .chargingCost(avgCost: overall, branch: branch)
        )
    }

    /// `analyzeEfficiencyTrend` — recent-vs-earlier Wh/km comparison over the first / second half.
    static func efficiencyTrend(_ drives: [InsightsEngineDrive]) -> InsightsEngineComputation? {
        let valid = drives.filter { $0.distanceM > 0 && $0.energyUsedWh != nil }
        guard valid.count >= 4 else { return nil }

        let half = valid.count / 2
        let efficiency: (ArraySlice<InsightsEngineDrive>) -> Double = { arr in
            let totalDist = arr.reduce(0.0) { $0 + $1.distanceM }
            let totalEnergy = arr.reduce(0.0) { $0 + ($1.energyUsedWh ?? 0) }
            return totalDist > 0 ? (totalEnergy / totalDist) * 1000 : 0
        }

        let recent = efficiency(valid[0 ..< half])
        let older = efficiency(valid[half...])
        guard older != 0 else { return nil }

        let changePct = ((older - recent) / older) * 100
        let improved = changePct > 0
        return InsightsEngineComputation(
            id: "efficiency-trend",
            icon: .efficiency,
            severity: improved ? .success : .warning,
            trend: improved ? .up : .down,
            trendGood: improved,
            facts: .efficiencyTrend(magnitudePct: abs(changePct), improved: improved)
        )
    }

    /// `analyzeBatteryHealth` — health %, the annualised degradation rate, and the aging verdict.
    static func batteryHealth(_ report: InsightsEngineBatteryReport) -> InsightsEngineComputation? {
        guard report.healthScore != 0 else { return nil }

        let degradation = report.degradationPct
        var aging: InsightsEngineFacts.Aging = .expected
        var severity: InsightsEngineSeverity = .success
        if degradation > 10 {
            aging = .worse
            severity = .warning
        } else if degradation < 5 {
            aging = .better
        }

        var yearlyRate = degradation
        let trend = report.monthlyTrend
        if trend.count >= 2 {
            let first = trend[0].capacityPct
            let last = trend[trend.count - 1].capacityPct
            let months = trend.count
            yearlyRate = months > 0 ? ((first - last) / Double(months)) * 12 : degradation
        }

        return InsightsEngineComputation(
            id: "battery-health",
            icon: .battery,
            severity: severity,
            trend: degradation > 8 ? .down : .up,
            trendGood: degradation <= 8,
            facts: .batteryHealth(healthPct: report.currentCapacityPct, yearlyRatePct: yearlyRate, aging: aging)
        )
    }

    /// `analyzeOptimalCharging` — typical end-of-charge level and the >80% habit check.
    static func optimalCharging(_ sessions: [InsightsEngineCharging]) -> InsightsEngineComputation? {
        let withEnd = sessions.compactMap(\.endBatteryLevel)
        guard withEnd.count >= 3 else { return nil }

        let avgEndLevel = withEnd.reduce(0, +) / Double(withEnd.count)
        let above80 = withEnd.count(where: { $0 > 80 })
        let above80Pct = (Double(above80) / Double(withEnd.count)) * 100

        let exceeds = above80Pct > 50
        return InsightsEngineComputation(
            id: "optimal-charging",
            icon: .optimalCharging,
            severity: exceeds ? .warning : .success,
            trend: exceeds ? .down : .up,
            trendGood: !exceeds,
            facts: .optimalCharging(
                avgEndLevel: avgEndLevel,
                branch: exceeds ? .exceeds(above80Pct: above80Pct) : .ideal
            )
        )
    }
}

// MARK: - Vampire drain · driving patterns · cost savings · range optimization

public extension InsightsEngineAnalyzers {
    /// `analyzeVampireDrain` — sentry-mode impact or the average idle-drain summary.
    static func vampireDrain(_ stats: InsightsEngineVampireDrain) -> InsightsEngineComputation? {
        guard stats.eventCount >= 1 else { return nil }

        let sentryDrain = stats.avgSentryDrain
        let noSentryDrain = stats.avgNosentryDrain
        guard !(sentryDrain <= 0 && noSentryDrain <= 0) else { return nil }

        let diff = sentryDrain - noSentryDrain
        let diffPct = noSentryDrain > 0 ? (diff / noSentryDrain) * 100 : 0
        let dailyRangeLoss = sentryDrain * 24

        let sentryHeavy = diffPct > 20
        let branch: InsightsEngineFacts.VampireDrainBranch = sentryHeavy
            ? .sentry(diffPct: diffPct, dailyRangeLoss: dailyRangeLoss)
            : .general(drainRate: stats.avgDrainRate, rangeLost: stats.totalRangeLost, eventCount: stats.eventCount)

        return InsightsEngineComputation(
            id: "vampire-drain",
            icon: .vampireDrain,
            severity: sentryHeavy ? .warning : .info,
            trend: sentryHeavy ? .down : .neutral,
            trendGood: !sentryHeavy,
            facts: .vampireDrain(branch)
        )
    }

    /// `analyzeDrivingPatterns` — average daily distance, busiest day, and peak driving hour.
    static func drivingPatterns(
        _ drives: [InsightsEngineDrive],
        calendar: Calendar
    ) -> InsightsEngineComputation? {
        guard drives.count >= 3 else { return nil }

        let totalDist = drives.reduce(0.0) { $0 + $1.distanceM }
        let dates = drives.map(\.startTs)
        let daySpan = dates.count > 1
            ? dates[0].timeIntervalSince(dates[dates.count - 1]) / 86400
            : 1
        let avgDaily = daySpan > 0 ? totalDist / max(daySpan, 1) : totalDist

        var dayCounts = [Int](repeating: 0, count: 7)
        var hourCounts = [Int](repeating: 0, count: 24)
        for date in dates {
            let weekday = calendar.component(.weekday, from: date) - 1
            let hour = calendar.component(.hour, from: date)
            if dayCounts.indices.contains(weekday) { dayCounts[weekday] += 1 }
            if hourCounts.indices.contains(hour) { hourCounts[hour] += 1 }
        }

        let busiestDay = InsightsEngineWeekday(rawValue: argmaxFirst(dayCounts)) ?? .sunday
        let peakHour = argmaxFirst(hourCounts)
        return InsightsEngineComputation(
            id: "driving-patterns",
            icon: .drivingPatterns,
            severity: .info,
            trend: .neutral,
            trendGood: true,
            facts: .drivingPatterns(
                avgDailyKm: avgDaily / 1000,
                busiestDay: busiestDay,
                peakHour: peakHour,
                peakEnd: (peakHour + 1) % 24
            )
        )
    }

    /// `analyzeCostSavings` — EV vs. gasoline savings (8.5 L/100km @ ~$1.50/L) and CO₂ avoided.
    static func costSavings(_ energy: InsightsEngineEnergyStats) -> InsightsEngineComputation? {
        guard energy.totalEnergyUsedKwh > 0 else { return nil }

        // Average gas car: 8.5 L/100km, avg gas price ~$1.50/L (web constants).
        let gasEquivalent = (energy.totalDistanceKm / 100) * 8.5 * 1.50
        let savings = gasEquivalent - energy.totalCost
        guard savings > 0 else { return nil }

        return InsightsEngineComputation(
            id: "cost-savings",
            icon: .costSavings,
            severity: .success,
            trend: .up,
            trendGood: true,
            facts: .costSavings(
                savings: savings,
                kwh: energy.totalEnergyUsedKwh,
                distanceKm: energy.totalDistanceKm,
                co2Kg: energy.co2SavedKg
            )
        )
    }

    /// `analyzeRangeOptimization` — effective range vs. rated at the user's average efficiency.
    static func rangeOptimization(
        _ energy: InsightsEngineEnergyStats,
        battery: InsightsEngineBatteryReport?
    ) -> InsightsEngineComputation? {
        guard energy.avgEfficiencyWhKm > 0 else { return nil }

        let effWhKm = energy.avgEfficiencyWhKm
        let ratedRange = battery?.estimatedRangeNewKm ?? 500
        let currentRange = battery?.estimatedRangeCurrentKm ?? ratedRange

        // Nominal consumption ~150 Wh/km for base comparison (web constant).
        let ratedEfficiency = 150.0
        let effectiveRange = (ratedEfficiency / effWhKm) * currentRange
        let rangePct = currentRange > 0 ? (effectiveRange / currentRange) * 100 : 100

        let severity: InsightsEngineSeverity = rangePct >= 90 ? .success : (rangePct >= 80 ? .info : .warning)
        let trend: InsightsEngineTrend = rangePct >= 90 ? .up : (rangePct >= 80 ? .neutral : .down)
        return InsightsEngineComputation(
            id: "range-optimization",
            icon: .rangeOptimization,
            severity: severity,
            trend: trend,
            trendGood: rangePct >= 80,
            facts: .rangeOptimization(
                effWhKm: effWhKm,
                effectiveRangeKm: effectiveRange,
                rangePct: rangePct,
                hint: rangePct < 85 ? .precondition : .efficient
            )
        )
    }
}
