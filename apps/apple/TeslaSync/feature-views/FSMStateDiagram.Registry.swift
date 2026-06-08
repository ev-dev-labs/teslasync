//
//  FSMStateDiagram.Registry.swift
//  TeslaSync — P4 feature view · 0229 · FSMStateDiagram (Apple)
//
//  The ported FSM registry the diagram reads (web `src/types/fsm`): the ordered state
//  list, the per-state semantic colour, and the directed transition edges for each of
//  the eight FSM types. Pure (Foundation-only) so the registry + projection stay
//  unit-testable off the main actor — the SwiftUI layer maps each `FSMStateColor` to a
//  P1/S9 design token. Mirrors three web seams verbatim:
//    • `FSM_STATES[fsmType]`     → `states(for:)`     (nil ⇒ web `undefined`)
//    • `FSM_EDGES[fsmType]`      → `edges(for:)`      (= `deriveEdges(transitions)`)
//    • `getStateColor(type, st)` → `color(for:state:)` (lowercased lookup, vehicle +
//                                                       neutral fallbacks)
//

import Foundation

// MARK: - Semantic state colour (web getStateColor result)

/// The resolved semantic colour for an FSM state node — the native port of the web
/// `getStateColor` Tailwind `dot`/`text` result, expressed as a token-free case so the
/// pure layers compile without SwiftUI. `FSMStateColor → Color` lives in the view layer.
public enum FSMStateColor: String, Sendable, Equatable, CaseIterable {
    case success
    case warning
    case danger
    case info
    case neutral
    case cyan
    case purple
    case orange
    case indigo
    case strongDanger
    case faded
}

// MARK: - Edge + derivation (web Edge tuple + deriveEdges)

/// A directed transition edge between two FSM states (web `Edge = [from, to]`).
public struct FSMEdge: Sendable, Equatable {
    public let from: String
    public let to: String

    public init(_ from: String, _ to: String) {
        self.from = from
        self.to = to
    }
}

/// Dedupes an ordered transition list into unique edges, preserving first-seen order —
/// the native port of the web `deriveEdges` (`from→to` key with a `Set` guard).
public enum FSMEdgeDerivation {
    public static func derive(_ transitions: [FSMEdge]) -> [FSMEdge] {
        var seen = Set<String>()
        var edges: [FSMEdge] = []
        for edge in transitions where seen.insert("\(edge.from)→\(edge.to)").inserted {
            edges.append(edge)
        }
        return edges
    }
}

// MARK: - Registry (web FSM_REGISTRY / FSM_STATES / FSM_EDGES / getStateColor)

/// The ported FSM registry. Unknown FSM types resolve to `nil` (web
/// `FSM_STATES[fsmType] === undefined`), which the diagram renders as its empty
/// "select an FSM" surface; an unknown *state* falls back to `.neutral` (web
/// `DEFAULT_STATE`), and an unknown FSM type falls back to the vehicle colour map for
/// state lookups (web `FSM_REGISTRY[fsmType] ?? FSM_REGISTRY.vehicle`).
public enum FSMRegistry {
    /// The eight registered FSM types, in registry order.
    public static let knownTypes: [String] = [
        "vehicle",
        "drive_session",
        "charge_session",
        "command",
        "notification",
        "alert_cooldown",
        "automation",
        "telemetry_connection"
    ]

    /// Whether the diagram can render this FSM type (web `states && edges`).
    public static func isKnown(_ fsmType: String) -> Bool {
        states(for: fsmType) != nil
    }

    /// Ordered state names for the FSM type (web `FSM_STATES[fsmType]`).
    public static func states(for fsmType: String) -> [String]? {
        switch fsmType {
        case "vehicle": FSMRegistryData.vehicleStates
        case "drive_session": FSMRegistryData.driveSessionStates
        case "charge_session": FSMRegistryData.chargeSessionStates
        case "command": FSMRegistryData.commandStates
        case "notification": FSMRegistryData.notificationStates
        case "alert_cooldown": FSMRegistryData.alertCooldownStates
        case "automation": FSMRegistryData.automationStates
        case "telemetry_connection": FSMRegistryData.telemetryConnectionStates
        default: nil
        }
    }

    /// Raw ordered transition pairs for the FSM type (web `*_TRANSITIONS`, from/to only).
    public static func transitions(for fsmType: String) -> [FSMEdge]? {
        switch fsmType {
        case "vehicle": FSMRegistryData.vehicleTransitions
        case "drive_session": FSMRegistryData.driveSessionTransitions
        case "charge_session": FSMRegistryData.chargeSessionTransitions
        case "command": FSMRegistryData.commandTransitions
        case "notification": FSMRegistryData.notificationTransitions
        case "alert_cooldown": FSMRegistryData.alertCooldownTransitions
        case "automation": FSMRegistryData.automationTransitions
        case "telemetry_connection": FSMRegistryData.telemetryConnectionTransitions
        default: nil
        }
    }

    /// Unique transition edges for the FSM type (web `FSM_EDGES[fsmType]`).
    public static func edges(for fsmType: String) -> [FSMEdge]? {
        guard let transitions = transitions(for: fsmType) else { return nil }
        return FSMEdgeDerivation.derive(transitions)
    }

    /// Web `getStateColor(fsmType, state)`: a case-insensitive state lookup, with the
    /// vehicle colour map as the unknown-type fallback and `.neutral` for an unknown
    /// state name.
    public static func color(for fsmType: String, state: String) -> FSMStateColor {
        let map = colorMap(for: fsmType) ?? FSMRegistryData.vehicleColors
        return map[state.lowercased()] ?? .neutral
    }

    static func colorMap(for fsmType: String) -> [String: FSMStateColor]? {
        switch fsmType {
        case "vehicle": FSMRegistryData.vehicleColors
        case "drive_session": FSMRegistryData.driveSessionColors
        case "charge_session": FSMRegistryData.chargeSessionColors
        case "command": FSMRegistryData.commandColors
        case "notification": FSMRegistryData.notificationColors
        case "alert_cooldown": FSMRegistryData.alertCooldownColors
        case "automation": FSMRegistryData.automationColors
        case "telemetry_connection": FSMRegistryData.telemetryConnectionColors
        default: nil
        }
    }
}
