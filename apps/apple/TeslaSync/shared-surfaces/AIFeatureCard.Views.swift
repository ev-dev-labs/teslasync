//
//  AIFeatureCard.Views.swift
//  TeslaSync — P4 shared surface · 0018 · AIFeatureCard (Apple)
//
//  The header-side presentational subviews composed by `AIFeatureCard`: the Helix brand mark (the
//  native parity of `components/branding/HelixMark.tsx`, reproduced as a stroked SwiftUI `Shape`
//  from the same 24×24 SVG path), the cyan "Helix" badge (web `AIBadge`), the card header
//  (title + badge + description + optional empty hint), and the universal "Ask Helix" action button.
//  All copy resolves through the P1/S10 facade; all colour comes from the P1/S9 tokens; the shared
//  `TSButton` primitive is reused. No networking, no Tailwind ports, no raw hex.
//
//  The mark is named `AIFeatureCardHelixMark` (not the bare `HelixMark`) so the surface stays
//  self-contained and does not collide with another shared surface's internal mark in the single
//  app module.
//

import SwiftUI

// MARK: - Helix brand mark (native parity of `components/branding/HelixMark.tsx`)

/// The Helix brand glyph — two intertwined quadratic strands crossing at the centre with two
/// horizontal rungs, the native port of the web `HelixMark` SVG (`viewBox 0 0 24 24`). Decorative;
/// the brand name is voiced by the surrounding badge / button label.
struct AIFeatureCardHelixMark: View {
    var size: CGFloat = 14
    var tint: Color = .TS.accent

    var body: some View {
        AIFeatureCardHelixMarkShape()
            .stroke(
                tint,
                style: StrokeStyle(
                    lineWidth: max(1, size * (1.75 / 24)),
                    lineCap: .round,
                    lineJoin: .round
                )
            )
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// The double-helix path — the verbatim port of the web `HelixMark` SVG geometry, scaled from its
/// 24-unit viewBox to the requested frame: strand A `M 8 2 Q 18 7 12 12 Q 6 17 16 22`, strand B
/// (mirrored about x=12) `M 16 2 Q 6 7 12 12 Q 18 17 8 22`, and two rungs at y=7 and y=17.
struct AIFeatureCardHelixMarkShape: Shape {
    func path(in rect: CGRect) -> Path {
        let scale = min(rect.width, rect.height) / 24
        func point(_ pathX: CGFloat, _ pathY: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + pathX * scale, y: rect.minY + pathY * scale)
        }
        var path = Path()
        // Strand A: top-left → centre → bottom-right.
        path.move(to: point(8, 2))
        path.addQuadCurve(to: point(12, 12), control: point(18, 7))
        path.addQuadCurve(to: point(16, 22), control: point(6, 17))
        // Strand B: mirrored about x=12, crossing strand A at the centre.
        path.move(to: point(16, 2))
        path.addQuadCurve(to: point(12, 12), control: point(6, 7))
        path.addQuadCurve(to: point(8, 22), control: point(18, 17))
        // Two rungs where the strands run nearly parallel.
        path.move(to: point(10, 7))
        path.addLine(to: point(14, 7))
        path.move(to: point(10, 17))
        path.addLine(to: point(14, 17))
        return path
    }
}

// MARK: - Helix badge (web `AIBadge` cyan pill)

/// The small cyan "Helix" pill rendered beside the title — the native parity of the web `AIBadge`
/// span (`rounded-full border border-cyan-300/30 bg-cyan-300/10 … text-cyan-300`). Non-interactive
/// like the web span; the brand name is voiced as one VoiceOver element with a freshness-aware
/// label, and the long-form explanation rides the pointer tooltip (web `title`).
struct AIFeatureCardBadge: View {
    let label: String?
    var connection: AIFeatureCardConnection = .live

    private var text: String {
        label ?? AIFeatureCardStrings.string("helix.badge", "Helix")
    }

    private var brand: String {
        AIFeatureCardStrings.string("helix.ariaLabel", "Helix")
    }

    private var freshnessNote: String {
        AIFeatureCardFreshness.note(for: connection)
    }

    private var tooltip: String {
        AIFeatureCardStrings.string(
            "helix.tooltip",
            "Helix is your AI assistant. It generates responses using your redacted fleet context."
        )
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            AIFeatureCardHelixMark(size: 14)
            Text(verbatim: text)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.accent)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.accent.opacity(0.1), in: Capsule(style: .continuous))
        .overlay(Capsule(style: .continuous).strokeBorder(Color.TS.accent.opacity(0.3), lineWidth: 1))
        .help(tooltip)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: AIFeatureCardAccessibility.badgeLabel(
            brand: brand,
            connection: connection,
            freshnessNote: freshnessNote
        )))
    }
}

// MARK: - Header (web `AIFeatureCard` title + badge + description + emptyHint)

/// The card header: the title, the cyan Helix badge, the one-paragraph description, and the optional
/// empty hint shown when the action cannot start (web `!canStart && emptyHint`).
struct AIFeatureCardHeader: View {
    let content: AIFeatureCardContent
    let canStart: Bool
    var connection: AIFeatureCardConnection = .live

    private var showsHint: Bool {
        AIFeatureCardLogic.showsEmptyHint(canStart: canStart, hasEmptyHint: content.hasEmptyHint)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
                Text(verbatim: content.title)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                AIFeatureCardBadge(label: content.badgeLabel, connection: connection)
            }
            Text(verbatim: content.description)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            if showsHint, let hint = content.emptyHint {
                Text(verbatim: hint)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Action button (web universal "Ask Helix" CTA)

/// The universal Helix action — visible "Ask Helix" when idle and "Helix is thinking…" while
/// streaming (web `AIThinkingDots`), with the per-feature verb folded into the accessibility label
/// ("Ask Helix · <buttonLabel>") and surfaced as the pointer tooltip. Disabled (computed, never a
/// literal) from the stream lifecycle + connectivity.
struct AIFeatureCardActionButton: View {
    let content: AIFeatureCardContent
    let isStreaming: Bool
    let disabled: Bool
    let onTap: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var askLabel: String {
        AIFeatureCardStrings.string("helix.askHelix", "Ask Helix")
    }

    private var thinkingLabel: String {
        AIFeatureCardStrings.string("helix.thinking", "Helix is thinking…")
    }

    var body: some View {
        TSButton(variant: .secondary, size: .small, action: onTap) {
            HStack(spacing: TSSpacing.xs) {
                AIFeatureCardHelixMark(size: 12)
                    .aiFeatureCardPulse(active: isStreaming && !reduceMotion)
                Text(verbatim: isStreaming ? thinkingLabel : askLabel)
                    .font(Font.TS.label)
            }
        }
        .disabled(disabled)
        .help(content.resolvedButtonTitle)
        .accessibilityLabel(Text(verbatim: AIFeatureCardAccessibility.actionLabel(
            askHelix: askLabel,
            verb: content.buttonLabel
        )))
        .accessibilityHint(Text(verbatim: content.resolvedButtonTitle))
    }
}
