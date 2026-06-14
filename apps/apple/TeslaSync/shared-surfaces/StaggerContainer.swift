//
//  StaggerContainer.swift
//  TeslaSync — P4 shared surface · 0193 · StaggerContainer (Apple)
//
//  The SwiftUI surface — the public API of the staggered-entrance container, the parity of the web
//  `<StaggerContainer>{children}</StaggerContainer>`. Like the web component it wraps arbitrary content and
//  orchestrates a cascade where each child enters in sequence on appear, deriving its timing from the native
//  peer of `useMotionPreference()` and honoring Reduce Motion (web `prefers-reduced-motion`): when reduced,
//  the cascade collapses to a no-op and children render in their final state with no movement. The
//  reduce-motion preference binds through the app's `\.accessibilityReduceMotion` environment (P1/S8, the
//  native peer of `useReducedMotion()`); the view binds through ``StaggerContainerModel`` for the derived
//  projection + the once-only `view.opened` telemetry (P1/S11), and publishes the orchestration into the
//  SwiftUI environment so every descendant ``staggerChild(index:)`` inherits the cascade — the native peer
//  of Framer Motion's variant inheritance. No networking, no Tailwind ports — motion is token-aware (P1/S9).
//

import SwiftUI

/// The staggered-entrance container — the SwiftUI parity of `components/motion/StaggerContainer.tsx`. Wraps
/// its children in a vertical stack and reveals them in a cascade on appear (each child delayed by
/// `index * 0.06 s`, the web `staggerChildren`), every child lifting + fading in over the canonical `350` ms.
/// Under reduced motion the children appear immediately in their final state. Children opt into the cascade
/// with the ``SwiftUICore/View/staggerChild(index:)`` modifier (the native peer of a `<StaggerItem>`); a
/// child that does not opt in simply renders, exactly as a web child with no variants would. Pass
/// ``StaggerContainerEmptyContent`` as the content when there is nothing to show.
public struct StaggerContainer<Content: View>: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        StaggerContainerSurface.slug
    }

    private let content: Content
    private let spacing: CGFloat
    private let alignment: HorizontalAlignment
    private let bindsReduceMotion: Bool
    @State private var model: StaggerContainerModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The content-style initializer — the parity of `<StaggerContainer>{children}</StaggerContainer>`.
    /// `stepSeconds` is the per-child cascade step (web container `staggerChildren: 0.06`); `childDurationMs`
    /// is the hosted child's entrance duration (web `<StaggerItem>`'s `useMotionPreference(350)`); `spacing`
    /// + `alignment` lay the children out (the web `motion.div` block flow). This path binds the live
    /// `\.accessibilityReduceMotion` environment (web `useReducedMotion()`).
    public init(
        spacing: CGFloat = TSSpacing.md,
        alignment: HorizontalAlignment = .leading,
        stepSeconds: Double = StaggerContainerProjector.staggerStepSeconds,
        childDurationMs: Int = StaggerContainerProjector.childDefaultDurationMs,
        telemetry: any StaggerContainerTelemetry = OSLogStaggerContainerTelemetry(),
        @ViewBuilder content: () -> Content
    ) {
        self.content = content()
        self.spacing = spacing
        self.alignment = alignment
        bindsReduceMotion = true
        _model = State(initialValue: StaggerContainerModel(
            input: StaggerContainerInput(stepSeconds: stepSeconds, childDurationMs: childDurationMs),
            telemetry: telemetry
        ))
    }

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, a seeded preference).
    /// The host owns the preference here, so the surface does NOT sync from the (get-only, un-overridable)
    /// `\.accessibilityReduceMotion` environment; the model's `reduceMotion` is honored verbatim.
    public init(
        model: StaggerContainerModel,
        spacing: CGFloat = TSSpacing.md,
        alignment: HorizontalAlignment = .leading,
        @ViewBuilder content: () -> Content
    ) {
        self.content = content()
        self.spacing = spacing
        self.alignment = alignment
        bindsReduceMotion = false
        _model = State(initialValue: model)
    }

    private var context: StaggerContainerContext {
        StaggerContainerContext(projection: model.projection, phase: model.phase)
    }

    public var body: some View {
        VStack(alignment: alignment, spacing: spacing) {
            content
        }
        .environment(\.staggerContainerContext, context)
        .onAppear {
            if bindsReduceMotion {
                model.update(reduceMotion: reduceMotion)
            }
            model.start()
            model.reveal()
        }
        .onDisappear { model.stop() }
        .onChange(of: reduceMotion) { _, newValue in
            guard bindsReduceMotion else { return }
            model.update(reduceMotion: newValue)
        }
    }
}
