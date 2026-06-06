import Foundation
import Shared

/// The user's display-unit preferences, mirroring the shared core's composite
/// `UnitPref` (`io.teslasync.shared.core.units.UnitPref`). Stored as the SI label
/// strings the shared enums round-trip through (`"km"`, `"mph"`, `"°C"`, …).
public struct UnitPreferences: Equatable, Sendable {
    public var distance: String
    public var speed: String
    public var temperature: String
    public var pressure: String
    public var energy: String
    public var duration: String
    public var power: String
    public var locale: String?
    public var precision: Int?

    public init(
        distance: String,
        speed: String,
        temperature: String,
        pressure: String,
        energy: String,
        duration: String,
        power: String,
        locale: String? = nil,
        precision: Int? = nil
    ) {
        self.distance = distance
        self.speed = speed
        self.temperature = temperature
        self.pressure = pressure
        self.energy = energy
        self.duration = duration
        self.power = power
        self.locale = locale
        self.precision = precision
    }
}

/// Ergonomic Swift entry point for the shared SI conversion + formatting engine.
///
/// All math/formatting lives in the KMP core (`Units.kt`) so every platform shows
/// identical numbers (verified by the golden-vector tests). This facade only
/// bridges Swift values into the shared functions.
///
/// > KMP interop note: top-level Kotlin functions are exported on `SharedUnitsKt`
/// > and enums are built from their `label` via the `fromLabel` companion — names
/// > inferred from source, pinned on the macOS build.
public enum Units {
    public static func convertDistance(_ meters: Double, _ prefs: UnitPreferences) -> Double {
        SharedUnitsKt.convertDistanceFromSI(meters: meters, to: distanceUnit(prefs.distance))
    }

    public static func convertSpeed(_ mps: Double, _ prefs: UnitPreferences) -> Double {
        SharedUnitsKt.convertSpeedFromSI(mps: mps, to: speedUnit(prefs.speed))
    }

    public static func convertTemperature(_ celsius: Double, _ prefs: UnitPreferences) -> Double {
        SharedUnitsKt.convertTempFromSI(celsius: celsius, to: temperatureUnit(prefs.temperature))
    }

    public static func convertPressure(_ kpa: Double, _ prefs: UnitPreferences) -> Double {
        SharedUnitsKt.convertPressureFromSI(kpa: kpa, to: pressureUnit(prefs.pressure))
    }

    public static func convertEnergy(_ wh: Double, _ prefs: UnitPreferences) -> Double {
        SharedUnitsKt.convertEnergyFromSI(wh: wh, to: energyUnit(prefs.energy))
    }

    public static func convertDuration(_ seconds: Double, _ prefs: UnitPreferences) -> Double {
        SharedUnitsKt.convertDurationFromSI(seconds: seconds, to: durationUnit(prefs.duration))
    }

    public static func convertPower(_ watts: Double, _ prefs: UnitPreferences) -> Double {
        SharedUnitsKt.convertPowerFromSI(watts: watts, to: powerUnit(prefs.power))
    }

    public static func formatDistance(_ meters: Double?, _ prefs: UnitPreferences) -> String {
        SharedUnitsKt.formatDistance(meters: boxed(meters), pref: composite(prefs), precision: nil)
    }

    public static func formatSpeed(_ mps: Double?, _ prefs: UnitPreferences) -> String {
        SharedUnitsKt.formatSpeed(mps: boxed(mps), pref: composite(prefs), precision: nil)
    }

    public static func formatTemperature(_ celsius: Double?, _ prefs: UnitPreferences) -> String {
        SharedUnitsKt.formatTemperature(celsius: boxed(celsius), pref: composite(prefs), precision: nil)
    }

    public static func formatPressure(_ kpa: Double?, _ prefs: UnitPreferences) -> String {
        SharedUnitsKt.formatPressure(kpa: boxed(kpa), pref: composite(prefs), precision: nil)
    }

    public static func formatEnergy(_ wh: Double?, _ prefs: UnitPreferences) -> String {
        SharedUnitsKt.formatEnergy(wh: boxed(wh), pref: composite(prefs), precision: nil)
    }

    public static func formatDuration(_ seconds: Double?, _ prefs: UnitPreferences) -> String {
        SharedUnitsKt.formatDuration(seconds: boxed(seconds), pref: composite(prefs), precision: nil)
    }

    public static func formatPower(_ watts: Double?, _ prefs: UnitPreferences) -> String {
        SharedUnitsKt.formatPower(watts: boxed(watts), pref: composite(prefs), precision: nil)
    }
}

extension Units {
    private static func boxed(_ value: Double?) -> KotlinDouble? {
        value.map(KotlinDouble.init(value:))
    }

    static func distanceUnit(_ label: String) -> SharedDistanceUnitPref {
        SharedDistanceUnitPref.companion.fromLabel(label: label)
    }

    static func speedUnit(_ label: String) -> SharedSpeedUnitPref {
        SharedSpeedUnitPref.companion.fromLabel(label: label)
    }

    static func temperatureUnit(_ label: String) -> SharedTemperatureUnitPref {
        SharedTemperatureUnitPref.companion.fromLabel(label: label)
    }

    static func pressureUnit(_ label: String) -> SharedPressureUnitPref {
        SharedPressureUnitPref.companion.fromLabel(label: label)
    }

    static func energyUnit(_ label: String) -> SharedEnergyUnitPref {
        SharedEnergyUnitPref.companion.fromLabel(label: label)
    }

    static func durationUnit(_ label: String) -> SharedDurationUnitPref {
        SharedDurationUnitPref.companion.fromLabel(label: label)
    }

    static func powerUnit(_ label: String) -> SharedPowerUnitPref {
        SharedPowerUnitPref.companion.fromLabel(label: label)
    }

    /// Builds the shared composite `UnitPref` from Swift preferences.
    static func composite(_ prefs: UnitPreferences) -> SharedUnitPref {
        SharedUnitPref(
            distance: distanceUnit(prefs.distance),
            speed: speedUnit(prefs.speed),
            temperature: temperatureUnit(prefs.temperature),
            pressure: pressureUnit(prefs.pressure),
            energy: energyUnit(prefs.energy),
            duration: durationUnit(prefs.duration),
            power: powerUnit(prefs.power),
            locale: prefs.locale,
            precision: prefs.precision.map(KotlinInt.init(value:)),
            emptyDisplay: nil
        )
    }
}
