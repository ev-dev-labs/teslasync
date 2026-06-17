import Foundation

// Render-boundary formatters for the "Share a trip" surface — the SwiftUI parity of the web page's
// local `formatDuration` plus its `formatDate` / `fmtInt` / `fmtNumber` / `convertDistanceFromSI`
// usages. Distance converts SI metres to the user's unit through the shared `Units` engine (P1/S5,
// ADR-005) and is integer-formatted with the unit suffix exactly like the web row; energy is shown
// verbatim in SI watt-hours (the web row renders `fmtNumber(total_energy_wh) Wh` without
// converting). All helpers are pure `static func`s (no stored formatter globals) so they are
// concurrency-safe under Swift 6 `complete` mode.
enum SharingTripsFormat {
    /// The universal unrenderable sentinel (web `'—'`).
    static let emDash = "—"

    /// Web `formatDate(trip.start_date)` → locale "Apr 4, 2026" (abbreviated date, no time).
    static func date(_ date: Date) -> String {
        date.formatted(.dateTime.year().month(.abbreviated).day())
    }

    /// Web `formatDuration(start, end)`: `'—'` while open, else `Xm` under an hour, `Hh Mm`
    /// otherwise (dropping the minutes when they round below 0.5).
    static func duration(start: Date, end: Date?) -> String {
        guard let end else { return emDash }
        let milliseconds = end.timeIntervalSince(start) * 1000
        let hours = Int((milliseconds / 3_600_000).rounded(.down))
        let minutesRaw = milliseconds.truncatingRemainder(dividingBy: 3_600_000) / 60_000
        if hours == 0 { return "\(integer(minutesRaw))m" }
        return minutesRaw >= 0.5 ? "\(hours)h \(integer(minutesRaw))m" : "\(hours)h"
    }

    /// Web `fmtInt(convertDistanceFromSI(total_distance_m, unit))` + ` ${unit}` — SI metres
    /// converted to the user's distance unit, integer-formatted, with the unit label appended.
    static func distance(meters: Double, units: UnitPreferences) -> String {
        "\(integer(Units.convertDistance(meters, units))) \(units.distance)"
    }

    /// Web `fmtNumber(total_energy_wh) + ' Wh'` — verbatim SI watt-hours at the user's precision
    /// (default 2), not converted to the energy-unit preference.
    static func energy(wattHours: Double, units: UnitPreferences) -> String {
        "\(number(wattHours, fractionDigits: units.precision ?? 2)) Wh"
    }

    /// Web `fmtInt` — locale-grouped integer (rounds).
    static func integer(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0)))
    }

    /// Web `fmtNumber` — locale-grouped decimal at the given precision.
    private static func number(_ value: Double, fractionDigits: Int) -> String {
        value.formatted(.number.precision(.fractionLength(max(0, fractionDigits))))
    }
}
