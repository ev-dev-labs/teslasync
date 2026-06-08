//
//  AutopilotSection.swift
//  TeslaSync — P4 feature view · 0165 · AutopilotSection (Apple)
//
//  The composable driving-dynamics "Autopilot & Cruise" feature view — the SwiftUI parity of
//  features/driving/components/driving-dynamics/AutopilotSection.tsx. Renders inside a GlassPanel
//  fading in on appear (web `<FadeIn delay={0.17}>`), and switches over the bound model's phase so
//  every prompt-required state renders (loading / empty / error / content), with stale / offline
//  carried on the freshness chip + banner. Binds through `AutopilotSectionModel` (P1/S8); no networking
//  lives here.
//

import SwiftUI

/// The composable "Autopilot & Cruise" section — the SwiftUI parity of the web `AutopilotSection`,
/// binding through `AutopilotSectionModel` (P1/S8). The body is the three cruise/autopilot stat tiles
/// (Current Speed, Cruise Set Speed, Follow Distance) or, when no telemetry has arrived, a friendly
/// empty state.
public struct AutopilotSection: View {
    @State private var model: AutopilotSectionModel

    public init(model: AutopilotSectionModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.17) {
            AutopilotGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    AutopilotSectionHeader(connection: model.connection)
                    if model.connection != .live {
                        AutopilotConnectivityBanner(connection: model.connection)
                    }
                    content
                }
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    /// The web content/empty split, widened to the full load envelope (loading / error / empty /
    /// content) so no state is hidden behind a blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            AutopilotSectionLoading()
        case let .error(message):
            AutopilotSectionErrorView(message: message) { model.refresh() }
        case .empty:
            AutopilotSectionEmpty()
        case .content:
            AutopilotStatsGrid(stats: model.projection.stats)
        }
    }
}
