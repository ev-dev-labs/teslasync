//
//  SuspenseProgressBoundary.Views.swift
//  TeslaSync — P4 shared surface · 0141 · SuspenseProgressBoundary (Apple)
//
//  The presentational subviews composed by `SuspenseProgressBoundary`: the determinate top progress bar
//  (the native peer of the web `components/feedback/TopProgress.tsx`) and the fallback ⇄ content
//  container (the native peer of `<Suspense fallback={…}>{children}</Suspense>`). The bar is the visible
//  consequence of the bridge — a slim strip along the top whose width tracks the controller's asymptotic
//  trickle while any consumer is active, then vanishes when the last one stops.
//
//  Colour comes from the P1/S9 tokens: the bar paints a cyan → indigo → emerald gradient built from the
//  `accent`, `chartSeriesSpeed`, and `statusSuccess` tones — the parity of the web
//  `from-cyan-400 via-indigo-400 to-emerald-400` palette-tone classes (chosen there precisely so the bar
//  never trips the neon-text audit). The strip honours Reduce Motion by omitting the width transition
//  while still appearing, so the loading affordance is preserved. VoiceOver reads it as a progress
//  indicator labelled from the P1/S10 `global.loading` key with the whole-percent value.
//

import SwiftUI

// MARK: - Top progress bar (web `TopProgress`)

/// The determinate top-of-viewport strip driven by a `SuspenseProgressController`. Renders nothing while
/// the controller is idle (web `if (!active) return null`); while active it fills to `valueNow` of the
/// available width over the cyan → indigo → emerald gradient. The width eases on change unless Reduce
/// Motion is on (web honours `prefers-reduced-motion`).
public struct SuspenseProgressTopBar: View {
    private let controller: SuspenseProgressController

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(controller: SuspenseProgressController) {
        self.controller = controller
    }

    public var body: some View {
        GeometryReader { geometry in
            if controller.isActive {
                Capsule()
                    .fill(barGradient)
                    .frame(width: filledWidth(in: geometry.size.width), alignment: .leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .shadow(color: Color.TS.accent.opacity(0.55), radius: 4)
                    .animation(
                        reduceMotion ? nil : .linear(duration: TSMotion.fastDuration),
                        value: controller.valueNow
                    )
            }
        }
        .frame(height: 2)
        .allowsHitTesting(false)
        .accessibilityElement()
        .accessibilityAddTraits(.updatesFrequently)
        .accessibilityLabel(Text(LocalizedStringKey(SuspenseProgressBoundaryMeta.loadingLabelKey)))
        .accessibilityValue(Text(verbatim: "\(controller.valueNow)%"))
        .accessibilityHidden(!controller.isActive)
    }

    private var barGradient: LinearGradient {
        LinearGradient(
            colors: [Color.TS.accent, Color.TS.chartSeriesSpeed, Color.TS.statusSuccess],
            startPoint: .leading,
            endPoint: .trailing
        )
    }

    private func filledWidth(in total: Double) -> Double {
        guard total.isFinite, total > 0 else { return 0 }
        return total * Double(controller.valueNow) / 100
    }
}

// MARK: - App-root bar (web `<TopProgress />` mounted once at the root)

/// A convenience root bar bound to the shared controller — the parity of mounting `<TopProgress />` once
/// at the app root so every boundary's activity surfaces in one strip. Inject a controller in tests /
/// previews; the running app uses the shared channel.
public struct SuspenseProgressBar: View {
    private let controller: SuspenseProgressController

    public init(controller: SuspenseProgressController = .shared) {
        self.controller = controller
    }

    public var body: some View {
        SuspenseProgressTopBar(controller: controller)
    }
}

// MARK: - Boundary container (web `<Suspense fallback>{children}`)

/// Swaps between the caller's `fallback` (while `loading`) and `content` (once `resolved`), the parity of
/// `<Suspense fallback={…}>{children}</Suspense>`. When `showsProgressBar` is set it overlays the
/// `SuspenseProgressTopBar` along the top edge so a standalone boundary demonstrates the whole bridge.
/// The swap cross-fades over the standard motion token, instant under Reduce Motion. Both branches always
/// render a real subtree, so the surface is never a blank box.
struct SuspenseBoundaryContainer<Content: View, Fallback: View>: View {
    let phase: SuspensePhase
    let showsProgressBar: Bool
    let controller: SuspenseProgressController
    @ViewBuilder let content: () -> Content
    @ViewBuilder let fallback: () -> Fallback

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack(alignment: .top) {
            phaseContent
                .animation(TSAnimation.standard(reduceMotion: reduceMotion), value: phase)

            if showsProgressBar {
                SuspenseProgressTopBar(controller: controller)
            }
        }
    }

    @ViewBuilder
    private var phaseContent: some View {
        switch phase {
        case .loading:
            fallback()
                .transition(.opacity)
                .accessibilityLabel(Text(LocalizedStringKey(SuspenseProgressBoundaryMeta.loadingLabelKey)))
        case .resolved:
            content()
                .transition(.opacity)
        }
    }
}
