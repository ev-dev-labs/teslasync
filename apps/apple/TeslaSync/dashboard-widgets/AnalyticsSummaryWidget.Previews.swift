//
//  AnalyticsSummaryWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0002 · AnalyticsSummaryWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / stale / offline / content)
//  and each layout (compact / standard / wide, incl. the wide trend-sparkline row). DEBUG-only;
//  skipped by the host compile + format gates.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func analyticsSummaryPreviewModel(_ update: AnalyticsSummaryUpdate) -> AnalyticsSummaryModel {
        let source = InMemoryAnalyticsSummarySource(initial: update)
        let model = AnalyticsSummaryModel(source: source)
        model.start()
        return model
    }

    private let analyticsSummarySample = AnalyticsSummaryDTO(
        totalDistanceKm: 12450.6,
        avgEfficiencyWhKm: 152.4,
        totalEnergyKwh: 1897.3,
        totalCost: 482.17
    )

    private let analyticsSummarySampleWithTrends = AnalyticsSummaryDTO(
        totalDistanceKm: 12450.6,
        avgEfficiencyWhKm: 152.4,
        totalEnergyKwh: 1897.3,
        totalCost: 482.17,
        distanceTrend: [320, 410, 280, 505, 460, 610, 540],
        efficiencyTrend: [148, 151, 149, 155, 150, 153, 152],
        energyTrend: [44, 60, 41, 75, 68, 90, 80],
        costTrend: [11, 15, 10, 19, 17, 23, 20]
    )

    private let analyticsSummarySampleUnits = AnalyticsSummaryUnitPrefs(
        distance: .miles,
        currencySymbol: "$",
        precision: 2,
        localeIdentifier: "en_US"
    )

    #Preview("Standard (2×2)") {
        AnalyticsSummaryWidget(
            model: analyticsSummaryPreviewModel(
                AnalyticsSummaryUpdate(
                    status: .loaded,
                    connection: .live,
                    summary: analyticsSummarySample,
                    units: analyticsSummarySampleUnits,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2),
            onOpen: {}
        )
        .frame(width: 320, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Wide (4×2) + sparklines") {
        AnalyticsSummaryWidget(
            model: analyticsSummaryPreviewModel(
                AnalyticsSummaryUpdate(
                    status: .loaded,
                    connection: .live,
                    summary: analyticsSummarySampleWithTrends,
                    units: analyticsSummarySampleUnits,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 4, rows: 2),
            onOpen: {}
        )
        .frame(width: 620, height: 260)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact (1×2)") {
        AnalyticsSummaryWidget(
            model: analyticsSummaryPreviewModel(
                AnalyticsSummaryUpdate(
                    status: .loaded,
                    connection: .live,
                    summary: analyticsSummarySample,
                    units: analyticsSummarySampleUnits,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 160, height: 200)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AnalyticsSummaryWidget(
            model: analyticsSummaryPreviewModel(AnalyticsSummaryUpdate(status: .loading, summary: nil)),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 320, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty (all-zero)") {
        AnalyticsSummaryWidget(
            model: analyticsSummaryPreviewModel(
                AnalyticsSummaryUpdate(status: .loaded, summary: AnalyticsSummaryDTO())
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 320, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        AnalyticsSummaryWidget(
            model: analyticsSummaryPreviewModel(
                AnalyticsSummaryUpdate(status: .failed("Network unavailable"), summary: nil)
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 320, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        AnalyticsSummaryWidget(
            model: analyticsSummaryPreviewModel(
                AnalyticsSummaryUpdate(
                    status: .loaded,
                    connection: .stale,
                    isFetching: true,
                    summary: analyticsSummarySample,
                    units: analyticsSummarySampleUnits,
                    updatedAt: Date().addingTimeInterval(-180)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2),
            onOpen: {}
        )
        .frame(width: 320, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        AnalyticsSummaryWidget(
            model: analyticsSummaryPreviewModel(
                AnalyticsSummaryUpdate(
                    status: .loaded,
                    connection: .offline,
                    summary: analyticsSummarySample,
                    units: analyticsSummarySampleUnits,
                    updatedAt: Date().addingTimeInterval(-600)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2),
            onOpen: {}
        )
        .frame(width: 320, height: 240)
        .padding()
        .background(Color.TS.bg)
    }
#endif
