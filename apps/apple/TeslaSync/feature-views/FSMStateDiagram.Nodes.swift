//
//  FSMStateDiagram.Nodes.swift
//  TeslaSync — P4 feature view · 0229 · FSMStateDiagram (Apple)
//
//  The diagram's atoms: the `FSMStateColor → Color` token mapping, the VoiceOver label
//  builders, and the SwiftUI node box / arrow / edge-summary chip. The node box mirrors
//  the web node (status dot · state name · count · current ring + pulse); the arrow
//  mirrors the web SVG connector with its optional edge count; the chip mirrors the web
//  summary pill. Colours resolve from the P1/S9 tokens (semantic, not Tailwind ports).
//

import SwiftUI

// MARK: - Colour mapping (web getStateColor `dot`/`text` → P1/S9 tokens)

extension FSMStateColor {
    /// The saturated dot hue (web `dot`), resolved from the design tokens. Brand chart
    /// tokens back the override hues (cyan/purple); orange + indigo have no token, so use
    /// their exact sRGB (web `orange-400` / `indigo-400`).
    var tint: Color {
        switch self {
        case .success: Color.TS.statusSuccess
        case .warning: Color.TS.statusWarning
        case .danger: Color.TS.statusDanger
        case .info: Color.TS.statusInfo
        case .neutral: Color.TS.textMuted
        case .cyan: Color.TS.chartSeriesRegen
        case .purple: Color.TS.chartSeriesPower
        case .orange: Color(.sRGB, red: 0.984, green: 0.573, blue: 0.235, opacity: 1)
        case .indigo: Color(.sRGB, red: 0.506, green: 0.545, blue: 0.969, opacity: 1)
        case .strongDanger: Color.TS.statusDanger
        case .faded: Color.TS.statusDanger.opacity(0.45)
        }
    }

    /// The node label colour — muted for the neutral/faded states (web muted text),
    /// otherwise the saturated hue.
    var labelColor: Color {
        switch self {
        case .neutral: Color.TS.textSecondary
        case .faded: Color.TS.textMuted
        default: tint
        }
    }
}

// MARK: - VoiceOver labels (P1/S10 facade)

/// Builds the surface's VoiceOver labels from the i18n facade, so the node + edge
/// accessibility text stays localized.
enum FSMStateDiagramA11y {
    static func node(state: String, count: Int, isCurrent: Bool) -> String {
        let base = String(
            format: FSMStateDiagramStrings.string("fsm.diagram.nodeA11y", "%1$@, %2$lld transitions"),
            state,
            count
        )
        guard isCurrent else { return base }
        return "\(base), \(FSMStateDiagramStrings.string("fsm.diagram.current", "current state"))"
    }

    static func edge(from: String, to: String, count: Int) -> String {
        String(
            format: FSMStateDiagramStrings.string("fsm.diagram.edgeA11y", "%1$@ to %2$@, %3$lld times"),
            from,
            to,
            count
        )
    }
}

// MARK: - Node cell (web node box + trailing arrow, wrapped together)

/// One state node plus its trailing arrow — the web `<div className="flex items-center">`
/// per state, kept as a single flow item so the node + arrow wrap together.
struct FSMNodeCell: View {
    let node: FSMDiagramNode

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            FSMNodeBox(node: node)
            if node.hasArrow {
                FSMArrow(count: node.arrowCount)
            }
        }
    }
}

/// The state node box: status dot, state name, observed count, and — when current — a
/// stronger border and a pulsing badge (web `isCurrent` ring + `animate-pulse`).
struct FSMNodeBox: View {
    let node: FSMDiagramNode
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false

    var body: some View {
        VStack(spacing: 2) {
            Circle()
                .fill(node.color.tint)
                .frame(width: 8, height: 8)
            Text(verbatim: node.state)
                .font(Font.TS.bodySm.weight(.medium))
                .foregroundStyle(node.color.labelColor)
                .lineLimit(1)
            if node.isActive {
                Text(verbatim: "\(node.count)")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .monospacedDigit()
            }
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .frame(minWidth: 76)
        .background(background)
        .overlay(border)
        .overlay(alignment: .topTrailing) { currentBadge }
        .opacity(isDimmed ? 0.5 : 1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: FSMStateDiagramA11y.node(
            state: node.state,
            count: node.count,
            isCurrent: node.isCurrent
        )))
    }

    private var isDimmed: Bool {
        !node.isActive && !node.isCurrent
    }

    private var background: some View {
        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            .fill(Color.TS.surface.opacity(node.isCurrent ? 0.55 : (node.isActive ? 0.32 : 0.18)))
    }

    private var border: some View {
        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            .strokeBorder(
                node.isCurrent ? Color.TS.accent.opacity(0.7) : Color.TS.border,
                lineWidth: node.isCurrent ? 1.5 : 1
            )
    }

    @ViewBuilder private var currentBadge: some View {
        if node.isCurrent {
            Circle()
                .fill(Color.TS.statusSuccess)
                .frame(width: 8, height: 8)
                .scaleEffect(pulse ? 1.25 : 0.85)
                .opacity(pulse ? 0.4 : 1)
                .offset(x: 4, y: -4)
                .onAppear {
                    guard !reduceMotion else { return }
                    withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) {
                        pulse = true
                    }
                }
                .accessibilityHidden(true)
        }
    }
}

// MARK: - Arrow (web SVG connector + optional edge count)

/// The connector between two consecutive nodes, with the optional edge count above it
/// (web arrow `<svg>` + `{edgeCount}`).
struct FSMArrow: View {
    let count: Int?

    var body: some View {
        Image(systemName: "arrow.right")
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(Color.TS.textMuted)
            .overlay(alignment: .top) {
                if let count {
                    Text(verbatim: "\(count)")
                        .font(.system(size: 9))
                        .foregroundStyle(Color.TS.textMuted)
                        .monospacedDigit()
                        .fixedSize()
                        .offset(y: -11)
                }
            }
            .accessibilityHidden(true)
    }
}

// MARK: - Edge-summary chip (web bottom summary pill)

/// One edge-summary chip: `from → to ×count`, the from/to coloured by their states
/// (web summary `<span>` row).
struct FSMEdgeChip: View {
    let edge: FSMDiagramEdge

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: edge.from)
                .foregroundStyle(edge.fromColor.labelColor)
            Image(systemName: "arrow.right")
                .font(.system(size: 9))
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: edge.to)
                .foregroundStyle(edge.toColor.labelColor)
            Text(verbatim: "×\(edge.count)")
                .foregroundStyle(Color.TS.textMuted)
                .monospacedDigit()
        }
        .font(Font.TS.caption)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .fill(Color.TS.surface.opacity(0.25))
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: FSMStateDiagramA11y.edge(
            from: edge.from,
            to: edge.to,
            count: edge.count
        )))
    }
}
