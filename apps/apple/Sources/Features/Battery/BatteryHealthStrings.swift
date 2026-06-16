import Foundation

/// Resolves the Battery Health interpolated i18n strings (the web `t(key, { token })`
/// calls). The string catalog stores the web values verbatim with their `{{token}}`
/// markers; this resolver looks each key up at runtime and substitutes the
/// i18next-style tokens, mirroring the sibling `BatteryDegradationFormat.ageLabel`
/// approach. Keys are ported verbatim from the web catalog so the call sites read the
/// same names.
public enum BatteryHealthStrings {
    private static func localized(_ key: String) -> String {
        String(localized: String.LocalizationValue(key))
    }

    private static func substitute(_ key: String, _ token: String, _ value: String) -> String {
        localized(key).replacingOccurrences(of: token, with: value)
    }

    /// Web `battery.insight.excellentDesc` — `{{soh}}` is `fmtNumber(current_soh, 0)`.
    public static func insightExcellent(soh: String) -> String {
        substitute("battery.insight.excellentDesc", "{{soh}}", soh)
    }

    /// Web `battery.insight.goodDesc` — `{{soh}}` is `fmtNumber(current_soh, 0)`.
    public static func insightGood(soh: String) -> String {
        substitute("battery.insight.goodDesc", "{{soh}}", soh)
    }

    /// Web `battery.insight.concernDesc` — `{{soh}}` is `fmtNumber(current_soh, 0)`.
    public static func insightConcern(soh: String) -> String {
        substitute("battery.insight.concernDesc", "{{soh}}", soh)
    }

    /// Web `battery.insight.highFastChargeDesc` — `{{pct}}` is `fmtPercent(fast_charge_pct)`.
    public static func insightHighFastCharge(pct: String) -> String {
        substitute("battery.insight.highFastChargeDesc", "{{pct}}", pct)
    }

    /// Web `battery.insight.deepDischargeDesc` — `{{count}}` deep discharges.
    public static func insightDeepDischarge(count: Int) -> String {
        substitute("battery.insight.deepDischargeDesc", "{{count}}", "\(count)")
    }

    /// Web `battery.insight.highSuperchargerDesc` — `{{count}}` Supercharger sessions.
    public static func insightHighSupercharger(count: Int) -> String {
        substitute("battery.insight.highSuperchargerDesc", "{{count}}", "\(count)")
    }

    /// Web `battery.insight.lowDegDesc` — `{{rate}}` is `fmtNumber(degradation_rate_yr, 1)`.
    public static func insightLowDegradation(rate: String) -> String {
        substitute("battery.insight.lowDegDesc", "{{rate}}", rate)
    }

    /// Web `battery.thermal.moduleNumber` — `{{n}}` is the module index.
    public static func moduleNumber(_ index: Int) -> String {
        substitute("battery.thermal.moduleNumber", "{{n}}", "\(index)")
    }
}
