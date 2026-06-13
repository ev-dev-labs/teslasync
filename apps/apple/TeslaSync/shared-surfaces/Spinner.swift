//
//  Spinner.swift
//  TeslaSync — P4 shared surface · 0140 · Spinner (Apple)
//
//  The SwiftUI surface — the public API of the brand loading mark, the parity of the web
//  `<Spinner size label />`. Like the web component it draws a glowing lightning bolt that strikes, fills,
//  holds, and fades on a loop, deriving its motion from the native peer of `useMotionPreference()` and
//  honoring Reduce Motion (web `prefers-reduced-motion`): when reduced, the bolt renders as a static,
//  fully-filled mark with the same glow and no draw cycle. The reduce-motion preference binds through the
//  app's `\.accessibilityReduceMotion` environment (P1/S8, the native peer of `useReducedMotion()`); the
//  view binds through ``SpinnerModel`` for the derived projection + the once-only `view.opened` telemetry
//  (P1/S11), and pushes preference changes into the holder via `.onChange` so a reused mark re-renders
//  faithfully. The bolt is decorative; the surface itself carries the status accessibility label (web
//  `role="status"` + `aria-label={label ?? 'Loading'}`). No networking, no Tailwind ports.
//

import SwiftUI

/// The brand loading mark — the SwiftUI parity of `components/feedback/Spinner.tsx`. Renders a glowing
/// lightning bolt at one of three sizes (`sm` / `md` / `lg`) with an optional caption under it, and is
/// announced to VoiceOver as a busy status. Mount it wherever a surface is fetching its first data, the same
/// loading affordance the web app shows.
public struct Spinner: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        SpinnerSurface.slug
    }

    private let bindsReduceMotion: Bool
    @State private var model: SpinnerModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The prop-style initializer — the parity of `<Spinner size label />`. `size` selects the mark scale
    /// (web `size`, default `md`); `label` is the optional caption + accessibility name (web `label`) and,
    /// when omitted, the surface falls back to the localized `"Loading"` label. This path binds the live
    /// `\.accessibilityReduceMotion` environment (web `useReducedMotion()`).
    public init(
        size: SpinnerSize = .md,
        label: String? = nil,
        telemetry: any SpinnerTelemetry = OSLogSpinnerTelemetry()
    ) {
        bindsReduceMotion = true
        _model = State(initialValue: SpinnerModel(
            input: SpinnerInput(size: size, label: label),
            telemetry: telemetry
        ))
    }

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, a seeded preference).
    /// The host owns the preference here, so the surface does NOT sync from the (get-only, un-overridable)
    /// `\.accessibilityReduceMotion` environment; the model's `reduceMotion` is honored verbatim.
    public init(model: SpinnerModel) {
        bindsReduceMotion = false
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(spacing: TSSpacing.md) {
            SpinnerBoltMark(projection: model.projection)
            if model.projection.showsLabelText {
                Text(verbatim: model.captionText)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: model.accessibilityLabel))
        .accessibilityAddTraits(.updatesFrequently)
        .onAppear {
            if bindsReduceMotion {
                model.update(reduceMotion: reduceMotion)
            }
            model.start()
        }
        .onDisappear { model.stop() }
        .onChange(of: reduceMotion) { _, newValue in
            guard bindsReduceMotion else { return }
            model.update(reduceMotion: newValue)
        }
    }
}
