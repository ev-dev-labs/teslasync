//
//  AiOutputPanel.Views.swift
//  TeslaSync — P4 shared surface · 0036 · AiOutputPanel (Apple)
//
//  The presentational subviews composed by `AiOutputPanel`: the Helix brand mark (the native
//  parity of `components/branding/HelixMark.tsx`), the animated thinking indicator (the native
//  parity of `components/ai/AIThinkingIndicator.tsx` — a pulsing Helix mark + bouncing dots over
//  shimmering skeleton lines), the inline Helix error row, and the accumulated narrative body.
//  All consume the P1/S10 facade and the shared P1/S9 tokens / components — no networking, no
//  Tailwind ports, no raw hex. Decorative motion is reduce-motion gated.
//

import SwiftUI

// MARK: - Helix brand mark (native parity of `components/branding/HelixMark.tsx`)

/// The Helix brand glyph — a stylised vertical double helix (two opposite-phase strands meeting
/// at the centre with two connecting rungs), the native port of the web `HelixMark` SVG
/// (`viewBox 0 0 24 24`). Decorative; the brand name is voiced by the surrounding label.
struct AiOutputPanelHelixMark: View {
    var size: CGFloat = 16
    var tint: Color = .TS.statusInfo

    var body: some View {
        AiOutputPanelHelixMarkShape()
            .stroke(
                tint,
                style: StrokeStyle(lineWidth: size * 1.75 / 24, lineCap: .round, lineJoin: .round)
            )
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// The double-helix path — the verbatim port of the web `HelixMark` SVG geometry, scaled from its
/// 24×24 viewBox to the layout rect.
struct AiOutputPanelHelixMarkShape: Shape {
    func path(in rect: CGRect) -> Path {
        let unit = min(rect.width, rect.height) / 24
        func point(_ pointX: CGFloat, _ pointY: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + pointX * unit, y: rect.minY + pointY * unit)
        }
        var path = Path()
        path.move(to: point(8, 2))
        path.addQuadCurve(to: point(12, 12), control: point(18, 7))
        path.addQuadCurve(to: point(16, 22), control: point(6, 17))
        path.move(to: point(16, 2))
        path.addQuadCurve(to: point(12, 12), control: point(6, 7))
        path.addQuadCurve(to: point(8, 22), control: point(18, 17))
        path.move(to: point(10, 7))
        path.addLine(to: point(14, 7))
        path.move(to: point(10, 17))
        path.addLine(to: point(14, 17))
        return path
    }
}

// MARK: - Thinking indicator (native parity of `components/ai/AIThinkingIndicator.tsx`)

/// The stream-open / no-text state: a pulsing Helix mark + bouncing-dot label above three
/// shimmering skeleton lines (decreasing widths to mimic prose), the native port of the web
/// `AIThinkingIndicator`. Reduce-motion-aware — the pulse / bounce stop and the static skeleton
/// remains. The default pending content of [AiOutputPanel].
public struct AiOutputPanelThinkingIndicator: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init() {}

    private var thinkingLabel: String {
        AiOutputPanelStrings.thinkingLabel
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.xs) {
                AiOutputPanelHelixMark(size: 16, tint: Color.TS.accent)
                    .aiOutputPanelPulse(active: !reduceMotion)
                Text(verbatim: thinkingLabel)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.accent)
                AiOutputPanelThinkingDots(active: !reduceMotion)
            }
            TSSkeleton(height: 12)
            TSSkeleton(width: 240, height: 12)
            TSSkeleton(width: 168, height: 12)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: thinkingLabel))
        .accessibilityAddTraits(.updatesFrequently)
    }
}

/// Three small bouncing dots after the thinking label (web `inline-flex … animate-bounce` with a
/// staggered delay). Decorative; hidden from VoiceOver and inert under reduce-motion.
struct AiOutputPanelThinkingDots: View {
    let active: Bool

    var body: some View {
        HStack(spacing: 3) {
            ForEach(0 ..< 3, id: \.self) { index in
                AiOutputPanelBounceDot(active: active, delay: Double(index) * 0.15)
            }
        }
        .accessibilityHidden(true)
    }
}

/// A single bouncing dot — animates a small vertical offset forever when `active`, otherwise rests.
struct AiOutputPanelBounceDot: View {
    let active: Bool
    let delay: Double

    @State private var lifted = false

    var body: some View {
        Circle()
            .fill(Color.TS.accent)
            .frame(width: 3, height: 3)
            .offset(y: lifted ? -3 : 0)
            .animation(bounceAnimation, value: lifted)
            .onAppear { lifted = active }
    }

    private var bounceAnimation: Animation? {
        active
            ? .easeInOut(duration: 0.45).repeatForever(autoreverses: true).delay(delay)
            : nil
    }
}

// MARK: - Error row (web `AiOutputPanel` error branch)

/// The Helix error branch — the red Helix mark + the "Helix error:" label + the resolved message
/// (web `error ?? t('ai.common.errorUnknown', 'unknown')`). Spoken as one VoiceOver element.
struct AiOutputPanelErrorRow: View {
    let message: String?

    private var errorLabel: String {
        AiOutputPanelStrings.errorLabel
    }

    private var resolved: String {
        AiOutputPanelLogic.resolveErrorMessage(message, unknown: AiOutputPanelStrings.unknownLabel)
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            AiOutputPanelHelixMark(size: 16, tint: Color.TS.statusDanger)
                .padding(.top, 1)
            (
                Text(verbatim: "\(errorLabel) ").fontWeight(.medium)
                    + Text(verbatim: resolved)
            )
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.statusDanger)
            .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(errorLabel) \(resolved)"))
    }
}

// MARK: - Narrative body (web `whitespace-pre-wrap` text)

/// The accumulated narrative — the streamed `delta.text`, with paragraph breaks preserved (the
/// parity of the web `whitespace-pre-wrap`) and selectable so the answer can be copied.
struct AiOutputPanelTextBody: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textPrimary)
            .lineSpacing(3)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .textSelection(.enabled)
    }
}

// MARK: - Reduce-motion-safe pulse

extension View {
    /// Applies a gentle repeating opacity pulse when `active`, and is otherwise inert — the
    /// reduce-motion gate shared by the thinking indicator's Helix mark.
    @ViewBuilder
    func aiOutputPanelPulse(active: Bool) -> some View {
        if active {
            modifier(AiOutputPanelPulseModifier())
        } else {
            self
        }
    }
}

private struct AiOutputPanelPulseModifier: ViewModifier {
    @State private var dim = false

    func body(content: Content) -> some View {
        content
            .opacity(dim ? 0.5 : 1)
            .animation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true), value: dim)
            .onAppear { dim = true }
    }
}
