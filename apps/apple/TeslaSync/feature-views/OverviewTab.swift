//
//  OverviewTab.swift
//  TeslaSync — P4 feature view · 0059 · OverviewTab (Apple)
//
//  The composable "Overview" analytics surface — the SwiftUI parity of
//  features/analytics/components/analytics/OverviewTab.tsx. Renders every state from the web
//  source (loading / empty / error / stale / offline / content) across the surface's own
//  sections — Distance by Vehicle, Day of Week Pattern, Monthly Cost Comparison, Quick Links
//  — bound through `OverviewModel` (P1/S8). No networking lives here; the freshness chip +
//  banner reflect the bound source's live-state and Quick Links route through the model's
//  navigation seam.
//
//  Scope note: the web `OverviewTab` renders `<OverviewVehicleComparison/>` inline between the
//  Distance and Day-of-Week sections. That block is its own surface (P-0060) with its own
//  prompt and is composed by the parent analytics page — it is intentionally not duplicated
//  here (see the prompt "Out of Scope").
//

import SwiftUI

/// The composable Overview analytics surface — the SwiftUI parity of
/// `features/analytics/components/analytics/OverviewTab.tsx`, binding through `OverviewModel`
/// (P1/S8). No networking lives here.
public struct OverviewTab: View {
    @State private var model: OverviewModel

    public init(model: OverviewModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                freshnessHeader
                if model.connection != .live {
                    OverviewConnectivityBanner(connection: model.connection)
                }
                content
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Header

private extension OverviewTab {
    var freshnessHeader: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: 0)
            OverviewFreshnessChip(connection: model.connection)
        }
    }
}

// MARK: - Phase switch (loading / error / content)

private extension OverviewTab {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            OverviewLoadingChrome()
        case let .error(message):
            OverviewErrorState(message: message) { model.refresh() }
        case .empty, .content:
            // `.empty` (resolved with no rows anywhere) still renders the panels so each shows
            // its own friendly empty state — parity with the web per-panel `EmptyState`.
            sections
        }
    }

    var sections: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            distanceSection
            daySection
            monthSection
            quickLinksSection
        }
    }
}

// MARK: - Distance by Vehicle

private extension OverviewTab {
    var distanceSection: some View {
        OverviewPanel(titleKey: "analytics.overview.distByVehicle", titleFallback: "Distance by Vehicle") {
            if model.vehicleBars.isEmpty {
                OverviewEmptyRow(key: "analytics.overview.noVehicles", fallback: "No vehicle data")
            } else {
                OverviewDistanceChart(
                    bars: model.vehicleBars,
                    accessibilitySummary: OverviewAccessibility.distanceSummary(
                        bars: model.vehicleBars,
                        unitLabel: model.distanceUnitLabel,
                        localize: OverviewStrings.string
                    )
                )
            }
        }
    }
}

// MARK: - Day of Week Pattern

private extension OverviewTab {
    var daySection: some View {
        OverviewPanel(titleKey: "analytics.overview.dayOfWeek", titleFallback: "Day of Week Pattern") {
            if model.dayData.isEmpty {
                OverviewEmptyRow(key: "analytics.overview.noDow", fallback: "No day-of-week data")
            } else {
                let drivesName = OverviewStrings.string("analytics.overview.drives", "Drives")
                let avgName = OverviewStrings.string("analytics.overview.avgDist", "Avg Distance")
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    OverviewDayChart(
                        data: model.dayData,
                        scale: OverviewProjection.dayAxisScale(model.dayData),
                        drivesName: drivesName,
                        avgName: avgName,
                        accessibilitySummary: OverviewAccessibility.daySummary(
                            data: model.dayData,
                            drivesName: drivesName,
                            avgName: avgName,
                            localize: OverviewStrings.string
                        )
                    )
                    OverviewChartLegend(items: [
                        .init(id: "drives", name: drivesName, color: TSChartPalette.color(at: 2)),
                        .init(id: "avg", name: avgName, color: TSChartPalette.color(at: 3))
                    ])
                }
            }
        }
    }
}

// MARK: - Monthly Cost Comparison

private extension OverviewTab {
    var monthSection: some View {
        OverviewPanel(titleKey: "analytics.overview.monthlyCost", titleFallback: "Monthly Cost Comparison") {
            if model.monthData.isEmpty {
                OverviewEmptyRow(key: "analytics.overview.noMonthly", fallback: "No monthly data")
            } else {
                let electricName = OverviewStrings.string("analytics.overview.electricCost", "Electric Cost")
                let gasName = OverviewStrings.string("analytics.overview.gasCost", "Gas Cost")
                let savingsName = OverviewStrings.string("analytics.overview.savings", "Savings")
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    OverviewMonthChart(
                        data: model.monthData,
                        scale: OverviewProjection.monthAxisScale(model.monthData),
                        electricName: electricName,
                        gasName: gasName,
                        savingsName: savingsName,
                        accessibilitySummary: OverviewAccessibility.monthSummary(
                            data: model.monthData,
                            electricName: electricName,
                            gasName: gasName,
                            savingsName: savingsName,
                            localize: OverviewStrings.string
                        )
                    )
                    OverviewChartLegend(items: [
                        .init(id: "electric", name: electricName, color: TSChartPalette.color(at: 0)),
                        .init(id: "gas", name: gasName, color: TSChartPalette.color(at: 5)),
                        .init(id: "savings", name: savingsName, color: TSChartPalette.color(at: 1))
                    ])
                }
            }
        }
    }
}

// MARK: - Quick Links

private extension OverviewTab {
    var quickLinksSection: some View {
        OverviewPanel(titleKey: "analytics.overview.quickLinks", titleFallback: "Quick Links") {
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 160), spacing: TSSpacing.sm)],
                spacing: TSSpacing.sm
            ) {
                ForEach(model.quickLinks) { link in
                    OverviewQuickLinkCard(link: link) { model.openQuickLink(link) }
                }
            }
        }
    }
}
