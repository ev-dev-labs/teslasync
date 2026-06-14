//
//  OnboardingWizard.Previews.swift
//  TeslaSync — P4 shared surface · 0131 · OnboardingWizard (Apple)
//
//  Xcode previews for every real branch of the first-run intro: the four presented steps (Welcome → Connect
//  → Configure → All-Set, each with its accent + indicator state + Next / Get-Started swap) and the
//  dismissed state (already onboarded → renders nothing). DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func stagedWizard(_ label: String, step: Int) -> some View {
        let model = OnboardingWizardModel(
            store: InMemoryOnboardingWizardStore(hasOnboarded: false),
            telemetry: OSLogOnboardingWizardTelemetry(),
            revealDelay: .zero,
            initiallyPresented: true,
            initialStep: step
        )
        return ZStack {
            LinearGradient(
                colors: [Color.TS.bg, Color.TS.surface],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()
            OnboardingWizard(model: model)
        }
        .overlay(alignment: .top) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
                .padding(TSSpacing.sm)
        }
    }

    #Preview("Step 1 — Welcome") {
        stagedWizard("presented · step 1 of 4 · accent primary", step: 0)
    }

    #Preview("Step 2 — Connect") {
        stagedWizard("presented · step 2 of 4 · accent success", step: 1)
    }

    #Preview("Step 3 — Configure") {
        stagedWizard("presented · step 3 of 4 · accent warning", step: 2)
    }

    #Preview("Step 4 — All Set") {
        stagedWizard("presented · step 4 of 4 · Get Started", step: 3)
    }

    #Preview("Dismissed — already onboarded") {
        let model = OnboardingWizardModel(
            store: InMemoryOnboardingWizardStore(hasOnboarded: true),
            telemetry: OSLogOnboardingWizardTelemetry(),
            revealDelay: .zero
        )
        return ZStack {
            Color.TS.bg.ignoresSafeArea()
            Text(verbatim: "Onboarding complete — the wizard renders nothing.")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
            OnboardingWizard(model: model)
        }
    }
#endif
