//
//  EnergyFlowWidget.Models.swift
//  TeslaSync — P4 dashboard widget · 0046 · EnergyFlowWidget (Apple)
//
//  Domain value types for the energy-flow surface — the cached vehicle-state DTO
//  the P1/S8 source decodes plus the flow-diagram projection (nodes + directional
//  arrows) ported from features/dashboard/widgets/EnergyFlowWidget.tsx and
//  shared/WidgetFlowDiagram.tsx. Foundation-only so the adapter stays pure +
//  headless-testable.
//

import Foundation

// MARK: - Cached DTO input (the shape the P1/S8 source decodes for the view)

/// Value-typed projection of the live `VehicleState` the web reads through
/// `useVehicleState` (`state.power`, `state.is_charging`, `state.charger_power`,
/// `state.battery_level`). Powers are kW as the web treats them (it formats
/// `power`/`charger_power` directly with `" kW"`, no /1000); `batteryLevel` is a
/// percentage. `nil` fields are not modeled — the source applies the web `?? 0`
/// /`?? false` fallbacks while decoding.
public struct EnergyFlowVehicleState: Sendable, Equatable {
    /// Instantaneous drive power in kW; signed (> 0 consuming, < 0 regenerating).
    public var powerKw: Double
    /// Whether the vehicle is actively charging (web `state.is_charging`).
    public var isCharging: Bool
    /// Charger input power in kW (web `state.charger_power`).
    public var chargerPowerKw: Double
    /// State of charge, 0…100 (web `state.battery_level`).
    public var batteryLevel: Double

    public init(
        powerKw: Double = 0,
        isCharging: Bool = false,
        chargerPowerKw: Double = 0,
        batteryLevel: Double = 0
    ) {
        self.powerKw = powerKw
        self.isCharging = isCharging
        self.chargerPowerKw = chargerPowerKw
        self.batteryLevel = batteryLevel
    }

    /// Drive direction derived from `powerKw` (web `isConsuming`/`isRegen`).
    public var isConsuming: Bool {
        powerKw > 0
    }

    public var isRegenerating: Bool {
        powerKw < 0
    }

    /// Drive-power magnitude in kW (web `absPower = Math.abs(power)`).
    public var absPowerKw: Double {
        abs(powerKw)
    }
}

// MARK: - Flow-diagram projection (port of shared/WidgetFlowDiagram.tsx)

/// The routing endpoints of the energy-flow diagram (web `FlowNode.id`). `charger`
/// only appears while charging.
public enum EnergyFlowNodeID: String, Sendable, CaseIterable {
    case battery
    case motor
    case charger
}

/// Anchor position of a node in the diagram's 100×100 space (web
/// `FlowNode.position` → `POSITION_COORDS`).
public enum EnergyFlowPosition: String, Sendable {
    case top
    case bottom
    case left
    case right
    case center

    /// Normalized anchor (`cx`, `cy`) in the 0…100 viewBox (web `POSITION_COORDS`).
    public var coord: (cx: Double, cy: Double) {
        switch self {
        case .top: (50, 12)
        case .bottom: (50, 88)
        case .left: (12, 50)
        case .right: (88, 50)
        case .center: (50, 50)
        }
    }
}

/// The localized label a node shows (web node `label`). The motor's label varies
/// with the drive state; modeling it as an enum keeps the builder pure (no i18n)
/// while the view resolves the catalog string at render.
public enum EnergyFlowLabel: String, Sendable, Equatable {
    case battery
    case consuming
    case regenerating
    case standby
    case charger
}

/// How a node's value is rendered semantically for accessibility (web
/// `formattedValue`): a percentage, a kW magnitude, or the standby dash.
public enum EnergyFlowValueUnit: Sendable, Equatable {
    case percent
    case kilowatts
    case standby
}

/// The semantic tint of a node or arrow (the web Tailwind colors). Resolved to a
/// `Color` by `EnergyFlowPalette`, kept out of the model so the builder stays
/// view-free + testable.
public enum EnergyFlowTint: String, Sendable, Equatable {
    case emerald
    case purple
    case amber
    case cyan
}

/// A routing endpoint with its current value (web `FlowNode`). `magnitude` is the
/// raw number shown in the node ring (web `AnimatedNumber value={node.value}`);
/// `unit` drives the accessibility-formatted value; `label`/`tint` resolve at
/// render time, keeping the model free of view + i18n concerns.
public struct EnergyFlowNode: Sendable, Equatable, Identifiable {
    public let id: EnergyFlowNodeID
    public var position: EnergyFlowPosition
    public var label: EnergyFlowLabel
    public var magnitude: Double
    public var unit: EnergyFlowValueUnit
    public var tint: EnergyFlowTint

    public init(
        id: EnergyFlowNodeID,
        position: EnergyFlowPosition,
        label: EnergyFlowLabel,
        magnitude: Double,
        unit: EnergyFlowValueUnit,
        tint: EnergyFlowTint
    ) {
        self.id = id
        self.position = position
        self.label = label
        self.magnitude = magnitude
        self.unit = unit
        self.tint = tint
    }
}

/// A directional power transfer between two nodes (web `FlowArrow`). `tint` is the
/// explicit color the web sets on every arrow; `active` drives the marching-dash
/// flow animation.
public struct EnergyFlowArrow: Sendable, Equatable, Identifiable {
    public let from: EnergyFlowNodeID
    public let to: EnergyFlowNodeID
    public var valueKw: Double
    public var active: Bool
    public var tint: EnergyFlowTint

    public var id: String {
        "\(from.rawValue)-\(to.rawValue)"
    }

    public init(
        from: EnergyFlowNodeID,
        to: EnergyFlowNodeID,
        valueKw: Double,
        active: Bool,
        tint: EnergyFlowTint
    ) {
        self.from = from
        self.to = to
        self.valueKw = valueKw
        self.active = active
        self.tint = tint
    }
}

/// The fully-resolved diagram (web memoized `nodes` + `arrows`). `hasState`
/// mirrors the web `state ? <diagram> : <EmptyState>` gate.
public struct EnergyFlowProjection: Sendable, Equatable {
    public var nodes: [EnergyFlowNode]
    public var arrows: [EnergyFlowArrow]
    public var hasState: Bool

    public init(nodes: [EnergyFlowNode] = [], arrows: [EnergyFlowArrow] = [], hasState: Bool = false) {
        self.nodes = nodes
        self.arrows = arrows
        self.hasState = hasState
    }

    /// Empty projection — no vehicle state resolved (web `state == null`).
    public static let empty = EnergyFlowProjection()

    /// Looks up a node by id (web `nodeMap.get`).
    public func node(_ id: EnergyFlowNodeID) -> EnergyFlowNode? {
        nodes.first { $0.id == id }
    }
}
