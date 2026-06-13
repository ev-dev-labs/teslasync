import Foundation

// The pure derivations the web page computes inline with `useMemo` — the voltage
// histogram (`buildHistogram`) and the health insights (`insights`) — split out of
// `BatteryCellsModels.swift` so each stays a small, independently testable function.

extension BatteryCellData {
    /// Web `buildHistogram(cells)`: 6…12 evenly spaced voltage buckets with their
    /// cell counts, labelled "low–high" at three decimals.
    public static func buildHistogram(_ cells: [BatteryCellReading]) -> [BatteryVoltageBucket] {
        guard !cells.isEmpty else { return [] }
        let voltages = cells.map(\.voltage)
        let minimum = voltages.min() ?? 0
        let maximum = voltages.max() ?? 0
        let range = maximum - minimum
        let bucketCount = max(6, min(12, Int(ceil(Double(cells.count) / 4))))
        let step = range > 0 ? range / Double(bucketCount) : 0.001

        var counts = [Int](repeating: 0, count: bucketCount)
        for voltage in voltages {
            let raw = step > 0 ? Int(((voltage - minimum) / step).rounded(.down)) : 0
            let index = max(0, min(raw, bucketCount - 1))
            counts[index] += 1
        }

        return (0 ..< bucketCount).map { index in
            let low = minimum + Double(index) * step
            let high = minimum + Double(index + 1) * step
            let label = "\(BatteryCellsFormat.number(low, decimals: 3))–\(BatteryCellsFormat.number(high, decimals: 3))"
            return BatteryVoltageBucket(index: index, label: label, count: counts[index])
        }
    }

    /// Web `insights` useMemo: the spread band, the temperature band, and the
    /// critical-cell tally, each yielding one recommendation.
    public static func buildInsights(
        imbalanceMv: Double,
        tempSpreadC: Double,
        criticalCells: Int
    ) -> [BatteryCellInsight] {
        [
            spreadInsight(imbalanceMv),
            temperatureInsight(tempSpreadC),
            criticalInsight(criticalCells)
        ]
    }

    /// Web spread insight: > 15 mV high (critical), > 5 mV watch (warning), else balanced.
    private static func spreadInsight(_ imbalanceMv: Double) -> BatteryCellInsight {
        if imbalanceMv > 15 {
            return BatteryCellInsight(
                id: "spread",
                systemImage: "bolt.fill",
                titleKey: "battery.cells.insight.highSpread",
                descriptionKey: "battery.cells.insight.highSpreadDesc",
                level: .critical
            )
        }
        if imbalanceMv > 5 {
            return BatteryCellInsight(
                id: "spread",
                systemImage: "bolt.fill",
                titleKey: "battery.cells.insight.watchSpread",
                descriptionKey: "battery.cells.insight.watchSpreadDesc",
                level: .warning
            )
        }
        return BatteryCellInsight(
            id: "spread",
            systemImage: "checkmark.circle.fill",
            titleKey: "battery.cells.insight.balanced",
            descriptionKey: "battery.cells.insight.balancedDesc",
            level: .good
        )
    }

    /// Web temperature insight: > 5 °C high (critical), > 3 °C watch (warning), else good.
    private static func temperatureInsight(_ tempSpreadC: Double) -> BatteryCellInsight {
        if tempSpreadC > 5 {
            return BatteryCellInsight(
                id: "temp",
                systemImage: "thermometer.high",
                titleKey: "battery.cells.insight.highTemp",
                descriptionKey: "battery.cells.insight.highTempDesc",
                level: .critical
            )
        }
        if tempSpreadC > 3 {
            return BatteryCellInsight(
                id: "temp",
                systemImage: "thermometer.medium",
                titleKey: "battery.cells.insight.watchTemp",
                descriptionKey: "battery.cells.insight.watchTempDesc",
                level: .warning
            )
        }
        return BatteryCellInsight(
            id: "temp",
            systemImage: "thermometer.medium",
            titleKey: "battery.cells.insight.goodTemp",
            descriptionKey: "battery.cells.insight.goodTempDesc",
            level: .good
        )
    }

    /// Web critical insight: any critical cells → alert (with count), else all-healthy.
    private static func criticalInsight(_ criticalCells: Int) -> BatteryCellInsight {
        if criticalCells > 0 {
            return BatteryCellInsight(
                id: "critical",
                systemImage: "exclamationmark.triangle.fill",
                titleKey: "battery.cells.insight.criticalCells",
                descriptionKey: "battery.cells.insight.criticalCellsDesc",
                descriptionCount: criticalCells,
                level: .critical
            )
        }
        return BatteryCellInsight(
            id: "critical",
            systemImage: "shield.lefthalf.filled",
            titleKey: "battery.cells.insight.healthy",
            descriptionKey: "battery.cells.insight.healthyDesc",
            level: .good
        )
    }
}
