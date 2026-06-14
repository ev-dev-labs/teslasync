//
//  WidgetFlowDiagram.Geometry.swift
//  TeslaSync — P4 widget primitive · 0006 · WidgetFlowDiagram (Apple)
//
//  The pure geometry + projection + accessibility core for the flow-diagram primitive — split from
//  WidgetFlowDiagram.Adapter.swift (which owns the value types + props + projection enum) to keep each
//  file within the SwiftLint file-length budget. This file ports the web component's `useMemo` bodies and
//  per-element render math (`strokeForValue` / `maxArrowValue` / `arrowColor` / endpoint-offset / compact
//  top-3 / label compaction / `AnimatedNumber decimals={1}`), the render-branch projector
//  (`nodes.length === 0 ? <EmptyState/> : <svg/>`), and the VoiceOver label builders. No SwiftUI, so every
//  rule is unit-testable in isolation on a plain host.
//

import CoreGraphics
import Foundation

// MARK: - FlowDiagramGeometry (pure viewBox math + render decisions)

/// Pure geometry + decision helpers for the primitive, mirroring the web component's `useMemo` bodies and
/// per-element render logic so they can be unit-tested without SwiftUI. All distances are in the web's
/// fixed `100 × 100` viewBox; the SwiftUI canvas applies one uniform scale at render.
public enum FlowDiagramGeometry {
    /// The web SVG viewBox edge (`viewBox="0 0 100 100"`).
    public static let viewBox: CGFloat = 100
    /// Web `NODE_RADIUS` (standard).
    public static let nodeRadius: CGFloat = 14
    /// Web `NODE_RADIUS_COMPACT`.
    public static let nodeRadiusCompact: CGFloat = 10
    /// Web `MIN_STROKE`.
    public static let minStroke: CGFloat = 1
    /// Web `MAX_STROKE`.
    public static let maxStroke: CGFloat = 4
    /// Web compact arrow cap (`.slice(0, 3)`).
    public static let compactArrowLimit = 3
    /// Web node hairline stroke width (`<circle strokeWidth={0.5} />`), in viewBox units.
    public static let nodeStroke: CGFloat = 0.5
    /// Web active-arrow dash pattern (`strokeDasharray="4 8"`), in viewBox units.
    public static let dashPattern: [CGFloat] = [4, 8]
    /// Web active-arrow dash travel per loop (`@keyframes dashFlow { to { stroke-dashoffset: -12 } }`).
    public static let dashTravel: CGFloat = 12
    /// Web active-arrow dash loop duration (`animation: dashFlow 0.8s linear infinite`), in seconds.
    public static let dashDuration: Double = 0.8

    /// Web `const r = compact ? NODE_RADIUS_COMPACT : NODE_RADIUS`.
    public static func radius(compact: Bool) -> CGFloat {
        compact ? nodeRadiusCompact : nodeRadius
    }

    /// Web `strokeForValue(value, maxValue)`: a `minStroke` floor scaled toward `maxStroke` by the
    /// magnitude ratio. A zero `maxValue` short-circuits to the floor (web guard).
    public static func strokeWidth(value: Double, maxValue: Double) -> CGFloat {
        guard maxValue != 0 else { return minStroke }
        let ratio = abs(value) / maxValue
        return minStroke + CGFloat(ratio) * (maxStroke - minStroke)
    }

    /// Web `const maxArrowValue = Math.max(...arrows.map(a => Math.abs(a.value)), 1)` — the largest edge
    /// magnitude, floored at `1` so a graph of only-zero edges still strokes at the minimum width.
    public static func maxArrowValue(_ arrows: [FlowArrow]) -> Double {
        let peak = arrows.map { abs($0.value) }.max() ?? 0
        return Swift.max(peak, 1)
    }

    /// Web `arrowColor` value-sign default (the `color?` override is applied by the projector).
    public static func tone(forValue value: Double) -> FlowArrowTone {
        if value > 0 { return .positive }
        if value < 0 { return .negative }
        return .neutral
    }

    /// Web `visibleArrows`: every arrow outside compact mode; the top three by magnitude (stable order)
    /// in compact mode (`[...arrows].sort((a, b) => |b.value| - |a.value|).slice(0, 3)`).
    public static func visibleArrows(_ arrows: [FlowArrow], compact: Bool) -> [FlowArrow] {
        guard compact else { return arrows }
        let ranked = arrows.sorted { abs($0.value) > abs($1.value) }
        return Array(ranked.prefix(compactArrowLimit))
    }

    /// Web on-canvas label: the full label, or its first three letters uppercased in compact mode when it
    /// is longer than three characters (`compact && label.length > 3 ? slice(0, 3).toUpperCase() : label`).
    public static func displayLabel(_ label: String, compact: Bool) -> String {
        guard compact, label.count > 3 else { return label }
        return String(label.prefix(3)).uppercased()
    }

    /// Web arrow endpoints: the from/to centers pushed inward along their connecting unit vector by the
    /// node `radius`, so the stroke touches the circle edges rather than the centers. A degenerate
    /// zero-length separation falls back to a unit length (web `dist || 1`), leaving the endpoints at the
    /// (coincident) centers.
    public static func endpoints(
        from start: CGPoint,
        to end: CGPoint,
        radius: CGFloat
    ) -> (start: CGPoint, end: CGPoint) {
        let deltaX = end.x - start.x
        let deltaY = end.y - start.y
        let rawDistance = (deltaX * deltaX + deltaY * deltaY).squareRoot()
        let distance = rawDistance == 0 ? 1 : rawDistance
        let unitX = deltaX / distance
        let unitY = deltaY / distance
        let startPoint = CGPoint(x: start.x + unitX * radius, y: start.y + unitY * radius)
        let endPoint = CGPoint(x: end.x - unitX * radius, y: end.y - unitY * radius)
        return (startPoint, endPoint)
    }

    /// The on-canvas display number (web `<AnimatedNumber value={node.value} decimals={1} />`) — one
    /// fraction digit, un-grouped (the node chip is tiny), formatted in the supplied locale so the decimal
    /// separator follows the user's region while staying deterministic for tests.
    public static func displayValueText(_ value: Double, locale: Locale = .current) -> String {
        value.formatted(
            .number
                .precision(.fractionLength(1))
                .grouping(.never)
                .locale(locale)
        )
    }
}

// MARK: - WidgetFlowDiagramProjector (pure render-decision port)

/// Ports the web render decision (`nodes.length === 0 ? <EmptyState/> : <svg/>`) to a pure, testable
/// projection, and resolves the populated branch's geometry from the props — the node placements + label
/// compaction and the radius-offset, magnitude-scaled, sign-toned edges. No SwiftUI, so the derivation is
/// verified in isolation. (The on-canvas value string is formatted at the view boundary with the
/// environment locale, the same way the web `<AnimatedNumber>` reads the runtime locale, so the projector
/// stays locale-free.)
public enum WidgetFlowDiagramProjector {
    /// The web render branch: the empty leaf when there are no nodes, else the populated graph.
    public static func resolve(_ input: WidgetFlowInput) -> WidgetFlowDiagramProjection {
        guard !input.nodes.isEmpty else { return .empty }
        return .diagram(canvas(input))
    }

    /// The resolved graph for the populated branch — the node projections (all nodes, in order) and the
    /// visible edge projections (the missing-endpoint edges dropped, web `if (!fromNode || !toNode)`).
    public static func canvas(_ input: WidgetFlowInput) -> FlowDiagramCanvas {
        let radius = FlowDiagramGeometry.radius(compact: input.compact)
        // Web `new Map(nodes.map(n => [n.id, n]))`: a duplicate id keeps the LAST occurrence.
        let nodeByID = Dictionary(input.nodes.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
        let maxValue = FlowDiagramGeometry.maxArrowValue(input.arrows)

        let nodes = input.nodes.map { node in
            projectNode(node, compact: input.compact)
        }
        let arrows = FlowDiagramGeometry
            .visibleArrows(input.arrows, compact: input.compact)
            .compactMap { arrow in
                projectArrow(arrow, nodeByID: nodeByID, radius: radius, maxValue: maxValue)
            }

        return FlowDiagramCanvas(nodeRadius: radius, nodes: nodes, arrows: arrows)
    }

    private static func projectNode(_ node: FlowNode, compact: Bool) -> ProjectedFlowNode {
        ProjectedFlowNode(
            id: node.id,
            center: node.position.point,
            displayValue: node.value,
            label: node.label,
            displayLabel: FlowDiagramGeometry.displayLabel(node.label, compact: compact),
            formattedValue: node.formattedValue,
            systemImage: node.systemImage,
            placesLabelAbove: node.position.placesLabelAbove
        )
    }

    private static func projectArrow(
        _ arrow: FlowArrow,
        nodeByID: [String: FlowNode],
        radius: CGFloat,
        maxValue: Double
    ) -> ProjectedFlowArrow? {
        guard
            let fromNode = nodeByID[arrow.from],
            let toNode = nodeByID[arrow.to]
        else { return nil }

        let segment = FlowDiagramGeometry.endpoints(
            from: fromNode.position.point,
            to: toNode.position.point,
            radius: radius
        )
        let tone = arrow.colorPaletteIndex.map(FlowArrowTone.palette)
            ?? FlowDiagramGeometry.tone(forValue: arrow.value)

        return ProjectedFlowArrow(
            from: arrow.from,
            to: arrow.to,
            start: segment.start,
            end: segment.end,
            strokeWidth: FlowDiagramGeometry.strokeWidth(value: arrow.value, maxValue: maxValue),
            tone: tone,
            active: arrow.active
        )
    }
}

// MARK: - Accessibility

/// VoiceOver label builders for the primitive's non-interactive graphic content. The SVG is a graphic, so
/// (like the sibling `TSRadarChart`) its accessible content is exposed as labels + a spoken summary rather
/// than as Dynamic-Type-scaled in-canvas text.
public enum WidgetFlowDiagramAccessibility {
    /// One node's spoken label — `"<label>: <formattedValue>"` (the full, un-compacted label and the
    /// caller's formatted value), so a glanceable micro-chip reads as a meaningful element.
    public static func nodeLabel(for node: ProjectedFlowNode) -> String {
        "\(node.label): \(node.formattedValue)"
    }

    /// The whole diagram's spoken summary — the node labels joined, so VoiceOver conveys the graph without
    /// the tiny on-canvas numbers (e.g. `"Battery: 80%, Motor: 12.5 kW"`).
    public static func summary(for canvas: FlowDiagramCanvas) -> String {
        canvas.nodes
            .map { nodeLabel(for: $0) }
            .joined(separator: ", ")
    }
}
