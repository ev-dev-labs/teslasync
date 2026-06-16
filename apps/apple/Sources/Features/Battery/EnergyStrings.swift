import Foundation

/// Resolves the Energy surface's interpolated i18n strings (web i18next `{{unit}}` / `{{days}}`
/// tokens) from the string catalog at the display boundary, keeping the web key names. Each
/// helper resolves the catalog value then substitutes the runtime token, mirroring the web
/// `t(key, { unit, days })` calls.
public enum EnergyStrings {
    /// Web `t('energy.metric.costPerDist', { unit })` → "Cost per {{unit}}".
    public static func costPerDistance(_ unit: String) -> String {
        String(localized: "energy.metric.costPerDist", defaultValue: "Cost per {{unit}}")
            .replacingOccurrences(of: "{{unit}}", with: unit)
    }

    /// Web `t('energy.lifetime.periodEnergy', { days })` → "Last {{days}} Days".
    public static func periodEnergyLabel(days: Int) -> String {
        String(localized: "energy.lifetime.periodEnergy", defaultValue: "Last {{days}} Days")
            .replacingOccurrences(of: "{{days}}", with: "\(days)")
    }

    /// Web `t('energy.cost_decimal.periodTotal', { days })` → "{{days}}-Day Total".
    public static func periodTotalLabel(days: Int) -> String {
        String(localized: "energy.cost_decimal.periodTotal", defaultValue: "{{days}}-Day Total")
            .replacingOccurrences(of: "{{days}}", with: "\(days)")
    }

    /// Web `t('energy.chart.distance', { unit })` → "Distance ({{unit}})".
    public static func distanceSeriesName(_ unit: String) -> String {
        String(localized: "energy.chart.distance", defaultValue: "Distance ({{unit}})")
            .replacingOccurrences(of: "{{unit}}", with: unit)
    }
}
