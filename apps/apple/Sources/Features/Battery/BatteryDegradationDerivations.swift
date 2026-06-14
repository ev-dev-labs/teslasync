import Foundation

// Derived chart-row value types + the cross-source projection derivation for the
// Battery Degradation surface (web `rangeData` / `projectionChartData` `useMemo`s).
// Split from `BatteryDegradationModels.swift` to keep each file focused; all values
// stay SI (kilometres / raw percent) and convert only at the render boundary.

// MARK: - Range-loss row (web `rangeData` row)

/// One range-loss sample (web `rangeData` row): original vs current range in km.
public struct BatteryRangeRow: Identifiable, Hashable, Sendable {
    public let index: Int
    public let label: String
    public let originalKm: Double
    public let currentKm: Double

    public var id: Int {
        index
    }

    public init(index: Int, label: String, originalKm: Double, currentKm: Double) {
        self.index = index
        self.label = label
        self.originalKm = originalKm
        self.currentKm = currentKm
    }
}

// MARK: - Projection row (web `projectionChartData` row)

/// One row of the health-trend projection (web `projectionChartData`): the actual
/// `health`, the `projected` value, and the confidence bounds. Each is nil where it
/// does not apply (history rows carry only `health`; projection rows carry the rest,
/// with the first projection row bridged to the last actual point).
public struct BatteryProjectionRow: Identifiable, Hashable, Sendable {
    public let index: Int
    public let label: String
    public let health: Double?
    public let projected: Double?
    public let confidenceLow: Double?
    public let confidenceHigh: Double?

    public var id: Int {
        index
    }

    public init(
        index: Int,
        label: String,
        health: Double?,
        projected: Double?,
        confidenceLow: Double?,
        confidenceHigh: Double?
    ) {
        self.index = index
        self.label = label
        self.health = health
        self.projected = projected
        self.confidenceLow = confidenceLow
        self.confidenceHigh = confidenceHigh
    }
}

// MARK: - Cross-source derivations

/// Pure derivations that combine the primary health source with the optional
/// degradation source (web `projectionChartData` useMemo). Kept SwiftUI-free.
public enum BatteryDegradationDerivations {
    /// Web `projectionChartData` — actual history followed by the predicted future,
    /// bridging the first projection row to the last actual SOH so the lines connect.
    public static func projectionRows(
        health: BatteryHealthData?,
        detail: BatteryDegradationDetail?
    ) -> [BatteryProjectionRow] {
        var rows: [BatteryProjectionRow] = []
        let history = health?.history ?? []
        for snapshot in history {
            rows.append(BatteryProjectionRow(
                index: rows.count,
                label: BatteryDegradationFormat.dateLabel(snapshot.date),
                health: snapshot.sohPct,
                projected: nil,
                confidenceLow: nil,
                confidenceHigh: nil
            ))
        }
        let projections = detail?.projections ?? []
        let bridge = history.last?.sohPct
        for (offset, point) in projections.enumerated() {
            rows.append(BatteryProjectionRow(
                index: rows.count,
                label: point.date,
                health: offset == 0 ? bridge : nil,
                projected: point.healthPct,
                confidenceLow: point.confidenceLow,
                confidenceHigh: point.confidenceHigh
            ))
        }
        return rows
    }
}
