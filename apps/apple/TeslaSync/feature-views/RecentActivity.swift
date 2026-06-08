//
//  RecentActivity.swift
//  TeslaSync — P4 feature view · 0130 · RecentActivity (Apple)
//
//  The composable dashboard "Recent Activity" surface — the SwiftUI parity of
//  features/dashboard/components/RecentActivity.tsx. Three glass panels (the unified activity
//  feed, the battery-trend chart, and the fleet-performance read) fade in on appear, laid out
//  responsively (side-by-side battery + performance on a regular width, stacked on a compact
//  width — the web `lg:grid-cols-3` / `sm:grid-cols-2` intent). Switches over the bound model's
//  phase so every prompt-required state renders (loading / empty / error / stale / offline /
//  content) — never a blank box. Binds through `RecentActivityModel` (P1/S8); no networking here.
//

import SwiftUI

/// The composable Recent Activity surface — the SwiftUI parity of the web `RecentActivity`,
/// binding through `RecentActivityModel` (P1/S8). `onViewAll` is the web `<Link to="/drives">`
/// affordance, wired by the host to navigation.
public struct RecentActivity: View {
    @State private var model: RecentActivityModel
    private let onViewAll: () -> Void
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    public init(model: RecentActivityModel, onViewAll: @escaping () -> Void = {}) {
        _model = State(initialValue: model)
        self.onViewAll = onViewAll
    }

    public var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                if model.connection != .live {
                    HStack(spacing: TSSpacing.sm) {
                        Spacer(minLength: 0)
                        RecentActivityFreshnessChip(connection: model.connection)
                    }
                    RecentActivityConnectivityBanner(connection: model.connection)
                }
                content
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    /// The web three-panel grid, widened to the full load envelope (loading / error / empty /
    /// content) so no state is hidden behind a blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            RecentActivityLoading()
        case let .error(message):
            RecentActivityError(message: message) { model.refresh() }
        case .empty:
            RecentActivityEmpty()
        case .content:
            panels
        }
    }

    /// The three panels — the activity feed on top, with the battery + performance panels
    /// side-by-side on a regular width and stacked on a compact width.
    private var panels: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            RecentActivityFeedPanel(items: model.timelineItems, onViewAll: onViewAll)
            if isCompact {
                RecentActivityBatteryPanel(points: model.batteryTrend, locale: model.displayLocale)
                RecentActivityPerformancePanel(performance: model.performance)
            } else {
                HStack(alignment: .top, spacing: TSSpacing.lg) {
                    RecentActivityBatteryPanel(points: model.batteryTrend, locale: model.displayLocale)
                    RecentActivityPerformancePanel(performance: model.performance)
                }
            }
        }
    }

    /// A compact width (iPhone portrait) stacks the panels; a regular / unspecified width
    /// (iPad, macOS) lays the battery + performance panels side-by-side.
    private var isCompact: Bool {
        horizontalSizeClass == .compact
    }
}
