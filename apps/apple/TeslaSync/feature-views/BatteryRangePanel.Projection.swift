//
//  BatteryRangePanel.Projection.swift
//  TeslaSync — P4 feature view · 0289 · BatteryRangePanel (Apple)
//
//  The pure render-branch projection (no SwiftUI, no networking) for the BatteryRangePanel surface —
//  the native port of the web `BatteryRangePanel.tsx` JSX. Maps a cached `BatteryRangePanelSnapshot`
//  (plus the user's `useUnits()` preference) into the localized `BatteryRangePanelContentModel`: the
//  radial battery gauge (web `RadialGauge`) and the three metric cards — Rated Range, Ideal Range,
//  and Charging (the `is_charging ? "{rate}/h" : "Not Charging"` value and the
//  `is_charging && time_to_full_charge > 0` "Full in {h}h" subtitle). Each web conditional render
//  branch is reproduced here over value types so it can be unit tested without a store or a view.
//

import Foundation

// MARK: - Projection (web render branches → the content model)

/// Projects the cached snapshot into the localized content model, reproducing every web render
/// branch. `localize` is the P1/S10 `t(key, fallback)` facade; passing an echo (returns the
/// fallback) yields the web English copy. `prefs` carries the distance unit + locale + precision
/// resolved from `useUnits()`.
public enum BatteryRangePanelProjection {
    public static func content(
        snapshot: BatteryRangePanelSnapshot?,
        prefs: BatteryRangePanelUnitPrefs,
        localize: (String, String) -> String
    ) -> BatteryRangePanelContentModel {
        BatteryRangePanelContentModel(
            gauge: gauge(snapshot, prefs, localize),
            metrics: [
                ratedRange(snapshot, prefs, localize),
                idealRange(snapshot, prefs, localize),
                charging(snapshot, prefs, localize)
            ]
        )
    }

    // MARK: Radial gauge (web `RadialGauge value={battery_level} max={100} unit="%"`)

    /// The battery gauge. The level is clamped to 0...100 for the ring fill (web `Math.max(0,
    /// Math.min(value, max))`); the numeric label uses 0 fraction digits for an integer level and the
    /// preference / global precision otherwise (web `decimals ?? (isInteger ? 0 : getGlobalPrecision())`).
    /// An absent level reads as the em-dash with an empty ring.
    private static func gauge(
        _ snapshot: BatteryRangePanelSnapshot?,
        _ prefs: BatteryRangePanelUnitPrefs,
        _ localize: (String, String) -> String
    ) -> BatteryRangePanelGaugeModel {
        let label = localize("common.battery", "Battery")
        let level = snapshot?.batteryLevel
        let clamped = level.flatMap { $0.isFinite ? min(max($0, 0), 100) : nil }
        let hasValue = clamped != nil
        let fraction = (clamped ?? 0) / 100
        let valueText = gaugeValueText(clamped, prefs)
        let unit = BatteryRangePanelFormat.percent
        let spokenValue = hasValue ? "\(valueText)\(unit)" : valueText
        return BatteryRangePanelGaugeModel(
            label: label,
            valueText: valueText,
            unit: unit,
            fraction: fraction,
            hasValue: hasValue,
            band: BatteryRangePanelMath.band(for: level),
            accessibilityLabel: "\(label): \(spokenValue)"
        )
    }

    private static func gaugeValueText(_ clamped: Double?, _ prefs: BatteryRangePanelUnitPrefs) -> String {
        guard let clamped else { return BatteryRangePanelMath.emDash }
        let isInteger = clamped == clamped.rounded()
        let decimals = isInteger ? 0 : (prefs.precision ?? BatteryRangePanelMath.defaultGaugePrecision)
        return BatteryRangePanelMath.number(clamped, decimals: decimals, localeIdentifier: prefs.localeIdentifier)
    }

    // MARK: Rated Range (web `formatDistance(rated_range, { precision: 0 })`, cyan)

    private static func ratedRange(
        _ snapshot: BatteryRangePanelSnapshot?,
        _ prefs: BatteryRangePanelUnitPrefs,
        _ localize: (String, String) -> String
    ) -> BatteryRangePanelMetricModel {
        let label = localize("vehicles.detail.ratedRange", "Rated Range")
        let value = BatteryRangePanelMath.distance(
            snapshot?.ratedRangeMeters,
            unit: prefs.distance,
            precisionOverride: 0,
            preferencePrecision: prefs.precision,
            localeIdentifier: prefs.localeIdentifier
        )
        return BatteryRangePanelMetricModel(
            id: "ratedRange",
            label: label,
            value: value,
            subtitle: nil,
            tone: .accent,
            systemImage: "location.north.fill",
            accessibilityLabel: "\(label): \(value)"
        )
    }

    // MARK: Ideal Range (web `formatDistance(ideal_range, { precision: 0 })`, green)

    private static func idealRange(
        _ snapshot: BatteryRangePanelSnapshot?,
        _ prefs: BatteryRangePanelUnitPrefs,
        _ localize: (String, String) -> String
    ) -> BatteryRangePanelMetricModel {
        let label = localize("vehicles.detail.idealRange", "Ideal Range")
        let value = BatteryRangePanelMath.distance(
            snapshot?.idealRangeMeters,
            unit: prefs.distance,
            precisionOverride: 0,
            preferencePrecision: prefs.precision,
            localeIdentifier: prefs.localeIdentifier
        )
        return BatteryRangePanelMetricModel(
            id: "idealRange",
            label: label,
            value: value,
            subtitle: nil,
            tone: .success,
            systemImage: "mappin.and.ellipse",
            accessibilityLabel: "\(label): \(value)"
        )
    }

    // MARK: Charging (web `is_charging ? "{rate}/h" : "Not Charging"` + "Full in {h}h" subtitle)

    /// The charging card. While charging the value is the charge rate (`formatDistance(charge_rate)`
    /// at the default distance precision) with the `/h` suffix; otherwise the localized "Not
    /// Charging". The card tints green while charging, cyan otherwise. The subtitle appears only when
    /// charging AND `time_to_full_charge > 0` (web guard), reading "Full in {h}h".
    private static func charging(
        _ snapshot: BatteryRangePanelSnapshot?,
        _ prefs: BatteryRangePanelUnitPrefs,
        _ localize: (String, String) -> String
    ) -> BatteryRangePanelMetricModel {
        let label = localize("common.charging", "Charging")
        let isCharging = snapshot?.isCharging ?? false
        let value = chargingValue(snapshot, prefs, localize, isCharging: isCharging)
        let subtitle = chargingSubtitle(snapshot, prefs, localize, isCharging: isCharging)
        let spoken = subtitle.map { "\(label): \(value). \($0)" } ?? "\(label): \(value)"
        return BatteryRangePanelMetricModel(
            id: "charging",
            label: label,
            value: value,
            subtitle: subtitle,
            tone: isCharging ? .success : .accent,
            systemImage: "bolt.batteryblock.fill",
            accessibilityLabel: spoken
        )
    }

    private static func chargingValue(
        _ snapshot: BatteryRangePanelSnapshot?,
        _ prefs: BatteryRangePanelUnitPrefs,
        _ localize: (String, String) -> String,
        isCharging: Bool
    ) -> String {
        guard isCharging else { return localize("common.notCharging", "Not Charging") }
        let rate = BatteryRangePanelMath.distance(
            snapshot?.chargeRateMeters,
            unit: prefs.distance,
            precisionOverride: nil,
            preferencePrecision: prefs.precision,
            localeIdentifier: prefs.localeIdentifier
        )
        return "\(rate)\(BatteryRangePanelFormat.perHourSuffix)"
    }

    private static func chargingSubtitle(
        _ snapshot: BatteryRangePanelSnapshot?,
        _ prefs: BatteryRangePanelUnitPrefs,
        _ localize: (String, String) -> String,
        isCharging: Bool
    ) -> String? {
        let hours = snapshot?.timeToFullChargeHours ?? 0
        guard isCharging, hours > 0 else { return nil }
        let prefix = localize("vehicles.detail.fullIn", "Full in")
        let number = BatteryRangePanelMath.number(hours, decimals: 1, localeIdentifier: prefs.localeIdentifier)
        return "\(prefix) \(number)\(BatteryRangePanelFormat.hourSuffix)"
    }
}
