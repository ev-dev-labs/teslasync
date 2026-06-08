//
//  BatteryTab.swift
//  TeslaSync — P4 feature view · 0052 · BatteryTab (Apple)
//
//  The composable analytics "Battery" surface — the SwiftUI parity of
//  features/analytics/components/analytics/BatteryTab.tsx. Renders every state from the web
//  source plus the prompt-required chrome (loading / empty / error / stale / offline) bound
//  through `BatteryTabModel` (P1/S8). No networking lives here; the freshness chip + banner
//  reflect the bound source's live-state, and the five metric cards + four trend charts come
//  from the pure `BatteryTabProjection`.
//

import SwiftUI

/// The composable analytics Battery surface — the SwiftUI parity of
/// `features/analytics/components/analytics/BatteryTab.tsx`, binding through `BatteryTabModel`
/// (P1/S8). No networking lives here.
public struct BatteryTab: View {
    @State private var model: BatteryTabModel

    public init(model: BatteryTabModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            freshnessHeader
            if model.connection != .live {
                BatteryConnectivityBanner(connection: model.connection)
            }
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Header

private extension BatteryTab {
    var freshnessHeader: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: 0)
            BatteryFreshnessChip(connection: model.connection)
        }
    }
}

// MARK: - Phase content (web empty / content + native loading / error chrome)

private extension BatteryTab {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            BatteryLoadingState()
        case .empty:
            BatteryEmptyState()
        case let .error(message):
            BatteryErrorState(message: message) { model.refresh() }
        case .content:
            if let projection = model.projection {
                BatteryContent(projection: projection)
            } else {
                BatteryEmptyState()
            }
        }
    }
}

// MARK: - Content body (web `FadeIn` → metric cards + four chart panels)

/// The resolved-data body: the five metric cards above the four trend charts, faded in on appear.
struct BatteryContent: View {
    let projection: BatteryTabProjection

    var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                BatteryMetricsGrid(metrics: projection.metrics)
                BatteryHealthTimelinePanel(points: projection.chart.points, domain: projection.chart.healthDomain)
                trendRow
                BatteryDegradationCyclesPanel(
                    points: projection.chart.points,
                    degradationMax: projection.chart.degradationMax,
                    cycleMax: projection.chart.cycleMax
                )
            }
        }
    }

    /// Web `grid-cols-1 lg:grid-cols-2`: side-by-side on wide idioms, stacked when space is tight.
    private var trendRow: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: TSSpacing.lg) {
                capacityPanel
                rangePanel
            }
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                capacityPanel
                rangePanel
            }
        }
    }

    private var capacityPanel: some View {
        BatteryCapacityTrendPanel(points: projection.chart.points, energySymbol: projection.energySymbol)
    }

    private var rangePanel: some View {
        BatteryRangeTrendPanel(points: projection.chart.points, distanceSymbol: projection.distanceSymbol)
    }
}

// MARK: - Localization facade SwiftUI bridge (P1/S10) — web `t(key, default)`

public extension BatteryTabStrings {
    /// Resolves a per-surface key to a verbatim `Text`. The "BatteryTab" table is resolved via
    /// `NSLocalizedString(tableName:)` (not the main catalog), so the localized value is rendered
    /// verbatim rather than re-looked-up as a SwiftUI `LocalizedStringKey`.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    /// Resolves a per-surface key to a `LocalizedStringKey` carrying the already-localized value,
    /// so shared components that require a `LocalizedStringKey` (e.g. `TSEmptyState`) display the
    /// BatteryTab-table string in every locale.
    static func label(_ key: String, _ fallback: String) -> LocalizedStringKey {
        LocalizedStringKey(string(key, fallback))
    }
}
