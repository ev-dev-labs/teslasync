import Foundation

/// Pure derivations for the Efficiency surface — the Swift port of the web `useMemo` blocks
/// (`dailyTrend`, `speedVsEff`, `tempVsEff`, `speedDist`, `tempBuckets`). Every function is a pure
/// transform of SI drives; unit conversion is injected as closures (the view builds them from the
/// shared `Units` facade, tests pass plain Swift converters) so the bucketing/aggregation logic is
/// verifiable without the KMP runtime. SI in, display rows out.
public enum EfficiencyEngine {
    /// One temperature band's °C boundaries (web `tempBuckets` ranges). `lowerC`/`upperC` are the
    /// open-ended label edges (nil = unbounded); `minC`/`maxC` are the half-open membership interval.
    private struct TempBound {
        let lowerC: Double?
        let upperC: Double?
        let minC: Double
        let maxC: Double
    }

    /// JavaScript `Math.round` (round half toward +∞), so the ported rows match the web byte-for-byte
    /// even for negative display temperatures (Swift's `.rounded()` rounds half away from zero).
    static func jsRound(_ value: Double) -> Double {
        (value + 0.5).rounded(.down)
    }

    // MARK: - Daily efficiency trend (web `dailyTrend`)

    /// Web `dailyTrend`: the scored drives (efficiency present), first 30, reversed to oldest→newest,
    /// each carrying the rounded display efficiency and the 1-dp display distance.
    public static func dailyTrend(
        _ drives: [EfficiencyDrive],
        efficiencyToDisplay: (Double) -> Double,
        distanceToDisplay: (Double) -> Double
    ) -> [EfficiencyTrendPoint] {
        let scored = drives.filter { $0.efficiencyWhPerKm != nil }
        let window = Array(scored.prefix(30)).reversed()
        return window.enumerated().map { index, drive in
            let efficiency = jsRound(efficiencyToDisplay(drive.efficiencyWhPerKm ?? 0))
            let distance = (distanceToDisplay(drive.distanceM) * 10).rounded() / 10
            return EfficiencyTrendPoint(
                index: index,
                date: drive.startTs,
                efficiencyDisplay: efficiency,
                distanceDisplay: distance
            )
        }
    }

    // MARK: - Speed vs efficiency (web `speedVsEff`)

    /// Web `speedVsEff`: one point per drive with a non-zero average speed and an efficiency, plotting
    /// rounded display speed against rounded display efficiency.
    public static func speedVsEfficiency(
        _ drives: [EfficiencyDrive],
        speedToDisplay: (Double) -> Double,
        efficiencyToDisplay: (Double) -> Double
    ) -> [EfficiencyScatterPoint] {
        drives.compactMap { drive in
            guard let speed = drive.avgSpeedMps, speed != 0, let efficiency = drive.efficiencyWhPerKm else {
                return nil
            }
            return EfficiencyScatterPoint(
                id: drive.id,
                xDisplay: jsRound(speedToDisplay(speed)),
                efficiencyDisplay: jsRound(efficiencyToDisplay(efficiency))
            )
        }
    }

    // MARK: - Temperature vs efficiency (web `tempVsEff`)

    /// Web `tempVsEff`: one point per drive with a recorded outside temperature and an efficiency,
    /// plotting rounded display temperature against rounded display efficiency.
    public static func temperatureVsEfficiency(
        _ drives: [EfficiencyDrive],
        temperatureToDisplay: (Double) -> Double,
        efficiencyToDisplay: (Double) -> Double
    ) -> [EfficiencyScatterPoint] {
        drives.compactMap { drive in
            guard let temp = drive.outsideTempAvgC, let efficiency = drive.efficiencyWhPerKm else {
                return nil
            }
            return EfficiencyScatterPoint(
                id: drive.id,
                xDisplay: jsRound(temperatureToDisplay(temp)),
                efficiencyDisplay: jsRound(efficiencyToDisplay(efficiency))
            )
        }
    }

    // MARK: - Efficiency by speed range (web `speedDist`)

    /// Web `speedDist`: drives bucketed by display average speed into five bands (0–30, 30–60, 60–90,
    /// 90–120, 120+), keeping only non-empty bands. Each band carries the drive count and the mean raw
    /// Wh/km (the view converts + tints it). The band edges are in the user's display speed unit, so
    /// the conversion is injected.
    public static func speedDistribution(
        _ drives: [EfficiencyDrive],
        speedToDisplay: (Double) -> Double
    ) -> [EfficiencySpeedBucket] {
        let edges = [0, 30, 60, 90, 120, 999]
        var counts = Array(repeating: 0, count: edges.count - 1)
        var totals = Array(repeating: 0.0, count: edges.count - 1)
        for drive in drives {
            guard let speed = drive.avgSpeedMps, let efficiency = drive.efficiencyWhPerKm else { continue }
            let display = speedToDisplay(speed)
            for bucket in 0 ..< counts.count {
                let lower = Double(edges[bucket])
                let upper = Double(edges[bucket + 1])
                guard display >= lower, display < upper else { continue }
                counts[bucket] += 1
                totals[bucket] += efficiency
                break
            }
        }
        return (0 ..< counts.count).compactMap { bucket in
            guard counts[bucket] > 0 else { return nil }
            let isOpenEnded = bucket == counts.count - 1
            return EfficiencySpeedBucket(
                id: bucket,
                lowerDisplay: edges[bucket],
                upperDisplay: edges[bucket + 1],
                isOpenEnded: isOpenEnded,
                count: counts[bucket],
                avgWhPerKm: totals[bucket] / Double(counts[bucket])
            )
        }
    }

    // MARK: - Efficiency by temperature range (web `tempBuckets`)

    /// Web `tempBuckets`: drives bucketed by raw outside temperature into five °C bands (<0, 0–10,
    /// 10–20, 20–30, >30 — the same boundaries the web uses whether the label is °C or °F), keeping
    /// only non-empty bands. Each band carries the count, the mean raw Wh/km, the total SI distance,
    /// and the mean SI speed; the view converts + labels at the render boundary. Fully unit-independent.
    public static func temperatureBuckets(_ drives: [EfficiencyDrive]) -> [EfficiencyTempBucket] {
        let bounds: [TempBound] = [
            TempBound(lowerC: nil, upperC: 0, minC: -999, maxC: 0),
            TempBound(lowerC: 0, upperC: 10, minC: 0, maxC: 10),
            TempBound(lowerC: 10, upperC: 20, minC: 10, maxC: 20),
            TempBound(lowerC: 20, upperC: 30, minC: 20, maxC: 30),
            TempBound(lowerC: 30, upperC: nil, minC: 30, maxC: 999)
        ]
        var counts = Array(repeating: 0, count: bounds.count)
        var totalEff = Array(repeating: 0.0, count: bounds.count)
        var totalDistanceM = Array(repeating: 0.0, count: bounds.count)
        var totalSpeedMps = Array(repeating: 0.0, count: bounds.count)
        for drive in drives {
            guard let temp = drive.outsideTempAvgC, let efficiency = drive.efficiencyWhPerKm else { continue }
            for bucket in bounds.indices where temp >= bounds[bucket].minC && temp < bounds[bucket].maxC {
                counts[bucket] += 1
                totalEff[bucket] += efficiency
                totalDistanceM[bucket] += drive.distanceM
                totalSpeedMps[bucket] += drive.avgSpeedMps ?? 0
                break
            }
        }
        return bounds.indices.compactMap { bucket in
            guard counts[bucket] > 0 else { return nil }
            let count = Double(counts[bucket])
            return EfficiencyTempBucket(
                id: bucket,
                lowerC: bounds[bucket].lowerC,
                upperC: bounds[bucket].upperC,
                count: counts[bucket],
                avgWhPerKm: totalEff[bucket] / count,
                totalDistanceM: totalDistanceM[bucket],
                avgSpeedMps: totalSpeedMps[bucket] / count
            )
        }
    }
}
