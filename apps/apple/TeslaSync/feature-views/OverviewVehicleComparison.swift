//
//  OverviewVehicleComparison.swift
//  TeslaSync — P4 feature view · 0060 · OverviewVehicleComparison (Apple)
//
//  The composed analytics feature view — SwiftUI parity of
//  features/analytics/components/analytics/OverviewVehicleComparison.tsx. Binds
//  through `OverviewComparisonModel` (no networking in the view) and renders every
//  state: loading (skeleton chrome) / error (retry) / content + empty (the 2×2
//  panel grid where each panel self-empties) with a stale / offline banner. The
//  grid pairs Fleet Usage + Efficiency Leaderboard above Vehicle Comparison +
//  Energy & Activity, one column when horizontally compact and two when regular
//  (the web `grid-cols-1 lg:grid-cols-2`).
//

import SwiftUI

// MARK: - OverviewVehicleComparison (the feature surface)

/// The fleet vehicle-comparison analytics surface — the SwiftUI parity of the web
/// `OverviewVehicleComparison`. Renders a donut of per-vehicle distance, an
/// efficiency leaderboard, a multi-vehicle radar, and an energy/activity bar chart.
/// Binds through `OverviewComparisonModel` (P1/S8); no networking lives here.
public struct OverviewVehicleComparison: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        OverviewComparisonModel.surfaceSlug
    }

    @State private var model: OverviewComparisonModel
    @Environment(\.horizontalSizeClass) private var sizeClass

    public init(model: OverviewComparisonModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .top)
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .accessibilityElement(children: .contain)
    }

    private var isCompact: Bool {
        sizeClass == .compact
    }
}

// MARK: - Content states

extension OverviewVehicleComparison {
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            loadingChrome
        case let .error(message):
            errorState(message)
        case .content, .empty:
            grid
        }
    }

    private var grid: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            if model.connection != .live {
                OverviewVehicleComparisonConnectivityBanner(
                    connection: model.connection,
                    updatedAt: model.updatedAt,
                    onRefresh: { model.refresh() }
                )
            }
            panels
        }
    }

    @ViewBuilder
    private var panels: some View {
        let vehicles = model.vehicles
        let unit = model.distanceUnit
        if isCompact {
            VStack(spacing: TSSpacing.lg) {
                OverviewFleetUsagePanel(vehicles: vehicles, unit: unit)
                OverviewLeaderboardPanel(vehicles: vehicles, unit: unit)
                OverviewComparisonRadarPanel(vehicles: vehicles)
                OverviewEnergyActivityPanel(vehicles: vehicles)
            }
        } else {
            Grid(horizontalSpacing: TSSpacing.lg, verticalSpacing: TSSpacing.lg) {
                GridRow {
                    OverviewFleetUsagePanel(vehicles: vehicles, unit: unit)
                    OverviewLeaderboardPanel(vehicles: vehicles, unit: unit)
                }
                GridRow {
                    OverviewComparisonRadarPanel(vehicles: vehicles)
                    OverviewEnergyActivityPanel(vehicles: vehicles)
                }
            }
        }
    }
}

// MARK: - Loading / error chrome

extension OverviewVehicleComparison {
    @ViewBuilder
    private var loadingChrome: some View {
        if isCompact {
            VStack(spacing: TSSpacing.lg) {
                ForEach(0 ..< 4, id: \.self) { _ in OverviewPanelSkeleton() }
            }
        } else {
            Grid(horizontalSpacing: TSSpacing.lg, verticalSpacing: TSSpacing.lg) {
                GridRow { OverviewPanelSkeleton(); OverviewPanelSkeleton() }
                GridRow { OverviewPanelSkeleton(); OverviewPanelSkeleton() }
            }
        }
    }

    private func errorState(_ message: String) -> some View {
        TSGlassPanel {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 26))
                    .foregroundStyle(Color.TS.statusDanger)
                OverviewComparisonStrings.text("overview.errorTitle", "Couldn't load comparison")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .multilineTextAlignment(.center)
                if !message.isEmpty {
                    Text(verbatim: message)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .multilineTextAlignment(.center)
                }
                OverviewRetryButton(onRetry: { model.refresh() })
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, TSSpacing.lg)
        }
        .accessibilityElement(children: .combine)
    }
}
