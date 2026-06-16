import Foundation

/// Pure display-boundary formatters + derivations for the Period Comparison surface (web
/// `fmtNumber` / `pctChange` / the `metrics` + `insights` `useMemo`s). SI values come from the
/// model; conversion to the user's unit preference happens here via the shared KMP `Units` facade
/// (P1/S5) — never in the model. Each formatter returns an em dash for nil/non-finite input
/// (never "nan").
public enum PeriodCompareFormat {
    /// The em dash shown for a missing value (web `'—'`).
    public static let emptyValue = "—"

    /// Miles per kilometre — the scale the web applies to Wh/km efficiency for imperial users.
    private static let kmPerMile = 1.609344

    /// Watt-hours per kilowatt-hour — the energy figure is displayed in kWh (web fixed `'kWh'`).
    private static let whPerKwh = 1000.0

    // MARK: - Percent change (web `pctChange`)

    /// Result of `pctChange` (web `{ value, positive }`).
    public struct Percent: Equatable, Sendable {
        public let value: String
        public let positive: Bool

        public init(value: String, positive: Bool) {
            self.value = value
            self.positive = positive
        }
    }

    /// Web `pctChange(a, b)`: signed percentage of A relative to B, em dash when B is zero.
    public static func pctChange(_ valueA: Double, _ valueB: Double) -> Percent {
        guard valueB != 0 else { return Percent(value: emptyValue, positive: true) }
        let pct = ((valueA - valueB) / valueB) * 100
        let sign = pct > 0 ? "+" : ""
        return Percent(value: "\(sign)\(number(pct, decimals: 1))%", positive: pct >= 0)
    }

    // MARK: - Number / currency

    /// Web `fmtNumber(value, decimals)`: en-US grouping, fixed fraction digits.
    public static func number(_ value: Double, decimals: Int = 0) -> String {
        guard value.isFinite else { return emptyValue }
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.\(decimals)f", value)
    }

    // MARK: - Efficiency (web `efficiencyUnit` / `whPerKm` scaling)

    /// Web `efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km'`.
    public static func efficiencyUnit(_ prefs: UnitPreferences) -> String {
        prefs.distance == "mi" ? "Wh/mi" : "Wh/km"
    }

    /// Web `effA = distanceUnit === 'mi' ? avg_efficiency * KM_PER_MILE : avg_efficiency`.
    public static func efficiencyValue(_ whPerKm: Double, _ prefs: UnitPreferences) -> Double {
        prefs.distance == "mi" ? whPerKm * kmPerMile : whPerKm
    }

    // MARK: - Metric values (web `metrics` after the `useUnits` conversion)

    /// Builds the six display-converted metric values in web order (web `metrics`). Distance
    /// converts from SI meters to the user's distance unit; efficiency scales for imperial; energy
    /// renders in kWh (web fixed label); drives/cost/CO₂ pass through.
    public static func metricValues(
        _ statsA: PeriodStats,
        _ statsB: PeriodStats,
        _ prefs: UnitPreferences
    ) -> [PeriodCompareMetricValue] {
        [
            PeriodCompareMetricValue(
                metric: .distance,
                valueA: Units.convertDistance(statsA.totalDistanceM, prefs),
                valueB: Units.convertDistance(statsB.totalDistanceM, prefs),
                unitLabel: prefs.distance
            ),
            PeriodCompareMetricValue(
                metric: .drives,
                valueA: Double(statsA.totalDrives),
                valueB: Double(statsB.totalDrives),
                unitLabel: ""
            ),
            PeriodCompareMetricValue(
                metric: .energy,
                valueA: statsA.energyUsedWh / whPerKwh,
                valueB: statsB.energyUsedWh / whPerKwh,
                unitLabel: "kWh"
            ),
            PeriodCompareMetricValue(
                metric: .efficiency,
                valueA: efficiencyValue(statsA.avgEfficiencyWhKm, prefs),
                valueB: efficiencyValue(statsB.avgEfficiencyWhKm, prefs),
                unitLabel: efficiencyUnit(prefs)
            ),
            PeriodCompareMetricValue(
                metric: .cost,
                valueA: statsA.totalCost,
                valueB: statsB.totalCost,
                unitLabel: "$"
            ),
            PeriodCompareMetricValue(
                metric: .co2,
                valueA: statsA.co2SavedKg,
                valueB: statsB.co2SavedKg,
                unitLabel: "kg"
            )
        ]
    }

    /// Web metric-card / chip value `${fmtNumber(value)} ${unit}` (unit omitted when empty).
    public static func valueWithUnit(_ value: Double, unit: String) -> String {
        unit.isEmpty ? number(value) : "\(number(value)) \(unit)"
    }

    // MARK: - Insights (web `insights` useMemo)

    /// The three insight lines (web `insights`). Percentages use the raw SI stats — the conversion
    /// factor cancels in a ratio, so the figures match the web verbatim. The `{{pct}}`/`{{dir}}`
    /// tokens are substituted exactly as i18next does, keeping the catalog defaults verbatim.
    public static func insights(_ statsA: PeriodStats, _ statsB: PeriodStats) -> [String] {
        let distance = pctChange(statsA.totalDistanceM, statsB.totalDistanceM)
        let efficiency = pctChange(statsA.avgEfficiencyWhKm, statsB.avgEfficiencyWhKm)
        let cost = pctChange(statsA.totalCost, statsB.totalCost)
        return [
            interpolate(
                String(
                    localized: "compare.insightDistance",
                    defaultValue: "Distance traveled was {{pct}} {{dir}} in Period A vs Period B."
                ),
                pct: distance.value,
                dir: distance.positive
                    ? String(localized: "compare.more", defaultValue: "more")
                    : String(localized: "compare.less", defaultValue: "less")
            ),
            interpolate(
                String(
                    localized: "compare.insightEfficiency",
                    defaultValue: "Efficiency {{dir}} by {{pct}} compared to Period B."
                ),
                pct: efficiency.value,
                dir: efficiency.positive
                    ? String(localized: "compare.improved", defaultValue: "improved")
                    : String(localized: "compare.declined", defaultValue: "declined")
            ),
            interpolate(
                String(
                    localized: "compare.insightCost",
                    defaultValue: "Costs were {{pct}} {{dir}} in Period A."
                ),
                pct: cost.value,
                dir: cost.positive
                    ? String(localized: "compare.higher", defaultValue: "higher")
                    : String(localized: "compare.lower", defaultValue: "lower")
            )
        ]
    }

    /// i18next-style `{{pct}}` / `{{dir}}` token substitution.
    private static func interpolate(_ template: String, pct: String, dir: String) -> String {
        template
            .replacingOccurrences(of: "{{pct}}", with: pct)
            .replacingOccurrences(of: "{{dir}}", with: dir)
    }
}
