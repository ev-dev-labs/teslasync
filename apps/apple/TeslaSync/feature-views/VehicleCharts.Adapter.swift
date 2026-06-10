//
//  VehicleCharts.Adapter.swift
//  TeslaSync — P4 feature view · 0303 · VehicleCharts (Apple)
//
//  The Foundation-only domain core for the vehicle-charts surface: the JS
//  truthiness guard the web map/trail filters rely on (`p.latitude && p.longitude`),
//  the decoded records that mirror the slices the web
//  features/vehicles/components/VehicleCharts.tsx consumes (`VehicleState`,
//  `Position`, `VehicleConfigSnapshot`, `UserPreferenceSnapshot`), the `cleanNil`
//  port (Go `<nil>` sentinel stripping), and the `parseSettingEnum` port (Tesla
//  Fleet Telemetry setting-enum normalisation). Pure + `Equatable` so every branch
//  unit-tests without a store or a rendered view.
//
//  Units note (ADR-009 / unit-conversion.instructions.md): `Position.speed_mph`
//  is a LEGACY-NAMED field whose wire value is SI metres-per-second — the web
//  feeds it straight to `convertSpeedFromSI`. We carry it as `speedMps` and only
//  ever convert at the display boundary (see VehicleCharts.Formatting units seam).
//

import CoreLocation
import Foundation

// MARK: - Numeric guard (web JS truthiness: `value && …`)

/// Native port of the implicit web truthiness guards. The map center
/// (`state.latitude && state.longitude`) and the trail filter
/// (`positions.filter(p => p.latitude && p.longitude)`) both rely on JS
/// truthiness, where `0`, `NaN`, `null`, and `undefined` are all falsy.
public enum VehicleChartsNumeric {
    /// Whether a coordinate component is "truthy" the way the web filter treats
    /// it: a finite, non-zero number (so `nil`, `NaN`, `±∞`, and `0` are dropped).
    public static func isTruthyCoordinate(_ value: Double?) -> Bool {
        guard let value else { return false }
        return value.isFinite && value != 0
    }

    /// Whether a value is a usable finite number (the speed guard, where the web
    /// uses `p.speed_mph != null` — a real `0` IS kept, only `nil`/`NaN` drop).
    public static func isFiniteNumber(_ value: Double?) -> Bool {
        guard let value else { return false }
        return value.isFinite
    }
}

// MARK: - `cleanNil` port (web web/src/lib/cleanNil.ts)

/// Strips the Go nil-string sentinels the API can echo (`fmt.Sprintf("%v", nil)`
/// → `"<nil>"`), reproducing the web `cleanNil`: returns `nil` for an absent,
/// blank, or sentinel value so the caller falls back to the em-dash.
public enum VehicleChartsCleanNil {
    private static let sentinels: Set<String> = ["<nil>", "nil", "null"]

    public static func clean(_ value: String?) -> String? {
        guard let value, !value.isEmpty, !sentinels.contains(value) else { return nil }
        return value
    }
}

// MARK: - `parseSettingEnum` port (web web/src/lib/parseSettingEnum.ts)

/// The semantic result of normalising a Tesla setting enum. Kept as a token so
/// the display layer resolves the human label through the i18n facade (the web
/// returns English literals like "Miles" directly; native localizes them).
public enum VehicleChartsSettingValue: Equatable, Sendable {
    case miles
    case kilometers
    case celsius
    case fahrenheit
    case percent
    case psi
    case bar
    case kpa
    /// A value the web map didn't recognise — echoed verbatim (it is data, not a
    /// UI literal), exactly like the web `?? value` fallthrough.
    case raw(String)
    /// Absent/blank — the web `if (!value) return '—'` branch.
    case missing
}

/// Normalises Tesla Fleet Telemetry setting enums (e.g. `"DistanceUnitMiles"`,
/// `"TemperatureUnitCelsius"`, `"PressureUnitPsi"`) into a semantic token, a
/// faithful port of the web `parseSettingEnum` (lowercase, strip non-letters,
/// look up the per-category map, else echo the raw value).
public enum VehicleChartsSettingEnum {
    public enum Category {
        case distance
        case temperature
        case charge
        case pressure
    }

    private static let distance: [String: VehicleChartsSettingValue] = [
        "distanceunitmiles": .miles,
        "distanceunitkilometers": .kilometers,
        "distanceunitkm": .kilometers,
        "miles": .miles,
        "mi": .miles,
        "km": .kilometers,
        "kilometers": .kilometers
    ]
    private static let temperature: [String: VehicleChartsSettingValue] = [
        "temperatureunitcelsius": .celsius,
        "temperatureunitfahrenheit": .fahrenheit,
        "celsius": .celsius,
        "fahrenheit": .fahrenheit,
        "c": .celsius,
        "f": .fahrenheit
    ]
    private static let charge: [String: VehicleChartsSettingValue] = [
        "chargeunitpercent": .percent,
        "chargeunitmiles": .miles,
        "chargeunitkilometers": .kilometers,
        "percent": .percent,
        "mi": .miles,
        "km": .kilometers
    ]
    private static let pressure: [String: VehicleChartsSettingValue] = [
        "pressureunitpsi": .psi,
        "pressureunitbar": .bar,
        "pressureunitkpa": .kpa,
        "psi": .psi,
        "bar": .bar,
        "kpa": .kpa
    ]

    private static func table(for category: Category) -> [String: VehicleChartsSettingValue] {
        switch category {
        case .distance: distance
        case .temperature: temperature
        case .charge: charge
        case .pressure: pressure
        }
    }

    /// Parses a raw setting value. `nil`/blank → `.missing`; a recognised enum →
    /// its token; anything else → `.raw(original)` (web `?? value`).
    public static func parse(_ value: String?, category: Category) -> VehicleChartsSettingValue {
        guard let value, !value.isEmpty else { return .missing }
        let key = value.lowercased().filter(\.isLetter)
        if let mapped = table(for: category)[key] { return mapped }
        return .raw(value)
    }
}

// MARK: - Domain records (ports of the consumed web slices)

/// The `VehicleState` subset the map reads (web only consumes `state.latitude` /
/// `state.longitude` here). Coordinates are stored raw; `currentCoordinate`
/// applies the web truthiness gate so a `0`/`NaN` location yields no map.
public struct VehicleChartsStateRecord: Equatable, Sendable {
    public var latitude: Double
    public var longitude: Double

    public init(latitude: Double, longitude: Double) {
        self.latitude = latitude
        self.longitude = longitude
    }

    /// The live coordinate, or `nil` when either component is falsy — the native
    /// parity of the web `state.latitude && state.longitude` map guard.
    public var currentCoordinate: CLLocationCoordinate2D? {
        guard VehicleChartsNumeric.isTruthyCoordinate(latitude),
              VehicleChartsNumeric.isTruthyCoordinate(longitude)
        else { return nil }
        return CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

/// One position sample — the native parity of the web `Position` fields the chart
/// reads (`ts`, `latitude`, `longitude`, `speed_mph`). `speedMps` carries the
/// SI metres-per-second value of the legacy-named `speed_mph` column.
public struct VehicleChartsPositionRecord: Identifiable, Equatable, Sendable {
    public var id: Int
    public var timestamp: Date?
    public var latitude: Double?
    public var longitude: Double?
    /// Speed in metres-per-second (SI) — the wire `speed_mph` value (legacy name).
    public var speedMps: Double?

    public init(
        id: Int,
        timestamp: Date? = nil,
        latitude: Double? = nil,
        longitude: Double? = nil,
        speedMps: Double? = nil
    ) {
        self.id = id
        self.timestamp = timestamp
        self.latitude = latitude
        self.longitude = longitude
        self.speedMps = speedMps
    }

    /// Whether this sample has a plottable trail coordinate (web `p.latitude &&
    /// p.longitude`).
    public var isPlottable: Bool {
        VehicleChartsNumeric.isTruthyCoordinate(latitude)
            && VehicleChartsNumeric.isTruthyCoordinate(longitude)
    }

    /// The trail coordinate, or `nil` when the sample is unplottable.
    public var coordinate: CLLocationCoordinate2D? {
        guard isPlottable, let latitude, let longitude else { return nil }
        return CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

/// The `VehicleConfigSnapshot` fields the configuration grid renders. Optional
/// strings mirror the web `?` fields (and are run through `cleanNil` at display).
public struct VehicleChartsConfig: Equatable, Sendable {
    public var carType: String?
    public var trim: String?
    public var exteriorColor: String?
    public var roofColor: String?
    public var wheelType: String?
    public var version: String?
    public var vehicleName: String?
    public var chargePort: String?
    public var rearSeatHeaters: String?
    public var efficiencyPackage: String?
    public var sunroofInstalled: String?
    public var europeVehicle: Bool?
    public var rightHandDrive: Bool?
    public var remoteStartEnabled: Bool?
    public var offroadLightbarPresent: Bool?
    public var softwareUpdateVersion: String?
    public var softwareUpdateDownloadPct: Double?
    public var softwareUpdateInstallPct: Double?

    public init(
        carType: String? = nil,
        trim: String? = nil,
        exteriorColor: String? = nil,
        roofColor: String? = nil,
        wheelType: String? = nil,
        version: String? = nil,
        vehicleName: String? = nil,
        chargePort: String? = nil,
        rearSeatHeaters: String? = nil,
        efficiencyPackage: String? = nil,
        sunroofInstalled: String? = nil,
        europeVehicle: Bool? = nil,
        rightHandDrive: Bool? = nil,
        remoteStartEnabled: Bool? = nil,
        offroadLightbarPresent: Bool? = nil,
        softwareUpdateVersion: String? = nil,
        softwareUpdateDownloadPct: Double? = nil,
        softwareUpdateInstallPct: Double? = nil
    ) {
        self.carType = carType
        self.trim = trim
        self.exteriorColor = exteriorColor
        self.roofColor = roofColor
        self.wheelType = wheelType
        self.version = version
        self.vehicleName = vehicleName
        self.chargePort = chargePort
        self.rearSeatHeaters = rearSeatHeaters
        self.efficiencyPackage = efficiencyPackage
        self.sunroofInstalled = sunroofInstalled
        self.europeVehicle = europeVehicle
        self.rightHandDrive = rightHandDrive
        self.remoteStartEnabled = remoteStartEnabled
        self.offroadLightbarPresent = offroadLightbarPresent
        self.softwareUpdateVersion = softwareUpdateVersion
        self.softwareUpdateDownloadPct = softwareUpdateDownloadPct
        self.softwareUpdateInstallPct = softwareUpdateInstallPct
    }
}

/// The `UserPreferenceSnapshot` fields the preferences grid renders.
public struct VehicleChartsPreferences: Equatable, Sendable {
    public var setting24hrTime: Bool?
    public var settingChargeUnit: String?
    public var settingDistanceUnit: String?
    public var settingTemperatureUnit: String?
    public var settingTirePressureUnit: String?

    public init(
        setting24hrTime: Bool? = nil,
        settingChargeUnit: String? = nil,
        settingDistanceUnit: String? = nil,
        settingTemperatureUnit: String? = nil,
        settingTirePressureUnit: String? = nil
    ) {
        self.setting24hrTime = setting24hrTime
        self.settingChargeUnit = settingChargeUnit
        self.settingDistanceUnit = settingDistanceUnit
        self.settingTemperatureUnit = settingTemperatureUnit
        self.settingTirePressureUnit = settingTirePressureUnit
    }
}

/// The coalesced slice a source resolves for the surface — the native parity of
/// the four web props (`state`, `positions`, `vehicleConfigData`, `userPrefData`).
public struct VehicleChartsData: Equatable, Sendable {
    public var state: VehicleChartsStateRecord?
    public var positions: [VehicleChartsPositionRecord]
    public var config: VehicleChartsConfig?
    public var preferences: VehicleChartsPreferences?

    public init(
        state: VehicleChartsStateRecord? = nil,
        positions: [VehicleChartsPositionRecord] = [],
        config: VehicleChartsConfig? = nil,
        preferences: VehicleChartsPreferences? = nil
    ) {
        self.state = state
        self.positions = positions
        self.config = config
        self.preferences = preferences
    }

    /// The empty slice (used as the model's pre-first-update default).
    public static let empty = VehicleChartsData()
}
