//
//  DrivingSection.swift
//  TeslaSync — P4 feature view · 0075 · DrivingSection (Apple)
//
//  The composable weekly-digest "Driving" surface — the SwiftUI parity of
//  features/analytics/components/weekly-digest/DrivingSection.tsx. Renders inside a GlassPanel-
//  equivalent card (web `<GlassPanel className="space-y-6 p-6">`) fading in on appear (web
//  `<FadeIn delay={0.1}>`), and switches over the bound model's phase so every prompt-required state
//  renders (loading / empty / error / stale / offline / content) — never a blank box. Binds through
//  `DrivingSectionModel` (P1/S8); no networking lives here.
//

import SwiftUI

/// The composable weekly-digest Driving section — the SwiftUI parity of the web `DrivingSection`,
/// binding through `DrivingSectionModel` (P1/S8). The body is the daily-distance bar chart, the four
/// driving stats (average efficiency, total driving time, efficiency change, drive count), and the
/// week's Top Drive card.
public struct DrivingSection: View {
    @State private var model: DrivingSectionModel

    public init(model: DrivingSectionModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.1) {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                DrivingSectionHeader(connection: model.connection)
                if model.connection != .live {
                    DrivingSectionConnectivityBanner(connection: model.connection)
                }
                content
            }
            .padding(TSSpacing.xl)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                Color.TS.surface,
                in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    /// The web body (always-rendered chart + stats + top-drive), widened to the full load envelope
    /// (loading / error / empty / content) so no state is hidden behind a blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            DrivingSectionLoading()
        case let .error(message):
            DrivingSectionErrorView(message: message) { model.refresh() }
        case .empty:
            DrivingSectionEmpty()
        case .content:
            loadedContent
        }
    }

    /// The resolved section body: the daily-distance chart panel, the four mini-stats, and the Top
    /// Drive card — each with its own inner empty state (web parity).
    private var loadedContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            DrivingDailyDistancePanel(
                bars: model.projection.bars,
                chartAccessibilityLabel: model.chartAccessibilitySummary
            )
            DrivingStatsGrid(stats: model.projection.stats)
            DrivingTopDrivePanel(card: model.projection.topDrive)
        }
    }
}
