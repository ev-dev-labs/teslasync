//
//  AutomationActivityFeed.swift
//  TeslaSync — P4 feature view · 0081 · AutomationActivityFeed (Apple)
//
//  The composable Automation "Recent Activity" feed — the SwiftUI parity of
//  features/automations/pages/AutomationActivityFeed.tsx. Renders every state from the web
//  source (loading / empty / error / content) plus the native P4 stale / offline chrome,
//  with the live SSE rows + the gated stats summary + the connection chip, all bound
//  through `AutomationFeedModel` (P1/S8). No networking lives here.
//

import SwiftUI

/// The composable Automation "Recent Activity" feed — the SwiftUI parity of
/// `features/automations/pages/AutomationActivityFeed.tsx`, binding through
/// `AutomationFeedModel` (P1/S8). No networking lives here.
public struct AutomationActivityFeed: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = AutomationFeedDiagnostics.surface

    @State private var model: AutomationFeedModel

    public init(model: AutomationFeedModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.1) {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    header
                    if model.connection == .stale || model.connection == .offline {
                        AutomationFeedConnectivityBanner(connection: model.connection)
                    }
                    if !model.liveRows.isEmpty {
                        liveEvents
                    }
                    historyContent
                }
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Header (web title + connection chip + stats)

private extension AutomationActivityFeed {
    var header: some View {
        HStack(alignment: .center, spacing: TSSpacing.sm) {
            titleGroup
            AutomationConnectionChip(connection: model.connection)
            Spacer(minLength: TSSpacing.sm)
            if let stats = model.stats {
                AutomationStatsRow(stats: stats)
            }
        }
    }

    var titleGroup: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "waveform.path.ecg")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityHidden(true)
            Text(verbatim: AutomationFeedStrings.string("automations.recentActivity", "Recent Activity"))
                .font(Font.TS.section)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
        }
    }
}

// MARK: - Live events (web SSE rows)

private extension AutomationActivityFeed {
    var liveEvents: some View {
        VStack(spacing: TSSpacing.xs) {
            ForEach(model.liveRows) { row in
                AutomationLiveEventRowView(row: row)
            }
        }
    }
}

// MARK: - History list (web isLoading / data / empty + native error)

private extension AutomationActivityFeed {
    @ViewBuilder
    var historyContent: some View {
        switch model.phase {
        case .loading:
            AutomationFeedLoadingView()
        case .data:
            VStack(spacing: 2) {
                ForEach(model.historyRows) { row in
                    AutomationHistoryRowView(row: row)
                }
            }
        case .empty:
            AutomationFeedEmptyView()
        case let .error(message):
            AutomationFeedErrorView(message: message) { model.refresh() }
        }
    }
}
