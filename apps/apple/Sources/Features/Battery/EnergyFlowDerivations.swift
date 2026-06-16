import Foundation

/// Pure ports of the web Energy-Flow page's `useMemo` computations (SwiftUI-free so they unit-test
/// without a host). The live-flow aggregation, the window averages, the efficiency rating
/// thresholds, and the daily-row sort mirror the web exactly; SI values stay SI here and convert
/// only at the SwiftUI render boundary (ADR-005).
public enum EnergyFlowDerivations {
    /// The default trailing window the page opens on (web `defaultPresetId: '7d'`).
    public static let defaultRangeDays = 7

    /// The day-count presets surfaced by the header period selector (web RangePicker
    /// `['7d','30d','90d']`, the trailing windows the backend `?days=N` honours).
    public static let rangePresets = [7, 30, 90]

    // MARK: - Live flow (web `chargePower` / `batterySOC`)

    /// Web `chargePower = (dc_charging_power ?? 0) + (ac_charging_power ?? 0)` — total charging
    /// power in kW (the `/energy/flow` endpoint serves kW verbatim).
    public static func chargePowerKw(_ flow: EnergyFlowSnapshot?) -> Double {
        (flow?.dcChargingPowerKw ?? 0) + (flow?.acChargingPowerKw ?? 0)
    }

    /// Web `batterySOC = flow?.soc ?? 0` — the live state of charge as a raw percent (0…100).
    public static func batterySocPercent(_ flow: EnergyFlowSnapshot?) -> Double {
        flow?.socPercent ?? 0
    }

    /// Whether any charging power is flowing (web `Math.abs(power) > 0.01`), used to dim the
    /// inactive flow arrows.
    public static func isFlowActive(_ powerKw: Double) -> Bool {
        abs(powerKw) > 0.01
    }

    // MARK: - Window averages (web `avgEfficiency` / `avgEnergyPerDay`)

    /// Web `avgEfficiency` — the average efficiency rounded to whole Wh per the user's display
    /// distance unit (`* 1000` for km, `* 1609.344` for mi).
    public static func avgEfficiencyDisplay(_ whPerM: Double, distanceUnit: String) -> Double {
        let scaled = distanceUnit == "mi" ? whPerM * 1609.344 : whPerM * 1000
        return scaled.rounded()
    }

    /// Web `avgEnergyPerDay = period > 0 ? total_energy_used_wh / period : 0` (SI watt-hours).
    public static func avgEnergyPerDayWh(_ stats: EnergyFlowStats?) -> Double {
        guard let stats, stats.periodDays > 0 else { return 0 }
        return stats.totalEnergyUsedWh / Double(stats.periodDays)
    }

    // MARK: - Efficiency rating (web threshold ladder)

    /// The qualitative efficiency rating the web badge shows.
    public enum EfficiencyRating: Equatable, Sendable {
        case noData, excellent, good, high
    }

    /// Web `excellentThreshold = distanceUnit === 'km' ? 150 : 240`.
    public static func excellentThreshold(distanceUnit: String) -> Double {
        distanceUnit == "mi" ? 240 : 150
    }

    /// Web `goodThreshold = distanceUnit === 'km' ? 200 : 320`.
    public static func goodThreshold(distanceUnit: String) -> Double {
        distanceUnit == "mi" ? 320 : 200
    }

    /// Web badge ladder: `0 → No Data`, `< excellent → Excellent`, `< good → Good`, else `High`.
    public static func efficiencyRating(avgDisplay: Double, distanceUnit: String) -> EfficiencyRating {
        guard avgDisplay != 0 else { return .noData }
        if avgDisplay < excellentThreshold(distanceUnit: distanceUnit) { return .excellent }
        if avgDisplay < goodThreshold(distanceUnit: distanceUnit) { return .good }
        return .high
    }

    // MARK: - Daily rows (web `sortedDailyRows`)

    /// Whether the breakdown has any efficiency point to plot (web `efficiencyChartData.length`):
    /// the daily-efficiency chart filters to days with a positive efficiency.
    public static func hasEfficiencyData(_ rows: [EnergyFlowDailyPoint]) -> Bool {
        rows.contains { $0.efficiencyWhPerM > 0 }
    }

    /// Web `sortedDailyRows` — the breakdown sorted by date (default descending, newest first).
    public static func sortedByDate(_ rows: [EnergyFlowDailyPoint], ascending: Bool = false) -> [EnergyFlowDailyPoint] {
        rows.sorted { ascending ? $0.date < $1.date : $0.date > $1.date }
    }
}
