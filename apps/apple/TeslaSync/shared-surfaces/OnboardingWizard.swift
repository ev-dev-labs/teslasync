//
//  OnboardingWizard.swift
//  TeslaSync — P4 shared surface · 0131 · OnboardingWizard (Apple)
//
//  The public API of the first-run intro — the SwiftUI parity of `components/feedback/OnboardingWizard.tsx`.
//  Mount it once near the app root (in a ZStack / `.overlay` over the content) and it reproduces the web
//  behaviour end-to-end: it stays withdrawn when onboarding was already completed, reveals after the 1.5 s
//  delay on a fresh install, steps a user through the four-step walkthrough (Welcome → Connect → Configure →
//  All-Set), and dismisses on Skip / ✕ / backdrop / Esc or when a peer scene completes onboarding —
//  persisting the completion flag and broadcasting it through the ``OnboardingWizardStore`` seam (P1/S8).
//  The state-holder owns the visibility + step state and the once-only `view.opened` telemetry (P1/S11); the
//  chrome is token-driven (P1/S9) and every string flows through the P1/S10 facade. No networking.
//
//  States reproduced (the web source's REAL branches — it has no fetch, so no loading/error/stale/offline):
//    • dismissed — already onboarded, not yet revealed, or dismissed by a peer scene → renders nothing
//      (web `if (!visible) return null`). The sanctioned "withdrawn surface" disposition.
//    • presented — the blurred backdrop + the centered glass card for `steps[currentStep]`, with the
//      indicator row, Skip, Next / Get Started, and ✕, across all four steps.
//

import SwiftUI

/// The first-run onboarding walkthrough — the SwiftUI parity of `components/feedback/OnboardingWizard.tsx`.
/// Renders nothing until its 1.5 s reveal fires on a fresh install (and never, once onboarding is complete);
/// when presented it shows a blurred backdrop behind a glass card with the step indicator, the accent-tinted
/// icon, the step title + body, and the Skip / Next ▸ / Get Started / ✕ controls. Drive it with the default
/// initializer in production; inject a model for previews, tests, and hosts that supply their own store.
public struct OnboardingWizard: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        OnboardingWizardSurface.slug
    }

    @State private var model: OnboardingWizardModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The production initializer — the parity of mounting `<OnboardingWizard />`. Wires the real
    /// `UserDefaults` + `NotificationCenter` store, the `os.Logger` telemetry, and the P1/S10 string facade.
    /// Optional seams let a host swap the persistence / diagnostics without reaching into the view.
    public init(
        store: any OnboardingWizardStore = UserDefaultsOnboardingWizardStore(),
        telemetry: any OnboardingWizardTelemetry = OSLogOnboardingWizardTelemetry()
    ) {
        _model = State(initialValue: OnboardingWizardModel(store: store, telemetry: telemetry))
    }

    /// Injects a pre-built model — the preview / test / host seam (a seeded store, a spy telemetry, an
    /// already-presented step).
    public init(model: OnboardingWizardModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ZStack {
            if model.isPresented {
                OnboardingWizardBackdrop(onDismiss: { model.skip() })
                    .transition(.opacity)
                OnboardingWizardCard(model: model, reduceMotion: reduceMotion)
                    .transition(OnboardingWizardMotion.cardTransition(reduce: reduceMotion))
            }
        }
        .animation(OnboardingWizardMotion.presentation(reduce: reduceMotion), value: model.isPresented)
        .onAppear { model.begin() }
        .onDisappear { model.stop() }
    }
}
