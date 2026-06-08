//
//  SpeedProfileWidget.Builder.swift
//  TeslaSync — P4 dashboard widget · 0095 · SpeedProfileWidget (Apple)
//
//  The pure cached → projection adapter: a faithful Swift port of the web
//  SpeedProfileWidget.tsx computation (buildChartData, formatBucketLabel,
//  findSweetSpot, the peak-frequency / peak-bucket derivations) plus
//  `convertSpeedFromSI`. No SwiftUI / transport — this is the unit-tested core
//  both platforms agree on.
//

import Foundation

// MARK: - SpeedProfileBuilder (port of the web widget's derive block)

/// Pure functions that turn the cached `/analytics/speed-profile` snapshot into
/// the display-unit `SpeedProfileProjection`. A 1:1 port of the web source so
/// both platforms show identical numbers.
public enum SpeedProfileBuilder {
    /// Seconds in one hour — the `SECONDS_PER_HOUR` factor in `convertSpeedFromSI`.
    static let secondsPerHour: Double = 3600
    /// Meters in one kilometre (`METERS_PER_KM`).
    static let metersPerKilometer: Double = 1000
    /// Meters in one mile (`METERS_PER_MILE`).
    static let metersPerMile: Double = 1609.344

    /// Converts SI meters-per-second to the user's speed unit (web
    /// `convertSpeedFromSI`): km/h = `mps * 3600 / 1000`, mph = `mps * 3600 / 1609.344`.
    public static func convertSpeedFromSI(_ mps: Double, to unit: SpeedDisplayUnit) -> Double {
        let value = mps.isFinite ? mps : 0
        switch unit {
        case .kilometersPerHour:
            return (value * secondsPerHour) / metersPerKilometer
        case .milesPerHour:
            return (value * secondsPerHour) / metersPerMile
        }
    }

    /// Converts a backend bucket label to the user's speed unit, mirroring the web
    /// `formatBucketLabel`: `"lo-hi"` → `"conv(lo)-conv(hi)"`, an `"N+"` open
    /// bucket → `"conv(N)+"`, and anything unparseable is returned verbatim.
    public static func formatBucketLabel(_ bucket: String, unit: SpeedDisplayUnit) -> String {
        let parts = bucket.split(separator: "-", omittingEmptySubsequences: false).map(String.init)
        if parts.count == 2, let low = parseLeadingDouble(parts[0]), let high = parseLeadingDouble(parts[1]) {
            let lowLabel = SpeedProfileNumberFormat.integer(convertSpeedFromSI(low, to: unit))
            let highLabel = SpeedProfileNumberFormat.integer(convertSpeedFromSI(high, to: unit))
            return "\(lowLabel)-\(highLabel)"
        }
        if let value = parseLeadingDouble(bucket) {
            return "\(SpeedProfileNumberFormat.integer(convertSpeedFromSI(value, to: unit)))+"
        }
        return bucket
    }

    /// Builds the per-bucket chart data (web `buildChartData`): the frequency is
    /// each bucket's share of total readings (percent); the efficiency is the
    /// bucket's average power. Returns `[]` for an absent / empty distribution.
    public static func buildBars(_ input: SpeedProfileInput?, unit: SpeedDisplayUnit) -> [SpeedProfileBar] {
        let distribution = input?.distribution ?? []
        let totalReadings = distribution.reduce(0.0) { running, bucket in
            running + (bucket.readings.isFinite ? bucket.readings : 0)
        }
        return distribution.map { bucket in
            let label = formatBucketLabel(bucket.speedBucket, unit: unit)
            let frequency = totalReadings > 0 ? (bucket.readings / totalReadings) * 100 : 0
            let efficiency = bucket.avgPowerKw.isFinite ? bucket.avgPowerKw : 0
            return SpeedProfileBar(bucket: label, frequency: frequency, efficiency: efficiency)
        }
    }

    /// Finds the bucket label with the best (lowest positive) efficiency — the
    /// fallback Sweet Spot when no optimal-speed estimate is available (web
    /// `findSweetSpot`). Returns `'—'` when no bucket has a positive value.
    public static func findSweetSpot(_ bars: [SpeedProfileBar]) -> String {
        let withEfficiency = bars.filter { $0.efficiency > 0 }
        guard var best = withEfficiency.first else { return SpeedProfileNumberFormat.emptyDash }
        for bar in withEfficiency where bar.efficiency < best.efficiency {
            best = bar
        }
        return best.bucket
    }

    /// Resolves the Sweet Spot stat (web `sweetSpot` memo): the converted optimal
    /// speed when the estimate is positive, otherwise the lowest-power bucket.
    public static func sweetSpot(input: SpeedProfileInput, bars: [SpeedProfileBar], unit: SpeedDisplayUnit) -> String {
        let optimal = input.optimalSpeedMps
        if optimal > 0 {
            return SpeedProfileNumberFormat.integer(convertSpeedFromSI(optimal, to: unit))
        }
        return findSweetSpot(bars)
    }

    /// Builds the projection from the cached input, or `nil` when there is no
    /// cached snapshot (the web renders its empty state when `data` is absent).
    /// `hasData` mirrors the web `hasData` guard the chart summary switches on.
    public static func project(_ input: SpeedProfileInput?, unit: SpeedDisplayUnit) -> SpeedProfileProjection? {
        guard let input else { return nil }

        let bars = buildBars(input, unit: unit)
        let peakFrequency = bars.map(\.frequency).max() ?? 0
        let peakBucket = bars.first(where: { $0.frequency == peakFrequency })?.bucket
            ?? SpeedProfileNumberFormat.emptyDash
        let sweet = sweetSpot(input: input, bars: bars, unit: unit)
        let hasData = !bars.isEmpty && bars.contains(where: { $0.frequency > 0 })

        return SpeedProfileProjection(
            unit: unit,
            bars: bars,
            peakBucket: peakBucket,
            peakFrequency: peakFrequency,
            sweetSpot: sweet,
            hasData: hasData
        )
    }

    // MARK: - Helpers

    /// Parses the leading numeric prefix of a string the way JS `parseFloat`
    /// does (skips leading whitespace, reads an optional sign + digits + a single
    /// decimal point, ignores any trailing characters such as the `+` in `"80+"`).
    /// Returns `nil` when no number leads the string (JS `NaN`).
    static func parseLeadingDouble(_ raw: String) -> Double? {
        var sawDigit = false
        var sawDot = false
        var result = ""
        var index = raw.startIndex

        while index < raw.endIndex, raw[index] == " " || raw[index] == "\t" {
            index = raw.index(after: index)
        }
        if index < raw.endIndex, raw[index] == "+" || raw[index] == "-" {
            result.append(raw[index])
            index = raw.index(after: index)
        }
        while index < raw.endIndex {
            let character = raw[index]
            if character.isNumber {
                sawDigit = true
                result.append(character)
            } else if character == ".", !sawDot {
                sawDot = true
                result.append(character)
            } else {
                break
            }
            index = raw.index(after: index)
        }
        guard sawDigit else { return nil }
        return Double(result)
    }
}
