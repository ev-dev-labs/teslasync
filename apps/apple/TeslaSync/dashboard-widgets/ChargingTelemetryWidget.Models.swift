//
//  ChargingTelemetryWidget.Models.swift
//  TeslaSync — P4 dashboard widget · 0025 · ChargingTelemetryWidget (Apple)
//
//  Domain value types for the charging-telemetry surface — the cached
//  `/charging-telemetry/latest` snapshot the P1/S8 source decodes and the
//  derived projection (voltage / current / power / phases / charger type /
//  efficiency) ported from features/dashboard/widgets/ChargingTelemetryWidget.tsx.
//  No SwiftUI or transport here so the shapes stay unit-testable.
//

import Foundation

// MARK: - Charger type (web `chargerType` heuristic)

/// The charger family derived from the live voltage: DC fast-charging above the
/// `ChargingTelemetryBuilder.dcVoltageThreshold`, otherwise AC (web `voltage > 300
/// ? 'DC' : 'AC'`). `nil` when the vehicle is not charging.
public enum ChargingTelemetryChargerType: String, Sendable, Equatable {
    case ac
    case dc
}

// MARK: - Stat identity (web `coreStats` / `wideStats` items)

/// The five metrics the stat grid can show, in the web's render order. The
/// label, unit and icon are resolved at render time from the kind, keeping the
/// projection free of view + i18n concerns.
public enum ChargingTelemetryStatKind: String, Sendable, CaseIterable {
    case voltage
    case current
    case power
    case phases
    case efficiency
}

// MARK: - Cached DTO input (the shape the P1/S8 source decodes for the view)

/// Value-typed projection of a `/charging-telemetry/latest` row (web
/// `useChargingTelemetryLatest`). Electrical fields are SI on the wire and model
/// the web `?? 0` fallbacks with optionals. `timestamp` is the `ts` the rolling
/// power history is keyed by (web `data.ts`).
public struct ChargingTelemetrySnapshot: Sendable, Equatable {
    /// The `charging_state` value that means "actively charging" (web
    /// `charging_state === 'Charging'`). An upstream API enum value, not UI copy.
    public static let chargingStateActive = "Charging"

    public var timestamp: String?
    public var chargingState: String?
    public var chargerVoltage: Double?
    public var chargerActualCurrent: Double?
    public var chargerPowerW: Double?
    public var chargerPhases: Double?
    public var chargerPilotCurrent: Double?

    public init(
        timestamp: String? = nil,
        chargingState: String? = nil,
        chargerVoltage: Double? = nil,
        chargerActualCurrent: Double? = nil,
        chargerPowerW: Double? = nil,
        chargerPhases: Double? = nil,
        chargerPilotCurrent: Double? = nil
    ) {
        self.timestamp = timestamp
        self.chargingState = chargingState
        self.chargerVoltage = chargerVoltage
        self.chargerActualCurrent = chargerActualCurrent
        self.chargerPowerW = chargerPowerW
        self.chargerPhases = chargerPhases
        self.chargerPilotCurrent = chargerPilotCurrent
    }

    /// Whether the vehicle is actively charging (web `isCharging`).
    public var isCharging: Bool {
        chargingState == Self.chargingStateActive
    }
}

// MARK: - Derived projection (port of the web memoized derivations)

/// The fully-resolved metrics the surface renders (web `voltage` / `current` /
/// `power` / `phases` + the `chargerType` and `efficiency` memos). `isCharging`
/// gates the stat grid versus the "Not currently charging" empty state.
public struct ChargingTelemetryProjection: Sendable, Equatable {
    public var isCharging: Bool
    public var voltage: Double
    public var current: Double
    public var power: Double
    public var phases: Double
    public var chargerType: ChargingTelemetryChargerType?
    public var efficiencyPercent: Double?

    public init(
        isCharging: Bool = false,
        voltage: Double = 0,
        current: Double = 0,
        power: Double = 0,
        phases: Double = 0,
        chargerType: ChargingTelemetryChargerType? = nil,
        efficiencyPercent: Double? = nil
    ) {
        self.isCharging = isCharging
        self.voltage = voltage
        self.current = current
        self.power = power
        self.phases = phases
        self.chargerType = chargerType
        self.efficiencyPercent = efficiencyPercent
    }

    /// Not-charging projection — the web state where `coreStats` is empty and the
    /// shell shows the "Not currently charging" empty state.
    public static let empty = ChargingTelemetryProjection()

    /// The stat kinds shown for the current size (web `coreStats` always, plus
    /// `wideStats` — efficiency — only when wide and resolvable). Empty when not
    /// charging, reproducing the web `if (!isCharging) return []`.
    public func statKinds(wide: Bool) -> [ChargingTelemetryStatKind] {
        guard isCharging else { return [] }
        var kinds: [ChargingTelemetryStatKind] = [.voltage, .current, .power, .phases]
        if wide, efficiencyPercent != nil {
            kinds.append(.efficiency)
        }
        return kinds
    }

    /// The formatted, locale-aware display value for a stat (web `fmtNumber` /
    /// `fmtInt`). Phases fall back to an em dash when zero (web
    /// `phases > 0 ? fmtInt(phases) : '—'`).
    public func formattedValue(
        for kind: ChargingTelemetryStatKind,
        locale: Locale = .autoupdatingCurrent
    ) -> String {
        switch kind {
        case .voltage:
            ChargingTelemetryFormat.number(voltage, fractionDigits: 0, locale: locale)
        case .current:
            ChargingTelemetryFormat.number(current, fractionDigits: 0, locale: locale)
        case .power:
            ChargingTelemetryFormat.number(power, fractionDigits: 1, locale: locale)
        case .phases:
            phases > 0
                ? ChargingTelemetryFormat.number(phases, fractionDigits: 0, locale: locale)
                : ChargingTelemetryFormat.noValue
        case .efficiency:
            ChargingTelemetryFormat.number(efficiencyPercent ?? 0, fractionDigits: 0, locale: locale)
        }
    }
}
