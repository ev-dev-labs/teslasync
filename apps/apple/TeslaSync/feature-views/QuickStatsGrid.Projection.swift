//
//  QuickStatsGrid.Projection.swift
//  TeslaSync — P4 feature view · 0295 · QuickStatsGrid (Apple)
//
//  The pure tile projection for the vehicle-detail quick-stats grid — the native port of
//  the web component's JSX (the eight `MetricCard`s, in source order) built from a vehicle
//  state + status + the active unit preferences. Split out of the adapter to keep each file
//  focused; it depends only on `QuickStatsFormat` (the SI / number ports) and
//  `UnitPreferences`, so the tile values, the accent colours, and the speed subtitle stay
//  unit tested without a store, a bundle, or a rendered view.
//

import Foundation

// MARK: - Tile accent (web `MetricCard` `color` — NeonColor subset the grid uses)

/// The three accent colours the grid's `MetricCard`s use (web `cyan` / `green` /
/// `purple`). The view maps each case to the matching design token (cyan → accent,
/// green → success, purple → power-series) so no colour literal lives in this core.
public enum QuickStatAccent: String, Equatable, Sendable {
    case cyan
    case green
    case purple
}

// MARK: - Tile model (one web `MetricCard`)

/// One resolved metric tile — the native mirror of a web `<MetricCard>`. The label and
/// optional subtitle are carried as i18n key + English fallback (resolved in the view);
/// the value is pre-formatted so the view is a pure function of this model.
public struct QuickStatTileModel: Identifiable, Equatable, Sendable {
    public let id: String
    public let labelKey: String
    public let labelFallback: String
    public let value: String
    public let subtitleKey: String?
    public let subtitleFallback: String?
    public let iconSystemName: String
    public let accent: QuickStatAccent

    public init(
        id: String,
        labelKey: String,
        labelFallback: String,
        value: String,
        subtitleKey: String? = nil,
        subtitleFallback: String? = nil,
        iconSystemName: String,
        accent: QuickStatAccent
    ) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.value = value
        self.subtitleKey = subtitleKey
        self.subtitleFallback = subtitleFallback
        self.iconSystemName = iconSystemName
        self.accent = accent
    }
}

// MARK: - Tile projection (web render of the eight `MetricCard`s)

/// Builds the eight quick-stats tiles from a vehicle state + status + the active unit
/// preferences — the native port of the web component's JSX, in source order. Pure +
/// public so the tile values, colours, and subtitle are unit tested without a view.
public enum QuickStatsTiles {
    /// Web order: Battery, Range, Odometer, Speed, Inside Temp, Outside Temp, Power, State.
    public static func tiles(
        for state: QuickStatsVehicleState,
        status: String?,
        units: UnitPreferences
    ) -> [QuickStatTileModel] {
        let locale = locale(for: units)
        return [
            battery(state, locale: locale),
            range(state, units: units, locale: locale),
            odometer(state, units: units, locale: locale),
            speed(state, units: units, locale: locale),
            insideTemp(state, units: units, locale: locale),
            outsideTemp(state, units: units, locale: locale),
            power(state, units: units, locale: locale),
            self.status(status)
        ]
    }

    private static func locale(for units: UnitPreferences) -> Locale {
        guard let tag = units.locale, !tag.isEmpty else { return .current }
        return Locale(identifier: tag)
    }

    private static func battery(_ state: QuickStatsVehicleState, locale _: Locale) -> QuickStatTileModel {
        // Web: `battery_level > 50 ? 'green' : battery_level > 20 ? 'cyan' : 'cyan'`.
        let accent: QuickStatAccent = state.batteryLevel > 50 ? .green : .cyan
        return QuickStatTileModel(
            id: "battery",
            labelKey: "common.battery",
            labelFallback: "Battery",
            value: QuickStatsFormat.batteryPercent(state.batteryLevel),
            iconSystemName: "battery.100",
            accent: accent
        )
    }

    private static func range(
        _ state: QuickStatsVehicleState,
        units: UnitPreferences,
        locale: Locale
    ) -> QuickStatTileModel {
        QuickStatTileModel(
            id: "range",
            labelKey: "common.range",
            labelFallback: "Range",
            value: QuickStatsFormat.formatDistance(
                state.ratedRange,
                unit: units.distance,
                precisionOverride: 0,
                preferencePrecision: units.precision,
                locale: locale
            ),
            iconSystemName: "location.north.fill",
            accent: .cyan
        )
    }

    private static func odometer(
        _ state: QuickStatsVehicleState,
        units: UnitPreferences,
        locale: Locale
    ) -> QuickStatTileModel {
        QuickStatTileModel(
            id: "odometer",
            labelKey: "common.odometer",
            labelFallback: "Odometer",
            value: QuickStatsFormat.formatDistance(
                state.odometer,
                unit: units.distance,
                precisionOverride: 0,
                preferencePrecision: units.precision,
                locale: locale
            ),
            iconSystemName: "car.fill",
            accent: .purple
        )
    }

    private static func speed(
        _ state: QuickStatsVehicleState,
        units: UnitPreferences,
        locale: Locale
    ) -> QuickStatTileModel {
        // Web subtitle: `speed > 0 ? t('common.driving') : t('common.parked')`.
        let driving = state.speed > 0
        return QuickStatTileModel(
            id: "speed",
            labelKey: "common.speed",
            labelFallback: "Speed",
            value: QuickStatsFormat.formatSpeed(
                state.speed,
                unit: units.speed,
                precisionOverride: 0,
                preferencePrecision: units.precision,
                locale: locale
            ),
            subtitleKey: driving ? "common.driving" : "common.parked",
            subtitleFallback: driving ? "Driving" : "Parked",
            iconSystemName: "speedometer",
            accent: .cyan
        )
    }

    private static func insideTemp(
        _ state: QuickStatsVehicleState,
        units: UnitPreferences,
        locale: Locale
    ) -> QuickStatTileModel {
        QuickStatTileModel(
            id: "insideTemp",
            labelKey: "common.insideTemp",
            labelFallback: "Inside Temp",
            value: QuickStatsFormat.formatTemperature(
                state.insideTemp,
                unit: units.temperature,
                preferencePrecision: units.precision,
                locale: locale
            ),
            iconSystemName: "thermometer.medium",
            accent: .green
        )
    }

    private static func outsideTemp(
        _ state: QuickStatsVehicleState,
        units: UnitPreferences,
        locale: Locale
    ) -> QuickStatTileModel {
        QuickStatTileModel(
            id: "outsideTemp",
            labelKey: "common.outsideTemp",
            labelFallback: "Outside Temp",
            value: QuickStatsFormat.formatTemperature(
                state.outsideTemp,
                unit: units.temperature,
                preferencePrecision: units.precision,
                locale: locale
            ),
            iconSystemName: "thermometer.medium",
            accent: .cyan
        )
    }

    private static func power(
        _ state: QuickStatsVehicleState,
        units: UnitPreferences,
        locale: Locale
    ) -> QuickStatTileModel {
        // Web: `${fmtNumber(power)} kW` — NOT routed through the unit facade.
        let number = QuickStatsFormat.fmtNumber(state.power, decimals: units.precision, locale: locale)
        return QuickStatTileModel(
            id: "power",
            labelKey: "common.power",
            labelFallback: "Power",
            value: "\(number) kW",
            iconSystemName: "bolt.fill",
            accent: .purple
        )
    }

    private static func status(_ status: String?) -> QuickStatTileModel {
        // Web renders the raw `status` string verbatim (no `t()` wrap).
        let value = status.flatMap { $0.isEmpty ? nil : $0 } ?? QuickStatsFormat.dash
        return QuickStatTileModel(
            id: "state",
            labelKey: "common.state",
            labelFallback: "State",
            value: value,
            iconSystemName: "waveform.path.ecg",
            accent: .cyan
        )
    }
}
