//
//  EnergyFlowAnimatedWidget.Builder.swift
//  TeslaSync — P4 dashboard widget · 0045 · EnergyFlowAnimatedWidget (Apple)
//
//  Pure cached→projection adapter — the unit-tested core. A faithful Swift port
//  of the node/arrow derivation in
//  features/dashboard/widgets/EnergyFlowAnimatedWidget.tsx (including the
//  always-present charger, the ±0.5 kW drive dead-band, and the `CompactView`
//  chips) plus the stroke/visibility math from shared/WidgetFlowDiagram.tsx. No
//  SwiftUI or transport here.
//

import Foundation

// MARK: - EnergyFlowAnimatedBuilder (faithful port of the web memoized nodes/arrows)

/// Derives the flow-diagram projection (and the compact summary) from a cached
/// vehicle-state snapshot, then the diagram's visibility + stroke math. Mirrors
/// the web exactly so both platforms route identical power between the same nodes.
public enum EnergyFlowAnimatedBuilder {
    /// Minimum / maximum arrow stroke (web `MIN_STROKE` / `MAX_STROKE`, viewBox units).
    public static let minStroke: Double = 1
    public static let maxStroke: Double = 4

    /// Builds the nodes + arrows from the cached vehicle state (web `nodes`/`arrows`
    /// memos). When `state` is `nil` the projection is empty, reproducing the web
    /// `state ? … : <EmptyState>` gate.
    public static func buildProjection(_ state: EnergyFlowAnimatedVehicleState?) -> EnergyFlowAnimatedProjection {
        guard let state else { return .empty }
        return EnergyFlowAnimatedProjection(
            nodes: nodes(for: state),
            arrows: arrows(for: state),
            hasState: true
        )
    }

    /// The routing endpoints in the web order: battery(left), drive(right), and
    /// charger(top). All three are ALWAYS present (the animated widget's `nodes`
    /// memo is unconditional); the charger shows a dash when not charging.
    static func nodes(for state: EnergyFlowAnimatedVehicleState) -> [EnergyFlowAnimatedNode] {
        [
            EnergyFlowAnimatedNode(
                id: .battery,
                position: .left,
                label: .battery,
                magnitude: state.batteryLevel,
                unit: .percent
            ),
            EnergyFlowAnimatedNode(
                id: .drive,
                position: .right,
                label: driveLabel(for: state),
                magnitude: state.absPowerKw,
                unit: driveUnit(for: state)
            ),
            EnergyFlowAnimatedNode(
                id: .charger,
                position: .top,
                label: .charger,
                magnitude: state.chargerPowerKw,
                unit: state.isCharging ? .kilowatts(decimals: 0) : .standby
            )
        ]
    }

    /// The drive node's label by direction (web ternary `Drive`/`Regen`/`Idle`).
    static func driveLabel(for state: EnergyFlowAnimatedVehicleState) -> EnergyFlowAnimatedLabel {
        if state.isConsuming { return .drive }
        if state.isRegenerating { return .regen }
        return .idle
    }

    /// The drive node's semantic unit (web `formattedValue`): a one-decimal kW
    /// magnitude while consuming/regenerating, else the standby dash.
    static func driveUnit(for state: EnergyFlowAnimatedVehicleState) -> EnergyFlowAnimatedValueUnit {
        state.isConsuming || state.isRegenerating ? .kilowatts(decimals: 1) : .standby
    }

    /// The directional transfers implied by the signed power (web `arrows` memo).
    /// All three are ALWAYS present; inactive arrows carry a 0 value (no flow,
    /// minimal stroke). battery→drive while consuming, drive→battery while
    /// regenerating, charger→battery while charging.
    static func arrows(for state: EnergyFlowAnimatedVehicleState) -> [EnergyFlowAnimatedArrow] {
        let absPower = state.absPowerKw
        return [
            EnergyFlowAnimatedArrow(
                from: .battery,
                to: .drive,
                valueKw: state.isConsuming ? absPower : 0,
                active: state.isConsuming,
                tint: .cyan
            ),
            EnergyFlowAnimatedArrow(
                from: .drive,
                to: .battery,
                valueKw: state.isRegenerating ? absPower : 0,
                active: state.isRegenerating,
                tint: .emerald
            ),
            EnergyFlowAnimatedArrow(
                from: .charger,
                to: .battery,
                valueKw: state.isCharging ? state.chargerPowerKw : 0,
                active: state.isCharging,
                tint: .amber
            )
        ]
    }

    // MARK: Compact summary (port of the web `CompactView`)

    /// The 1-column summary: the headline battery percentage plus the ordered
    /// active chips (web `CompactView` — charging, then consuming, then regen,
    /// else "Idle"). Regen reports `abs(power)`. `nil` state yields an empty
    /// summary.
    public static func compactSummary(
        _ state: EnergyFlowAnimatedVehicleState?
    ) -> EnergyFlowAnimatedCompactSummary {
        guard let state else { return .empty }
        var chips: [EnergyFlowAnimatedCompactChip] = []
        if state.isCharging {
            chips.append(EnergyFlowAnimatedCompactChip(kind: .charging, valueKw: state.chargerPowerKw))
        }
        if state.isConsuming {
            chips.append(EnergyFlowAnimatedCompactChip(kind: .consuming, valueKw: state.powerKw))
        }
        if state.isRegenerating {
            chips.append(EnergyFlowAnimatedCompactChip(kind: .regen, valueKw: state.absPowerKw))
        }
        return EnergyFlowAnimatedCompactSummary(batteryLevel: state.batteryLevel, chips: chips)
    }

    // MARK: Diagram math (port of shared/WidgetFlowDiagram.tsx)

    /// The arrows actually drawn: all when expanded, else the three largest by
    /// magnitude (web `visibleArrows`).
    public static func visibleArrows(
        _ arrows: [EnergyFlowAnimatedArrow],
        compact: Bool
    ) -> [EnergyFlowAnimatedArrow] {
        guard compact else { return arrows }
        return Array(
            arrows
                .sorted { abs($0.valueKw) > abs($1.valueKw) }
                .prefix(3)
        )
    }

    /// The denominator for stroke scaling: the largest arrow magnitude, floored at
    /// 1 (web `Math.max(...abs, 1)`).
    public static func maxArrowValue(_ arrows: [EnergyFlowAnimatedArrow]) -> Double {
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
