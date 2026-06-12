//
//  StaggerItem.swift
//  TeslaSync — P4 shared surface · 0194 · StaggerItem (Apple)
//
//  The SwiftUI surface — the public API of the staggered-entrance item, the parity of the web
//  `<StaggerItem>{children}</StaggerItem>`. Like the web component it wraps arbitrary content and lifts +
//  fades it in on appear, deriving its timing from the native peer of `useMotionPreference(350)` and
//  honoring Reduce Motion (web `prefers-reduced-motion`): when reduced, the content renders in its final
//  state with no movement. The reduce-motion preference binds through the app's
//  `\.accessibilityReduceMotion` environment (P1/S8, the native peer of `useReducedMotion()`); the view
//  binds through ``StaggerItemModel`` for the derived projection + the once-only `view.opened` telemetry
//  (P1/S11), and pushes preference changes into the holder via `.onChange` so a reused item re-renders
//  faithfully. No networking, no Tailwind ports — motion is token-aware (P1/S9).
//

import SwiftUI

/// The staggered-entrance item — the SwiftUI parity of `components/motion/StaggerItem.tsx`. Wraps its
/// content and animates it in (opacity `0` → `1`, lifted `15` pt → `0`) over the web's `350` ms, with an
/// optional index-derived cascade delay (web `StaggerContainer`'s `staggerChildren: 0.06`). Under reduced
/// motion the content appears immediately in its final state. Mount it around a card, a row, or a section
/// so it joins the page with the same cascade the web uses.
public struct StaggerItem<Content: View>: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        StaggerItemSurface.slug
    }

    private let content: Content
    private let bindsReduceMotion: Bool
    @State private var model: StaggerItemModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The content-style initializer — the parity of `<StaggerItem>{children}</StaggerItem>`. `index` is
    /// the cascade position (web container `staggerChildren`; `0`, the default, means no delay);
    /// `defaultMs` is the entrance duration when motion is allowed (web `useMotionPreference(350)`). This
    /// path binds the live `\.accessibilityReduceMotion` environment (web `useReducedMotion()`).
    public init(
        index: Int = 0,
        defaultMs: Int = StaggerItemProjector.defaultDurationMs,
        telemetry: any StaggerItemTelemetry = OSLogStaggerItemTelemetry(),
        @ViewBuilder content: () -> Content
    ) {
        self.content = content()
        bindsReduceMotion = true
        _model = State(initialValue: StaggerItemModel(
            input: StaggerItemInput(index: index, defaultMs: defaultMs),
            telemetry: telemetry
        ))
    }

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, a seeded preference).
    /// The host owns the preference here, so the surface does NOT sync from the (get-only, un-overridable)
    /// `\.accessibilityReduceMotion` environment; the model's `reduceMotion` is honored verbatim.
    public init(model: StaggerItemModel, @ViewBuilder content: () -> Content) {
        self.content = content()
        bindsReduceMotion = false
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .modifier(StaggerItemRevealModifier(model: model))
            .onAppear {
                if bindsReduceMotion {
                    model.update(reduceMotion: reduceMotion)
                }
                model.start()
                withAnimation(StaggerItemMotion.entrance(for: model.projection)) {
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
