//
//  LivePowerFlowWidget.Diagram.swift
//  TeslaSync — P4 dashboard widget · 0056 · LivePowerFlowWidget (Apple)
//
//  PowerFlowDiagram — the SwiftUI reproduction of shared/WidgetFlowDiagram.tsx:
//  four nodes anchored in a 100×100 space with directional, magnitude-weighted
//  arrows. Active flows animate a marching-dash; everything honors Reduce Motion.
//  Arrows are drawn in a Canvas; node chrome (icon + live value + label) is
//  composed from real SwiftUI views for crisp SF Symbols and numeric text.
//

import SwiftUI

// MARK: - PowerFlowDiagram (web `WidgetFlowDiagram`)

/// Renders the power-flow projection. Arrows are stroked in a `Canvas` (width ∝
/// magnitude, dashed + animated when active); nodes are positioned views. Exposed
/// to VoiceOver as a single image with a per-node value summary.
struct PowerFlowDiagram: View {
    let projection: PowerFlowProjection
    var compact: Bool = false

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Node radius in viewBox units (web `NODE_RADIUS` / `NODE_RADIUS_COMPACT`).
    var radius: CGFloat {
        compact ? 10 : 14
    }

    var body: some View {
        if projection.nodes.isEmpty {
            emptyMessage
        } else {
            GeometryReader { geo in
                let side = min(geo.size.width, geo.size.height)
                let scale = side / 100
                let origin = CGPoint(x: (geo.size.width - side) / 2, y: (geo.size.height - side) / 2)
                ZStack(alignment: .topLeading) {
                    arrowsCanvas(scale: scale, origin: origin)
                    nodesLayer(scale: scale, origin: origin)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityAddTraits(.isImage)
            .accessibilityLabel(LivePowerFlowStrings.text("widget.livePowerFlow.diagramA11y", "Energy flow diagram"))
            .accessibilityValue(Text(verbatim: LivePowerFlowAccessibility.summary(for: projection)))
        }
    }

    private var emptyMessage: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "bolt.slash")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.textMuted)
            LivePowerFlowStrings.text("widget.livePowerFlow.noData", "No live power data")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Arrow rendering (Canvas)

/// The per-frame transform + magnitude/phase inputs for stroking the arrows,
/// bundled so the draw routine stays within the parameter budget.
private struct PowerFlowRenderContext {
    let scale: CGFloat
    let origin: CGPoint
    let maxValue: Double
    let phase: CGFloat
}

extension PowerFlowDiagram {
    private func arrowsCanvas(scale: CGFloat, origin: CGPoint) -> some View {
        let arrows = PowerFlowBuilder.visibleArrows(projection.arrows, compact: compact)
        let maxValue = PowerFlowBuilder.maxArrowValue(projection.arrows)
        return TimelineView(.animation(paused: reduceMotion)) { timeline in
            Canvas { context, _ in
                let render = PowerFlowRenderContext(
                    scale: scale,
                    origin: origin,
                    maxValue: maxValue,
                    phase: dashPhase(at: timeline.date)
                )
                for arrow in arrows {
                    drawArrow(arrow, into: &context, render: render)
                }
            }
        }
    }

    private func drawArrow(
        _ arrow: PowerFlowArrow,
        into context: inout GraphicsContext,
        render: PowerFlowRenderContext
    ) {
        guard let fromNode = projection.node(arrow.from), let toNode = projection.node(arrow.to) else { return }
        let radiusPx = radius * render.scale
        let start = point(for: fromNode.position, scale: render.scale, origin: render.origin)
        let end = point(for: toNode.position, scale: render.scale, origin: render.origin)
        let dx = end.x - start.x
        let dy = end.y - start.y
        let dist = max(hypot(dx, dy), 0.0001)
        let unit = CGPoint(x: dx / dist, y: dy / dist)

        var path = Path()
        path.move(to: CGPoint(x: start.x + unit.x * radiusPx, y: start.y + unit.y * radiusPx))
        path.addLine(to: CGPoint(x: end.x - unit.x * radiusPx, y: end.y - unit.y * radiusPx))

        let width = PowerFlowBuilder.stroke(for: arrow.valueKw, max: render.maxValue) * render.scale
        let shading = GraphicsContext.Shading.color(LivePowerFlowPalette.arrowColor(arrow))
        if arrow.active {
            let offset = render.phase * render.scale
            let dash = [4 * render.scale, 8 * render.scale]
            let style = StrokeStyle(lineWidth: width, lineCap: .round, dash: dash, dashPhase: offset)
            context.stroke(path, with: shading, style: style)
        } else {
            context.stroke(path, with: shading, style: StrokeStyle(lineWidth: width, lineCap: .round))
        }
    }

    /// The animated dash offset in viewBox units: a full 12-unit cycle (`4 + 8`)
    /// every 0.8s, marching toward the target (web `dashFlow` keyframe → `-12`).
    private func dashPhase(at date: Date) -> CGFloat {
        let period = 0.8
        let fraction = date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: period) / period
        return -CGFloat(fraction) * 12
    }

    private func point(for position: PowerFlowPosition, scale: CGFloat, origin: CGPoint) -> CGPoint {
        let coord = position.coord
        return CGPoint(x: origin.x + CGFloat(coord.cx) * scale, y: origin.y + CGFloat(coord.cy) * scale)
    }
}

// MARK: - Node rendering

extension PowerFlowDiagram {
    private func nodesLayer(scale: CGFloat, origin: CGPoint) -> some View {
        ForEach(projection.nodes) { node in
            PowerFlowNodeView(node: node, diameter: radius * 2 * scale, labelBelow: node.position == .bottom)
                .position(point(for: node.position, scale: scale, origin: origin))
        }
    }
}

/// A single routing endpoint: a tinted circle with the node's SF Symbol, its live
/// kW value (animated, Reduce-Motion-aware) and a label set just outside the ring.
struct PowerFlowNodeView: View {
    let node: PowerFlowNode
    let diameter: CGFloat
    let labelBelow: Bool

    var body: some View {
        ZStack {
            Circle()
                .fill(LivePowerFlowPalette.nodeFill)
                .overlay(Circle().strokeBorder(LivePowerFlowPalette.nodeStroke, lineWidth: max(0.5, diameter * 0.03)))
            VStack(spacing: diameter * 0.04) {
                Image(systemName: node.id.symbol)
                    .font(.system(size: diameter * 0.30, weight: .semibold))
                    .foregroundStyle(LivePowerFlowPalette.color(for: node.id))
                PowerFlowValueText(value: node.valueKw, fontSize: diameter * 0.26)
            }
        }
        .frame(width: diameter, height: diameter)
        .overlay {
            Text(verbatim: LivePowerFlowStrings.nodeLabel(node.id))
                .font(.system(size: max(7, diameter * 0.20), weight: .medium))
                .foregroundStyle(LivePowerFlowPalette.nodeLabel)
                .fixedSize()
                .offset(y: labelBelow ? diameter * 0.5 + diameter * 0.18 : -(diameter * 0.5 + diameter * 0.18))
        }
    }
}

/// The node's live value. Rolls to the new magnitude on change (and counts up on
/// first appear); under Reduce Motion it snaps. Web `AnimatedNumber`.
struct PowerFlowValueText: View {
    let value: Double
    let fontSize: CGFloat

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown: Double = 0

    var body: some View {
        Text(verbatim: PowerFlowFormat.number(shown))
            .font(.system(size: fontSize, weight: .semibold))
            .monospacedDigit()
            .foregroundStyle(Color.TS.textPrimary)
            .contentTransition(.numericText())
            .onAppear { animate(to: value) }
            .onChange(of: value) { _, newValue in animate(to: newValue) }
    }

    private func animate(to target: Double) {
        guard !reduceMotion else {
            shown = target
            return
        }
        withAnimation(.easeOut(duration: TSMotion.slowDuration)) { shown = target }
    }
}

// MARK: - Node SF Symbols (web lucide icons)

extension PowerFlowNodeID {
    /// The SF Symbol mirroring the web lucide icon for this node.
    var symbol: String {
        switch self {
        case .solar: "sun.max.fill"
        case .grid: "bolt.fill"
        case .home: "house.fill"
        case .battery: "battery.100percent"
        }
    }
}
