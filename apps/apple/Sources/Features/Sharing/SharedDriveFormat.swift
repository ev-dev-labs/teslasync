import Foundation

// Unit-aware display helpers for the Shared Drive report — the native port of the web page's
// boundary helpers (`elevationLabel`, `convertElevation`, `efficiencyUnit`, `toEfficiencyDisplay`)
// plus `formatDurationSecondsAsMinutes`. SI lives in the model; these convert to the viewer's
// preferred display unit at the render boundary only (ADR-005). Distance + speed go through the
// shared `Units` engine; elevation (m → ft) and energy-per-distance efficiency (Wh/km → Wh/mi) have
// no dedicated SI helper yet, so they convert inline with the same constants the web page pins.

enum SharedDriveFormat {
    /// Web `KM_PER_MILE` — Wh/km → Wh/mi efficiency factor for imperial viewers.
    static let kmPerMile = 1.609344
    /// Web `METERS_PER_FOOT` — meters → feet elevation factor for imperial viewers.
    static let metersPerFoot = 0.3048
    /// Web `METERS_PER_KM` — Wh/m → Wh/km lift before the efficiency display conversion.
    static let metersPerKm = 1000.0
    /// Web FALLBACK em dash for absent/invalid values.
    static let fallback = "—"

    /// Whether the viewer prefers imperial distance (web `distancePref === 'mi'`).
    static func isMiles(_ units: UnitPreferences) -> Bool {
        units.distance == "mi"
    }

    /// Web `elevationLabel` — `ft` for imperial, `m` for metric.
    static func elevationUnit(_ units: UnitPreferences) -> String {
        isMiles(units) ? "ft" : "m"
    }

    /// Web `convertElevation` — meters → feet for imperial viewers, else identity.
    static func convertElevation(_ meters: Double, _ units: UnitPreferences) -> Double {
        isMiles(units) ? meters / metersPerFoot : meters
    }

    /// Web `efficiencyUnit` — `Wh/mi` for imperial, `Wh/km` for metric.
    static func efficiencyUnit(_ units: UnitPreferences) -> String {
        isMiles(units) ? "Wh/mi" : "Wh/km"
    }

    /// Web `toEfficiencyDisplay` — scale Wh/km into Wh/mi for imperial viewers, else identity.
    static func toEfficiencyDisplay(_ whPerKm: Double, _ units: UnitPreferences) -> Double {
        isMiles(units) ? whPerKm * kmPerMile : whPerKm
    }

    /// The efficiency stat value (web `${round(toEfficiencyDisplay(wh_per_m * 1000))} ${unit}`).
    static func efficiencyValue(_ whPerM: Double, _ units: UnitPreferences) -> String {
        let display = toEfficiencyDisplay(whPerM * metersPerKm, units)
        return "\(roundedInt(display)) \(efficiencyUnit(units))"
    }

    /// The elevation-gain stat value (web `${round(convertElevation(gain))} ${unit}`).
    static func elevationGainValue(_ meters: Double, _ units: UnitPreferences) -> String {
        "\(roundedInt(convertElevation(meters, units))) \(elevationUnit(units))"
    }

    /// The battery stat value (web ``${start}% → ${end}%``).
    static func batteryValue(start: Double, end: Double) -> String {
        "\(roundedInt(start))% → \(roundedInt(end))%"
    }

    /// Web `formatDurationSecondsAsMinutes`: `Xm` under an hour, else `Hh Mm` (drops a sub-half
    /// trailing minute), em dash for absent/negative input.
    static func durationMinutes(_ seconds: Double?) -> String {
        guard let seconds, seconds.isFinite, seconds >= 0 else { return fallback }
        let hours = Int(seconds / 3600)
        let minutes = seconds.truncatingRemainder(dividingBy: 3600) / 60
        if hours == 0 { return "\(roundedInt(minutes))m" }
        return minutes >= 0.5 ? "\(hours)h \(roundedInt(minutes))m" : "\(hours)h"
    }

    /// `Math.round`-equivalent integer rendering (web `formatRoundedInt`).
    static func roundedInt(_ value: Double) -> String {
        guard value.isFinite else { return fallback }
        return "\(Int(value.rounded()))"
    }
}
