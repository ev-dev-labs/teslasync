//
//  EnergyFlowAnimatedWidget.Models.swift
//  TeslaSync — P4 dashboard widget · 0045 · EnergyFlowAnimatedWidget (Apple)
//
//  Domain value types for the animated energy-flow surface — the cached
//  vehicle-state DTO the P1/S8 source decodes, the flow-diagram projection
//  (nodes + directional arrows), and the 1-column compact summary, ported from
//  features/dashboard/widgets/EnergyFlowAnimatedWidget.tsx +
//  shared/WidgetFlowDiagram.tsx. Foundation-only so the adapter stays pure and
//  headless-testable.
//

import Foundation

// MARK: - Cached DTO input (the shape the P1/S8 source decodes for the view)

/// Value-typed projection of the live `VehicleState` the web reads through
/// `useVehicleState` (`state.power`, `state.is_charging`, `state.charger_power`,
/// `state.battery_level`). Powers are kW as the web treats them (it formats
/// `power`/`charger_power` directly with `" kW"`, no /1000); `batteryLevel` is a
/// percentage. `nil` fields are not modeled — the source applies the web `?? 0` /
/// `?? false` fallbacks while decoding.
public struct EnergyFlowAnimatedVehicleState: Sendable, Equatable {
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

    /// Drive direction derived from `powerKw`. Unlike the sibling EnergyFlow
    /// surface, the animated widget uses a ±0.5 kW dead-band (web `power > 0.5` /
    /// `power < -0.5`) so tiny idle power doesn't flicker the drive flow.
    public var isConsuming: Bool {
        powerKw > 0.5
    }

    public var isRegenerating: Bool {
        powerKw < -0.5
    }

    /// Drive-power magnitude in kW (web `absPower = Math.abs(power)`).
    public var absPowerKw: Double {
        abs(powerKw)
    }
}

// MARK: - Flow-diagram projection (port of shared/WidgetFlowDiagram.tsx)

/// The routing endpoints of the energy-flow diagram (web `FlowNode.id`). The
/// animated widget always renders all three (the charger is present even when
/// idle, dimmed to a dash), unlike the sibling surface.
public enum EnergyFlowAnimatedNodeID: String, Sendable, CaseIterable {
    case battery
    case drive
    case charger
}

/// Anchor position of a node in the diagram's 100×100 space (web
/// `FlowNode.position` → `POSITION_COORDS`).
public enum EnergyFlowAnimatedPosition: String, Sendable {
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

/// The localized label a node shows (web node `label`). The drive node's label
/// varies with the drive state; modeling it as an enum keeps the builder pure (no
/// i18n) while the view resolves the catalog string at render.
public enum EnergyFlowAnimatedLabel: String, Sendable, Equatable {
    case battery
    case drive
    case regen
    case idle
    case charger
}

/// How a node's value is rendered semantically for accessibility (web
/// `formattedValue`): a percentage, a kW magnitude at a node-specific precision,
/// or the standby dash. The drive node formats at one decimal; the charger at
/// zero (web `fmtNumber(chargerPower, 0)`); the battery is a whole percent.
public enum EnergyFlowAnimatedValueUnit: Sendable, Equatable {
    case percent
    case kilowatts(decimals: Int)
    case standby
}

/// The semantic tint of an arrow (the web Tailwind colors). Resolved to a `Color`
/// by `EnergyFlowAnimatedPalette`, kept out of the model so the builder stays
/// view-free + testable.
public enum EnergyFlowAnimatedTint: String, Sendable, Equatable {
    case cyan
    case emerald
    case amber
}

/// A routing endpoint with its current value (web `FlowNode`). `magnitude` is the
/// raw number shown in the node ring (web `AnimatedNumber value={node.value}`,
/// one decimal); `unit` drives the accessibility-formatted value; `label`
/// resolves at render time, keeping the model free of view + i18n concerns. The
/// animated widget's node glyphs are uncolored in the web source, so nodes carry
/// no tint (only arrows do).
public struct EnergyFlowAnimatedNode: Sendable, Equatable, Identifiable {
    public let id: EnergyFlowAnimatedNodeID
    public var position: EnergyFlowAnimatedPosition
    public var label: EnergyFlowAnimatedLabel
    public var magnitude: Double
    public var unit: EnergyFlowAnimatedValueUnit

    public init(
        id: EnergyFlowAnimatedNodeID,
        position: EnergyFlowAnimatedPosition,
        label: EnergyFlowAnimatedLabel,
        magnitude: Double,
        unit: EnergyFlowAnimatedValueUnit
    ) {
        self.id = id
        self.position = position
        self.label = label
        self.magnitude = magnitude
        self.unit = unit
    }
}

/// A directional power transfer between two nodes (web `FlowArrow`). `tint` is the
/// explicit color the web sets on every arrow; `active` drives the marching-dash
/// flow animation.
public struct EnergyFlowAnimatedArrow: Sendable, Equatable, Identifiable {
    public let from: EnergyFlowAnimatedNodeID
    public let to: EnergyFlowAnimatedNodeID
    public var valueKw: Double
    public var active: Bool
    public var tint: EnergyFlowAnimatedTint

    public var id: String {
        "\(from.rawValue)-\(to.rawValue)"
    }

    public init(
        from: EnergyFlowAnimatedNodeID,
        to: EnergyFlowAnimatedNodeID,
        valueKw: Double,
        active: Bool,
        tint: EnergyFlowAnimatedTint
    ) {
        self.from = from
        self.to = to
        self.valueKw = valueKw
        self.active = active
        self.tint = tint
    }
}

/// The fully-resolved diagram (web memoized `nodes` + `arrows`). `hasState`
/// mirrors the web `state ? <diagram/compact> : <EmptyState>` gate.
public struct EnergyFlowAnimatedProjection: Sendable, Equatable {
    public var nodes: [EnergyFlowAnimatedNode]
    public var arrows: [EnergyFlowAnimatedArrow]
    public var hasState: Bool

    public init(
        nodes: [EnergyFlowAnimatedNode] = [],
        arrows: [EnergyFlowAnimatedArrow] = [],
        hasState: Bool = false
    ) {
        self.nodes = nodes
        self.arrows = arrows
        self.hasState = hasState
    }

    /// Empty projection — no vehicle state resolved (web `state == null`).
    public static let empty = EnergyFlowAnimatedProjection()

    /// Looks up a node by id (web `nodeMap.get`).
    public func node(_ id: EnergyFlowAnimatedNodeID) -> EnergyFlowAnimatedNode? {
        nodes.first { $0.id == id }
    }
}

// MARK: - Compact (1-column) summary (port of the web `CompactView`)

/// One active power chip in the compact (`size.cols < 2`) layout (web
/// `CompactView` rows). Each chip carries the magnitude already oriented for
/// display (regen uses `abs(power)`); the view resolves the icon/tint/label.
public struct EnergyFlowAnimatedCompactChip: Sendable, Equatable, Identifiable {
    /// The three mutually-independent compact rows (web order: charging,
    /// consuming, regen).
    public enum Kind: String, Sendable, CaseIterable {
        case charging
        case consuming
        case regen
    }

    public let kind: Kind
    public var valueKw: Double

    public var id: String {
        kind.rawValue
    }

    public init(kind: Kind, valueKw: Double) {
        self.kind = kind
        self.valueKw = valueKw
    }
}

/// The compact-layout projection (web `CompactView`): the headline battery
/// percentage plus the ordered active chips. `isIdle` reproduces the web
/// `!isConsuming && !isRegen && !isCharging` branch.
public struct EnergyFlowAnimatedCompactSummary: Sendable, Equatable {
    public var batteryLevel: Double
    public var chips: [EnergyFlowAnimatedCompactChip]

    public init(batteryLevel: Double = 0, chips: [EnergyFlowAnimatedCompactChip] = []) {
        self.batteryLevel = batteryLevel
        self.chips = chips
    }

    /// No power moving in or out — the web standby copy ("Idle") shows.
    public var isIdle: Bool {
        chips.isEmpty
    }

    /// Empty summary — no vehicle state resolved.
    public static let empty = EnergyFlowAnimatedCompactSummary()
}
