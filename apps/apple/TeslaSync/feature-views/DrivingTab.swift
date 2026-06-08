//
//  DrivingTab.swift
//  TeslaSync — P4 feature view · 0056 · DrivingTab (Apple)
//
//  The composable "Driving" analytics tab — the SwiftUI parity of
//  features/analytics/components/analytics/DrivingTab.tsx. Renders every state from the
//  web source (loading / empty / error / stale / offline / content) and the seven drive-
//  analytics charts (speed / trip-distance / hourly / temperature-vs-efficiency / daily-
//  trend / duration / efficiency-trend), bound through `DrivingTabModel` (P1/S8). No
//  networking lives here; the freshness chip + banner reflect the bound source's live
//  state and every visible string resolves through the P1/S10 facade.
//
//  Scope: the web component also composes `<DrivingPerformanceCards>` (above the charts)
//  and `<DrivingTemperatureStats>` (below). Those are sibling feature-view surfaces with
//  their own P4 prompts (and their own i18n keys); this surface owns the seven chart
//  panels enumerated by this prompt's extracted titles/keys. The composition order is
//  preserved so the sibling surfaces slot in around these panels at integration time.
//

import SwiftUI

/// The composable Driving analytics tab — the SwiftUI parity of
/// `features/analytics/components/analytics/DrivingTab.tsx`, binding through
/// `DrivingTabModel` (P1/S8). No networking lives here.
public struct DrivingTab: View {
    @State private var model: DrivingTabModel

    public init(model: DrivingTabModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .accessibilityElement(children: .contain)
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .loading:
            DriveAnalyticsLoadingPanels()
        case let .error(message):
            DriveAnalyticsErrorState(message: message) { model.refresh() }
        case .empty:
            emptyContent
        case .content:
            chartsContent
        }
    }
}

// MARK: - Header

private extension DrivingTab {
    var freshnessHeader: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: 0)
            DriveAnalyticsFreshnessChip(connection: model.connection)
        }
    }

    @ViewBuilder var connectivityBanner: some View {
        if model.connection != .live {
            DriveAnalyticsConnectivityBanner(connection: model.connection)
        }
    }
}

// MARK: - Empty (whole surface)

private extension DrivingTab {
    var emptyContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            freshnessHeader
            connectivityBanner
            DriveAnalyticsSurfaceEmpty()
        }
    }
}

// MARK: - Content (the seven charts, web order)

private extension DrivingTab {
    var chartsContent: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                freshnessHeader
                connectivityBanner
                SpeedDistributionChart(bars: model.projection.speedBars)
                TripDistanceDistributionChart(bars: model.projection.distanceBars)
                HourlyPatternChart(points: model.projection.hourly)
                TemperatureEfficiencyChart(points: model.projection.tempEff, labels: model.projection.labels)
                DailyTrendChart(points: model.projection.dailyTrend, labels: model.projection.labels)
                DurationDistributionChart(bars: model.projection.durationBars)
                EfficiencyTrendChart(points: model.projection.effTrend, labels: model.projection.labels)
            }
        }
    }
}
