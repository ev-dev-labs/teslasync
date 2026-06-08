//
//  OptimizerSection.swift
//  TeslaSync — P4 feature view · 0104 · OptimizerSection (Apple)
//
//  The charging-optimizer section — the SwiftUI parity of the web
//  features/charging/components/charging-list/OptimizerSection.tsx. Renders the
//  conditional savings banner, the Charging Habits / Battery-Friendly Score / Cost
//  Analysis trio, the conditional Cost Heatmap, and the Optimization Recommendations
//  panel (with its empty state), plus every native state (loading / loaded /
//  per-panel empty / error / stale / offline). Binding flows through `OptimizerModel`
//  (P1/S8); no networking lives here — the web section takes `optimizer` as a prop,
//  the native model is fed by an `OptimizerSource`.
//

import SwiftUI

// MARK: - String facade `Text` helper (kept here so the Model layer stays SwiftUI-free)

public extension OptimizerSection {
    /// A `Text` for a facade key, rendered verbatim so the resolved (possibly
    /// localized) value is never re-interpreted as a SwiftUI string key.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: OptimizerStrings.string(key, fallback))
    }
}

// MARK: - OptimizerSection (the feature surface)

/// The charging-optimizer section. Switches over the model's render phase and, in the
/// loaded phase, composes the web's render tree: an optional savings banner, the
/// three habit/score/cost panels, an optional heatmap, and the recommendations panel
/// (which owns its own empty state, matching the web, which never hides a panel).
public struct OptimizerSection: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "OptimizerSection"

    @State private var model: OptimizerModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// - Parameter model: the bound view-model (built over an `OptimizerSource`).
    public init(model: OptimizerModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: model.phase)
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Self.text("charging.optimizer.a11y", "Charging optimizer"))
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            OptimizerSkeleton()
        case let .error(message):
            OptimizerErrorView(message: message) { model.refresh() }
        case .loaded:
            loadedContent
        }
    }

    private var loadedContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            if model.connection != .live {
                OptimizerFreshnessBanner(connection: model.connection) { model.refresh() }
            }
            if model.savingsBannerVisible {
                OptimizerSavingsBanner(title: savingsTitle, detail: savingsDetail)
            }
            statsGrid
            if model.heatmapVisible {
                OptimizerHeatmapPanel(
                    entries: model.optimizer.weeklyHeatmap,
                    peakCostPerKwh: model.optimizer.costAnalysis.peakCostPerKwh,
                    localize: model.localize,
                    formatting: model.formatting
                )
            }
            OptimizerRecommendationsPanel(
                recommendations: model.recommendations,
                localize: model.localize,
                formatting: model.formatting
            )
        }
    }

    /// The web `grid-cols-1 lg:grid-cols-3` trio: stacks on compact widths and lays
    /// out up to three columns on regular widths via an adaptive grid.
    private var statsGrid: some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 240), spacing: TSSpacing.lg, alignment: .top)],
            spacing: TSSpacing.lg
        ) {
            OptimizerHabitsPanel(
                schedule: model.optimizer.schedule,
                localize: model.localize,
                formatting: model.formatting
            )
            OptimizerScorePanel(
                score: model.optimizer.batteryHealthScore,
                tier: model.batteryScoreTier,
                localize: model.localize,
                formatting: model.formatting
            )
            OptimizerCostPanel(
                analysis: model.optimizer.costAnalysis,
                localize: model.localize,
                formatting: model.formatting
            )
        }
    }

    /// The interpolated savings-banner title (web `t('…savingsBanner', { amount })`
    /// where `amount = fmtNumber(potential_monthly_savings, 0)`).
    private var savingsTitle: String {
        let amount = model.formatting.formatNumber(
            OptimizerNumeric.safe(model.optimizer.costAnalysis.potentialMonthlySavings),
            decimals: 0
        )
        let template = model.localize(
            "charging.optimizer.savingsBanner",
            "Save ~$%@/month by adjusting your charging schedule"
        )
        return String(format: template, amount)
    }

    private var savingsDetail: String {
        model.localize(
            "charging.optimizer.savingsDetail",
            "Based on your charging patterns, shifting to off-peak hours could reduce your monthly costs."
        )
    }
}
