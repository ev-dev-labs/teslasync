import Foundation

// Render-boundary formatters for the Trips list surface — the SwiftUI parity of the web page's local
// `formatDuration` plus its `formatDate` / `fmtInt` / `convertDistanceFromSI` / `formatEnergy` /
// `formatCurrency` usages. Distance converts SI metres to the user's unit through the shared `Units`
// engine (P1/S5, ADR-005); energy formats unit-aware through the same engine (web
// `useUnits().formatEnergy`); cost formats as `{symbol}{number}` (web `useFormatting().formatCurrency`);
// efficiency derives Wh/km from SI and converts to Wh/mi for imperial (web `KM_PER_MILE`). All helpers
// are pure `static func`s (no stored formatter globals) so they are concurrency-safe under Swift 6
// `complete` mode.
enum TripListFormat {
    /// The universal unrenderable sentinel (web `'—'`).
    static let emDash = "—"

    /// Web `KM_PER_MILE` — the inline Wh/km → Wh/mi efficiency factor the web page hard-codes because
    /// `convertEfficiencyFromSI` does not yet exist (same precedent as the web `TripListPage`).
    static let kmPerMile = 1.609344

    // MARK: Date + duration (web `formatDate` / `formatDuration`)

    /// Web `formatDate(trip.start_date)` → locale "Apr 4, 2026" (abbreviated date, no time).
    static func date(_ date: Date) -> String {
        date.formatted(.dateTime.year().month(.abbreviated).day())
    }

    /// Web `formatDuration(start, end)`: the "In progress" sentinel while open, else `Xm` under an
    /// hour, `Hh Mm` otherwise (dropping the minutes when they round below 0.5). The sentinel resolves
    /// from the catalog (reusing the shipped `driveDetail.inProgress` key) so no literal is hard-coded.
    static func duration(start: Date, end: Date?) -> String {
        guard let end else { return String(localized: "driveDetail.inProgress") }
        let milliseconds = end.timeIntervalSince(start) * 1000
        let hours = Int((milliseconds / 3_600_000).rounded(.down))
        let minutesRaw = milliseconds.truncatingRemainder(dividingBy: 3_600_000) / 60_000
        if hours == 0 { return "\(integer(minutesRaw))m" }
        return minutesRaw >= 0.5 ? "\(hours)h \(integer(minutesRaw))m" : "\(hours)h"
    }

    // MARK: Distance (web `convertDistanceFromSI` + `fmtInt`)

    /// Web `convertDistanceFromSI(total_distance_m, unit)` — the raw display-unit value (for the chart
    /// magnitudes and the cost-per-distance maths).
    static func distanceValue(meters: Double, units: UnitPreferences) -> Double {
        Units.convertDistance(meters, units)
    }

    /// Web `fmtInt(convertDistanceFromSI(total_distance_m, unit))` + ` ${unit}` — SI metres converted
    /// to the user's distance unit, integer-formatted, with the unit label appended.
    static func distanceText(meters: Double, units: UnitPreferences) -> String {
        "\(integer(distanceValue(meters: meters, units: units))) \(units.distance)"
    }

    // MARK: Energy (web `useUnits().formatEnergy`)

    /// Web `formatEnergy(total_energy_wh)` — SI watt-hours formatted unit-aware (kWh / Wh / MWh) by
    /// the shared engine at the user's precision.
    static func energy(wattHours: Double, units: UnitPreferences) -> String {
        Units.formatEnergy(wattHours, units)
    }

    // MARK: Cost (web `useFormatting().formatCurrency`)

    /// Web `formatCurrency(value)` → `{symbol}{fmtNumber(value, 2)}` — the user's currency symbol
    /// adjacent to the locale-grouped amount (no FX conversion, exactly as the web performs none).
    static func currency(_ value: Double, symbol: String, locale: Locale) -> String {
        CurrencyFormatting.display(
            symbol: symbol,
            value: value,
            precision: CurrencyMeta.defaultPrecision,
            locale: locale
        )
    }

    /// The Total-Cost card subtitle (web `${formatCurrency((totalCost / totalDistDisplay) * 100)}/100${unit}`):
    /// cost per 100 distance-units, or a bare zero amount when there is no distance.
    static func costPerHundred(
        totalCost: Double,
        totalDistanceDisplay: Double,
        symbol: String,
        unit: String,
        locale: Locale
    ) -> String {
        guard totalDistanceDisplay > 0 else { return currency(0, symbol: symbol, locale: locale) }
        let per = (totalCost / totalDistanceDisplay) * 100
        return "\(currency(per, symbol: symbol, locale: locale))/100\(unit)"
    }

    // MARK: Efficiency (web row `whPerKm` → Wh/mi | Wh/km)

    /// The efficiency unit label (web `unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km'`).
    static func efficiencyUnit(_ units: UnitPreferences) -> String {
        units.distance == "mi" ? "Wh/mi" : "Wh/km"
    }

    /// Web row efficiency: `whPerKm = total_energy_wh / (total_distance_m / 1000)`, scaled by
    /// `KM_PER_MILE` for imperial. Zero when the trip has no distance.
    static func efficiencyValue(energyWh: Double, distanceM: Double, units: UnitPreferences) -> Double {
        guard distanceM > 0 else { return 0 }
        let whPerKm = energyWh / (distanceM / 1000)
        return units.distance == "mi" ? whPerKm * kmPerMile : whPerKm
    }

    /// The row's efficiency line (web `fmtInt(efficiencyDisplay) ${unit}`), showing `0 ${unit}` for a
    /// trip with no distance.
    static func efficiencyText(energyWh: Double, distanceM: Double, units: UnitPreferences) -> String {
        let unit = efficiencyUnit(units)
        guard distanceM > 0 else { return "0 \(unit)" }
        return "\(integer(efficiencyValue(energyWh: energyWh, distanceM: distanceM, units: units))) \(unit)"
    }

    // MARK: Number (web `fmtInt`)

    /// Web `fmtInt` — locale-grouped integer (rounds half away from zero).
    static func integer(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0)))
    }
}
