//
//  DrivingCoachSection.swift
//  TeslaSync — P4 feature view · 0167 · DrivingCoachSection (Apple)
//
//  The composable driving-dynamics "Driving Coach" surface — the SwiftUI parity of
//  features/driving/components/driving-dynamics/DrivingCoachSection.tsx. Renders the header (always visible,
//  web `<FadeIn delay={0.42}>`), then switches over the bound model's phase so every prompt-required state
//  renders (loading / empty / error / stale / offline / content) — never a blank box. The content is the
//  web composition: the score gauge + style breakdown + efficiency cards (3-up), the weekly score trend
//  chart, the driving-pattern bars, the recommendations, and the per-drive score table. Binds through
//  `DrivingCoachSectionModel` (P1/S8); no networking lives here.
//

import SwiftUI

/// The composable "Driving Coach" section — the SwiftUI parity of the web `DrivingCoachSection`, binding
/// through `DrivingCoachSectionModel` (P1/S8).
public struct DrivingCoachSection: View {
    @State private var model: DrivingCoachSectionModel

    public init(model: DrivingCoachSectionModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            TSFadeIn(delay: 0.05) {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    DrivingCoachSectionHeader(connection: model.connection)
                    if model.connection != .live {
                        DrivingCoachSectionConnectivityBanner(connection: model.connection)
                    }
                }
            }
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    /// The phase-switched body so no state is hidden behind a blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            TSFadeIn(delay: 0.1) { DrivingCoachSectionLoading() }
        case let .error(message):
            TSFadeIn(delay: 0.1) {
                DrivingCoachSectionErrorView(message: message) { model.refresh() }
            }
        case .empty:
            TSFadeIn(delay: 0.1) { DrivingCoachSectionEmpty() }
        case .content:
            loadedContent
        }
    }

    /// The resolved section body — the web composition, each region staggered in (web per-panel `FadeIn`
    /// delays 0.43–0.49).
    private var loadedContent: some View {
        let projection = model.projection
        return VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 260), spacing: TSSpacing.lg)],
                alignment: .leading,
                spacing: TSSpacing.lg
            ) {
                TSFadeIn(delay: 0.08) {
                    DrivingCoachScoreGaugePanel(
                        gauge: projection.gauge,
                        drivesAnalyzed: projection.drivesAnalyzed
                    )
                }
                TSFadeIn(delay: 0.12) {
                    DrivingCoachStyleBreakdownPanel(model: projection.styleBreakdown)
                }
                TSFadeIn(delay: 0.16) {
                    DrivingCoachEfficiencyPanel(
                        avgEfficiencyText: projection.avgEfficiencyText,
                        bestEfficiencyText: projection.bestEfficiencyText
                    )
                }
            }
            TSFadeIn(delay: 0.20) {
                DrivingCoachWeeklyTrendPanel(points: projection.trend)
            }
            TSFadeIn(delay: 0.24) {
                DrivingCoachPatternsPanel(rows: projection.patterns)
            }
            TSFadeIn(delay: 0.28) {
                DrivingCoachRecommendationsPanel(rows: projection.recommendations)
            }
            TSFadeIn(delay: 0.32) {
                DrivingCoachPerDrivePanel(rows: projection.perDriveRows)
            }
        }
    }
}
