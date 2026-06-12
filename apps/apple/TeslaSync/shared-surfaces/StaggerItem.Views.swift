//
//  StaggerItem.Views.swift
//  TeslaSync — P4 shared surface · 0194 · StaggerItem (Apple)
//
//  The presentational pieces of the staggered-entrance item — the native peers of the web behaviour: the
//  reveal modifier that maps the entrance phase to an opacity + vertical offset (web `motion.div`
//  `variants`), the entrance-animation builder that turns the pure projection into a SwiftUI `Animation`
//  honoring Reduce Motion (web `transition: { duration }` + the container's `staggerChildren` delay), and
//  the friendly empty-content leaf rendered when the item has nothing to stagger (the native "never a
//  blank box" peer). All chrome is token-driven (P1/S9); no raw hex, no Tailwind ports.
//

import SwiftUI

// MARK: - Entrance animation (web `transition: { duration }` + container `staggerChildren`)

/// Builds the SwiftUI entrance animation from the pure projection — the native boundary that turns the
/// Foundation-only timing into a SwiftUI `Animation`. Returns `nil` under reduced motion so the reveal is
/// instant (the web `hidden` variant already equals the final state). The curve is `easeOut`, matching the
/// app's `TSFadeIn` motion language; the delay is the index-derived cascade (web `staggerChildren`).
public enum StaggerItemMotion {
    /// The entrance animation, or `nil` when reduced motion is in effect.
    public static func entrance(for projection: StaggerItemProjection) -> Animation? {
        guard !projection.reduce else { return nil }
        return .easeOut(duration: projection.durationSeconds)
            .delay(projection.staggerDelaySeconds)
    }
}

// MARK: - Reveal modifier (web `motion.div` variants)

/// Maps the current entrance phase to an opacity + vertical offset — the native peer of the web
/// `motion.div` `hidden` / `show` variants. Reads the observed ``StaggerItemModel`` so the values track
/// the phase flip; the surface performs that flip inside `withAnimation`, so the change animates (or
/// settles instantly under reduced motion). The wrapper is transparent to VoiceOver: it adds no
/// accessibility traits of its own, leaving the hosted content to own its semantics.
struct StaggerItemRevealModifier: ViewModifier {
    let model: StaggerItemModel

    func body(content: Content) -> some View {
        let projection = model.projection
        return content
            .opacity(projection.opacity(for: model.phase))
            .offset(y: CGFloat(projection.offsetY(for: model.phase)))
    }
}

// MARK: - Empty-content leaf (native — never a blank box)

/// The friendly leaf a host passes when there is nothing to stagger — a labelled card rather than a bare
/// box (native HIG). The web wrapper simply hosts no children; the native peer states the condition so the
/// surface never collapses to an unexplained empty space. Token-driven (P1/S9); copy via the P1/S10
/// facade; combined into a single VoiceOver element.
struct StaggerItemEmptyContent: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "rectangle.stack")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: StaggerItemStrings.emptyTitle)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            Text(verbatim: StaggerItemStrings.emptyMessage)
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
        .accessibilityLabel(Text(verbatim: "\(StaggerItemStrings.emptyTitle). \(StaggerItemStrings.emptyMessage)"))
    }
}
