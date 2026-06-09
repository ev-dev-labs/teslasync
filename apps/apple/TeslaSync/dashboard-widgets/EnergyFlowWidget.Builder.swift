//
//  EnergyFlowWidget.Builder.swift
//  TeslaSync — P4 dashboard widget · 0046 · EnergyFlowWidget (Apple)
//
//  Pure cached→projection adapter — the unit-tested core. A faithful Swift port of
//  the node/arrow derivation in features/dashboard/widgets/EnergyFlowWidget.tsx
//  plus the stroke/visibility math from shared/WidgetFlowDiagram.tsx. No SwiftUI
//  or transport here.
//

import Foundation

// MARK: - EnergyFlowBuilder (faithful port of the web memoized nodes/arrows)

/// Derives the flow-diagram projection from a cached vehicle-state snapshot, then
/// the diagram's visibility + stroke math. Mirrors the web exactly so both
/// platforms route identical power between the same nodes.
public enum EnergyFlowBuilder {
    /// Minimum / maximum arrow stroke (web `MIN_STROKE` / `MAX_STROKE`, viewBox units).
    public static let minStroke: Double = 1
    public static let maxStroke: Double = 4

    /// Builds the nodes + arrows from the cached vehicle state (web `nodes`/`arrows`
    /// memos). When `state` is `nil` the projection is empty, reproducing the web
    /// `state ? <diagram> : <EmptyState>` gate.
    public static func buildProjection(_ state: EnergyFlowVehicleState?) -> EnergyFlowProjection {
        guard let state else { return .empty }
        return EnergyFlowProjection(
            nodes: nodes(for: state),
            arrows: arrows(for: state),
            hasState: true
        )
    }

    /// The routing endpoints in the web order: battery(left), motor(right), and —
    /// only while charging — charger(top).
    static func nodes(for state: EnergyFlowVehicleState) -> [EnergyFlowNode] {
        var result: [EnergyFlowNode] = [
            EnergyFlowNode(
                id: .battery,
                position: .left,
                label: .battery,
                magnitude: state.batteryLevel,
                unit: .percent,
                tint: .emerald
            ),
            EnergyFlowNode(
                id: .motor,
                position: .right,
                label: motorLabel(for: state),
                magnitude: state.absPowerKw,
                unit: state.absPowerKw > 0 ? .kilowatts : .standby,
                tint: .purple
            )
        ]
        if state.isCharging {
            result.append(EnergyFlowNode(
                id: .charger,
                position: .top,
                label: .charger,
                magnitude: state.chargerPowerKw,
                unit: .kilowatts,
                tint: .amber
            ))
        }
        return result
    }

    /// The motor node's label by drive direction (web ternary on `isConsuming` /
    /// `isRegen`).
    static func motorLabel(for state: EnergyFlowVehicleState) -> EnergyFlowLabel {
        if state.isConsuming { return .consuming }
        if state.isRegenerating { return .regenerating }
        return .standby
    }

    /// The directional transfers implied by the signed power (web `arrows` memo).
    /// battery→motor while consuming, motor→battery while regenerating, and
    /// charger→battery while charging.
    static func arrows(for state: EnergyFlowVehicleState) -> [EnergyFlowArrow] {
        let absPower = state.absPowerKw
        var result: [EnergyFlowArrow] = [
            EnergyFlowArrow(
                from: .battery,
                to: .motor,
                valueKw: state.isConsuming ? absPower : 0,
                active: state.isConsuming,
                tint: .cyan
            ),
            EnergyFlowArrow(
                from: .motor,
                to: .battery,
                valueKw: state.isRegenerating ? absPower : 0,
                active: state.isRegenerating,
                tint: .emerald
            )
        ]
        if state.isCharging {
            result.append(EnergyFlowArrow(
                from: .charger,
                to: .battery,
                valueKw: state.chargerPowerKw,
                active: true,
                tint: .amber
            ))
        }
        return result
    }

    // MARK: Diagram math (port of shared/WidgetFlowDiagram.tsx)

    /// The arrows actually drawn: all when expanded, else the three largest by
    /// magnitude (web `visibleArrows`). 1×1 widgets are compact.
    public static func visibleArrows(_ arrows: [EnergyFlowArrow], compact: Bool) -> [EnergyFlowArrow] {
        guard compact else { return arrows }
        return Array(
            arrows
                .sorted { abs($0.valueKw) > abs($1.valueKw) }
                .prefix(3)
        )
    }

    /// The denominator for stroke scaling: the largest arrow magnitude, floored at
    /// 1 (web `Math.max(...abs, 1)`).
    public static func maxArrowValue(_ arrows: [EnergyFlowArrow]) -> Double {
        let largest = arrows.map { abs($0.valueKw) }.max() ?? 0
        return Swift.max(largest, 1)
    }

    /// Stroke width for an arrow magnitude in `minStroke…maxStroke` (web
    /// `strokeForValue`).
    public static func stroke(for value: Double, max maxValue: Double) -> Double {
        guard maxValue != 0 else { return minStroke }
        let ratio = abs(value) / maxValue
        return minStroke + ratio * (maxStroke - minStroke)
    }
}
