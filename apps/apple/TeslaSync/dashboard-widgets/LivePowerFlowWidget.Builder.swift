//
//  LivePowerFlowWidget.Builder.swift
//  TeslaSync — P4 dashboard widget · 0056 · LivePowerFlowWidget (Apple)
//
//  Pure cached→projection adapter — the unit-tested core. A faithful Swift port
//  of the node/arrow derivation in features/dashboard/widgets/
//  LivePowerFlowWidget.tsx plus the stroke/visibility math from
//  shared/WidgetFlowDiagram.tsx. No SwiftUI or transport here.
//

import Foundation

// MARK: - PowerFlowBuilder (faithful port of the web memoized nodes/arrows)

/// Derives the flow-diagram projection from a cached live-status snapshot, then
/// the diagram's visibility + stroke math. Mirrors the web exactly so both
/// platforms route identical power between the same nodes.
public enum PowerFlowBuilder {
    /// Minimum / maximum arrow stroke (web `MIN_STROKE` / `MAX_STROKE`, viewBox units).
    public static let minStroke: Double = 1
    public static let maxStroke: Double = 4

    /// Builds the four nodes + the active arrows from the live status (web
    /// `nodes`/`arrows` memos). When `live` is `nil` the projection is empty,
    /// reproducing the web `liveStatus != null` gate ("No live power data").
    public static func buildProjection(_ live: PowerFlowLiveStatus?) -> PowerFlowProjection {
        guard let live else { return .empty }
        return PowerFlowProjection(
            nodes: nodes(for: live),
            arrows: arrows(for: live),
            hasData: true
        )
    }

    /// The four routing endpoints in the web's `[solar, grid, home, battery]` order.
    static func nodes(for live: PowerFlowLiveStatus) -> [PowerFlowNode] {
        [
            PowerFlowNode(id: .solar, position: .top, valueKw: abs(live.solarKw)),
            PowerFlowNode(id: .grid, position: .left, valueKw: abs(live.gridKw)),
            PowerFlowNode(id: .home, position: .right, valueKw: abs(live.homeKw)),
            PowerFlowNode(id: .battery, position: .bottom, valueKw: abs(live.batteryKw))
        ]
    }

    /// The directional transfers implied by the signed powers (web `arrows` memo).
    /// Sign convention: battery > 0 charging, < 0 discharging; grid > 0 import,
    /// < 0 export.
    static func arrows(for live: PowerFlowLiveStatus) -> [PowerFlowArrow] {
        let solar = live.solarKw
        let battery = live.batteryKw
        let grid = live.gridKw
        var result: [PowerFlowArrow] = []

        // Solar → Home (solar producing).
        if solar > 0 {
            result.append(PowerFlowArrow(
                from: .solar, to: .home, valueKw: solar, active: solar > 0.01, colorNode: .solar
            ))
        }
        // Solar → Battery (excess solar charging the battery).
        if solar > 0, battery > 0 {
            result.append(PowerFlowArrow(
                from: .solar, to: .battery, valueKw: min(solar, abs(battery)), active: true, colorNode: .solar
            ))
        }
        // Battery → Home (discharging).
        if battery < 0 {
            result.append(PowerFlowArrow(
                from: .battery, to: .home, valueKw: abs(battery), active: true, colorNode: .battery
            ))
        }
        // Grid → Home (importing).
        if grid > 0 {
            result.append(PowerFlowArrow(
                from: .grid, to: .home, valueKw: grid, active: true, colorNode: .grid
            ))
        }
        // Home → Grid (exporting).
        if grid < 0 {
            result.append(PowerFlowArrow(
                from: .home, to: .grid, valueKw: abs(grid), active: true, colorNode: .home
            ))
        }
        // Grid → Battery (charging from grid when there is no solar).
        if battery > 0, solar <= 0 {
            result.append(PowerFlowArrow(
                from: .grid, to: .battery, valueKw: abs(battery), active: true, colorNode: .grid
            ))
        }
        return result
    }

    // MARK: Diagram math (port of shared/WidgetFlowDiagram.tsx)

    /// The arrows actually drawn: all when expanded, else the three largest by
    /// magnitude (web `visibleArrows`). 1×1 widgets are compact.
    public static func visibleArrows(_ arrows: [PowerFlowArrow], compact: Bool) -> [PowerFlowArrow] {
        guard compact else { return arrows }
        return Array(
            arrows
                .sorted { abs($0.valueKw) > abs($1.valueKw) }
                .prefix(3)
        )
    }

    /// The denominator for stroke scaling: the largest arrow magnitude, floored at
    /// 1 (web `Math.max(...abs, 1)`).
    public static func maxArrowValue(_ arrows: [PowerFlowArrow]) -> Double {
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
