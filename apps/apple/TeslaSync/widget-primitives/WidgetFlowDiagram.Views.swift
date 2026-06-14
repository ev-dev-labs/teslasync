//
//  WidgetFlowDiagram.Views.swift
//  TeslaSync — P4 widget primitive · 0006 · WidgetFlowDiagram (Apple)
//
//  The presentational pieces of the flow-diagram primitive — the native peers of the web SVG elements: the
//  friendly empty leaf (the native "never a bare box" peer of the web `<EmptyState message={emptyMessage}
//  className="py-8" />`), the arrows layer (the web `<line>`s — magnitude-scaled, sign-toned, with the web
//  `dashFlow` marching-ants animation for the active ones), and the circular node chips (the web
//  `<circle>` + `<foreignObject>` icon/value + `<text>` label). The web SVG draws against a fixed
//  `100 × 100` viewBox; ``FlowDiagramLayout`` scales that box uniformly to the live size (SVG
//  `preserveAspectRatio="xMidYMid meet"`). All chrome is token-driven (P1/S9); the web Tailwind hues map to
//  the semantic status tokens + the brand chart palette (no raw hex). The graphic exposes its content to
//  VoiceOver as per-node labels + a spoken summary (the sibling `TSRadarChart` precedent), and respects
//  Reduce Motion (no marching-ants / no value cross-fade when it is on).
//

import SwiftUI

// MARK: - FlowArrowTone → Color (P1/S9 tokens; web Tailwind hues dropped)

extension FlowArrowTone {
    /// The token color for the resolved tone — the native peer of the web Tailwind classes. Sign defaults
    /// map to the semantic status tokens; a caller override maps to the index-stable brand chart palette.
    var color: Color {
        switch self {
        case .positive: Color.TS.statusSuccess
        case .negative: Color.TS.statusDanger
        case .neutral: Color.TS.textMuted
        case let .palette(index): TSChartPalette.color(at: index)
        }
    }
}

// MARK: - FlowDiagramLayout (viewBox → live coordinates; SVG `xMidYMid meet`)

/// Maps the web's fixed `100 × 100` viewBox onto the live view size with one uniform scale, centered — the
/// native peer of the SVG default `preserveAspectRatio="xMidYMid meet"`. A degenerate zero size collapses
/// the scale to `0` (the canvas simply draws nothing), so the helper is always well-formed.
struct FlowDiagramLayout: Equatable {
    let scale: CGFloat
    let originX: CGFloat
    let originY: CGFloat

    init(size: CGSize) {
        let edge = min(size.width, size.height)
        let resolvedScale = edge.isFinite && edge > 0 ? edge / FlowDiagramGeometry.viewBox : 0
        scale = resolvedScale
        let drawn = FlowDiagramGeometry.viewBox * resolvedScale
        originX = (size.width - drawn) / 2
        originY = (size.height - drawn) / 2
    }

    /// A viewBox point in live coordinates.
    func point(_ viewBoxPoint: CGPoint) -> CGPoint {
        CGPoint(x: originX + viewBoxPoint.x * scale, y: originY + viewBoxPoint.y * scale)
    }

    /// A viewBox length in live points.
    func length(_ viewBoxLength: CGFloat) -> CGFloat {
        viewBoxLength * scale
    }
}

// MARK: - WidgetFlowDiagramEmptyState (web `<EmptyState message={emptyMessage} className="py-8" />`)

/// The friendly empty leaf — the native "never a bare box" peer of the web empty branch. A centered
/// connected-nodes glyph over the headline (the resolved empty message) and a supporting hint, combined
/// into a single VoiceOver element. Token-driven (P1/S9); copy via the P1/S10 facade.
struct WidgetFlowDiagramEmptyState: View {
    let message: String

    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: message)
            } icon: {
                Image(systemName: "point.3.connected.trianglepath.dotted")
            }
        } description: {
            Text(verbatim: WidgetFlowDiagramStrings.emptyHint)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.vertical, TSSpacing.x3xl) // web `py-8` (2rem)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(message). \(WidgetFlowDiagramStrings.emptyHint)"))
    }
}

// MARK: - WidgetFlowDiagramCanvasView (web `<svg>` graph)

/// The populated graph — the native peer of the web `<svg>`: the arrows layer behind the node chips,
/// drawn against the uniformly scaled viewBox. The whole graphic is one VoiceOver container labeled
/// "Energy flow diagram" (web `aria-label`) with a spoken node summary; the arrows are decorative.
struct WidgetFlowDiagramCanvasView: View {
    let canvas: FlowDiagramCanvas

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.locale) private var locale

    var body: some View {
        GeometryReader { proxy in
            let layout = FlowDiagramLayout(size: proxy.size)
            ZStack {
                FlowArrowsLayer(arrows: canvas.arrows, layout: layout, animates: !reduceMotion)
                ForEach(canvas.nodes) { node in
                    FlowNodeChip(node: node, radius: canvas.nodeRadius, layout: layout, locale: locale)
                        .position(layout.point(node.center))
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: WidgetFlowDiagramStrings.accessibilityLabel))
    }
}

// MARK: - FlowArrowsLayer (web `<line>`s + `dashFlow` animation)

/// The edges — every arrow stroked as a magnitude-scaled, sign-toned line; the active ones carry the web
/// `dashFlow` marching-ants animation (a `4 8` dash whose offset travels `-12` viewBox units every `0.8s`,
/// scaled to the live size). When Reduce Motion is on (or no edge is active) the layer draws statically.
/// Decorative for VoiceOver — the flow is conveyed by the node values + the container summary.
struct FlowArrowsLayer: View {
    let arrows: [ProjectedFlowArrow]
    let layout: FlowDiagramLayout
    let animates: Bool

    private var hasActiveArrow: Bool {
        arrows.contains { $0.active }
    }

    var body: some View {
        Group {
            if animates, hasActiveArrow {
                TimelineView(.animation) { timeline in
                    Canvas { context, _ in
                        draw(in: context, phase: dashPhase(at: timeline.date))
                    }
                }
            } else {
                Canvas { context, _ in
                    draw(in: context, phase: 0)
                }
            }
        }
        .accessibilityHidden(true)
    }

    /// The web `dashFlow` offset at a given instant — a linear `0 → -dashTravel` sweep every `dashDuration`,
    /// scaled from viewBox units to live points.
    private func dashPhase(at date: Date) -> CGFloat {
        let elapsed = date.timeIntervalSinceReferenceDate
        let period = FlowDiagramGeometry.dashDuration
        let fraction = elapsed.truncatingRemainder(dividingBy: period) / period
        return -layout.length(FlowDiagramGeometry.dashTravel) * CGFloat(fraction)
    }

    private func draw(in context: GraphicsContext, phase: CGFloat) {
        for arrow in arrows {
            var path = Path()
            path.move(to: layout.point(arrow.start))
            path.addLine(to: layout.point(arrow.end))

            let width = max(layout.length(arrow.strokeWidth), 0.5)
            let style: StrokeStyle = arrow.active
                ? StrokeStyle(
                    lineWidth: width,
                    lineCap: .round,
                    dash: FlowDiagramGeometry.dashPattern.map { layout.length($0) },
                    dashPhase: phase
                )
                : StrokeStyle(lineWidth: width, lineCap: .round)

            context.stroke(path, with: .color(arrow.tone.color), style: style)
        }
    }
}

// MARK: - FlowNodeChip (web `<circle>` + `<foreignObject>` + `<text>`)

/// One node — the native peer of the web node group: a glassy circle (web `fill-white/5 stroke-white/20`),
/// the optional SF Symbol icon over the animated value (web `<foreignObject>` icon + `<AnimatedNumber
/// decimals={1} />`), and the label floated just outside the circle (web `<text>` above, or below for the
/// `bottom` node). One combined VoiceOver element. The in-graphic type scales with the diagram (a chart
/// graphic, per the `TSRadarChart` precedent); the value cross-fade respects Reduce Motion.
struct FlowNodeChip: View {
    let node: ProjectedFlowNode
    let radius: CGFloat
    let layout: FlowDiagramLayout
    let locale: Locale

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var diameter: CGFloat {
        layout.length(radius * 2)
    }

    private var valueFontSize: CGFloat {
        max(layout.length(radius * 0.36), 1)
    }

    private var iconFontSize: CGFloat {
        max(layout.length(radius * 0.43), 1)
    }

    private var labelFontSize: CGFloat {
        max(layout.length(radius * 0.29), 1)
    }

    private var labelOffset: CGFloat {
        let gap = diameter / 2 + layout.length(2)
        return node.placesLabelAbove ? -gap : gap
    }

    var body: some View {
        Circle()
            .fill(Color.TS.surfaceGlass)
            .frame(width: diameter, height: diameter)
            .overlay {
                Circle()
                    .strokeBorder(Color.TS.border, lineWidth: max(layout.length(FlowDiagramGeometry.nodeStroke), 0.5))
            }
            .overlay { chipContent }
            .overlay(alignment: .center) { labelView }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: WidgetFlowDiagramAccessibility.nodeLabel(for: node)))
    }

    private var chipContent: some View {
        VStack(spacing: layout.length(1)) {
            if let symbol = node.systemImage {
                Image(systemName: symbol)
                    .font(.system(size: iconFontSize))
                    .foregroundStyle(Color.TS.textPrimary)
            }
            Text(verbatim: FlowDiagramGeometry.displayValueText(node.displayValue, locale: locale))
                .font(.system(size: valueFontSize, weight: .semibold))
                .monospacedDigit()
                .contentTransition(.numericText())
                .animation(
                    reduceMotion ? nil : .easeOut(duration: TSMotion.normalDuration),
                    value: node.displayValue
                )
                .foregroundStyle(Color.TS.textPrimary)
        }
        .padding(layout.length(1))
    }

    private var labelView: some View {
        Text(verbatim: node.displayLabel)
            .font(.system(size: labelFontSize, weight: .medium))
            .foregroundStyle(Color.TS.textSecondary)
            .lineLimit(1)
            .fixedSize()
            .offset(y: labelOffset)
            .allowsHitTesting(false)
    }
}
