//
//  InsightsEngine.Projection.swift
//  TeslaSync — P4 shared surface · 0092 · InsightsEngine (Apple)
//
//  The pure projection from the coalesced input snapshot to the resolved view-state — the native port
//  of the web `InsightsEngine` render plus the P4 leaf contract. The analyzers (Adapter) produce
//  locale-agnostic facts; this layer localizes (P1/S10) + formats (the `useFormatting` /
//  `fmtNumber` boundary) them into view-ready prose so the view is a pure function of the result.
//  Kept free of SwiftUI so every rendered string is unit-tested in isolation.
//

import Foundation

public enum InsightsEngineProjection {}

// MARK: - Phase resolution (web body + P4 leaf contract)

public extension InsightsEngineProjection {
    /// Resolves the input snapshot into the view-state. `loading` / `failed` map to the leaf chrome;
    /// `loaded` runs the analyzers and either yields the localized cards or the friendly empty state
    /// (web `insights.length === 0 → null`).
    static func resolve(
        _ input: InsightsEngineInput,
        calendar: Calendar = .current
    ) -> InsightsEngineResolved {
        switch input.load {
        case .loading:
            return InsightsEngineResolved(phase: .loading)
        case let .failed(message):
            return InsightsEngineResolved(phase: .error(message))
        case let .loaded(data):
            let computations = InsightsEngineAnalyzers.analyze(data, calendar: calendar)
            guard !computations.isEmpty else { return InsightsEngineResolved(phase: .empty) }
            let formatting = InsightsEngineFormatting(input.formatting)
            let insights = computations.map { resolve($0, formatting: formatting) }
            return InsightsEngineResolved(phase: .ready, insights: insights)
        }
    }

    /// Localizes one computation into a view-ready insight (title + description + VoiceOver label).
    static func resolve(
        _ computation: InsightsEngineComputation,
        formatting: InsightsEngineFormatting
    ) -> InsightsEngineResolvedInsight {
        let title = title(for: computation.icon)
        let description = description(for: computation.facts, formatting: formatting)
        let trend = trendLabel(computation.trend)
        return InsightsEngineResolvedInsight(
            id: computation.id,
            icon: computation.icon,
            severity: computation.severity,
            trend: computation.trend,
            trendGood: computation.trendGood,
            title: title,
            description: description,
            accessibilityLabel: "\(title). \(trend). \(description)"
        )
    }
}

// MARK: - Titles + labels

extension InsightsEngineProjection {
    static func title(for icon: InsightsEngineIcon) -> String {
        switch icon {
        case .chargingCost:
            InsightsEngineStrings.string("insights.chargingCost.title", "Charging Cost")
        case .efficiency:
            InsightsEngineStrings.string("insights.efficiencyTrend.title", "Efficiency Trend")
        case .battery:
            InsightsEngineStrings.string("insights.batteryHealth.title", "Battery Health")
        case .optimalCharging:
            InsightsEngineStrings.string("insights.optimalCharging.title", "Optimal Charging")
        case .vampireDrain:
            InsightsEngineStrings.string("insights.vampireDrain.title", "Vampire Drain")
        case .drivingPatterns:
            InsightsEngineStrings.string("insights.drivingPatterns.title", "Driving Patterns")
        case .costSavings:
            InsightsEngineStrings.string("insights.costSavings.title", "EV Cost Savings")
        case .rangeOptimization:
            InsightsEngineStrings.string("insights.rangeOptimization.title", "Range Optimization")
        }
    }

    static func trendLabel(_ trend: InsightsEngineTrend) -> String {
        switch trend {
        case .up: InsightsEngineStrings.string("insights.trend.up", "Trending up")
        case .down: InsightsEngineStrings.string("insights.trend.down", "Trending down")
        case .neutral: InsightsEngineStrings.string("insights.trend.neutral", "Steady")
        }
    }

    static func agingPhrase(_ aging: InsightsEngineFacts.Aging) -> String {
        switch aging {
        case .expected: InsightsEngineStrings.string("insights.batteryHealth.aging.expected", "as expected")
        case .worse: InsightsEngineStrings.string("insights.batteryHealth.aging.worse", "worse than average")
        case .better: InsightsEngineStrings.string("insights.batteryHealth.aging.better", "better than average")
        }
    }

    static func dayName(_ day: InsightsEngineWeekday) -> String {
        switch day {
        case .sunday: InsightsEngineStrings.string("insights.day.sunday", "Sunday")
        case .monday: InsightsEngineStrings.string("insights.day.monday", "Monday")
        case .tuesday: InsightsEngineStrings.string("insights.day.tuesday", "Tuesday")
        case .wednesday: InsightsEngineStrings.string("insights.day.wednesday", "Wednesday")
        case .thursday: InsightsEngineStrings.string("insights.day.thursday", "Thursday")
        case .friday: InsightsEngineStrings.string("insights.day.friday", "Friday")
        case .saturday: InsightsEngineStrings.string("insights.day.saturday", "Saturday")
        }
    }
}

// MARK: - Description builders (web prose templates, localized + formatted)

extension InsightsEngineProjection {
    static func description(
        for facts: InsightsEngineFacts,
        formatting fmt: InsightsEngineFormatting
    ) -> String {
        switch facts {
        case let .chargingCost(avgCost, branch):
            chargingCostText(avgCost: avgCost, branch: branch, fmt: fmt)
        case let .efficiencyTrend(magnitudePct, improved):
            efficiencyText(magnitudePct: magnitudePct, improved: improved, fmt: fmt)
        case let .batteryHealth(healthPct, yearlyRatePct, aging):
            batteryHealthText(healthPct: healthPct, yearlyRatePct: yearlyRatePct, aging: aging, fmt: fmt)
        case let .optimalCharging(avgEndLevel, branch):
            optimalChargingText(avgEndLevel: avgEndLevel, branch: branch, fmt: fmt)
        case let .vampireDrain(branch):
            vampireDrainText(branch: branch, fmt: fmt)
        case let .drivingPatterns(avgDailyKm, busiestDay, peakHour, peakEnd):
            drivingPatternsText(
                avgDailyKm: avgDailyKm,
                busiestDay: busiestDay,
                peakHour: peakHour,
                peakEnd: peakEnd,
                fmt: fmt
            )
        case let .costSavings(savings, kwh, distanceKm, co2Kg):
            costSavingsText(savings: savings, kwh: kwh, distanceKm: distanceKm, co2Kg: co2Kg, fmt: fmt)
        case let .rangeOptimization(effWhKm, effectiveRangeKm, rangePct, hint):
            rangeOptimizationText(
                effWhKm: effWhKm,
                effectiveRangeKm: effectiveRangeKm,
                rangePct: rangePct,
                hint: hint,
                fmt: fmt
            )
        }
    }

    private static func chargingCostText(
        avgCost: Double,
        branch: InsightsEngineFacts.ChargingCostBranch,
        fmt: InsightsEngineFormatting
    ) -> String {
        let base = InsightsEngineStrings.format(
            "insights.chargingCost.base",
            "Your average charging cost is %@/kWh.",
            fmt.currency(avgCost, decimals: 2)
        )
        switch branch {
        case .overallOnly:
            return base
        case let .homeSaves(savingsPct):
            let extra = InsightsEngineStrings.format(
                "insights.chargingCost.homeSaves",
                "Home charging saves you %@%% compared to Supercharging.",
                fmt.number(savingsPct, decimals: 0)
            )
            return "\(base) \(extra)"
        case .homeHigher:
            let extra = InsightsEngineStrings.string(
                "insights.chargingCost.homeHigher",
                "Your home electricity rate is higher than Supercharger rates — consider off-peak charging."
            )
            return "\(base) \(extra)"
        }
    }

    private static func efficiencyText(
        magnitudePct: Double,
        improved: Bool,
        fmt: InsightsEngineFormatting
    ) -> String {
        let magnitude = fmt.number(magnitudePct, decimals: 1)
        if improved {
            return InsightsEngineStrings.format(
                "insights.efficiencyTrend.improved",
                "Your driving efficiency improved %@%% in recent drives compared to earlier drives. "
                    + "Keep up the smooth driving!",
                magnitude
            )
        }
        return InsightsEngineStrings.format(
            "insights.efficiencyTrend.declined",
            "Your driving efficiency decreased %@%% in recent drives. "
                + "Consider gentler acceleration and highway cruise control.",
            magnitude
        )
    }

    private static func batteryHealthText(
        healthPct: Double,
        yearlyRatePct: Double,
        aging: InsightsEngineFacts.Aging,
        fmt: InsightsEngineFormatting
    ) -> String {
        InsightsEngineStrings.format(
            "insights.batteryHealth.description",
            "Battery health is at %1$@%%. Degradation rate is %2$@%% per year — your battery is aging %3$@.",
            fmt.number(healthPct, decimals: 1),
            fmt.number(yearlyRatePct, decimals: 1),
            agingPhrase(aging)
        )
    }

    private static func optimalChargingText(
        avgEndLevel: Double,
        branch: InsightsEngineFacts.OptimalChargingBranch,
        fmt: InsightsEngineFormatting
    ) -> String {
        let base = InsightsEngineStrings.format(
            "insights.optimalCharging.base",
            "You charge most often to %@%%.",
            fmt.number(avgEndLevel, decimals: 0)
        )
        switch branch {
        case let .exceeds(above80Pct):
            let extra = InsightsEngineStrings.format(
                "insights.optimalCharging.exceeds",
                "%@%% of your charges exceed 80%%. For battery longevity, consider keeping charges between 20–80%%.",
                fmt.number(above80Pct, decimals: 0)
            )
            return "\(base) \(extra)"
        case .ideal:
            let extra = InsightsEngineStrings.string(
                "insights.optimalCharging.ideal",
                "Great habit — most of your charges stay within the ideal 20–80% range for battery longevity."
            )
            return "\(base) \(extra)"
        }
    }

    private static func vampireDrainText(
        branch: InsightsEngineFacts.VampireDrainBranch,
        fmt: InsightsEngineFormatting
    ) -> String {
        switch branch {
        case let .sentry(diffPct, dailyRangeLoss):
            InsightsEngineStrings.format(
                "insights.vampireDrain.sentry",
                "Sentry Mode increases battery drain by %1$@%%. "
                    + "Consider disabling it at home to save ~%2$@ km of range daily.",
                fmt.number(diffPct, decimals: 0),
                fmt.number(dailyRangeLoss, decimals: 1)
            )
        case let .general(drainRate, rangeLost, eventCount):
            InsightsEngineStrings.format(
                "insights.vampireDrain.general",
                "Average vampire drain is %1$@ %%/hr. Total range lost to idle drain: %2$@ km across %3$@ events.",
                fmt.number(drainRate, decimals: 2),
                fmt.number(rangeLost, decimals: 1),
                String(eventCount)
            )
        }
    }

    private static func drivingPatternsText(
        avgDailyKm: Double,
        busiestDay: InsightsEngineWeekday,
        peakHour: Int,
        peakEnd: Int,
        fmt: InsightsEngineFormatting
    ) -> String {
        InsightsEngineStrings.format(
            "insights.drivingPatterns.description",
            "You drive an average of %1$@ km/day. Your most active day is %2$@. Peak driving time: %3$@:00–%4$@:00.",
            fmt.number(avgDailyKm, decimals: 1),
            dayName(busiestDay),
            String(peakHour),
            String(peakEnd)
        )
    }

    private static func costSavingsText(
        savings: Double,
        kwh: Double,
        distanceKm: Double,
        co2Kg: Double,
        fmt: InsightsEngineFormatting
    ) -> String {
        InsightsEngineStrings.format(
            "insights.costSavings.description",
            "You've saved approximately %1$@ vs. gasoline based on %2$@ kWh consumed over %3$@ km. "
                + "That's also %4$@ kg of CO₂ saved!",
            fmt.currency(savings, decimals: 0),
            fmt.number(kwh, decimals: 0),
            fmt.number(distanceKm, decimals: 0),
            fmt.number(co2Kg, decimals: 0)
        )
    }

    private static func rangeOptimizationText(
        effWhKm: Double,
        effectiveRangeKm: Double,
        rangePct: Double,
        hint: InsightsEngineFacts.RangeHint,
        fmt: InsightsEngineFormatting
    ) -> String {
        let base = InsightsEngineStrings.format(
            "insights.rangeOptimization.base",
            "At your average efficiency of %1$@ Wh/km, your effective range is ~%2$@ km (%3$@%% of rated range).",
            fmt.number(effWhKm, decimals: 0),
            fmt.number(effectiveRangeKm, decimals: 0),
            fmt.number(rangePct, decimals: 0)
        )
        let hintText: String = switch hint {
        case .precondition:
            InsightsEngineStrings.string(
                "insights.rangeOptimization.hint.precondition",
                "Consider preconditioning and reducing highway speed for better range."
            )
        case .efficient:
            InsightsEngineStrings.string(
                "insights.rangeOptimization.hint.efficient",
                "Your driving style is range-efficient — great work!"
            )
        }
        return "\(base) \(hintText)"
    }
}
