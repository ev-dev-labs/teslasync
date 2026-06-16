import Foundation

/// Pure display-boundary formatters for the Quick Stats surface (web `fmtInt` + `formatCurrency`
/// from `useFormatting`, and the `convertDistanceFromSI` render). Counts and currency format
/// directly; the absolute distance (metres) converts through the shared SI `Units` facade at the
/// render boundary (ADR-005) — nothing non-SI is stored or computed. The energy card is pinned to
/// kWh exactly as the web hardcodes its "kWh Used" label (no user energy-unit conversion). Every
/// helper returns an em dash for non-finite input (never "nan"), matching the web `'—'` sentinel.
public enum QuickStatsPageFormat {
    /// The em dash shown for a missing value (web `'—'`).
    public static let emptyValue = "—"

    /// The number of days the kiosk summarises (web `useAnalyticsSummary(30)`).
    public static let summaryDays = 30

    /// Web `fmtNumber(value, decimals)`: en-US grouping, fixed fraction digits.
    public static func number(_ value: Double, decimals: Int) -> String {
        guard value.isFinite else { return emptyValue }
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.\(decimals)f", value)
    }

    /// Web `fmtInt(value)` → `fmtNumber(value, 0)` (grouped, no fraction digits).
    public static func integer(_ value: Double) -> String {
        number(value, decimals: 0)
    }

    /// Web distance card value: `fmtInt(convertDistanceFromSI(totalDistanceKm * 1000, distanceUnit))`.
    /// SI metres → the user's distance unit (via the shared facade) as a grouped integer. The unit
    /// suffix is NOT included here — it lives in the card's `{{unit}} Driven` label.
    public static func distanceDriven(_ meters: Double, _ prefs: UnitPreferences) -> String {
        let display = Units.convertDistance(meters, prefs)
        return integer(display)
    }

    /// Web drives card value: `analytics?.totalDrives ?? 0` rendered as a bare count (no grouping,
    /// matching the web's direct numeric render).
    public static func drives(_ count: Int) -> String {
        String(count)
    }

    /// Web energy card value: `fmtInt(totalEnergyKwh)`. SI watt-hours → kilowatt-hours as a grouped
    /// integer; the "kWh" unit is fixed in the card's `quickStats.energy` label.
    public static func energyKWh(_ wattHours: Double) -> String {
        integer(wattHours / 1000)
    }

    /// Web cost card value: `formatCurrency(totalCost, 0)` — locale currency, no fraction digits
    /// (default USD, matching the sibling `AnalyticsFormat.currency`).
    public static func currency(_ amount: Double, decimals: Int = 0, code: String = "USD") -> String {
        guard amount.isFinite else { return emptyValue }
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = code
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        return formatter.string(from: NSNumber(value: amount)) ?? emptyValue
    }
}
