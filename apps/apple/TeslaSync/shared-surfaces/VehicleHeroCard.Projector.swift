//
//  VehicleHeroCard.Projector.swift
//  TeslaSync — P4 shared surface · 0233 · VehicleHeroCard (Apple)
//
//  The pure projector behind ``VehicleHeroCardProjection`` — the verbatim port of the web source's render
//  math, split from the value types to keep each file within the SwiftLint length budget. Every function is a
//  free, bundle-free transform (Foundation only) so the unit tests reach it without a rendered view; the
//  localized labels the gauges + stat cards need are injected as a ``VehicleHeroCardCopy`` of resolved
//  strings + a photo-alt closure, keeping the core free of `NSLocalizedString`.
//

import Foundation

// MARK: - VehicleHeroCardCopy (the localized reads the projection needs)

/// The localized copy the projector consumes — the resolved `t()` reads for the four gauge labels, the eight
/// stat-card labels, the lock / sentry words, and the interpolated photo alt. Bundled into one value so the
/// pure projector stays within the parameter budget; the production app fills it from the P1/S10 facade and
/// tests pass identity-fallback strings.
public struct VehicleHeroCardCopy: Sendable {
    public let gaugeBattery: String
    public let gaugeRange: String
    public let gaugeInside: String
    public let gaugeOutside: String
    public let statInsideTemp: String
    public let statOutsideTemp: String
    public let statOdometer: String
    public let statRange: String
    public let statStatus: String
    public let statSentry: String
    public let statFirmware: String
    public let statPower: String
    public let locked: String
    public let unlocked: String
    public let on: String
    public let off: String
    /// Web `t('vehicleHero.photo.alt', '{{name}} photo', { name })` — interpolates the display name.
    public let photoAlt: @Sendable (String) -> String

    public init(
        gaugeBattery: String,
        gaugeRange: String,
        gaugeInside: String,
        gaugeOutside: String,
        statInsideTemp: String,
        statOutsideTemp: String,
        statOdometer: String,
        statRange: String,
        statStatus: String,
        statSentry: String,
        statFirmware: String,
        statPower: String,
        locked: String,
        unlocked: String,
        on: String,
        off: String,
        photoAlt: @escaping @Sendable (String) -> String
    ) {
        self.gaugeBattery = gaugeBattery
        self.gaugeRange = gaugeRange
        self.gaugeInside = gaugeInside
        self.gaugeOutside = gaugeOutside
        self.statInsideTemp = statInsideTemp
        self.statOutsideTemp = statOutsideTemp
        self.statOdometer = statOdometer
        self.statRange = statRange
        self.statStatus = statStatus
        self.statSentry = statSentry
        self.statFirmware = statFirmware
        self.statPower = statPower
        self.locked = locked
        self.unlocked = unlocked
        self.on = on
        self.off = off
        self.photoAlt = photoAlt
    }
}

// MARK: - VehicleHeroCardProjector (web render math)

/// The pure gauge / stat / identity resolver — the verbatim port of `VehicleHeroCard.tsx`'s render body.
public enum VehicleHeroCardProjector {
    /// Web `rangeDisplay = Math.round(convertDistanceFromSI(rated_range ?? 0, distance))`.
    public static func rangeDisplay(_ state: VehicleHeroCardLiveState, distanceUnit: String) -> Int {
        VehicleHeroCardFormat.jsRound(
            VehicleHeroCardConvert.distanceFromSI(state.ratedRangeMeters ?? 0, to: distanceUnit)
        )
    }

    /// Web `…TempDisplay = Math.round(convertTempFromSI(temp ?? 0, temperature))`.
    public static func tempDisplay(_ celsius: Double?, temperatureUnit: String) -> Int {
        VehicleHeroCardFormat.jsRound(VehicleHeroCardConvert.tempFromSI(celsius ?? 0, to: temperatureUnit))
    }

    /// Web `odometerDisplay = fmtInt(Math.round(convertDistanceFromSI(odometer ?? 0, distance)))` — the
    /// rounded metres → display integer (grouped by `fmtInt` at the call site).
    public static func odometerDisplay(_ state: VehicleHeroCardLiveState, distanceUnit: String) -> Int {
        VehicleHeroCardFormat.jsRound(
            VehicleHeroCardConvert.distanceFromSI(state.odometerMeters ?? 0, to: distanceUnit)
        )
    }

    /// The four gauges (web `RadialGauge` array). Battery reads the raw `battery_level`; range / inside /
    /// outside read the rounded display integers; each max scales with the active unit.
    public static func gauges(
        state: VehicleHeroCardLiveState,
        prefs: VehicleHeroCardUnitPrefs,
        copy: VehicleHeroCardCopy
    ) -> [VehicleHeroCardGauge] {
        let battery = state.batteryLevel ?? 0
        let range = Double(rangeDisplay(state, distanceUnit: prefs.distance))
        let inside = Double(tempDisplay(state.insideTempC, temperatureUnit: prefs.temperature))
        let outside = Double(tempDisplay(state.outsideTempC, temperatureUnit: prefs.temperature))
        let rangeMax = VehicleHeroCardSurface.rangeMax(distanceUnit: prefs.distance)
        let tempMax = VehicleHeroCardSurface.tempMax(temperatureUnit: prefs.temperature)
        return [
            gauge(.battery, battery, 100, "%", copy.gaugeBattery),
            gauge(.range, range, rangeMax, prefs.distance, copy.gaugeRange),
            gauge(.inside, inside, tempMax, prefs.temperature, copy.gaugeInside),
            gauge(.outside, outside, tempMax, prefs.temperature, copy.gaugeOutside)
        ]
    }

    /// The eight stat cards, in web source order (Inside Temp, Outside Temp, Odometer, Range, Status, Sentry,
    /// Firmware, Power). Odometer + Power are grouped (`fmtInt` / `fmtNumber`); the temps + range render the
    /// raw display integer (web `value={…Display}`); Status / Sentry / Firmware are strings.
    public static func stats(
        state: VehicleHeroCardLiveState,
        prefs: VehicleHeroCardUnitPrefs,
        copy: VehicleHeroCardCopy
    ) -> [VehicleHeroCardStat] {
        let dist = prefs.distance
        let temp = prefs.temperature
        let inside = String(tempDisplay(state.insideTempC, temperatureUnit: temp))
        let outside = String(tempDisplay(state.outsideTempC, temperatureUnit: temp))
        let odometer = VehicleHeroCardFormat.fmtInt(Double(odometerDisplay(state, distanceUnit: dist)))
        let range = String(rangeDisplay(state, distanceUnit: dist))
        let lock = state.isLocked ? copy.locked : copy.unlocked
        let sentry = state.sentryMode ? copy.on : copy.off
        let power = VehicleHeroCardFormat.fmtNumber(state.power ?? 0)
        return [
            VehicleHeroCardStat(key: "insideTemp", label: copy.statInsideTemp, value: inside, unit: temp),
            VehicleHeroCardStat(key: "outsideTemp", label: copy.statOutsideTemp, value: outside, unit: temp),
            VehicleHeroCardStat(key: "odometer", label: copy.statOdometer, value: odometer, unit: dist),
            VehicleHeroCardStat(key: "range", label: copy.statRange, value: range, unit: dist),
            VehicleHeroCardStat(key: "status", label: copy.statStatus, value: lock),
            VehicleHeroCardStat(key: "sentry", label: copy.statSentry, value: sentry),
            VehicleHeroCardStat(key: "firmware", label: copy.statFirmware, value: state.softwareVersion),
            VehicleHeroCardStat(key: "power", label: copy.statPower, value: power, unit: "kW")
        ]
    }

    /// The header identity (web `display_name` + `toStatus(vehicleState?.state ?? vehicle.state)` + VIN +
    /// model).
    public static func identity(
        vehicle: VehicleHeroCardVehicle,
        liveState: VehicleHeroCardLiveState?
    ) -> VehicleHeroCardIdentity {
        VehicleHeroCardIdentity(
            vehicleID: vehicle.id,
            title: vehicle.displayName,
            status: VehicleHeroCardStatus.from(liveState?.state ?? vehicle.state),
            vin: vehicle.vin,
            model: vehicle.model
        )
    }

    /// The photo alt (web `t('vehicleHero.photo.alt', '{{name}} photo', { name })`); `nil` when there is no
    /// photo, so the view renders the gauges-only layout.
    public static func photoAlt(
        vehicle: VehicleHeroCardVehicle,
        hasPhoto: Bool,
        copy: VehicleHeroCardCopy
    ) -> String? {
        hasPhoto ? copy.photoAlt(vehicle.displayName) : nil
    }

    /// The full render-ready projection. With no live state (web `vs == null`) the gauges + stats are empty
    /// and `hasLiveState` is `false`, so the view shows the friendly no-live-data fallback rather than hiding.
    public static func projection(
        vehicle: VehicleHeroCardVehicle,
        liveState: VehicleHeroCardLiveState?,
        prefs: VehicleHeroCardUnitPrefs,
        hasPhoto: Bool,
        copy: VehicleHeroCardCopy
    ) -> VehicleHeroCardProjection {
        let identity = identity(vehicle: vehicle, liveState: liveState)
        let alt = photoAlt(vehicle: vehicle, hasPhoto: hasPhoto, copy: copy)
        guard let state = liveState else {
            return VehicleHeroCardProjection(
                identity: identity, photoAlt: alt, gauges: [], stats: [], hasLiveState: false
            )
        }
        return VehicleHeroCardProjection(
            identity: identity,
            photoAlt: alt,
            gauges: gauges(state: state, prefs: prefs, copy: copy),
            stats: stats(state: state, prefs: prefs, copy: copy),
            hasLiveState: true
        )
    }

    /// Builds one gauge, pre-formatting its display value via the gauge rule (integer → no fraction).
    private static func gauge(
        _ kind: VehicleHeroCardGauge.Kind,
        _ value: Double,
        _ max: Double,
        _ unit: String,
        _ label: String
    ) -> VehicleHeroCardGauge {
        VehicleHeroCardGauge(
            kind: kind,
            value: value,
            max: max,
            unit: unit,
            valueText: VehicleHeroCardFormat.gaugeValue(value),
            label: label
        )
    }
}
