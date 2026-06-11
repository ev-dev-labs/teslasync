//
//  KpiOverviewCard.Previews.swift
//  TeslaSync — P4 shared surface · 0093 · KpiOverviewCard (Apple)
//
//  Xcode previews for every presentation form the web source supports plus the P4 leaf states: the
//  content composition (header + headline delta + a six-tile KPI grid + secondary line + footer
//  callout), the header-only minimum (no comparison / delta / secondary / footer), the loading
//  skeleton grid, the friendly empty state, the error tile, and the stale / offline freshness chips.
//  Staged on the app background; the host snapshot is pushed through the live source on appear (the
//  parity of the page rendering with computed props). DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    private enum KpiOverviewPreviewData {
        static func header(delta: Bool, comparison: Bool) -> KpiOverviewHeader {
            KpiOverviewHeader(
                title: "Overview",
                currentLabel: "Last 30 days",
                comparisonLabel: comparison ? "vs prior 30 days" : nil,
                delta: delta ? KpiOverviewDelta(value: 12.4, formatted: "12%") : nil
            )
        }

        static let tiles: [KpiOverviewItem] = [
            KpiOverviewItem(
                id: "drives",
                label: "Drives",
                value: "46",
                delta: KpiOverviewDelta(value: 8, formatted: "8%")
            ),
            KpiOverviewItem(
                id: "distance",
                label: "Distance",
                value: "1,284 mi",
                delta: KpiOverviewDelta(value: -3, formatted: "3%", lowerIsBetter: true)
            ),
            KpiOverviewItem(id: "energy", label: "Energy", value: "312 kWh"),
            KpiOverviewItem(
                id: "efficiency",
                label: "Efficiency",
                value: "243 Wh/mi",
                delta: KpiOverviewDelta(value: -5, formatted: "5%", lowerIsBetter: true)
            ),
            KpiOverviewItem(id: "cost", label: "Cost", value: "$48.10"),
            KpiOverviewItem(id: "topSpeed", label: "Top speed", value: "82 mph")
        ]

        static let secondary = "Top speed 152 mph · Longest 29.1 mi · Avg trip 11.5 mi"

        static let footer = KpiOverviewCallout(
            tone: .warning,
            message: "1 anomaly detected in this range",
            actionLabel: "Review"
        )

        static func content(connection: KpiOverviewConnection = .live) -> KpiOverviewInput {
            KpiOverviewInput(
                header: header(delta: true, comparison: true),
                items: tiles,
                secondary: secondary,
                footer: footer,
                connection: connection
            )
        }
    }

    @MainActor
    private func staged(_ view: some View) -> some View {
        view
            .padding()
            .frame(maxWidth: 560, alignment: .leading)
            .background(Color.TS.bg)
    }

    #Preview("Content — full") {
        staged(KpiOverviewCard(input: KpiOverviewPreviewData.content()) {})
    }

    #Preview("Content — header only") {
        staged(KpiOverviewCard(input: KpiOverviewInput(
            header: KpiOverviewPreviewData.header(delta: false, comparison: false),
            items: [
                KpiOverviewItem(id: "drives", label: "Drives", value: "4"),
                KpiOverviewItem(id: "distance", label: "Distance", value: "46.1 mi")
            ]
        )))
    }

    #Preview("Loading") {
        staged(KpiOverviewCard(input: KpiOverviewInput(
            header: KpiOverviewPreviewData.header(delta: false, comparison: true),
            isLoading: true
        )))
    }

    #Preview("Empty") {
        staged(KpiOverviewCard(input: KpiOverviewInput(
            header: KpiOverviewPreviewData.header(delta: false, comparison: true)
        )))
    }

    #Preview("Error") {
        staged(KpiOverviewCard(input: KpiOverviewInput(
            header: KpiOverviewPreviewData.header(delta: false, comparison: true),
            errorMessage: "Could not load metrics"
        )))
    }

    #Preview("Stale") {
        staged(KpiOverviewCard(input: KpiOverviewPreviewData.content(connection: .stale)) {})
    }

    #Preview("Offline") {
        staged(KpiOverviewCard(input: KpiOverviewPreviewData.content(connection: .offline)) {})
    }
#endif
