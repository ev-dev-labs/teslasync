//
//  FadeIn.Views.swift
//  TeslaSync — P4 shared surface · 0191 · FadeIn (Apple)
//
//  The presentational pieces of the fade-in entrance wrapper — the native peers of the web behaviour: the
//  reveal modifier that maps the entrance phase to an opacity + vertical offset (web `motion.div` `initial`
//  / `animate`), the entrance-animation builder that turns the pure projection into a SwiftUI `Animation`
//  honoring Reduce Motion (web `transition: { duration, delay, ease: 'easeOut' }`), and the friendly
//  empty-content leaf rendered when the wrapper has nothing to fade in (the native "never a blank box"
//  peer). All chrome is token-driven (P1/S9); no raw hex, no Tailwind ports.
//

import SwiftUI

// MARK: - Entrance animation (web `transition: { duration, delay, ease }`)

/// Builds the SwiftUI entrance animation from the pure projection — the native boundary that turns the
/// Foundation-only timing into a SwiftUI `Animation`. Returns `nil` under reduced motion so the reveal is
/// instant (the web `initial={false}` already equals the final state). The curve is `easeOut`, matching the
/// web `transition.ease`; the delay is the web `transition.delay` (suppressed to `0` under reduced motion).
public enum FadeInMotion {
    /// The entrance animation, or `nil` when reduced motion is in effect.
    public static func entrance(for projection: FadeInProjection) -> Animation? {
        guard !projection.reduce else { return nil }
        return .easeOut(duration: projection.durationSeconds)
            .delay(projection.delaySeconds)
    }
}

// MARK: - Reveal modifier (web `motion.div` initial → animate)

/// Maps the current entrance phase to an opacity + vertical offset — the native peer of the web `motion.div`
/// `initial` → `animate` transition. Reads the observed ``FadeInModel`` so the values track the phase flip;
/// the surface performs that flip inside `withAnimation`, so the change animates (or settles instantly under
/// reduced motion). The wrapper is transparent to VoiceOver: it adds no accessibility traits of its own,
/// leaving the hosted content to own its semantics.
struct FadeInRevealModifier: ViewModifier {
    let model: FadeInModel

    func body(content: Content) -> some View {
        let projection = model.projection
        return content
            .opacity(projection.opacity(for: model.phase))
            .offset(y: CGFloat(projection.offsetY(for: model.phase)))
    }
}

// MARK: - Empty-content leaf (native — never a blank box)

/// The friendly leaf a host passes when there is nothing to fade in — a labelled card rather than a bare box
/// (native HIG). The web wrapper simply hosts no children; the native peer states the condition so the
/// surface never collapses to an unexplained empty space. Token-driven (P1/S9); copy via the P1/S10 facade;
/// combined into a single VoiceOver element.
struct FadeInEmptyContent: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "sparkles")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: FadeInStrings.emptyTitle)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            Text(verbatim: FadeInStrings.emptyMessage)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.lg)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(FadeInStrings.emptyTitle). \(FadeInStrings.emptyMessage)"))
    }
}
