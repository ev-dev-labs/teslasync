//
//  DetailedStatistics.swift
//  TeslaSync — P4 feature view · 0101 · DetailedStatistics (Apple)
//
//  The composable charging-list "Detailed Statistics" panel — the SwiftUI parity of
//  features/charging/components/charging-list/DetailedStatistics.tsx. Renders inside a
//  GlassPanel-equivalent card (web `<GlassPanel className="p-5">`) headed by a TrendingUp title
//  (web `<h3 class="section-title"><TrendingUp/> Detailed Statistics</h3>`), and switches over the
//  bound model's phase so every prompt-required state renders (loading / empty / error / stale /
//  offline / content) — never a blank box. Binds through `DetailedStatisticsModel` (P1/S8); no
//  networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch → skeleton grid (web parent `isLoading`).
//    • empty    — resolved, no sessions → friendly empty state, never a blank box.
//    • error    — parent query failure → retry affordance (web `QueryError` peer).
//    • content  — the six populated tiles.
//    • stale / offline — the orthogonal `connection` axis → header freshness chip + banner with a
//                 one-shot auto-refresh on the stale transition.
//

import SwiftUI

/// The composable charging Detailed Statistics panel — the SwiftUI parity of the web
/// `DetailedStatistics`, binding through `DetailedStatisticsModel` (P1/S8).
public struct DetailedStatistics: View {
    @State private var model: DetailedStatisticsModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(model: DetailedStatisticsModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                if model.connection != .live {
                    DetailedStatisticsConnectivityBanner(connection: model.connection)
                }
                content
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }
}

// MARK: - Header (web `<h3 class="section-title"><TrendingUp/> {title}</h3>` + freshness)

private extension DetailedStatistics {
    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "chart.line.uptrend.xyaxis")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            DetailedStatisticsStrings.text("charging.stats.detailedStatistics", "Detailed Statistics")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            if model.connection != .live {
                DetailedStatisticsFreshnessChip(connection: model.connection)
            }
            refreshButton
        }
    }

    var refreshButton: some View {
        let spinning = model.refreshing && !reduceMotion
        return Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 11, weight: .semibold))
                .rotationEffect(.degrees(spinning ? 360 : 0))
                .animation(
                    spinning ? .linear(duration: 1).repeatForever(autoreverses: false) : .default,
                    value: spinning
                )
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(DetailedStatisticsStrings.text("charging.stats.refresh", "Refresh"))
    }
}

// MARK: - Content states (web grid + the P4 leaf contract)

private extension DetailedStatistics {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            DetailedStatisticsLoading()
        case let .error(message):
            DetailedStatisticsError(message: message) { model.refresh() }
        case .empty:
            DetailedStatisticsEmpty()
        case .content:
            DetailedStatisticsGrid(metrics: model.metrics)
        }
    }
}
