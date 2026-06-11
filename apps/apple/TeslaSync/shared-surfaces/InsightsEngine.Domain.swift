//
//  InsightsEngine.Domain.swift
//  TeslaSync — P4 shared surface · 0092 · InsightsEngine (Apple)
//
//  The pure Foundation domain model for the Smart-Insights engine — the SwiftUI parity of
//  web/src/components/data-display/InsightsEngine.tsx. The web component is `@ts-nocheck`
//  ("legacy API types; will be rewired in a later phase") and reads a LEGACY field shape off the
//  `InsightData` it is handed (e.g. `charge_energy_added`, `fast_charger_type`, `end_battery_level`,
//  `total_energy_used_kwh`, `total_distance_km`, `avg_efficiency_wh_km`). To preserve byte-for-byte
//  parity of the computed insights (Honesty Covenant rules 5 + 9 — no parity shortcuts, no silent
//  drift), these DTOs mirror exactly the fields the web analyzers read, with the same value
//  semantics (kWh / km / %). Adapting the live SI API into this shape is the bound state-holder's job
//  (P1/S8), out of scope for this surface.
//
//  Nothing here imports SwiftUI or performs localization / number formatting: the analyzers produce
//  structured, locale-agnostic facts (`InsightsEngineComputation`), and the projection (P1/S10) turns
//  them into localized prose at the display boundary. That keeps the whole computation unit-testable
//  in isolation against the exact web expressions.
//

import Foundation

// MARK: - Domain DTOs (mirror the web `InsightData` legacy read-contract)

/// One drive — only the fields the web analyzers read. `distanceM` is SI meters and `energyUsedWh`
/// is SI watt-hours (the web `Drive` already exposes `distance_m` / `energy_used_wh`); `startTs` is
/// the parsed `start_ts` timestamp used for the day/hour histogram.
public struct InsightsEngineDrive: Sendable, Equatable {
    public var distanceM: Double
    public var energyUsedWh: Double?
    public var startTs: Date

    public init(distanceM: Double, energyUsedWh: Double?, startTs: Date) {
        self.distanceM = distanceM
        self.energyUsedWh = energyUsedWh
        self.startTs = startTs
    }
}

/// One charging session — the web legacy read-contract: `cost` (currency), `chargeEnergyAdded` in
/// kWh (`charge_energy_added`), `fastChargerType` truthiness (`fast_charger_type` → Supercharger vs
/// home), and `endBatteryLevel` (`end_battery_level`, 0–100).
public struct InsightsEngineCharging: Sendable, Equatable {
    public var cost: Double?
    public var chargeEnergyAdded: Double
    public var fastChargerType: String?
    public var endBatteryLevel: Double?

    public init(
        cost: Double?,
        chargeEnergyAdded: Double,
        fastChargerType: String?,
        endBatteryLevel: Double?
    ) {
        self.cost = cost
        self.chargeEnergyAdded = chargeEnergyAdded
        self.fastChargerType = fastChargerType
        self.endBatteryLevel = endBatteryLevel
    }
}

/// Aggregate energy stats — the web legacy read-contract: `totalEnergyUsedKwh`
/// (`total_energy_used_kwh`), `totalDistanceKm` (`total_distance_km`), `totalCost`, `co2SavedKg`
/// (`co2_saved_kg`), and `avgEfficiencyWhKm` (`avg_efficiency_wh_km`).
public struct InsightsEngineEnergyStats: Sendable, Equatable {
    public var totalEnergyUsedKwh: Double
    public var totalDistanceKm: Double
    public var totalCost: Double
    public var co2SavedKg: Double
    public var avgEfficiencyWhKm: Double

    public init(
        totalEnergyUsedKwh: Double,
        totalDistanceKm: Double,
        totalCost: Double,
        co2SavedKg: Double,
        avgEfficiencyWhKm: Double
    ) {
        self.totalEnergyUsedKwh = totalEnergyUsedKwh
        self.totalDistanceKm = totalDistanceKm
        self.totalCost = totalCost
        self.co2SavedKg = co2SavedKg
        self.avgEfficiencyWhKm = avgEfficiencyWhKm
    }
}

/// One point on the battery monthly-capacity trend (`monthly_trend[].capacity_pct`).
public struct InsightsEngineBatteryTrendPoint: Sendable, Equatable {
    public var capacityPct: Double

    public init(capacityPct: Double) {
        self.capacityPct = capacityPct
    }
}

/// Battery degradation report — the web read-contract: `healthScore` (`health_score`; a falsy 0
/// suppresses the insight), `currentCapacityPct`, `degradationPct`, the monthly capacity trend, and
/// the rated / current range estimates used by range optimization.
public struct InsightsEngineBatteryReport: Sendable, Equatable {
    public var healthScore: Double
    public var currentCapacityPct: Double
    public var degradationPct: Double
    public var monthlyTrend: [InsightsEngineBatteryTrendPoint]
    public var estimatedRangeNewKm: Double?
    public var estimatedRangeCurrentKm: Double?

    public init(
        healthScore: Double,
        currentCapacityPct: Double,
        degradationPct: Double,
        monthlyTrend: [InsightsEngineBatteryTrendPoint],
        estimatedRangeNewKm: Double?,
        estimatedRangeCurrentKm: Double?
    ) {
        self.healthScore = healthScore
        self.currentCapacityPct = currentCapacityPct
        self.degradationPct = degradationPct
        self.monthlyTrend = monthlyTrend
        self.estimatedRangeNewKm = estimatedRangeNewKm
        self.estimatedRangeCurrentKm = estimatedRangeCurrentKm
    }
}

/// Vampire-drain stats — the web read-contract: the average drain rate (%/hr), the total range lost
/// (km), the sentry / no-sentry averages, and the event count (a 0 count suppresses the insight).
public struct InsightsEngineVampireDrain: Sendable, Equatable {
    public var avgDrainRate: Double
    public var totalRangeLost: Double
    public var avgSentryDrain: Double
    public var avgNosentryDrain: Double
    public var eventCount: Int

    public init(
        avgDrainRate: Double,
        totalRangeLost: Double,
        avgSentryDrain: Double,
        avgNosentryDrain: Double,
        eventCount: Int
    ) {
        self.avgDrainRate = avgDrainRate
        self.totalRangeLost = totalRangeLost
        self.avgSentryDrain = avgSentryDrain
        self.avgNosentryDrain = avgNosentryDrain
        self.eventCount = eventCount
    }
}

/// Mileage stats — carried by the web `InsightData` for completeness but read by no analyzer. Kept so
/// the native input snapshot is a faithful peer of the web prop (and so a future analyzer can bind it
/// without a contract change).
public struct InsightsEngineMileageStats: Sendable, Equatable {
    public var totalDistance: Double
    public var avgDaily: Double
    public var maxDaily: Double
    public var totalEnergy: Double
    public var totalDrives: Int
    public var daysTracked: Int

    public init(
        totalDistance: Double = 0,
        avgDaily: Double = 0,
        maxDaily: Double = 0,
        totalEnergy: Double = 0,
        totalDrives: Int = 0,
        daysTracked: Int = 0
    ) {
        self.totalDistance = totalDistance
        self.avgDaily = avgDaily
        self.maxDaily = maxDaily
        self.totalEnergy = totalEnergy
        self.totalDrives = totalDrives
        self.daysTracked = daysTracked
    }
}

/// The coalesced analysis input — the native peer of the web `InsightData` prop. All members optional
/// / empty by default so the empty surface (web `return null`) is naturally reachable.
public struct InsightsEngineData: Sendable, Equatable {
    public var drives: [InsightsEngineDrive]
    public var chargingSessions: [InsightsEngineCharging]
    public var energyStats: InsightsEngineEnergyStats?
    public var batteryReport: InsightsEngineBatteryReport?
    public var mileageStats: InsightsEngineMileageStats?
    public var vampireDrainStats: InsightsEngineVampireDrain?

    public init(
        drives: [InsightsEngineDrive] = [],
        chargingSessions: [InsightsEngineCharging] = [],
        energyStats: InsightsEngineEnergyStats? = nil,
        batteryReport: InsightsEngineBatteryReport? = nil,
        mileageStats: InsightsEngineMileageStats? = nil,
        vampireDrainStats: InsightsEngineVampireDrain? = nil
    ) {
        self.drives = drives
        self.chargingSessions = chargingSessions
        self.energyStats = energyStats
        self.batteryReport = batteryReport
        self.mileageStats = mileageStats
        self.vampireDrainStats = vampireDrainStats
    }
}

// MARK: - Presentation-agnostic enums (web `Severity` / `Trend` + the per-insight icon)

/// The web `Severity` union — drives the card's left-border / icon tint (mapped to the status tokens
/// at the view boundary, never raw hex).
public enum InsightsEngineSeverity: String, Sendable, Equatable, CaseIterable {
    case info
    case success
    case warning
    case alert
}

/// The web `Trend` union — drives the trend glyph + its colour (combined with `trendGood`).
public enum InsightsEngineTrend: String, Sendable, Equatable, CaseIterable {
    case up
    case down
    case neutral
}

/// The per-insight leading icon — the native peer of the web lucide glyph (resolved to an SF Symbol
/// at the view boundary). One case per analyzer.
public enum InsightsEngineIcon: String, Sendable, Equatable {
    case chargingCost
    case efficiency
    case battery
    case optimalCharging
    case vampireDrain
    case drivingPatterns
    case costSavings
    case rangeOptimization
}

/// Day of week (web `dayNames`, index 0 = Sunday) — the busiest-day result of the driving-patterns
/// analyzer, localized at the projection boundary.
public enum InsightsEngineWeekday: Int, Sendable, Equatable, CaseIterable {
    case sunday = 0
    case monday
    case tuesday
    case wednesday
    case thursday
    case friday
    case saturday
}

// MARK: - Structured facts (locale-agnostic — localized in the projection)

/// The structured, locale-agnostic result of one analyzer — every number + branch the web prose
/// interpolates, with NO formatting / localization applied (that happens in the projection at the
/// display boundary). Pinned by the adapter tests against the exact web expressions.
public enum InsightsEngineFacts: Sendable, Equatable {
    /// Branch of `analyzeChargingCost` after the base "average cost" sentence.
    public enum ChargingCostBranch: Sendable, Equatable {
        case overallOnly
        case homeSaves(savingsPct: Double)
        case homeHigher
    }

    /// Branch of `analyzeBatteryHealth` — the aging-quality phrase.
    public enum Aging: Sendable, Equatable {
        case expected
        case worse
        case better
    }

    /// Branch of `analyzeOptimalCharging` after the base "charge to N%" sentence.
    public enum OptimalChargingBranch: Sendable, Equatable {
        case exceeds(above80Pct: Double)
        case ideal
    }

    /// Branch of `analyzeVampireDrain`.
    public enum VampireDrainBranch: Sendable, Equatable {
        case sentry(diffPct: Double, dailyRangeLoss: Double)
        case general(drainRate: Double, rangeLost: Double, eventCount: Int)
    }

    /// Branch of `analyzeRangeOptimization` — the trailing hint sentence.
    public enum RangeHint: Sendable, Equatable {
        case precondition
        case efficient
    }

    case chargingCost(avgCost: Double, branch: ChargingCostBranch)
    case efficiencyTrend(magnitudePct: Double, improved: Bool)
    case batteryHealth(healthPct: Double, yearlyRatePct: Double, aging: Aging)
    case optimalCharging(avgEndLevel: Double, branch: OptimalChargingBranch)
    case vampireDrain(VampireDrainBranch)
    case drivingPatterns(avgDailyKm: Double, busiestDay: InsightsEngineWeekday, peakHour: Int, peakEnd: Int)
    case costSavings(savings: Double, kwh: Double, distanceKm: Double, co2Kg: Double)
    case rangeOptimization(effWhKm: Double, effectiveRangeKm: Double, rangePct: Double, hint: RangeHint)
}

/// One computed insight — the structured peer of the web `Insight` object minus the localized title /
/// description (built in the projection). `id` matches the web id verbatim so ordering + identity are
/// stable.
public struct InsightsEngineComputation: Sendable, Equatable, Identifiable {
    public let id: String
    public let icon: InsightsEngineIcon
    public let severity: InsightsEngineSeverity
    public let trend: InsightsEngineTrend
    public let trendGood: Bool
    public let facts: InsightsEngineFacts

    public init(
        id: String,
        icon: InsightsEngineIcon,
        severity: InsightsEngineSeverity,
        trend: InsightsEngineTrend,
        trendGood: Bool,
        facts: InsightsEngineFacts
    ) {
        self.id = id
        self.icon = icon
        self.severity = severity
        self.trend = trend
        self.trendGood = trendGood
        self.facts = facts
    }
}
