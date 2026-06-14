import Foundation

/// Pure display-boundary formatters for the True Cost surface (web `formatCurrency` /
/// `formatEnergy` / `fmtNumber` / `fmtInt` / `useUnits` helpers). SI values come from the model;
/// conversion to the user's unit preference happens here via the shared KMP `Units` facade (P1/S5)
/// — never in the model. Each returns an em dash for nil/non-finite input (never "nan").
///
/// Currency mirrors the web `useFormatting().formatCurrency` exactly: `currencySymbol +
/// fmtNumber(amount, decimals)` (a symbol prefix + en-US grouped number), NOT locale-currency
/// formatting — so `$1,234.56`, matching the web page verbatim.
public enum TrueCostFormat {
    /// The em dash shown for a missing value (web `'—'`).
    public static let emptyValue = "—"

    /// The fraction digits a bare `formatCurrency(v)` / `fmtNumber(v)` uses — the user's global
    /// precision preference (web `userPrecision`, default 2).
    public static func defaultDecimals(_ prefs: UnitPreferences) -> Int {
        prefs.precision ?? 2
    }

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

    /// Web `formatCurrency(amount, decimals)` → `${currencySymbol}${fmtNumber(amount, decimals)}`.
    public static func currency(_ amount: Double, decimals: Int, symbol: String = "$") -> String {
        guard amount.isFinite else { return emptyValue }
        return "\(symbol)\(number(amount, decimals: decimals))"
    }

    /// Web per-km `<Currency value precision={3} />` — currency at 3 decimals, em dash on non-finite.
    public static func costPerKm(_ amount: Double, symbol: String = "$") -> String {
        currency(amount, decimals: 3, symbol: symbol)
    }

    // MARK: - Energy (web `formatEnergy(total_wh)` — unit-preference aware via Units)

    /// SI watt-hours → the user's energy unit (web `useUnits().formatEnergy`). Uses the shared KMP
    /// `Units` facade so every platform shows identical numbers; em dash on non-finite.
    public static func energy(_ wattHours: Double, _ prefs: UnitPreferences) -> String {
        guard wattHours.isFinite else { return emptyValue }
        return Units.formatEnergy(wattHours, prefs)
    }

    // MARK: - Distance (web `fmtInt(convertDistanceFromSI(total_km × 1000, distanceUnit))`)

    /// SI meters → the user's distance unit, integer digits, with the unit label (web
    /// `${fmtInt(convertDistanceFromSI(m, distanceUnit))} ${distanceUnit}`).
    public static func distanceInt(_ meters: Double, _ prefs: UnitPreferences) -> String {
        "\(number(Units.convertDistance(meters, prefs), decimals: 0)) \(prefs.distance)"
    }

    // MARK: - Localized composition (web `t(key, default, { …interpolation })`)

    /// The gasoline-volume label (web `gasUnit === 'liter' ? t('common.unit.liter') :
    /// t('common.unit.gallon')`). Static keys so the string extractor sees both.
    public static func gasUnitLabel(_ gasUnit: TrueCostGasUnit) -> String {
        switch gasUnit {
        case .liter: String(localized: "common.unit.liter", defaultValue: "L")
        case .gallon: String(localized: "common.unit.gallon", defaultValue: "gal")
        }
    }

    /// Web card-1 sub-line `${formatEnergy(total_wh)} · ${total_sessions} ${t('tco.sessions')}`.
    public static func energyAndSessions(_ wattHours: Double, sessions: Int, _ prefs: UnitPreferences) -> String {
        let sessionsLabel = String(localized: "tco.sessions", defaultValue: "sessions")
        return "\(energy(wattHours, prefs)) · \(sessions) \(sessionsLabel)"
    }

    /// Web card-2 sub-line `@ ${formatCurrency(gas_price)}/${gasUnitLabel} · ${gas_efficiency_mpg} MPG`.
    /// "MPG" is a unit suffix carried in the data string (the web hardcodes it, no i18n key), the
    /// same way the sibling Statistics page carries "kWh"/"kg" suffixes in its value strings.
    public static func gasMeta(
        gasPrice: Double,
        gasUnit: TrueCostGasUnit,
        mpg: Double,
        _ prefs: UnitPreferences,
        symbol: String = "$"
    ) -> String {
        let price = currency(gasPrice, decimals: defaultDecimals(prefs), symbol: symbol)
        return "@ \(price)/\(gasUnitLabel(gasUnit)) · \(number(mpg, decimals: 0)) MPG"
    }

    /// Web card-3 sub-line `${t('tco.overMonths', 'Over {{months}} months', { months })}`.
    public static func overMonths(_ months: Double, _ prefs: UnitPreferences) -> String {
        let monthsValue = number(months, decimals: defaultDecimals(prefs))
        let format = String(localized: "tco.overMonths", defaultValue: "Over %@ months")
        return String(format: format, monthsValue)
    }

    /// Web savings-breakdown footnote
    /// `${fmtInt(convertDistanceFromSI(total_km × 1000))} ${distanceUnit} · ${first_date} → ${last_date}`.
    public static func ownershipFootnote(
        distanceM: Double,
        firstDate: String,
        lastDate: String,
        _ prefs: UnitPreferences
    ) -> String {
        "\(distanceInt(distanceM, prefs)) · \(firstDate) → \(lastDate)"
    }
}
