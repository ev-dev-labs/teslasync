//
//  FadeIn.swift
//  TeslaSync — P4 shared surface · 0191 · FadeIn (Apple)
//
//  The SwiftUI surface — the public API of the fade-in entrance wrapper, the parity of the web
//  `<FadeIn>{children}</FadeIn>`. Like the web component it wraps arbitrary content and lifts + fades it in
//  on appear, deriving its timing from the native peer of `useMotionPreference(400)` and honoring Reduce
//  Motion (web `prefers-reduced-motion`): when reduced, the content renders in its final state with no
//  movement (web `initial={false}`) and the entrance delay is dropped. The reduce-motion preference binds
//  through the app's `\.accessibilityReduceMotion` environment (P1/S8, the native peer of
//  `useReducedMotion()`); the view binds through ``FadeInModel`` for the derived projection + the once-only
//  `view.opened` telemetry (P1/S11), and pushes preference changes into the holder via `.onChange` so a
//  reused wrapper re-renders faithfully. No networking, no Tailwind ports — motion is token-aware (P1/S9).
//

import SwiftUI

/// The fade-in entrance wrapper — the SwiftUI parity of `components/motion/FadeIn.tsx`. Wraps its content
/// and animates it in (opacity `0` → `1`, lifted `12` pt → `0`) over the web's `400` ms, with an optional
/// `delay` (web `delay`) for stagger orchestration. Under reduced motion the content appears immediately in
/// its final state. Mount it around a card, a row, or a section so it joins the page with the same fade the
/// web uses.
public struct FadeIn<Content: View>: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        FadeInSurface.slug
    }

    private let content: Content
    private let bindsReduceMotion: Bool
    @State private var model: FadeInModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The content-style initializer — the parity of `<FadeIn delay={…}>{children}</FadeIn>`. `delay` is the
    /// entrance delay in seconds (web `delay`; `0`, the default, fades in immediately); `defaultMs` is the
    /// entrance duration when motion is allowed (web `useMotionPreference(400)`). This path binds the live
    /// `\.accessibilityReduceMotion` environment (web `useReducedMotion()`).
    public init(
        delay: Double = 0,
        defaultMs: Int = FadeInProjector.defaultDurationMs,
        telemetry: any FadeInTelemetry = OSLogFadeInTelemetry(),
        @ViewBuilder content: () -> Content
    ) {
        self.content = content()
        bindsReduceMotion = true
        _model = State(initialValue: FadeInModel(
            input: FadeInInput(delaySeconds: delay, defaultMs: defaultMs),
            telemetry: telemetry
        ))
    }

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, a seeded preference). The
    /// host owns the preference here, so the surface does NOT sync from the (get-only, un-overridable)
    /// `\.accessibilityReduceMotion` environment; the model's `reduceMotion` is honored verbatim.
    public init(model: FadeInModel, @ViewBuilder content: () -> Content) {
        self.content = content()
        bindsReduceMotion = false
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .modifier(FadeInRevealModifier(model: model))
            .onAppear {
                if bindsReduceMotion {
                    model.update(reduceMotion: reduceMotion)
                }
                model.start()
                withAnimation(FadeInMotion.entrance(for: model.projection)) {
                    model.reveal()
                }
            }
            .onDisappear { model.stop() }
            .onChange(of: reduceMotion) { _, newValue in
                guard bindsReduceMotion else { return }
                model.update(reduceMotion: newValue)
            }
    }
}
