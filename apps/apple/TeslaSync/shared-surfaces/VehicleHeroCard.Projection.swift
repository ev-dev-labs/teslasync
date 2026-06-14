//
//  VehicleHeroCard.Projection.swift
//  TeslaSync — P4 shared surface · 0233 · VehicleHeroCard (Apple)
//
//  The render-ready projection for the vehicle hero card — the pure, Foundation-only math behind the web
//  source's JSX. It carries the value types the host pushes (the `vehicle` identity + the optional
//  `vehicleState` live state + the active `useUnits` distance/temperature labels), and `VehicleHeroCardProjector`
//  reproduces, verbatim, the web render output: the four `RadialGauge`s (battery / range / inside / outside
//  with their unit-scaled maxima), the eight `StatCard`s in source order (Inside Temp, Outside Temp,
//  Odometer, Range, Status, Sentry, Firmware, Power), the identity row (display name + validated status +
//  VIN + model), and the optional photo alt text. Pure functions only — no SwiftUI, no `@Observable` — so the
//  whole derivation is unit-tested without a rendered view.
//

import Foundation

// MARK: - VehicleHeroCardVehicle (web `vehicle` prop)

/// The vehicle identity the header reads — the native peer of the web `vehicle` prop (`id`, `display_name`,
/// `model`, `vin`, `state`).
public struct VehicleHeroCardVehicle: Sendable, Equatable, Identifiable {
    public let id: Int
    public let displayName: String
    public let model: String
    public let vin: String
    /// The Tesla API lifecycle string (web `vehicle.state`) — the status fallback when there is no live state.
    public let state: String

    public init(id: Int, displayName: String, model: String, vin: String, state: String) {
        self.id = id
        self.displayName = displayName
        self.model = model
        self.vin = vin
        self.state = state
    }
}

// MARK: - VehicleHeroCardLiveState (web `vehicleState` prop)

/// The live vehicle state the gauges + stat cards read — the native peer of the web `vehicleState` prop. The
/// numeric fields arrive in SI (metres for `odometer` / `rated_range`, °C for the temps; web `?? 0` on each)
/// and are converted at the display boundary by the projector. `power` is the value the web shows verbatim
/// with a `kW` suffix (`fmtNumber(vs.power)`).
public struct VehicleHeroCardLiveState: Sendable, Equatable {
    public let batteryLevel: Double?
    public let ratedRangeMeters: Double?
    public let insideTempC: Double?
    public let outsideTempC: Double?
    public let odometerMeters: Double?
    public let isCharging: Bool
    public let isLocked: Bool
    public let sentryMode: Bool
    public let softwareVersion: String
    public let power: Double?
    /// The live lifecycle string (web `vehicleState.state`) — the preferred status source over `vehicle.state`.
    public let state: String?

    public init(
        batteryLevel: Double?,
        ratedRangeMeters: Double?,
        insideTempC: Double?,
        outsideTempC: Double?,
        odometerMeters: Double?,
        isCharging: Bool,
        isLocked: Bool,
        sentryMode: Bool,
        softwareVersion: String,
        power: Double?,
        state: String? = nil
    ) {
        self.batteryLevel = batteryLevel
        self.ratedRangeMeters = ratedRangeMeters
        self.insideTempC = insideTempC
        self.outsideTempC = outsideTempC
        self.odometerMeters = odometerMeters
        self.isCharging = isCharging
        self.isLocked = isLocked
        self.sentryMode = sentryMode
        self.softwareVersion = softwareVersion
        self.power = power
        self.state = state
    }
}

// MARK: - VehicleHeroCardUnitPrefs (web `useUnits().unitPrefs`)

/// The active display-unit labels (web `unitPrefs.distance` / `unitPrefs.temperature`) — the only two the
/// hero card consults, pulled from Settings so every label tracks the user's preference.
public struct VehicleHeroCardUnitPrefs: Sendable, Equatable {
    /// `"mi"` | `"km"` (web `unitPrefs.distance`).
    public let distance: String
    /// `"°F"` | `"°C"` (web `unitPrefs.temperature`).
    public let temperature: String

    public init(distance: String, temperature: String) {
        self.distance = distance
        self.temperature = temperature
    }

    /// The default Settings produces for an imperial account (web `deriveDistance`/`deriveTemperature`).
    public static let imperial = VehicleHeroCardUnitPrefs(distance: "mi", temperature: "°F")
    /// The metric default.
    public static let metric = VehicleHeroCardUnitPrefs(distance: "km", temperature: "°C")
}

// MARK: - VehicleHeroCardGauge (web `RadialGauge`)

/// One render-ready radial gauge — the native peer of a web `<RadialGauge>`: the clamped value, its max, the
/// unit suffix, the pre-formatted display number, and the localized label (resolved upstream by the
/// projector's copy). `kind` keys the gauge's accent color, applied by the view's palette (battery turns red
/// at ≤ 20 %, mirroring the web `value > 20 ? '#22d3ee' : '#ef4444'`).
public struct VehicleHeroCardGauge: Sendable, Equatable, Identifiable {
    public enum Kind: String, Sendable, Equatable {
        case battery
        case range
        case inside
        case outside
    }

    public let kind: Kind
    public let value: Double
    public let max: Double
    public let unit: String
    public let valueText: String
    public let label: String

    public var id: String {
        kind.rawValue
    }

    public init(kind: Kind, value: Double, max: Double, unit: String, valueText: String, label: String) {
        self.kind = kind
        self.value = value
        self.max = max
        self.unit = unit
        self.valueText = valueText
        self.label = label
    }

    /// The clamped fraction the arc fills (web `Math.max(0, Math.min(value, max)) / max`). Guards a zero max.
    public var fraction: Double {
        guard max > 0 else { return 0 }
        return Swift.min(Swift.max(value, 0), max) / max
    }
}

// MARK: - VehicleHeroCardStat (web `StatCard`)

/// One render-ready stat card — the native peer of a web `<StatCard>`: a localized label, a pre-formatted
/// value, and an optional unit suffix. `key` is a stable identity for the grid + tests.
public struct VehicleHeroCardStat: Sendable, Equatable, Identifiable {
    public let key: String
    public let label: String
    public let value: String
    public let unit: String?

    public var id: String {
        key
    }

    public init(key: String, label: String, value: String, unit: String? = nil) {
        self.key = key
        self.label = label
        self.value = value
        self.unit = unit
    }
}

// MARK: - VehicleHeroCardIdentity (web identity row)

/// The header identity — the display name title, the validated status (for the badge), the mono VIN, and the
/// model chip (web `display_name` + `StatusBadge` + `vin` + `Badge`).
public struct VehicleHeroCardIdentity: Sendable, Equatable {
    /// The vehicle id the action bar routes on (web `/vehicles/${vehicle.id}`).
    public let vehicleID: Int
    public let title: String
    public let status: VehicleHeroCardStatus
    public let vin: String
    public let model: String

    public init(vehicleID: Int, title: String, status: VehicleHeroCardStatus, vin: String, model: String) {
        self.vehicleID = vehicleID
        self.title = title
        self.status = status
        self.vin = vin
        self.model = model
    }
}

// MARK: - VehicleHeroCardProjection (full render-ready output)

/// The full render-ready projection — identity, optional photo alt, the four gauges, the eight stat cards,
/// and whether a live state exists (web `vs && (...)` gate; native shows a friendly fallback instead of
/// hiding). A pure function of the bound vehicle + live state + units.
public struct VehicleHeroCardProjection: Sendable, Equatable {
    public let identity: VehicleHeroCardIdentity
    public let photoAlt: String?
    public let gauges: [VehicleHeroCardGauge]
    public let stats: [VehicleHeroCardStat]
    public let hasLiveState: Bool

    public init(
        identity: VehicleHeroCardIdentity,
        photoAlt: String?,
        gauges: [VehicleHeroCardGauge],
        stats: [VehicleHeroCardStat],
        hasLiveState: Bool
    ) {
        self.identity = identity
        self.photoAlt = photoAlt
        self.gauges = gauges
        self.stats = stats
        self.hasLiveState = hasLiveState
    }
}
