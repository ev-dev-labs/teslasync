//
//  LiveStateIndicators.Views.swift
//  TeslaSync — P4 feature view · 0292 · LiveStateIndicators (Apple)
//
//  The data presentation composed by `LiveStateIndicators`: the tone → token mapping,
//  the single indicator badge (the native parity of the web `Badge variant dot
//  size="lg"`), the wrapping flow that reproduces the web `flex flex-wrap gap-2`, and
//  the resolved badge row. All chrome uses the shared P1/S9 tokens — no Tailwind ports,
//  no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the per-badge tone maps the web
//  `Badge variant` — success → `statusSuccess`, danger → `statusDanger`, warning →
//  `statusWarning`, info → `statusInfo`, neutral → `textMuted` (the web gray chip).
//

import SwiftUI

// MARK: - Tone → token (web Badge `variant` resolved at the view boundary)

extension LiveStateTone {
    /// The semantic design-token colour for the badge (ADR-006). The web `dot` is
    /// `bg-current`, so the dot, the text, the tinted fill, and the border all derive
    /// from this single colour.
    var color: Color {
        switch self {
        case .success: Color.TS.statusSuccess
        case .danger: Color.TS.statusDanger
        case .warning: Color.TS.statusWarning
        case .info: Color.TS.statusInfo
        case .neutral: Color.TS.textMuted
        }
    }
}

// MARK: - Badge (web `<Badge variant dot size="lg">`)

/// One live-state chip — a leading status dot (web `dot`, `h-1.5 w-1.5 bg-current`) and
/// the tone-tinted label (web `size="lg"` → larger text, `font-medium`) inside a
/// tinted, bordered capsule (web `rounded-full` + the `variant` palette). The dot is
/// decorative; the combined text carries the meaning to VoiceOver, and the chip is
/// static (the web `Badge` is a `<span>`, not a control).
struct LiveStateIndicatorBadge: View {
    let indicator: LiveStateIndicator

    /// The composed display text — "{prefix}: {value}" (web `{t('common.speed')}:
    /// {value}`) or the bare value, resolved through the P1/S10 facade.
    private var text: String {
        let prefix = indicator.prefix.map { LiveStateIndicatorsStrings.resolve($0) }
        let value = LiveStateIndicatorsStrings.resolve(indicator.value)
        return LiveStateIndicatorsAccessibility.badgeLabel(prefix: prefix, value: value)
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(indicator.tone.color)
                .frame(width: 6, height: 6)
                .accessibilityHidden(true)
            Text(verbatim: text)
                .font(Font.TS.body.weight(.medium))
                .foregroundStyle(indicator.tone.color)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.xs)
        .background(indicator.tone.color.opacity(0.15), in: Capsule())
        .overlay(Capsule().strokeBorder(indicator.tone.color.opacity(0.3), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: text))
    }
}

// MARK: - Flow layout (web `flex flex-wrap gap-2`)

/// A left-to-right wrapping layout — the native parity of the web `flex flex-wrap
/// gap-2`. Subviews keep their intrinsic size and wrap to the next line when the row
/// would overflow the proposed width, separated by `spacing` horizontally and
/// vertically (web `gap-2`).
struct LiveStateIndicatorsFlowLayout: Layout {
    var spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout Void) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var rowWidth: CGFloat = 0
        var rowHeight: CGFloat = 0
        var totalWidth: CGFloat = 0
        var totalHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if rowWidth > 0, rowWidth + spacing + size.width > maxWidth {
                totalWidth = max(totalWidth, rowWidth)
                totalHeight += rowHeight + spacing
                rowWidth = size.width
                rowHeight = size.height
            } else {
                rowWidth += (rowWidth > 0 ? spacing : 0) + size.width
                rowHeight = max(rowHeight, size.height)
            }
        }
        totalWidth = max(totalWidth, rowWidth)
        totalHeight += rowHeight
        return CGSize(width: min(totalWidth, maxWidth), height: totalHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal _: ProposedViewSize, subviews: Subviews, cache _: inout Void) {
        var pointX = bounds.minX
        var pointY = bounds.minY
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if pointX > bounds.minX, pointX + size.width > bounds.maxX {
                pointX = bounds.minX
                pointY += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: pointX, y: pointY), anchor: .topLeading, proposal: ProposedViewSize(size))
            pointX += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

// MARK: - Resolved badge row (web non-empty render: five chips)

/// The resolved surface body — the five indicator chips laid out in the wrapping flow,
/// faded in on appear (web `FadeIn`).
struct LiveStateIndicatorsRow: View {
    let projection: LiveStateProjection

    var body: some View {
        TSFadeIn {
            LiveStateIndicatorsFlowLayout(spacing: TSSpacing.sm) {
                ForEach(projection.indicators) { indicator in
                    LiveStateIndicatorBadge(indicator: indicator)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}
