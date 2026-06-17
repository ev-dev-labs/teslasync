import Foundation

// Render-boundary formatters + derivations for the Fleet (vehicle list) surface — the SwiftUI parity
// of the web page's `deriveVehicleStatus` / `batteryColor` / `convertDistanceFromSI` / `fmtNumber` /
// `formatDistance` usages. Distance + power convert SI → the user's unit through the shared `Units`
// engine (P1/S5, ADR-005); the status + battery axes REUSE the `VehicleStatus` / `BatteryTone` types
// already owned by the `VehicleCard` feature view (DRY — no duplicate FSM table or colour thresholds).
// All helpers are pure `static func`s (no stored formatter globals) so they are concurrency-safe under
// Swift 6 `complete` mode.
enum VehicleListFormat {
    /// The universal unrenderable sentinel (web `'—'`).
    static let emDash = "—"

    // MARK: Status (web `deriveVehicleStatus` from `@/types/fsm`)

    /// Web `deriveVehicleStatus(state)`: no state → offline; the charging flag wins; then a positive
    /// speed → driving; then a recognized FSM string; else the online fallback. Returns the shared
    /// `VehicleStatus` whose `.tone` / `.labelKey` / `.labelFallback` the badge reads.
    static func status(for state: VehicleStateSnapshot?) -> VehicleStatus {
        guard let state else { return .offline }
        if state.isCharging { return .charging }
        if state.speedMps > 0 { return .driving }
        return VehicleStatus(rawValue: state.state.lowercased()) ?? .online
    }

    // MARK: Battery (web `batteryColor` thresholds)

    /// Web `batteryColor(level)` → the shared state-of-charge tone (`> 60` success, `> 25` warning,
    /// else danger). Drives the battery bar gradient + the percent tint.
    static func batteryTone(_ level: Int) -> TSTone {
        BatteryTone.forLevel(level)
    }

    // MARK: Distance (web `formatDistance` / `convertDistanceFromSI` + `fmtNumber`)

    /// Web `formatDistance(meters)` — SI metres formatted unit-aware (km / mi) by the shared engine at
    /// the user's precision; the row range / odometer + the battery-panel range read this.
    static func distanceText(meters: Double, units: UnitPreferences) -> String {
        Units.formatDistance(meters, units)
    }

    /// Web Total-Range card value `fmtNumber(convertDistanceFromSI(totalRange, unit))` — SI metres
    /// converted to the user's distance unit and number-formatted (no unit label; the card label
    /// already carries the unit). Bare zero when the fleet has no resolved range.
    static func totalRangeValue(meters: Double, units: UnitPreferences) -> String {
        number(Units.convertDistance(meters, units), units: units)
    }

    // MARK: Power (web row `${charger_power} kW`)

    /// The charging-power chip — SI watts formatted unit-aware (kW / W) by the shared engine. The web
    /// appends a literal `kW` to the raw field; the SI store carries watts (cf. `VehicleCardLiveState`)
    /// so the unit-aware formatter yields the same "{n} kW" at the display boundary.
    static func chargePowerText(watts: Double, units: UnitPreferences) -> String {
        Units.formatPower(watts, units)
    }

    // MARK: Number (web `fmtNumber`)

    /// Web `fmtNumber(value)` — locale-grouped at the user's precision (web `_globalPrecision`,
    /// default 2). The Avg-Battery card value (`${fmtNumber(avg)}%`) + the Total-Range value read this.
    static func number(_ value: Double, units: UnitPreferences) -> String {
        value.formatted(.number.precision(.fractionLength(units.precision ?? 2)))
    }

    /// Web `Math.round(value)` — the integer percent the battery panel header + the per-vehicle
    /// battery readouts show (`{level}%`).
    static func roundedPercent(_ value: Double) -> Int {
        Int(value.rounded())
    }
}
