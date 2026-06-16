import Foundation

/// Pure display-boundary formatters for the Efficiency surface (web `fmtNumber` / `fmtInt` /
/// `fmtWithUnit` + `convertDistanceFromSI` / `convertSpeedFromSI` / `convertTempFromSI` +
/// `formatEnergy` / `formatDuration`). SI values come from the model; conversion to the user's unit
/// preference happens here via the shared KMP `Units` facade (P1/S5) — never in the model. Each
/// numeric helper returns an em dash for nil/non-finite input (never "nan").
public enum EfficiencyPageFormat {
    /// The em dash shown for a missing value (web `'—'`).
    public static let emptyValue = "—"

    /// The fraction digits a bare `fmtNumber(v)` uses — the user's global precision preference
    /// (web `_globalPrecision`, default 2).
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

    /// Web `fmtInt(value)` → `fmtNumber(value, 0)`.
    public static func integer(_ value: Double) -> String {
        number(value, decimals: 0)
    }

    // MARK: - Unit labels (web `distanceUnit` / `speedUnit` / `tempUnit` / `efficiencyUnit`)

    public static func distanceUnit(_ prefs: UnitPreferences) -> String {
        prefs.distance
    }

    public static func speedUnit(_ prefs: UnitPreferences) -> String {
        prefs.speed
    }

    public static func temperatureUnit(_ prefs: UnitPreferences) -> String {
        prefs.temperature
    }

    /// Web `efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km'`.
    public static func efficiencyUnit(_ prefs: UnitPreferences) -> String {
        prefs.distance == "mi" ? "Wh/mi" : "Wh/km"
    }

    // MARK: - Distance (web `fmtWithUnit(toDistanceDisplay(m), distanceUnit)`)

    /// SI meters → the user's distance unit numeric (web `toDistanceDisplay`).
    public static func distanceValue(_ meters: Double, _ prefs: UnitPreferences) -> Double {
        Units.convertDistance(meters, prefs)
    }

    /// SI meters → `${fmtInt(toDistanceDisplay(m))} ${distanceUnit}` (insights/table totals).
    public static func distanceInt(_ meters: Double, _ prefs: UnitPreferences) -> String {
        "\(integer(distanceValue(meters, prefs))) \(prefs.distance)"
    }

    // MARK: - Speed (web `fmtWithUnit(toSpeedDisplay(mps), speedUnit)`)

    /// SI m/s → the user's speed-unit numeric (web `toSpeedDisplay`).
    public static func speedValue(_ metersPerSecond: Double, _ prefs: UnitPreferences) -> Double {
        Units.convertSpeed(metersPerSecond, prefs)
    }

    /// SI m/s → `${fmtInt(toSpeedDisplay(mps))} ${speedUnit}` (insights / metric bar caption).
    public static func speedInt(_ metersPerSecond: Double, _ prefs: UnitPreferences) -> String {
        "\(integer(speedValue(metersPerSecond, prefs))) \(prefs.speed)"
    }

    /// SI m/s → `${fmtNumber(toSpeedDisplay(mps))} ${speedUnit}` (avg-speed stat card).
    public static func speed(_ metersPerSecond: Double, _ prefs: UnitPreferences) -> String {
        "\(number(speedValue(metersPerSecond, prefs), decimals: defaultDecimals(prefs))) \(prefs.speed)"
    }

    // MARK: - Temperature (web `toTemperatureDisplay`)

    /// SI °C → the user's temperature-unit numeric (web `toTemperatureDisplay`).
    public static func temperatureValue(_ celsius: Double, _ prefs: UnitPreferences) -> Double {
        Units.convertTemperature(celsius, prefs)
    }

    // MARK: - Efficiency (web `toEfficiencyDisplay` + efficiencyUnit)

    /// Web `toEfficiencyDisplay`: Wh/km stays as-is for metric, scaled by km-per-mile for imperial.
    public static func efficiencyValue(_ whPerKm: Double, _ prefs: UnitPreferences) -> Double {
        prefs.distance == "mi" ? whPerKm * 1.609344 : whPerKm
    }

    /// Web `fmtNumber(toEfficiencyDisplay(whPerKm))` + efficiencyUnit (avg-consumption stat card).
    public static func efficiency(_ whPerKm: Double, _ prefs: UnitPreferences) -> String {
        "\(number(efficiencyValue(whPerKm, prefs), decimals: defaultDecimals(prefs))) \(efficiencyUnit(prefs))"
    }

    /// Web `fmtInt(toEfficiencyDisplay(whPerKm))` (temperature-table avg column — numeric only).
    public static func efficiencyInt(_ whPerKm: Double, _ prefs: UnitPreferences) -> String {
        integer(efficiencyValue(whPerKm, prefs))
    }

    // MARK: - Energy / duration (web `formatEnergy` / `formatDuration`, SI in)

    /// Web `formatEnergy(wh)` via the shared facade (SI Wh in → the user's energy unit + label).
    public static func energy(_ wattHours: Double, _ prefs: UnitPreferences) -> String {
        Units.formatEnergy(wattHours, prefs)
    }

    /// Web `formatDuration(seconds)` via the shared facade (SI seconds in → the user's duration unit).
    public static func duration(_ seconds: Double, _ prefs: UnitPreferences) -> String {
        Units.formatDuration(seconds, prefs)
    }

    // MARK: - Ratios / derived (web `regenRatio*100`, `costPerKm`, `kmPerKwh`)

    /// Web `${fmtNumber(regenRatio * 100)}%` — a 0…1 fraction shown as a percent.
    public static func percent(_ fraction: Double, _ prefs: UnitPreferences) -> String {
        "\(number(fraction * 100, decimals: defaultDecimals(prefs)))%"
    }

    /// Web `kg` CO₂ label `${fmtInt(co2SavedKg)} kg`.
    public static func co2(_ kilograms: Double) -> String {
        "\(integer(kilograms)) kg"
    }

    /// Web hero `kmPerKwh = avgEfficiencyWhKm > 0 ? fmtNumber(1000 / avgEfficiencyWhKm, 1) : '—'` —
    /// always km/kWh (the raw Wh/km reciprocal), independent of the display unit.
    public static func kmPerKwh(_ avgWhPerKm: Double) -> String {
        guard avgWhPerKm > 0 else { return emptyValue }
        return number(1000 / avgWhPerKm, decimals: 1)
    }

    /// Web temperature-table `${distanceUnit}/kWh` cell: `1000 / toEfficiencyDisplay(avgWhPerKm)`.
    public static func distancePerKwh(_ avgWhPerKm: Double, _ prefs: UnitPreferences) -> String {
        let display = efficiencyValue(avgWhPerKm, prefs)
        guard display > 0 else { return emptyValue }
        return number(1000 / display, decimals: defaultDecimals(prefs))
    }

    /// Web `costPerKm = totalDistanceM > 0 ? fmtNumber((avgEfficiencyWhKm / 1000) * 0.12, 3) : '—'`
    /// (an estimate at $0.12/kWh; the leading `$` is added by the caller).
    public static func costPerKm(avgWhPerKm: Double, totalDistanceM: Double) -> String {
        guard totalDistanceM > 0 else { return emptyValue }
        return number((avgWhPerKm / 1000) * 0.12, decimals: 3)
    }

    /// Web `${'$'}${costPerKm}` — the cost estimate with its currency prefix.
    public static func costPerKmCurrency(avgWhPerKm: Double, totalDistanceM: Double) -> String {
        "$\(costPerKm(avgWhPerKm: avgWhPerKm, totalDistanceM: totalDistanceM))"
    }

    // MARK: - Bucket labels (web `speedDist[].range`, `tempBuckets[].range`)

    /// Web `${range} ${speedUnit}` — e.g. "0–30 km/h", "120+ mph". The band boundaries are already in
    /// the user's display speed unit (the buckets were computed from `toSpeedDisplay`).
    public static func speedBucketLabel(_ bucket: EfficiencySpeedBucket, _ prefs: UnitPreferences) -> String {
        if bucket.isOpenEnded {
            return "\(bucket.lowerDisplay)+ \(prefs.speed)"
        }
        return "\(bucket.lowerDisplay)–\(bucket.upperDisplay) \(prefs.speed)"
    }

    /// Web `tempBuckets[].range` — e.g. "< 0°C" / "< 32°F", "0–10°C" / "32–50°F", "> 30°C" / "> 86°F".
    /// The band boundaries are the same °C values in both unit systems (the web changes only the label
    /// and the unit symbol), so each °C edge is converted to the display unit for the number.
    public static func temperatureBucketLabel(_ bucket: EfficiencyTempBucket, _ prefs: UnitPreferences) -> String {
        let unit = prefs.temperature
        func edge(_ celsius: Double) -> String {
            integer(temperatureValue(celsius, prefs))
        }
        switch (bucket.lowerC, bucket.upperC) {
        case let (nil, upper?):
            return "< \(edge(upper))\(unit)"
        case let (lower?, nil):
            return "> \(edge(lower))\(unit)"
        case let (lower?, upper?):
            return "\(edge(lower))–\(edge(upper))\(unit)"
        case (nil, nil):
            return emptyValue
        }
    }

    // MARK: - Dates (web `formatDateShort`)

    /// Web `formatDateShort(iso)`: localized `MMM d` (e.g. "Jan 5").
    public static func dateShort(_ date: Date) -> String {
        dateShortFormatter.string(from: date)
    }

    private static let dateShortFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.setLocalizedDateFormatFromTemplate("MMMd")
        return formatter
    }()
}
