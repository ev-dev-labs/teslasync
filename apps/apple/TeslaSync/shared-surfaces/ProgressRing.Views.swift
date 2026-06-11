//
//  ProgressRing.Views.swift
//  TeslaSync — P4 shared surface · 0099 · ProgressRing (Apple)
//
//  The presentational subviews composed by `ProgressRing`: the gauge (the track ring + the animated
//  fill arc + the optional centered text) and the optional caption below it — the native peer of the
//  web `<svg>` with its two `<circle>`s and the absolutely-centered `<div>`. The track ring is always
//  painted, so the surface is never a blank box even at zero fill. The arc reveals from zero to
//  `fillFraction` on appear and re-animates on change over the `--duration-slow` token (web
//  `transition-all duration-slow`), honoring Reduce Motion with an instant set.
//
//  Colour comes from the use-site: the fill arc takes the caller's tint (web `color`, default the P1/S9
//  `Color.TS.accent` token), the track is the hairline `Color.TS.border`, the primary centered text is
//  `Color.TS.textPrimary`, and the secondary centered text + caption are `Color.TS.textMuted` — the
//  native parity of the web `--text-primary` / `--text-muted` reads. The primary figure is monospaced
//  (web `tabular-nums`) so a rolling value does not shimmer-shift.
//

import SwiftUI

// MARK: - Gauge (web `<svg>` ring + centered overlay + caption)

/// The circular progress gauge. A `ZStack` layers the always-present track ring under the trimmed,
/// rounded-cap fill arc (rotated -90° so it starts at twelve o'clock, web `-rotate-90`) and, when the
/// caller supplies centered text, the centered primary / secondary labels. An optional caption sits
/// below. VoiceOver reads the whole gauge as one element via the composed label.
struct ProgressRingGauge: View {
    let resolved: ProgressRingResolved
    let input: ProgressRingInput
    let color: Color
    let accessibilityLabel: String

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var animatedFraction: Double = 0

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            ring
            if let caption = ProgressRingAccessibility.nonEmpty(input.label) {
                Text(verbatim: caption)
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    private var ring: some View {
        let inset = CGFloat(resolved.strokeWidth) / 2
        return ZStack {
            Circle()
                .inset(by: inset)
                .stroke(Color.TS.border, lineWidth: CGFloat(resolved.strokeWidth))
            Circle()
                .inset(by: inset)
                .trim(from: 0, to: animatedFraction)
                .stroke(
                    color,
                    style: StrokeStyle(lineWidth: CGFloat(resolved.strokeWidth), lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
            if resolved.hasCenter {
                centerOverlay
            }
        }
        .frame(width: CGFloat(resolved.size), height: CGFloat(resolved.size))
        .onAppear { reveal(to: resolved.fillFraction) }
        .onChange(of: resolved.fillFraction) { _, newValue in reveal(to: newValue) }
    }

    private var centerOverlay: some View {
        VStack(spacing: 1) {
            if let centerLabel = input.centerLabel {
                Text(verbatim: centerLabel)
                    .font(.system(size: CGFloat(resolved.mainFontSize), weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
            }
            if let centerSubLabel = input.centerSubLabel {
                Text(verbatim: centerSubLabel)
                    .font(.system(size: CGFloat(resolved.subFontSize)))
                    .textCase(.uppercase)
                    .tracking(0.5)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, CGFloat(resolved.strokeWidth))
        .accessibilityHidden(true)
    }

    private func reveal(to target: Double) {
        if reduceMotion {
            animatedFraction = target
        } else {
            withAnimation(.easeInOut(duration: TSMotion.slowDuration)) { animatedFraction = target }
        }
    }
}
