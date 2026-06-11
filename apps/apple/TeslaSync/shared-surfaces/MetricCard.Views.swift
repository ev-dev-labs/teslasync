//
//  MetricCard.Views.swift
//  TeslaSync — P4 shared surface · 0095 · MetricCard (Apple)
//
//  The presentational pieces of the metric card: the color / tone / arrow → design-token projections,
//  the label row with its optional "?" help affordance (the native peer of the web `<HelpTooltip>` —
//  a focusable trigger revealing a popover with the body + an optional "Learn more" link), the bold
//  value, the muted subtitle, the legacy change pill, the delta footer (the native peer of the web
//  `<Delta>` — skeleton / em-dash / sign-decorated arms), the colored icon box, and the assembled
//  card container. All chrome is token-driven (P1/S9); no raw hex, no Tailwind ports. Decorative
//  glyphs are hidden from VoiceOver; the value is spoken as one combined element and the help trigger
//  carries its own label.
//

import SwiftUI

// MARK: - Axis → design tokens

extension MetricCardColor {
    /// The icon-box tint — the theme-aware projection of the web `neonColorMap[color]`. Reads from the
    /// design system so it recolors across light / dark / high-contrast, where the web used fixed
    /// Tailwind shades. The box uses this at low opacity for the fill + ring and at full strength for
    /// the glyph (the web `bg-neon-{c}/10` / `ring-neon-{c}/20` / `text-{c}-300`).
    var tint: Color {
        switch self {
        case .cyan: Color.TS.accent
        case .green: Color.TS.statusSuccess
        case .red: Color.TS.statusDanger
        case .purple: Color.TS.chartSeriesPower
        case .amber: Color.TS.statusWarning
        case .blue: Color.TS.chartSeriesSpeed
        }
    }
}

extension MetricCardTone {
    /// The trend value color — the theme-aware projection of the web `colorForDelta` classes
    /// (`emerald` / `rose` / `var(--text-secondary)` / `var(--text-muted)`).
    var color: Color {
        switch self {
        case .muted: Color.TS.textMuted
        case .secondary: Color.TS.textSecondary
        case .success: Color.TS.statusSuccess
        case .danger: Color.TS.statusDanger
        }
    }
}

extension MetricCardDeltaArrow {
    /// The SF Symbol for the arrow — the native peer of the web lucide `Arrow{Up,Down,Right}`. `nil`
    /// when hidden (web `hideArrow`).
    var systemName: String? {
        switch self {
        case .up: "arrow.up"
        case .down: "arrow.down"
        case .right: "arrow.right"
        case .hidden: nil
        }
    }
}

extension MetricCardDelta.Size {
    /// The trend text font — web `text-sm` (md) / `text-xs` (sm). Images in the row inherit it, so the
    /// arrow scales with the text (web `h-3.5` / `h-3`).
    var font: Font {
        self == .md ? Font.TS.body : Font.TS.caption
    }
}

// MARK: - Label row + help affordance (web label `<p>` + `<HelpTooltip>`)

/// The label row — the muted, truncated metric label with an optional "?" help trigger to its right
/// (web `<p class="metric-label">… <HelpTooltip/></p>`). The label text is hidden from VoiceOver
/// because it is spoken as part of the combined value element; the help trigger keeps its own label.
struct MetricCardLabelRow: View {
    let label: String
    let help: MetricCardHelp?
    let helpAccessibilityLabel: String
    let learnMoreLabel: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .truncationMode(.tail)
                .accessibilityHidden(true)
            if let help, help.hasBody {
                MetricCardHelpButton(
                    help: help,
                    accessibilityLabel: helpAccessibilityLabel,
                    learnMoreLabel: learnMoreLabel
                )
            }
        }
    }
}

/// The "?" help trigger — a focusable button that reveals the help popover on tap (the native peer of
/// the web `<HelpTooltip>` button). Keyboard- and VoiceOver-accessible with the resolved label
/// (web `aria-label`). The popover adapts to a popover even in compact width (never a full sheet).
struct MetricCardHelpButton: View {
    let help: MetricCardHelp
    let accessibilityLabel: String
    let learnMoreLabel: String

    @State private var presented = false

    var body: some View {
        Button {
            presented = true
        } label: {
            Image(systemName: "questionmark.circle")
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
        .accessibilityAddTraits(.isButton)
        .popover(isPresented: $presented, arrowEdge: help.placement.arrowEdge) {
            MetricCardHelpPopover(
                message: help.resolvedBody,
                learnMore: help.learnMore,
                learnMoreLabel: learnMoreLabel
            )
            .presentationCompactAdaptation(.popover)
        }
    }
}

extension MetricCardHelp.Placement {
    /// The popover arrow edge for the web tooltip side.
    var arrowEdge: Edge {
        switch self {
        case .top: .top
        case .bottom: .bottom
        case .leading: .leading
        case .trailing: .trailing
        }
    }
}

/// The help popover body — the resolved help copy plus an optional "Learn more" link that opens in the
/// system browser (web tooltip body + `<a target="_blank">`).
struct MetricCardHelpPopover: View {
    let message: String
    let learnMore: MetricCardLearnMore?
    let learnMoreLabel: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: message)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
            if let learnMore {
                Link(destination: learnMore.url) {
                    HStack(spacing: TSSpacing.xs) {
                        Text(verbatim: learnMoreLabel)
                        Image(systemName: "arrow.up.right.square")
                    }
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.accent)
                }
            }
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: 260, alignment: .leading)
    }
}

// MARK: - Value + subtitle (web value `<p>` + subtitle `<p>`)

/// The bold headline value (web `text-xl font-bold tracking-tight`). Hidden from VoiceOver on its own
/// because the combined "label, value, subtitle" is spoken by the surrounding element.
struct MetricCardValueText: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.title)
            .foregroundStyle(Color.TS.textPrimary)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// The muted, truncated subtitle (web `text-[10px] text-[var(--text-muted)] truncate`).
struct MetricCardSubtitleText: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .lineLimit(1)
            .truncationMode(.tail)
            .accessibilityHidden(true)
    }
}

// MARK: - Trend (legacy change pill + delta footer)

/// The legacy change pill (web `change && !delta`): "↑ 12%" emerald / "↓ 12%" rose. Rendered as one
/// string so VoiceOver reads the arrow + value natively, byte-identical to the web.
struct MetricCardChangePill: View {
    let projection: MetricCardChangeProjection

    var body: some View {
        Text(verbatim: projection.text)
            .font(Font.TS.caption.weight(.medium))
            .foregroundStyle(projection.positive ? Color.TS.statusSuccess : Color.TS.statusDanger)
    }
}

/// The delta footer — the native peer of the web `<Delta>`: a skeleton while loading, a muted "—"
/// (plus any `comparedTo`) when the comparison is missing, or the sign-/tone-decorated value with its
/// arrow and trailing label. Spoken as one VoiceOver element with the resolved title.
struct MetricCardDeltaFooter: View {
    let projection: MetricCardDeltaProjection

    var body: some View {
        Group {
            switch projection {
            case let .loading(size):
                TSSkeleton(width: 60, height: size == .md ? 16 : 14)
            case let .empty(comparedTo, size):
                emptyRow(comparedTo: comparedTo, size: size)
            case let .value(value):
                valueRow(value)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    private func emptyRow(comparedTo: String?, size: MetricCardDelta.Size) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: MetricCardGlyph.dash)
            if let comparedTo, !comparedTo.isEmpty {
                Text(verbatim: comparedTo)
            }
        }
        .font(size.font)
        .foregroundStyle(Color.TS.textMuted)
    }

    private func valueRow(_ value: MetricCardDeltaValue) -> some View {
        HStack(spacing: TSSpacing.xs) {
            if let symbol = value.arrow.systemName {
                Image(systemName: symbol).accessibilityHidden(true)
            }
            Text(verbatim: value.text)
            if let comparedTo = value.comparedTo, !comparedTo.isEmpty {
                Text(verbatim: comparedTo)
                    .fontWeight(.regular)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .font(value.size.font.weight(.medium))
        .foregroundStyle(value.tone.color)
    }

    /// The spoken delta label — the populated "current vs previous" title, else "No comparison data"
    /// (web `title` attributes), resolved through the P1/S10 facade.
    private var accessibilityLabel: String {
        switch projection {
        case let .value(value):
            MetricCardStrings.deltaTitle(current: value.currentText, previous: value.previousText)
        case .empty, .loading:
            MetricCardStrings.deltaNoComparison
        }
    }
}

// MARK: - Icon box (web `neonColorMap` ring box)

/// The colored icon box — an SF Symbol on a tinted fill with a faint ring (web `rounded-lg p-1.5
/// ring-1` with `bg-neon-{c}/10` / `ring-neon-{c}/20`). Decorative, so hidden from VoiceOver (the web
/// icon is a non-labelled `ReactNode`).
struct MetricCardIconBox: View {
    let systemName: String
    let color: MetricCardColor

    var body: some View {
        Image(systemName: systemName)
            .font(Font.TS.panel)
            .foregroundStyle(color.tint)
            .padding(TSSpacing.sm)
            .background(
                color.tint.opacity(0.1),
                in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .strokeBorder(color.tint.opacity(0.25), lineWidth: 1)
            )
            .accessibilityHidden(true)
    }
}

// MARK: - MetricCardContentView (the assembled card)

/// The assembled metric card — the native peer of the web `MetricCard` `<div>`: the glass container,
/// the top row (the label / value / subtitle / trend column plus the optional icon box), and the
/// VoiceOver wiring. A pure function of its inputs + the resolved projection (no networking, no
/// derivation), so it composes in every branch for snapshot / preview / test.
struct MetricCardContentView: View {
    let inputs: MetricCardInputs
    let projection: MetricCardProjection
    let valueAccessibilityLabel: String
    let helpAccessibilityLabel: String
    let learnMoreLabel: String

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var hovering = false

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            column
            if let icon = inputs.iconSystemName {
                MetricCardIconBox(systemName: icon, color: inputs.color)
            }
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(borderColor, lineWidth: 1)
        )
        .animation(TSAnimation.fast(reduceMotion: reduceMotion), value: hovering)
        .onHover { hovering = $0 }
    }

    private var column: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            MetricCardLabelRow(
                label: inputs.label,
                help: inputs.help,
                helpAccessibilityLabel: helpAccessibilityLabel,
                learnMoreLabel: learnMoreLabel
            )
            MetricCardValueText(text: projection.valueText)
                .accessibilityLabel(Text(verbatim: valueAccessibilityLabel))
            if let subtitle = projection.subtitle, !subtitle.isEmpty {
                MetricCardSubtitleText(text: subtitle)
            }
            trend
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var trend: some View {
        switch projection.trend {
        case .none:
            EmptyView()
        case let .change(change):
            MetricCardChangePill(projection: change)
        case let .delta(delta):
            MetricCardDeltaFooter(projection: delta)
        }
    }

    /// The container border — the subtle resting token, brightened on pointer hover (web
    /// `hover:border-white/[0.08]`).
    private var borderColor: Color {
        hovering ? Color.TS.textMuted.opacity(0.35) : Color.TS.border
    }
}
