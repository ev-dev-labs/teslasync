import Foundation

/// Pure display-boundary formatters for the Lifetime Stats surface (web `fmtNumber` / `fmtInt` /
/// `formatCurrency` / `Currency` / `useUnits` / `useDateFormat` helpers). SI values come from the
/// model; conversion to the user's unit preference happens here via the shared KMP `Units` facade
/// (P1/S5) — never in the model. Each numeric helper returns an em dash for nil/non-finite input
/// (never "nan"), matching the web `'—'` sentinel. The three interpolated strings (hero subtitle,
/// Earth comparison, "Tracking since …") resolve their template from `Localizable.xcstrings` and
/// fill it via `String(format:)`, mirroring the sibling pages' parameterized-string convention.
public enum LifetimeStatsFormat {
    /// The em dash shown for a missing value (web `'—'`).
    public static let emptyValue = "—"

    // MARK: - Primitive number / currency (web `fmtNumber` / `fmtInt` / `formatCurrency`)

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

    /// Web `fmtInt(value)` → `fmtNumber(value, 0)`.
    public static func integer(_ value: Double) -> String {
        number(value, decimals: 0)
    }

    /// Web `formatCurrency(amount, decimals)` / `<Currency>` — locale currency, fixed fraction
    /// digits (default USD, mirroring the sibling analytics pages).
    public static func currency(_ amount: Double, decimals: Int, code: String = "USD") -> String {
        guard amount.isFinite else { return emptyValue }
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = code
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        return formatter.string(from: NSNumber(value: amount)) ?? emptyValue
    }

    // MARK: - Distance (web `fromKm` = convertDistanceFromSI + distanceUnit)

    /// The user's distance unit label (web `unitPrefs.distance`).
    public static func distanceUnit(_ prefs: UnitPreferences) -> String {
        prefs.distance
    }

    /// SI meters → the user's distance unit, fixed digits, value only (web `fmtNumber(fromKm(m),
    /// decimals)` without the trailing unit — the hero / Total-Distance card append the label).
    public static func distanceValue(_ meters: Double, _ prefs: UnitPreferences, decimals: Int) -> String {
        number(Units.convertDistance(meters, prefs), decimals: decimals)
    }

    /// SI meters → `${fmtNumber(fromKm(m), decimals)} ${distanceUnit}` (web records' inline form).
    public static func distance(_ meters: Double, _ prefs: UnitPreferences, decimals: Int) -> String {
        "\(distanceValue(meters, prefs, decimals: decimals)) \(prefs.distance)"
    }

    // MARK: - Speed (web `fromKmh` = convertSpeedFromSI + speedUnit)

    /// SI meters-per-second → `${fmtNumber(fromKmh(mps), decimals)} ${speedUnit}` (web highest-speed
    /// record's inline form).
    public static func speed(_ mps: Double, _ prefs: UnitPreferences, decimals: Int) -> String {
        "\(number(Units.convertSpeed(mps, prefs), decimals: decimals)) \(prefs.speed)"
    }

    // MARK: - Energy (always kWh on this page; web hardcodes the `kWh` label)

    /// SI watt-hours → `fmtNumber(wh / 1000, decimals)`, value only (web shows kWh directly, no
    /// unit pref — the Total-Energy card appends the `kWh` label, the record appends it inline).
    public static func energyKWhValue(_ wattHours: Double, decimals: Int) -> String {
        number(wattHours / 1000, decimals: decimals)
    }

    /// SI watt-hours → `${fmtNumber(wh / 1000, decimals)} kWh` (web biggest-charge record inline).
    public static func energyKWh(_ wattHours: Double, decimals: Int) -> String {
        "\(energyKWhValue(wattHours, decimals: decimals)) kWh"
    }

    // MARK: - Duration / efficiency / CO₂ / percent (web inline labels)

    /// SI seconds → `fmtNumber(seconds / 3600, decimals)` whole hours, value only (web
    /// `fmtNumber(total_driving_hours, 1)`; the card appends the `hrs` label).
    public static func hoursValue(_ seconds: Double, decimals: Int = 1) -> String {
        number(seconds / 3600, decimals: decimals)
    }

    /// Web `avg_efficiency_wh_km > 0 ? ${fmtNumber(avg_efficiency_wh_km, 0)} Wh/km : '—'`. Always
    /// Wh/km (no unit preference on this page).
    public static func efficiency(_ whPerKm: Double) -> String {
        guard whPerKm > 0 else { return emptyValue }
        return "\(number(whPerKm, decimals: 0)) Wh/km"
    }

    /// Web `${fmtNumber(co2, decimals)} kg` — CO₂ mass with the kg label inline.
    public static func co2Kg(_ kilograms: Double, decimals: Int = 0) -> String {
        "\(number(kilograms, decimals: decimals)) kg"
    }

    /// Web `${fmtNumber(co2, 0)} kg` with the AnimatedNumber `suffix=" kg"` (environmental panel).
    public static func co2KgAnimated(_ kilograms: Double) -> String {
        co2Kg(kilograms, decimals: 0)
    }

    /// Web `fmtNumber(value, decimals)` for the fun-fact percentages (the card appends the `%`
    /// unit separately).
    public static func percentValue(_ value: Double, decimals: Int) -> String {
        number(value, decimals: decimals)
    }

    // MARK: - Timeline (web `useDateFormat().formatDate` + activity fallbacks)

    /// Web `fmtDate(iso)` — an ISO day/datetime string rendered as an abbreviated locale date, or
    /// `nil` when absent/unparseable (the record date line is hidden, mirroring web `date && …`).
    public static func date(_ iso: String?) -> String? {
        guard let iso, !iso.isEmpty else { return nil }
        if let parsed = parseISODate(iso) {
            return parsed.formatted(date: .abbreviated, time: .omitted)
        }
        return nil
    }

    /// Web `most_active_hour != null ? ${most_active_hour}:00 : '—'`.
    public static func hourOfDay(_ hour: Int?) -> String {
        guard let hour else { return emptyValue }
        return "\(hour):00"
    }

    /// Web `most_active_day_of_week || '—'`.
    public static func dayOfWeek(_ value: String) -> String {
        value.isEmpty ? emptyValue : value
    }

    // MARK: - Interpolated strings (web `t(key, { interpolation })`)

    /// Web `t('lifetime.heroSubtitle', 'driven across {{drives}} drives', { drives })`.
    public static func heroSubtitle(drives: Int) -> String {
        String(format: String(localized: "lifetime.heroSubtitle"), integer(Double(drives)))
    }

    /// Web `t('lifetime.earthCompare', "That's {{x}}x around the Earth!", { x })` where
    /// `x = fmtNumber(earth_circumferences, 2)`.
    public static func earthCompare(circumferences: Double) -> String {
        String(format: String(localized: "lifetime.earthCompare"), number(circumferences, decimals: 2))
    }

    /// Web `t('lifetime.since', 'Tracking since {{date}} ({{days}} days)', { date, days })`.
    public static func since(firstDriveDate iso: String?, ownershipDays days: Int) -> String {
        String(
            format: String(localized: "lifetime.since"),
            date(iso) ?? emptyValue,
            integer(Double(days))
        )
    }

    // MARK: - ISO date parsing

    /// Parses the lifetime date strings, accepting RFC3339 datetimes (with or without fractional
    /// seconds) and plain `yyyy-MM-dd` days. Returns `nil` for anything unparseable.
    static func parseISODate(_ value: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: value) { return date }

        let plainISO = ISO8601DateFormatter()
        plainISO.formatOptions = [.withInternetDateTime]
        if let date = plainISO.date(from: value) { return date }

        let dayFormatter = DateFormatter()
        dayFormatter.locale = Locale(identifier: "en_US_POSIX")
        dayFormatter.timeZone = TimeZone(identifier: "UTC")
        dayFormatter.dateFormat = "yyyy-MM-dd"
        return dayFormatter.date(from: value)
    }
}
