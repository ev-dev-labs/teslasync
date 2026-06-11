//
//  ClimatePanel.Projection.swift
//  TeslaSync — P4 feature view · 0278 · ClimatePanel (Apple)
//
//  The pure render-branch projection (no SwiftUI, no networking) for the ClimatePanel surface —
//  the native port of the web `ClimatePanel.tsx` JSX. Maps a cached `CabinClimatePanelSnapshot`
//  (plus the user's `useUnits()` preference) into the localized `CabinClimatePanelContentModel`:
//  the Cabin / Outside temperature cards, the Driver / Passenger setpoint rows, the HVAC-state
//  row, the six-bar fan meter, and the Defrost / Climate / Precondition badges. Each web
//  conditional render branch is reproduced here over value types so it can be unit tested without
//  a store, a bundle, or a rendered view.
//

import Foundation

// MARK: - Projection (web render branches → the content model)

/// Projects the cached snapshot into the localized content model, reproducing every web render
/// branch. `localize` is the P1/S10 `t(key, fallback)` facade; passing an echo (returns the
/// fallback) yields the web English copy. `prefs` carries the temperature display unit + locale
/// resolved from `useUnits()`.
public enum CabinClimatePanelProjection {
    public static func content(
        snapshot: CabinClimatePanelSnapshot?,
        prefs: CabinClimatePanelUnitPrefs,
        localize: (String, String) -> String
    ) -> CabinClimatePanelContentModel {
        CabinClimatePanelContentModel(
            cabin: temperatureCard(
                id: "cabin",
                celsius: snapshot?.insideTempC,
                label: localize("common.insideTemp", "Cabin"),
                prefs: prefs
            ),
            outside: temperatureCard(
                id: "outside",
                celsius: snapshot?.outsideTempC,
                label: localize("common.outsideTemp", "Outside"),
                prefs: prefs
            ),
            driverSetpoint: temperatureRow(
                id: "driverSetpoint",
                celsius: snapshot?.driverSetpointC,
                label: localize("telemetry.driverSetpoint", "Driver Setpoint"),
                prefs: prefs
            ),
            passengerSetpoint: temperatureRow(
                id: "passengerSetpoint",
                celsius: snapshot?.passengerSetpointC,
                label: localize("telemetry.passengerSetpoint", "Passenger Setpoint"),
                prefs: prefs
            ),
            hvacState: hvacStateRow(snapshot?.hvacState, localize),
            fan: fanModel(snapshot?.fanStatus, localize),
            badges: badges(snapshot, localize)
        )
    }

    // MARK: Temperature card + setpoint row (web `formatTemperature(...)`)

    private static func temperatureCard(
        id: String,
        celsius: Double?,
        label: String,
        prefs: CabinClimatePanelUnitPrefs
    ) -> CabinClimatePanelMetricModel {
        let value = formattedTemperature(celsius, prefs)
        return CabinClimatePanelMetricModel(
            id: id,
            label: label,
            value: value,
            accessibilityLabel: "\(label): \(value)"
        )
    }

    private static func temperatureRow(
        id: String,
        celsius: Double?,
        label: String,
        prefs: CabinClimatePanelUnitPrefs
    ) -> CabinClimatePanelRowModel {
        let value = formattedTemperature(celsius, prefs)
        return CabinClimatePanelRowModel(
            id: id,
            label: label,
            value: value,
            accessibilityLabel: "\(label): \(value)"
        )
    }

    private static func formattedTemperature(
        _ celsius: Double?,
        _ prefs: CabinClimatePanelUnitPrefs
    ) -> String {
        CabinClimatePanelMath.temperatureInline(
            celsius,
            unit: prefs.temperature,
            precision: prefs.precision,
            localeIdentifier: prefs.localeIdentifier
        )
    }

    // MARK: HVAC state (web `hvac_state ?? '—'`)

    /// Web `securityData.hvac_state ?? '—'` — nullish, so only a nil value falls back; a non-nil
    /// string (even empty) is shown verbatim.
    private static func hvacStateRow(
        _ state: String?,
        _ localize: (String, String) -> String
    ) -> CabinClimatePanelRowModel {
        let label = localize("telemetry.hvacState", "HVAC State")
        let value = state ?? CabinClimatePanelFormat.dash
        return CabinClimatePanelRowModel(
            id: "hvacState",
            label: label,
            value: value,
            accessibilityLabel: "\(label): \(value)"
        )
    }

    // MARK: Fan meter (web `fan_status ?? 0` + six bars)

    private static func fanModel(
        _ fanStatus: Int?,
        _ localize: (String, String) -> String
    ) -> CabinClimatePanelFanModel {
        let label = localize("telemetry.fanSpeed", "Fan Speed")
        let raw = fanStatus ?? 0
        let filled = min(max(raw, 0), CabinClimatePanelFanModel.barCount)
        let valueText = "\(raw)"
        return CabinClimatePanelFanModel(
            label: label,
            rawLevel: raw,
            valueText: valueText,
            filledBars: filled,
            accessibilityLabel: "\(label): \(valueText)"
        )
    }

    // MARK: System badges (web Defrost / Climate / Precondition)

    private static func badges(
        _ snapshot: CabinClimatePanelSnapshot?,
        _ localize: (String, String) -> String
    ) -> [CabinClimatePanelBadgeModel] {
        [
            defrostBadge(snapshot?.defrostMode, localize),
            climateBadge(snapshot?.isClimateOn, localize),
            preconditionBadge(snapshot?.isPreconditioning, localize)
        ]
    }

    /// Web defrost badge: active when `defrost_mode && defrost_mode !== 'Off'`. The trailing word
    /// is the mode itself when active, else the localized "Off". Active is the info (blue) accent.
    private static func defrostBadge(
        _ mode: String?,
        _ localize: (String, String) -> String
    ) -> CabinClimatePanelBadgeModel {
        let label = localize("telemetry.defrost", "Defrost")
        let active = isDefrostActive(mode)
        let trailing = active ? (mode ?? "") : localize("common.off", "Off")
        let text = "\(label) \(trailing)"
        return CabinClimatePanelBadgeModel(
            id: "defrost",
            text: text,
            active: active,
            tone: active ? .info : .neutral,
            systemImage: "snowflake",
            accessibilityLabel: text
        )
    }

    /// Web climate badge: active when `is_climate_on`. Trailing word is On / Off. Active is the
    /// success (green) accent.
    private static func climateBadge(
        _ on: Bool?,
        _ localize: (String, String) -> String
    ) -> CabinClimatePanelBadgeModel {
        let label = localize("telemetry.climate", "Climate")
        let active = on ?? false
        let trailing = active ? localize("common.on", "On") : localize("common.off", "Off")
        let text = "\(label) \(trailing)"
        return CabinClimatePanelBadgeModel(
            id: "climate",
            text: text,
            active: active,
            tone: active ? .success : .neutral,
            systemImage: "bolt.fill",
            accessibilityLabel: text
        )
    }

    /// Web precondition badge: active when `is_preconditioning`. Trailing word is On / Off. Active
    /// is the warning (amber) accent. The web pill has no leading icon.
    private static func preconditionBadge(
        _ on: Bool?,
        _ localize: (String, String) -> String
    ) -> CabinClimatePanelBadgeModel {
        let label = localize("telemetry.precondition", "Precondition")
        let active = on ?? false
        let trailing = active ? localize("common.on", "On") : localize("common.off", "Off")
        let text = "\(label) \(trailing)"
        return CabinClimatePanelBadgeModel(
            id: "precondition",
            text: text,
            active: active,
            tone: active ? .warning : .neutral,
            systemImage: nil,
            accessibilityLabel: text
        )
    }

    /// Web `climateData.defrost_mode && climateData.defrost_mode !== 'Off'`: truthiness on the
    /// string (a nil or empty mode is inactive) AND not the literal "Off".
    static func isDefrostActive(_ mode: String?) -> Bool {
        guard let mode, !mode.isEmpty else { return false }
        return mode != CabinClimatePanelFormat.defrostOff
    }
}
