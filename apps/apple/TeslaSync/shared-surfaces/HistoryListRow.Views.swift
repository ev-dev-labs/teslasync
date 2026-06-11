//
//  HistoryListRow.Views.swift
//  TeslaSync — P4 shared surface · 0091 · HistoryListRow (Apple)
//
//  The presentational pieces of the slot-based history row: the glow → design-token colour projection
//  (the web `GlassPanel glow` hues), the slot bundle, and the content view — the native peer of the
//  web composition (the outer `flex` with the tap-isolated checkbox column + the glass panel, and
//  inside the panel the leading column, the primary / route / metrics / insight lines, the
//  hover-revealed actions overlay, and the trailing chevron). All chrome is token-driven (P1/S9); the
//  metrics line uses `.monospacedDigit()` (web `tabular-nums`); hover/reveal motion honours Reduce
//  Motion; no raw hex, no Tailwind ports.
//
//  Web-parity interaction detail, reproduced exactly:
//    • the checkbox column and the actions overlay sit OUTSIDE the row's tap target, so toggling a
//      selection or firing a quick action never activates the row (web `e.stopPropagation()`).
//    • the actions overlay is hover-revealed on pointer platforms (web `group-hover:opacity-100`); on
//      touch — where there is no hover — it stays reachable so the controls are never stranded.
//    • the chevron tints toward the glow colour on hover (web `group-hover:text-cyan-400`).
//

import SwiftUI

// MARK: - HistoryListRowGlow → design tokens (web GlassPanel glow hues)

extension HistoryListRowGlow {
    /// The glow colour — the theme-aware token projection of the web glow hues (`cyan → accent`,
    /// `green → success`, `purple → power-series`, `none → no glow`). Reads from the design system so
    /// it recolours across light / dark / high-contrast, where the web neon hues did not.
    var color: Color? {
        switch self {
        case .cyan: Color.TS.accent
        case .green: Color.TS.statusSuccess
        case .purple: Color.TS.chartSeriesPower
        case .none: nil
        }
    }
}

// MARK: - HistoryListRowSlotViews (the erased slot bundle)

/// The caller-composed slot views, type-erased (web `ReactNode` slots). `primary` is required; the
/// rest are `nil` when the web slot was omitted. Bundled into one value so the content view's
/// initializer stays readable.
struct HistoryListRowSlotViews {
    let checkbox: AnyView?
    let leading: AnyView?
    let primary: AnyView
    let route: AnyView?
    let metrics: AnyView?
    let insight: AnyView?
    let actions: [AnyView]
}

// MARK: - HistoryListRowContentView (web composition)

/// The history row — the native peer of the web `HistoryListRow` body. A pure function of its
/// projection + slots: it renders the tap-isolated checkbox column, the glass panel (with the
/// hover-revealed actions overlay, the leading column, the four content lines, and the chevron), and
/// wraps the row body in a link / button element when the source supplies `href` / `onClick`.
struct HistoryListRowContentView: View {
    let projection: HistoryListRowProjection
    let accessibilityHint: String?
    let slots: HistoryListRowSlotViews
    let perform: (@MainActor () -> Void)?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    #if os(macOS)
        @Environment(\.accessibilityVoiceOverEnabled) private var voiceOverEnabled
    #endif
    @State private var isHovering = false

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.sm) {
            if projection.showsCheckbox, let checkbox = slots.checkbox {
                checkbox
                    .padding(.leading, TSSpacing.sm)
                    .accessibilityElement(children: .contain)
            }
            panel
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: Panel

    private var panel: some View {
        ZStack(alignment: .topTrailing) {
            activatableBody
                .padding(TSSpacing.md)
            if projection.showsActions {
                actionsOverlay
                    .padding(TSSpacing.sm)
            }
        }
        .background(TSMaterial.panel, in: panelShape)
        .overlay(panelShape.strokeBorder(borderColor, lineWidth: projection.isSelected ? 1.5 : 1))
        .clipShape(panelShape)
        .onHover { hovering in
            withAnimation(TSAnimation.fast(reduceMotion: reduceMotion)) { isHovering = hovering }
        }
    }

    private var panelShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
    }

    /// The selected tint takes precedence (web `border-cyan-400`); otherwise the glow colour shows on
    /// hover (web `group-hover` glow); otherwise the resting glass border.
    private var borderColor: Color {
        if projection.isSelected { return Color.TS.accent.opacity(0.5) }
        if isHovering, let glow = projection.glow.color { return glow.opacity(0.6) }
        return Color.TS.border
    }

    // MARK: Activatable body (web `<Link>` / `onClick` panel, or inert)

    @ViewBuilder
    private var activatableBody: some View {
        if projection.isNavigable, let perform {
            Button(action: perform) { rowBody }
                .buttonStyle(.plain)
                .accessibilityHint(hintText)
                .accessibilityAddTraits(projection.accessibilityIsLink ? .isLink : [])
        } else {
            rowBody
        }
    }

    private var hintText: Text {
        accessibilityHint.map(Text.init) ?? Text(verbatim: "")
    }

    // MARK: Row body (leading · lines · chevron)

    private var rowBody: some View {
        HStack(alignment: .center, spacing: TSSpacing.md) {
            if projection.showsLeading, let leading = slots.leading {
                leading
                    .frame(width: 36)
                    .multilineTextAlignment(.center)
            }
            lines
                .frame(maxWidth: .infinity, alignment: .leading)
            if projection.showsChevron {
                chevron
            }
        }
        .contentShape(Rectangle())
    }

    private var lines: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            slots.primary
            if projection.showsRoute, let route = slots.route {
                route
            }
            if projection.showsMetrics, let metrics = slots.metrics {
                metrics
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .monospacedDigit()
            }
            if projection.showsInsight, let insight = slots.insight {
                insight
            }
        }
    }

    private var chevron: some View {
        Image(systemName: "chevron.right")
            .font(Font.TS.body)
            .foregroundStyle(isHovering ? (projection.glow.color ?? Color.TS.accent) : Color.TS.textMuted)
            .accessibilityHidden(true)
    }

    // MARK: Actions overlay (web hover-revealed quick actions)

    private var actionsOverlay: some View {
        HStack(spacing: TSSpacing.xs) {
            ForEach(Array(slots.actions.enumerated()), id: \.offset) { _, action in
                action
            }
        }
        .opacity(actionsVisible ? 1 : 0)
        .allowsHitTesting(actionsVisible)
        .accessibilityElement(children: .contain)
    }

    /// Pointer platforms reveal the actions on hover (web `group-hover`); touch keeps them reachable
    /// since there is no hover state. VoiceOver on macOS reveals them so they are never stranded.
    private var actionsVisible: Bool {
        #if os(macOS)
            return isHovering || voiceOverEnabled
        #else
            return true
        #endif
    }
}
