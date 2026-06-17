import SwiftUI

// MARK: - Runtime-key localization bridge

/// Resolves a runtime string key to its localized value from the platform string catalog
/// (`Localizable.xcstrings`), so model-provided keys render localized (not verbatim — the
/// `LocalizedStringKey(String)` initializer would bypass the lookup). Static literals elsewhere use
/// `LocalizedStringKey` literals directly; the dynamic checklist strings flow through here.
enum OnboardingText {
    static func localized(_ key: String) -> String {
        String(localized: String.LocalizationValue(key))
    }
}

// MARK: - Stepper (web `Stepper`)

/// The vertical checklist (web `Stepper` `<ol>`): each step shows a done / current / pending
/// indicator, its title + description, and — only while it is the current step — its call-to-action.
/// A connector line joins the indicators. The resolved state is derived across the whole list so the
/// first not-done step is the only `current` one (web `stateOf`).
struct OnboardingChecklistStepper: View {
    let steps: [OnboardingChecklistStep]
    let onAction: (OnboardingStepCTA) -> Void

    private var doneFlags: [Bool] {
        steps.map(\.done)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            ForEach(Array(steps.enumerated()), id: \.element.id) { index, step in
                OnboardingStepRow(
                    step: step,
                    state: OnboardingStepState.resolve(done: doneFlags, at: index),
                    index: index,
                    isLast: index == steps.count - 1,
                    onAction: onAction
                )
            }
        }
        .accessibilityLabel(Text("onboarding.intro.title"))
    }
}

// MARK: - Step row (web `Stepper` `<li>`)

/// One checklist row: the indicator + connector column and the title / description / CTA column.
struct OnboardingStepRow: View {
    let step: OnboardingChecklistStep
    let state: OnboardingStepState
    let index: Int
    let isLast: Bool
    let onAction: (OnboardingStepCTA) -> Void

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.lg) {
            indicatorColumn
            content
        }
        .accessibilityElement(children: .contain)
    }

    private var indicatorColumn: some View {
        VStack(spacing: TSSpacing.xs) {
            OnboardingStepIndicator(state: state, index: index)
            if !isLast {
                Rectangle()
                    .fill(state == .done ? Color.TS.statusSuccess.opacity(0.4) : Color.TS.border)
                    .frame(width: 1)
                    .frame(minHeight: 28)
                    .frame(maxHeight: .infinity)
                    .accessibilityHidden(true)
            }
        }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: OnboardingText.localized(step.titleKey))
                .font(Font.TS.panel)
                .foregroundStyle(titleColor)
                .accessibilityAddTraits(.isHeader)
            Text(verbatim: OnboardingText.localized(step.descriptionKey))
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            if state == .current {
                OnboardingStepCTAButton(cta: step.cta, onAction: onAction)
                    .padding(.top, TSSpacing.xs)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var titleColor: Color {
        switch state {
        case .done, .pending: Color.TS.textSecondary
        case .current: Color.TS.textPrimary
        }
    }
}

// MARK: - Step indicator (web indicator circle)

/// The leading circle: a check when done (success tint), a spinner when current (accent tint), or
/// the 1-based step number when pending (muted). Decorative — the row's title + description carry
/// the semantics (web marks the indicator `aria-hidden="true"`).
struct OnboardingStepIndicator: View {
    let state: OnboardingStepState
    let index: Int

    var body: some View {
        ZStack {
            Circle()
                .fill(tint.opacity(0.18))
                .overlay(Circle().strokeBorder(tint.opacity(0.5), lineWidth: 1))
            symbol
        }
        .frame(width: 36, height: 36)
        .accessibilityHidden(true)
    }

    @ViewBuilder
    private var symbol: some View {
        switch state {
        case .done:
            Image(systemName: "checkmark")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(tint)
        case .current:
            ProgressView()
                .controlSize(.small)
        case .pending:
            Text(verbatim: "\(index + 1)")
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .foregroundStyle(tint)
        }
    }

    private var tint: Color {
        switch state {
        case .done: Color.TS.statusSuccess
        case .current: Color.TS.accent
        case .pending: Color.TS.textMuted
        }
    }
}

// MARK: - Step CTA (web `renderCta`)

/// Renders the current step's call-to-action: a primary route push, an outline refresh (spinning +
/// disabled while a refetch is in flight), or an outline external-doc link.
struct OnboardingStepCTAButton: View {
    let cta: OnboardingStepCTA
    let onAction: (OnboardingStepCTA) -> Void

    var body: some View {
        switch cta {
        case let .navigate(_, labelKey):
            TSButton(variant: .primary, size: .small, action: { onAction(cta) }, label: {
                HStack(spacing: TSSpacing.xs) {
                    Text(verbatim: OnboardingText.localized(labelKey))
                    Image(systemName: "arrow.forward").font(.system(size: 12, weight: .semibold))
                }
            })
        case let .refresh(labelKey, busy):
            TSButton(variant: .secondary, size: .small, action: { onAction(cta) }, label: {
                HStack(spacing: TSSpacing.xs) {
                    if busy {
                        ProgressView().controlSize(.small)
                    } else {
                        Image(systemName: "arrow.clockwise").font(.system(size: 12, weight: .semibold))
                    }
                    Text(verbatim: OnboardingText.localized(labelKey))
                }
            })
            .disabled(busy)
        case let .externalDoc(_, labelKey):
            TSButton(variant: .secondary, size: .small, action: { onAction(cta) }, label: {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "book").font(.system(size: 12, weight: .semibold))
                    Text(verbatim: OnboardingText.localized(labelKey))
                    Image(systemName: "arrow.up.right").font(.system(size: 10, weight: .semibold))
                        .accessibilityHidden(true)
                }
            })
        }
    }
}

// MARK: - Loading skeleton (web `PageContainer` loader)

/// The first-fetch loading state for the checklist (web `isLoading`): shimmer rows standing in for
/// the three steps so the panel is populated, never blank, while the status resolves.
struct OnboardingStepperSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            ForEach(0 ..< 3, id: \.self) { _ in
                HStack(alignment: .top, spacing: TSSpacing.lg) {
                    Circle()
                        .fill(Color.TS.border.opacity(0.3))
                        .frame(width: 36, height: 36)
                    VStack(alignment: .leading, spacing: TSSpacing.sm) {
                        TSSkeleton(width: 220, height: 16)
                        TSSkeleton(height: 12)
                        TSSkeleton(width: 280, height: 12)
                    }
                }
            }
        }
        .accessibilityLabel(Text("loading"))
    }
}
