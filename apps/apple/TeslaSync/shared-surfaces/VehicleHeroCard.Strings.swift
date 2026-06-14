//
//  VehicleHeroCard.Strings.swift
//  TeslaSync — P4 shared surface · 0233 · VehicleHeroCard (Apple)
//
//  The i18n facade (P1/S10) for the vehicle hero card — the native peer of the `t()` keys used by
//  `web/src/components/vehicles/VehicleHeroCard.tsx`. The web source's keys are mirrored VERBATIM (same key,
//  same English fallback) so the native surface resolves the identical catalog entries; the remaining entries
//  are the native chrome / a11y additions the P4 always-render leaf states (loading / empty / error /
//  no-live-data) and the freshness axis (live / stale / offline) need — the web renders nothing for those,
//  whereas the native HIG calls for a labelled state rather than a blank box. Keys live in the
//  "VehicleHeroCard" table, folded into the app `Localizable.xcstrings` at integration time; in test /
//  preview bundles `NSLocalizedString` returns the `value:` fallback, keeping the labels deterministic.
//

import Foundation

public enum VehicleHeroCardStrings {
    public static let table = "VehicleHeroCard"

    /// The default resolver — the bundle-backed `t(key, default)` with the web English fallback.
    public static let string: VehicleHeroCardResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    // MARK: Web source keys (verbatim) — gauges

    public static var gaugeBattery: String {
        string("vehicleHero.gauge.battery", "Battery")
    }

    public static var gaugeRange: String {
        string("vehicleHero.gauge.range", "Range")
    }

    public static var gaugeInside: String {
        string("vehicleHero.gauge.inside", "Inside")
    }

    public static var gaugeOutside: String {
        string("vehicleHero.gauge.outside", "Outside")
    }

    // MARK: Web source keys (verbatim) — stat cards

    public static var statInsideTemp: String {
        string("vehicleHero.stat.insideTemp", "Inside Temp")
    }

    public static var statOutsideTemp: String {
        string("vehicleHero.stat.outsideTemp", "Outside Temp")
    }

    public static var statOdometer: String {
        string("vehicleHero.stat.odometer", "Odometer")
    }

    public static var statRange: String {
        string("vehicleHero.stat.range", "Range")
    }

    public static var statStatus: String {
        string("vehicleHero.stat.status", "Status")
    }

    public static var statSentry: String {
        string("vehicleHero.stat.sentry", "Sentry")
    }

    public static var statFirmware: String {
        string("vehicleHero.stat.firmware", "Firmware")
    }

    public static var statPower: String {
        string("vehicleHero.stat.power", "Power")
    }

    public static var locked: String {
        string("vehicleHero.locked", "Locked")
    }

    public static var unlocked: String {
        string("vehicleHero.unlocked", "Unlocked")
    }

    public static var on: String {
        string("common.on", "On")
    }

    public static var off: String {
        string("common.off", "Off")
    }

    // MARK: Web source keys (verbatim) — actions

    public static var actionDetails: String {
        string("vehicleHero.action.details", "Details")
    }

    public static var actionCommands: String {
        string("vehicleHero.action.commands", "Commands")
    }

    public static var actionLiveMap: String {
        string("vehicleHero.action.liveMap", "Live Map")
    }

    /// Web `t('vehicleHero.photo.alt', '{{name}} photo', { name })` — interpolates the display name.
    public static func photoAlt(_ name: String) -> String {
        interpolate(string("vehicleHero.photo.alt", "{{name}} photo"), name: name)
    }

    // MARK: Native chrome / a11y additions (no blank box — see the leaf states)

    public static var loadingA11y: String {
        string("vehicleHero.loadingA11y", "Loading vehicle")
    }

    public static var emptyTitle: String {
        string("vehicleHero.empty.title", "No vehicle")
    }

    public static var emptyMessage: String {
        string("vehicleHero.empty.message", "Select a vehicle to see its live status.")
    }

    public static var errorTitle: String {
        string("vehicleHero.errorTitle", "Couldn't load vehicle")
    }

    public static var retry: String {
        string("vehicleHero.retry", "Retry")
    }

    public static var noLiveDataTitle: String {
        string("vehicleHero.noLiveData.title", "No live data")
    }

    public static var noLiveDataMessage: String {
        string("vehicleHero.noLiveData.message", "This vehicle hasn't reported live telemetry yet.")
    }

    public static var live: String {
        string("vehicleHero.live", "Live")
    }

    public static var stale: String {
        string("vehicleHero.stale", "Stale")
    }

    public static var offline: String {
        string("vehicleHero.offline", "Offline")
    }

    public static var staleA11y: String {
        string("vehicleHero.staleA11y", "Stale — tap to refresh")
    }

    public static var offlineA11y: String {
        string("vehicleHero.offlineA11y", "Offline — showing the last value")
    }

    public static var staleBanner: String {
        string("vehicleHero.staleBanner", "Showing data that may be out of date.")
    }

    public static var offlineBanner: String {
        string("vehicleHero.offlineBanner", "You're offline. Showing the last known values.")
    }

    public static var refresh: String {
        string("vehicleHero.refresh", "Refresh")
    }

    public static var vinLabel: String {
        string("vehicleHero.vinA11y", "VIN")
    }

    public static var statusLabel: String {
        string("vehicleHero.statusA11y", "Status")
    }

    /// VoiceOver value for a gauge — "{label}: {value}{unit}" (e.g. "Battery: 72%").
    public static func gaugeA11y(label: String, value: String, unit: String) -> String {
        "\(label): \(value)\(unit)"
    }

    // MARK: Copy builder (the labels the projector needs)

    /// Builds the localized copy the pure projector consumes from any resolver — the production app passes
    /// the bundle-backed ``string``; tests pass an identity-fallback resolver so the projection stays
    /// deterministic.
    public static func makeCopy(_ localize: @escaping VehicleHeroCardResolve = string) -> VehicleHeroCardCopy {
        VehicleHeroCardCopy(
            gaugeBattery: localize("vehicleHero.gauge.battery", "Battery"),
            gaugeRange: localize("vehicleHero.gauge.range", "Range"),
            gaugeInside: localize("vehicleHero.gauge.inside", "Inside"),
            gaugeOutside: localize("vehicleHero.gauge.outside", "Outside"),
            statInsideTemp: localize("vehicleHero.stat.insideTemp", "Inside Temp"),
            statOutsideTemp: localize("vehicleHero.stat.outsideTemp", "Outside Temp"),
            statOdometer: localize("vehicleHero.stat.odometer", "Odometer"),
            statRange: localize("vehicleHero.stat.range", "Range"),
            statStatus: localize("vehicleHero.stat.status", "Status"),
            statSentry: localize("vehicleHero.stat.sentry", "Sentry"),
            statFirmware: localize("vehicleHero.stat.firmware", "Firmware"),
            statPower: localize("vehicleHero.stat.power", "Power"),
            locked: localize("vehicleHero.locked", "Locked"),
            unlocked: localize("vehicleHero.unlocked", "Unlocked"),
            on: localize("common.on", "On"),
            off: localize("common.off", "Off"),
            photoAlt: { name in interpolate(localize("vehicleHero.photo.alt", "{{name}} photo"), name: name) }
        )
    }

    /// Substitutes the `{{name}}` token (web i18next interpolation).
    private static func interpolate(_ template: String, name: String) -> String {
        template.replacingOccurrences(of: "{{name}}", with: name)
    }
}
