//
//  FleetApiSection.Onboarding.swift
//  TeslaSync — P4 feature view · 0004 · FleetApiSection (Apple)
//
//  The setup-wizard surface (port of `OnboardingWorkflow`): a progress bar, tappable
//  step chips, the active step card ("Step N: label" + detail), and the previous /
//  complete / next controls. Completion persists across launches (port of the web
//  `localStorage('devtools-onboarding')`) and auto-detects the keypair / auth steps
//  from the live queries. A danger callout surfaces a failed shared query.
//

import SwiftUI

/// The Fleet API onboarding wizard.
struct OnboardingWorkflow: View {
    let model: FleetApiSectionModel

    @AppStorage("devtools-onboarding") private var storedCompleted = "{}"
    @State private var completed: [String: Bool] = [:]
    @State private var currentStep = 0

    private var steps: [OnboardingStep] {
        model.onboardingSteps
    }

    private var progress: OnboardingProgress {
        FleetApiBuilder.onboardingProgress(steps: steps, completed: completed)
    }

    private var hasLoadError: Bool {
        if case .failed = model.fleetInfo { return true }
        if case .failed = model.publicKeyStatus { return true }
        return false
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            if hasLoadError {
                FleetWarningCallout(
                    titleKey: "error.loadFailed", titleFallback: "Failed to load data",
                    bodyKey: "devtools.fleet.loadErrorHint",
                    bodyFallback: "Some onboarding status could not be refreshed."
                )
            }
            progressSection
            stepChips
            if currentStep < steps.count { stepCard(steps[currentStep]) }
        }
        .onAppear(perform: load)
        .onChange(of: model.isKeypairConfigured) { _, _ in autoDetect() }
        .onChange(of: model.isAuthenticated) { _, _ in autoDetect() }
        .accessibilityElement(children: .contain)
    }

    private var progressSection: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack {
                FleetApiStrings.text("devtools.fleet.progress", "Progress")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer(minLength: TSSpacing.sm)
                Text(verbatim: progressText)
                    .font(Font.TS.caption)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textSecondary)
            }
            ProgressView(value: Double(progress.completed), total: Double(max(progress.total, 1)))
                .tint(Color.TS.accent)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: FleetApiAccessibility.progressLabel(progress)))
    }

    private var progressText: String {
        let percent = FleetApiBuilder.formatInt(Int(progress.percent.rounded()))
        return "\(progress.completed) / \(progress.total) (\(percent)%)"
    }

    private var stepChips: some View {
        FlowChips(steps: steps, currentStep: currentStep, completed: completed) { index in
            currentStep = index
        }
    }

    private func stepCard(_ step: OnboardingStep) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                stepIcon(step)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: "\(stepNumber): \(step.label)")
                        .font(Font.TS.panel)
                        .foregroundStyle(Color.TS.textPrimary)
                    Text(verbatim: step.detail)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            navButtons(step)
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .tsGlassPanel()
    }

    private var stepNumber: String {
        FleetApiStrings.count("devtools.onboarding.stepLabel", "Step %lld", currentStep + 1)
    }

    private func stepIcon(_ step: OnboardingStep) -> some View {
        let done = completed[step.id] == true
        let tone: FleetTone = done ? .green : .cyan
        return Image(systemName: done ? "checkmark.circle.fill" : step.systemImage)
            .font(.system(size: 18, weight: .semibold))
            .foregroundStyle(tone.color)
            .frame(width: 40, height: 40)
            .background(tone.color.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .accessibilityHidden(true)
    }

    private func navButtons(_ step: OnboardingStep) -> some View {
        let done = completed[step.id] == true
        return HStack(spacing: TSSpacing.sm) {
            FleetButton(
                titleKey: "devtools.fleet.previous", fallback: "Previous",
                variant: .ghost, systemImage: "chevron.left", disabled: currentStep == 0
            ) { if currentStep > 0 { currentStep -= 1 } }
            FleetButton(
                titleKey: done ? "devtools.fleet.completed" : "devtools.fleet.markComplete",
                fallback: done ? "Completed" : "Mark Complete",
                variant: done ? .secondary : .primary, systemImage: "checkmark"
            ) { markComplete(step) }
            FleetButton(
                titleKey: "devtools.fleet.next", fallback: "Next",
                variant: .ghost, systemImage: "chevron.right", disabled: currentStep >= steps.count - 1
            ) { if currentStep < steps.count - 1 { currentStep += 1 } }
        }
    }

    // MARK: Persistence + state

    private func load() {
        let data = Data(storedCompleted.utf8)
        if let decoded = try? JSONDecoder().decode([String: Bool].self, from: data) {
            completed = decoded
        }
        autoDetect()
    }

    private func autoDetect() {
        let next = FleetApiBuilder.autoDetectCompleted(
            completed,
            configured: model.isKeypairConfigured,
            authenticated: model.isAuthenticated
        )
        if next != completed { persist(next) }
    }

    private func markComplete(_ step: OnboardingStep) {
        var next = completed
        next[step.id] = true
        persist(next)
        if currentStep < steps.count - 1 { currentStep += 1 }
    }

    private func persist(_ next: [String: Bool]) {
        completed = next
        if let data = try? JSONEncoder().encode(next), let string = String(data: data, encoding: .utf8) {
            storedCompleted = string
        }
    }
}

// MARK: - Step chips (wrapping)

/// The tappable step indicator chips, wrapping across lines.
private struct FlowChips: View {
    let steps: [OnboardingStep]
    let currentStep: Int
    let completed: [String: Bool]
    let onTap: (Int) -> Void

    var body: some View {
        ViewThatFits(in: .horizontal) {
            row
            ScrollView(.horizontal, showsIndicators: false) { row }
        }
    }

    private var row: some View {
        HStack(spacing: TSSpacing.xs) {
            ForEach(Array(steps.enumerated()), id: \.element.id) { index, step in
                chip(index: index, step: step)
            }
        }
    }

    private func chip(index: Int, step: OnboardingStep) -> some View {
        let done = completed[step.id] == true
        let tone: FleetTone = done ? .green : (index == currentStep ? .cyan : .neutral)
        return Button { onTap(index) } label: {
            FleetBadge(text: Text(verbatim: step.label), tone: tone, dot: index == currentStep)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: step.label))
        .accessibilityAddTraits(index == currentStep ? [.isSelected, .isButton] : .isButton)
    }
}
