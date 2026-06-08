//
//  MileageStatsWidget.Builder.swift
//  TeslaSync — P4 dashboard widget · 0064 · MileageStatsWidget (Apple)
//
//  The pure cached → projection adapter: a faithful Swift port of the web
//  MileageStatsWidget.tsx computation (lines that derive the daily/weekly/
//  monthly averages, the next 10k milestone, and the months-to-milestone
//  projection) plus `convertDistanceFromSI`. No SwiftUI / transport — this is
//  the unit-tested core both platforms agree on.
//

import Foundation

// MARK: - MileageStatsBuilder (port of the web widget's derive block)

/// Pure functions that turn the cached `/mileage/stats` snapshot into the
/// display-unit `MileageStatsProjection`. A 1:1 port of the web source so both
/// platforms show identical numbers.
public enum MileageStatsBuilder {
    /// One 10 000-unit milestone step (web `const step = 10_000`).
    public static let milestoneStep: Double = 10000

    /// Days in the rolling average window the daily average derives from.
    private static let rollingWindowDays: Double = 30

    /// Converts SI meters to the user's distance unit (web `convertDistanceFromSI`).
    public static func convertDistanceFromSI(_ meters: Double, to unit: MileageDistanceUnit) -> Double {
        let value = meters.isFinite ? meters : 0
        return value / unit.metersPerUnit
    }

    /// Rounds up to the next 10 000-unit milestone above the current total
    /// (web `nextMilestone`: `ceil((total + 1) / step) * step`).
    public static func nextMilestone(_ totalInUnit: Double) -> Double {
        let total = totalInUnit.isFinite ? totalInUnit : 0
        return ((total + 1) / milestoneStep).rounded(.up) * milestoneStep
    }

    /// Estimates whole months to reach the milestone at the current daily pace
    /// (web `dailyAvg > 0 ? max(1, round(remaining / dailyAvg / 30)) : 0`).
    public static func monthsToMilestone(remaining: Double, dailyAvgDisplay: Double) -> Int {
        guard dailyAvgDisplay > 0, remaining.isFinite else { return 0 }
        let months = (remaining / dailyAvgDisplay / rollingWindowDays).rounded()
        return max(1, Int(months))
    }

    /// Builds the projection from the cached input, or `nil` when there is no
    /// cached snapshot (the web renders its empty state when `data` is absent).
    public static func project(_ input: MileageStatsInput?, unit: MileageDistanceUnit) -> MileageStatsProjection? {
        guard let input else { return nil }

        // Backend exposes kilometres; lift to SI meters before converting so the
        // SI-canonical converter (meters in) treats the values correctly.
        let totalMeters = input.lifetimeKm * 1000
        let dailyAvgMeters = (input.last30dKm / rollingWindowDays) * 1000

        let totalDisplay = convertDistanceFromSI(totalMeters, to: unit)
        let dailyAvgDisplay = convertDistanceFromSI(dailyAvgMeters, to: unit)
        let milestone = nextMilestone(totalDisplay)
        let remaining = milestone - totalDisplay

        return MileageStatsProjection(
            unit: unit,
            totalDisplay: totalDisplay,
            dailyAvgDisplay: dailyAvgDisplay,
            weeklyAvgDisplay: dailyAvgDisplay * 7,
            monthlyAvgDisplay: dailyAvgDisplay * rollingWindowDays,
            milestone: milestone,
            remaining: remaining,
            monthsToMilestone: monthsToMilestone(remaining: remaining, dailyAvgDisplay: dailyAvgDisplay)
        )
    }
}
