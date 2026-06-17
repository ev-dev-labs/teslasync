//
//  SpeedProfileFormat.swift
//  TeslaSync — P4 feature view · P7 · driving/SpeedProfile (Apple) — Display formatting
//
//  Pure display-boundary helpers for the Speed Profile surface (web `fmtNumber` +
//  `convertSpeedFromSI` + the `speedUnit` / `efficiencyUnit` / `toEfficiencyDisplay`
//  helpers + `bucketColor` / `bucketTextClass` / `categoryIcon` + the per-bucket
//  `bucketEfficiency` memo + the insight sentence). SI values come from the model;
//  conversion to the user's unit happens here via the shared KMP `Units` facade
//  (P1/S5) — never in the model. All color values resolve from the P2 design tokens
//  (no hardcoded hex); each numeric helper returns an em dash for non-finite input.
//

import SwiftUI

/// Mean efficiency + speed for one distribution bucket (web `bucketEfficiency` value).
struct SpeedBucketEfficiency {
    let avgEfficiencyWhPerKm: Double
    let avgSpeedMps: Double
}

enum SpeedProfileFormat {
    /// The em dash shown for a missing value (web `'—'`).
    static let emptyValue = "—"

    /// The fraction digits a bare `fmtNumber(v)` uses — the user's global precision
    /// (web default 2).
    static func defaultDecimals(_ prefs: UnitPreferences) -> Int {
        prefs.precision ?? 2
    }

    /// Web `fmtNumber(value, decimals)`: locale-aware grouping, fixed fraction digits.
    static func number(_ value: Double, decimals: Int, _ prefs: UnitPreferences) -> String {
        guard value.isFinite else { return emptyValue }
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: (prefs.locale ?? "en-US").replacingOccurrences(of: "-", with: "_"))
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.\(decimals)f", value)
    }

    // MARK: - Speed (web `speedUnit` + `toSpeedDisplay` = `convertSpeedFromSI`)

    /// Web `speedUnit = unitPrefs.speed` (`"km/h"` / `"mph"`).
    static func speedUnit(_ prefs: UnitPreferences) -> String {
        prefs.speed
    }

    /// SI m/s → the user's speed-unit value (web `toSpeedDisplay = convertSpeedFromSI`).
    static func speedDisplay(_ mps: Double, _ prefs: UnitPreferences) -> Double {
        Units.convertSpeed(mps, prefs)
    }

    /// Web `Math.round(toSpeedDisplay(mps))` — the rounded display number (gauges).
    static func speedRounded(_ mps: Double, _ prefs: UnitPreferences) -> Int {
        let value = speedDisplay(mps, prefs)
        guard value.isFinite else { return 0 }
        return Int(value.rounded())
    }

    /// Web `${fmtNumber(toSpeedDisplay(mps))} ${speedUnit}` (detail-card avg speed).
    static func speed(_ mps: Double, _ prefs: UnitPreferences) -> String {
        "\(number(speedDisplay(mps, prefs), decimals: defaultDecimals(prefs), prefs)) \(speedUnit(prefs))"
    }

    // MARK: - Efficiency (web `efficiencyUnit` + `toEfficiencyDisplay`)

    /// Web `efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km'`.
    static func efficiencyUnit(_ prefs: UnitPreferences) -> String {
        prefs.distance == "mi" ? "Wh/mi" : "Wh/km"
    }

    /// Web `toEfficiencyDisplay`: `Wh/km` for metric, scaled by km-per-mile for imperial.
    static func efficiencyDisplay(_ whPerKm: Double, _ prefs: UnitPreferences) -> Double {
        prefs.distance == "mi" ? whPerKm * 1.609344 : whPerKm
    }

    /// Web `fmtNumber(toEfficiencyDisplay(whPerKm))` (detail-card consumption number).
    static func efficiency(_ whPerKm: Double, _ prefs: UnitPreferences) -> String {
        number(efficiencyDisplay(whPerKm, prefs), decimals: defaultDecimals(prefs), prefs)
    }

    /// Web `Math.round(toEfficiencyDisplay(whPerKm))` (scatter Y value).
    static func efficiencyRounded(_ whPerKm: Double, _ prefs: UnitPreferences) -> Int {
        let value = efficiencyDisplay(whPerKm, prefs)
        guard value.isFinite else { return 0 }
        return Int(value.rounded())
    }

    // MARK: - Percent (web `fmtNumber(pct, 1)%`)

    /// Web `${fmtNumber(pct, 1)}%` — the bucket time-share label.
    static func percent(_ value: Double, _ prefs: UnitPreferences) -> String {
        "\(number(value, decimals: 1, prefs))%"
    }

    // MARK: - Bucket color (web `bucketColor` / `bucketTextClass`)

    /// Web `bucketColor(range)` mapped to the design-token chart palette
    /// (green→Battery, cyan→Regen, amber→Energy, red→Temperature). Also serves the
    /// web `bucketTextClass` tint (same thresholds).
    static func bucketColor(_ label: String) -> Color {
        if label.hasPrefix("0") || label.contains("15") { return Color.TS.chartSeriesBattery }
        if label.hasPrefix("30") || label.contains("45") { return Color.TS.chartSeriesRegen }
        if label.hasPrefix("60") || label.contains("75") { return Color.TS.chartSeriesEnergy }
        return Color.TS.chartSeriesTemperature
    }

    // MARK: - Category icon (web `categoryIcon`)

    /// Web `categoryIcon(range)` SF Symbol: `Car` for low / `TrendingUp` for high /
    /// `Gauge` otherwise.
    static func bucketIconSystemName(_ label: String) -> String {
        if label.contains("30") || label.hasPrefix("0") { return "car.fill" }
        if label.contains("60") || label.contains("90") { return "chart.line.uptrend.xyaxis" }
        return "gauge.with.dots.needle.50percent"
    }

    /// Web category-icon tint (green / cyan / amber), mapped to the chart palette.
    static func bucketIconColor(_ label: String) -> Color {
        if label.contains("30") || label.hasPrefix("0") { return Color.TS.chartSeriesBattery }
        if label.contains("60") || label.contains("90") { return Color.TS.chartSeriesRegen }
        return Color.TS.chartSeriesEnergy
    }

    // MARK: - Detail-card efficiency color (web `avgEff < 160 ? green : < 220 ? amber : red`)

    /// Web detail-card consumption tint keyed on the raw `Wh/km` value.
    static func efficiencyColor(_ whPerKm: Double) -> Color {
        switch whPerKm {
        case ..<160: Color.TS.chartSeriesBattery
        case ..<220: Color.TS.chartSeriesEnergy
        default: Color.TS.chartSeriesTemperature
        }
    }

    // MARK: - Scatter band color (web `eff < 140 ? green : < 200 ? cyan : < 260 ? amber : red`)

    /// Web scatter-point tint keyed on the *display* efficiency value.
    static func scatterColor(_ displayEfficiency: Double) -> Color {
        switch displayEfficiency {
        case ..<140: Color.TS.chartSeriesBattery
        case ..<200: Color.TS.chartSeriesRegen
        case ..<260: Color.TS.chartSeriesEnergy
        default: Color.TS.chartSeriesTemperature
        }
    }

    // MARK: - Per-bucket efficiency (web `bucketEfficiency` useMemo)

    /// Web `bucketEfficiency`: for each windowed drive with an average speed + a
    /// derivable efficiency, match its *display* speed into a distribution bucket
    /// (labels are in display units) and accumulate the mean consumption (`Wh/km`)
    /// and mean speed (`m/s`) per bucket.
    static func bucketEfficiency(
        drives: [SpeedProfileDrive],
        buckets: [SpeedProfileBucket],
        _ prefs: UnitPreferences
    ) -> [String: SpeedBucketEfficiency] {
        guard !buckets.isEmpty else { return [:] }
        var totals: [String: BucketAccumulator] = [:]
        for drive in drives {
            guard let mps = drive.avgSpeedMps, let efficiency = drive.efficiencyWhPerKm else { continue }
            let displaySpeed = speedDisplay(mps, prefs)
            for bucket in buckets {
                guard let bounds = bucket.bounds else { continue }
                if displaySpeed >= bounds.lo, displaySpeed < bounds.hi {
                    var entry = totals[bucket.label] ?? BucketAccumulator()
                    entry.totalEfficiency += efficiency
                    entry.totalSpeedMps += mps
                    entry.samples += 1
                    totals[bucket.label] = entry
                    break
                }
            }
        }
        return totals.reduce(into: [:]) { result, element in
            let (label, entry) = element
            guard entry.samples > 0 else { return }
            result[label] = SpeedBucketEfficiency(
                avgEfficiencyWhPerKm: entry.totalEfficiency / Double(entry.samples),
                avgSpeedMps: entry.totalSpeedMps / Double(entry.samples)
            )
        }
    }

    /// Mutable per-bucket running totals used while folding drives into buckets.
    private struct BucketAccumulator {
        var totalEfficiency: Double = 0
        var totalSpeedMps: Double = 0
        var samples: Int = 0
    }

    // MARK: - Insight sentence (web `speedProfile.insightText` with `{{speed}} {{unit}}`)

    /// Web efficiency-insight sentence with the optimal speed + unit interpolated
    /// (the catalog stores the i18next `{{speed}} {{unit}}` tokens as `%1$@ %2$@`).
    static func insightText(optimalSpeedMps: Double, _ prefs: UnitPreferences) -> String {
        let template = String(
            localized: "translation.speedProfile.insightText",
            defaultValue: """
            Drives around %1$@ %2$@ show the best energy efficiency. Reducing highway \
            speed could improve efficiency by ~15%%.
            """
        )
        let speed = number(speedDisplay(optimalSpeedMps, prefs), decimals: defaultDecimals(prefs), prefs)
        return String(format: template, speed, speedUnit(prefs))
    }
}
