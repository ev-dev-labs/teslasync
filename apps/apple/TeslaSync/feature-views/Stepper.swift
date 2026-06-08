//
//  Stepper.swift
//  TeslaSync — P4 feature view · 0195 · OnboardingStepper (Apple)
//
//  The composable onboarding step list — the SwiftUI parity of
//  features/onboarding/components/OnboardingStepper.tsx. Binds through `StepperModel`
//  (P1/S8); no networking lives here. Renders the web leaf's ordered step list
//  (done / current / pending rows with their while-current CTA) plus the P4
//  states the leaf delegates to its parent: loading skeleton, never-a-blank-box
//  empty, query-error retry, and the stale/offline status chips.
//

import SwiftUI

/// The composable onboarding step list — the SwiftUI parity of
/// `features/onboarding/components/OnboardingStepper.tsx`, binding through `StepperModel`
/// (P1/S8). No networking lives here.
public struct OnboardingStepper: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "OnboardingStepper"

    @State private var model: StepperModel

    public init(model: StepperModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.isOffline {
                StepperStatusChip(copy: StepperCopy.offline, tone: .muted, systemImage: "wifi.slash")
            }
            if model.isStale {
                StepperStatusChip(
                    copy: StepperCopy.stale,
                    tone: .accent,
                    systemImage: "clock.badge.exclamationmark"
                )
            }
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        switch model.render {
        case .loading:
            StepperLoadingView()
        case .failed:
            StepperErrorView(onRetry: { model.refresh() })
        case .empty:
            StepperEmptyView()
        case let .steps(rows):
            StepperListView(rows: rows) { row in
                model.activateStep(row.id)
            }
        }
    }
}
