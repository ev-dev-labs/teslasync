//
//  AIThinkingIndicator.Views.swift
//  TeslaSync — P4 shared surface · 0053 · AIThinkingIndicator (Apple)
//
//  The presentational subviews composed by `AIThinkingIndicator` and `AIThinkingDots`: the Helix
//  brand mark (the native parity of `components/branding/HelixMark.tsx`, reproduced as a stroked
//  SwiftUI `Shape` from the same 24×24 SVG path), the bouncing-dot row (web `animate-bounce` with a
//  staggered delay), the three shimmering skeleton lines (web `animate-shimmer`, decreasing widths to
//  mimic prose), and the reduce-motion-safe pulse the Helix mark wears. All copy resolves through the
//  P1/S10 facade; all colour comes from the P1/S9 tokens; the shared `TSSkeleton` primitive is reused
//  for the shimmer lines. No networking, no Tailwind ports, no raw hex.
//
//  Every animation is reduce-motion-aware (web `motion-safe:`): with Reduce Motion on, the pulse and
//  bounce rest and the shimmer drops — the static skeleton remains visible, never a blank box.
//
//  The mark is named `AIThinkingHelixMark` (not the bare `HelixMark`) so the surface stays
//  self-contained and does not collide with another shared surface's internal mark in the single app
//  module.
//

import SwiftUI

// MARK: - Helix brand mark (native parity of `components/branding/HelixMark.tsx`)

/// The Helix brand glyph — two intertwined quadratic strands crossing at the centre with two
/// horizontal rungs, the native port of the web `HelixMark` SVG (`viewBox 0 0 24 24`). Decorative;
/// the brand name is voiced by the surrounding status label. Pulses gently when `animate` is set.
struct AIThinkingHelixMark: View {
    var size: CGFloat = 16
    var tint: Color = .TS.accent
    var animate: Bool = true

    var body: some View {
        AIThinkingHelixMarkShape()
            .stroke(
                tint,
                style: StrokeStyle(lineWidth: max(1, size * (1.75 / 24)), lineCap: .round, lineJoin: .round)
            )
            .frame(width: size, height: size)
            .aiThinkingPulse(active: animate)
            .accessibilityHidden(true)
    }
}

/// The double-helix path — the verbatim port of the web `HelixMark` SVG geometry, scaled from its
/// 24-unit viewBox to the requested frame: strand A `M 8 2 Q 18 7 12 12 Q 6 17 16 22`, strand B
/// (mirrored about x=12) `M 16 2 Q 6 7 12 12 Q 18 17 8 22`, and two rungs at y=7 and y=17.
struct AIThinkingHelixMarkShape: Shape {
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

// MARK: - Bouncing dots (web `inline-flex … animate-bounce`)

/// The three staggered bouncing dots that trail the thinking label. Decorative (hidden from
/// VoiceOver) and inert under Reduce Motion. `style` lets the full indicator paint them in the cyan
/// accent while the compact in-button form inherits the current foreground (web `bg-current`).
struct AIThinkingBounceDots: View {
    let active: Bool
    let style: AnyShapeStyle
    var dotSize: CGFloat = 4
    var spacing: CGFloat = 3

    var body: some View {
        HStack(spacing: spacing) {
            ForEach(0 ..< 3, id: \.self) { index in
                AIThinkingBounceDot(active: active, style: style, size: dotSize, delay: Double(index) * 0.15)
            }
        }
        .accessibilityHidden(true)
    }
}

/// A single bouncing dot — animates a small vertical offset forever when `active`, otherwise rests.
struct AIThinkingBounceDot: View {
    let active: Bool
    let style: AnyShapeStyle
    let size: CGFloat
    let delay: Double

    @State private var lifted = false

    var body: some View {
        Circle()
            .fill(style)
            .frame(width: size, height: size)
            .offset(y: lifted ? -size * 0.75 : 0)
            .animation(bounceAnimation, value: lifted)
            .onAppear { lifted = active }
    }

    private var bounceAnimation: Animation? {
        active
            ? .easeInOut(duration: 0.45).repeatForever(autoreverses: true).delay(delay)
            : nil
    }
}

// MARK: - Skeleton lines (web `animate-shimmer` prose lines)

/// The three shimmering skeleton lines beneath the thinking label — full / 11-12ths / 9-12ths width
/// to mimic decreasing prose, the native port of the web `h-3 w-…` shimmer rows. Reuses the shared
/// `TSSkeleton`, whose shimmer already respects Reduce Motion and leaves the static block visible.
struct AIThinkingSkeletonLines: View {
    private let lineHeight: CGFloat = 12
    private let fractions: [CGFloat] = [1, 11.0 / 12.0, 9.0 / 12.0]

    var body: some View {
        GeometryReader { geo in
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                ForEach(fractions.indices, id: \.self) { index in
                    TSSkeleton(
                        width: geo.size.width * fractions[index],
                        height: lineHeight,
                        cornerRadius: TSRadius.sm
                    )
                }
            }
        }
        .frame(height: lineHeight * 3 + TSSpacing.sm * 2)
        .accessibilityHidden(true)
    }
}

// MARK: - Full indicator body (web `AIThinkingIndicator`)

/// The full streaming-pending body — the pulsing Helix mark + the medium-weight cyan label + the
/// bouncing dots, above the three shimmering skeleton lines. Spoken as one `role="status"` element
/// whose name is the resolved label; the decorative parts are hidden from VoiceOver.
struct AIThinkingFullContent: View {
    let label: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(spacing: TSSpacing.sm) {
                AIThinkingHelixMark(size: 16, tint: .TS.accent, animate: !reduceMotion)
                Text(verbatim: label)
                    .font(Font.TS.body)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.accent)
                AIThinkingBounceDots(active: !reduceMotion, style: AnyShapeStyle(Color.TS.accent))
            }
            AIThinkingSkeletonLines()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: AIThinkingAccessibility.statusLabel(label)))
        .accessibilityAddTraits(.updatesFrequently)
    }
}

// MARK: - Compact dots body (web `AIThinkingDots`)

/// The compact in-button form — a label followed by the three bouncing dots, sized for an action
/// button's streaming state where the full skeleton block is too tall. The dots inherit the current
/// foreground (web `bg-current`). Spoken as one element whose name is the caller-supplied label.
struct AIThinkingCompactContent: View {
    let label: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: TSSpacing.xs + 2) {
            Text(verbatim: label)
            AIThinkingBounceDots(active: !reduceMotion, style: AnyShapeStyle(.foreground), spacing: 2)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Reduce-motion-safe pulse

extension View {
    /// Applies a gentle repeating opacity pulse when `active`, and is otherwise inert — the
    /// reduce-motion gate shared by the thinking indicator's Helix mark (web `motion-safe:animate-pulse`).
    @ViewBuilder
    func aiThinkingPulse(active: Bool) -> some View {
        if active {
            modifier(AIThinkingPulseModifier())
        } else {
            self
        }
    }
}

private struct AIThinkingPulseModifier: ViewModifier {
    @State private var dim = false

    func body(content: Content) -> some View {
        content
            .opacity(dim ? 0.5 : 1)
            .animation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true), value: dim)
            .onAppear { dim = true }
    }
}
