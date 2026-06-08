//
//  Stepper.Previews.swift
//  TeslaSync — P4 feature view · 0195 · Stepper (Apple)
//
//  Xcode previews for the step list + each P4 state (loading / empty / error /
//  stale / offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: StepperInput) -> StepperModel {
        let source = InMemoryStepperSource(initial: input)
        let model = StepperModel(source: source)
        model.start()
        return model
    }

    @MainActor
    private func previewSurface(_ input: StepperInput) -> some View {
        ScrollView {
            Stepper(model: previewModel(input))
                .padding()
        }
        .background(Color.TS.bg)
    }

    private let previewSteps: [StepperStep] = [
        StepperStep(
            key: "connect",
            title: "Connect your Tesla account",
            description: "Authorize TeslaSync with the Fleet API so it can read your vehicles.",
            isDone: true
        ),
        StepperStep(
            key: "telemetry",
            title: "Enable Fleet Telemetry",
            description: "Stream live signals from your vehicle for real-time drive and charge tracking.",
            isDone: false,
            cta: StepperStepCTA(label: "Set up streaming")
        ),
        StepperStep(
            key: "automations",
            title: "Create your first automation",
            description: "Precondition the cabin, cap charging, or get alerts when something changes.",
            isDone: false
        )
    ]

    private let completedSteps: [StepperStep] = previewSteps.map { step in
        StepperStep(
            key: step.key,
            title: step.title,
            description: step.description,
            isDone: true,
            cta: step.cta
        )
    }

    #Preview("Steps (done · current · pending)") {
        previewSurface(StepperInput(phase: .loaded(previewSteps)))
    }

    #Preview("All complete") {
        previewSurface(StepperInput(phase: .loaded(completedSteps)))
    }

    #Preview("Empty (no steps)") {
        previewSurface(StepperInput(phase: .loaded([])))
    }

    #Preview("Loading") {
        previewSurface(StepperInput(phase: .loading))
    }

    #Preview("Error") {
        previewSurface(StepperInput(phase: .failed))
    }

    #Preview("Stale (auto-refresh)") {
        previewSurface(StepperInput(phase: .loaded(previewSteps), isStale: true))
    }

    #Preview("Offline (cached)") {
        previewSurface(StepperInput(phase: .loaded(previewSteps), isOffline: true))
    }
#endif
