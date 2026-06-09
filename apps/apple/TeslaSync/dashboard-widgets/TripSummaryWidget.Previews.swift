//
//  TripSummaryWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0103 · TripSummaryWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / offline / stale / content) and
//  the compact/wide layouts. DEBUG-only; skipped by the host compile + format gates.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func tripSummaryPreviewModel(_ update: TripSummaryUpdate) -> TripSummaryModel {
        let source = InMemoryTripSummarySource(initial: update)
        let model = TripSummaryModel(source: source)
        model.start()
        return model
    }

    private let tripSummarySample: [TripSummaryDTO] = [
        TripSummaryDTO(
            id: 1,
            name: "Tahoe Weekend",
            startDate: Date().addingTimeInterval(-90000),
            endDate: Date().addingTimeInterval(-78000),
            totalDistanceM: 312_540,
            driveCount: 4,
            chargeCount: 2
        ),
        TripSummaryDTO(
            id: 2,
            name: "Morning Commute",
            startDate: Date().addingTimeInterval(-180_000),
            endDate: Date().addingTimeInterval(-178_200),
            totalDistanceM: 18432,
            driveCount: 1,
            chargeCount: 0
        ),
        TripSummaryDTO(
            id: 3,
            name: nil,
            startDate: Date().addingTimeInterval(-280_000),
            endDate: Date().addingTimeInterval(-277_000),
            totalDistanceM: 4200,
            driveCount: 2,
            chargeCount: 1
        )
    ]

    private let tripSummarySampleUnits = TripSummaryUnitPrefs(
        distance: .miles,
        localeIdentifier: "en_US",
        timeZoneIdentifier: "America/Los_Angeles"
    )

    #Preview("Standard (2×4)") {
        TripSummaryWidget(
            model: tripSummaryPreviewModel(
                TripSummaryUpdate(
                    status: .loaded,
                    connection: .live,
                    trips: tripSummarySample,
                    units: tripSummarySampleUnits,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 300, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Wide (4×4)") {
        TripSummaryWidget(
            model: tripSummaryPreviewModel(
                TripSummaryUpdate(
                    status: .loaded,
                    connection: .live,
                    trips: tripSummarySample,
                    units: tripSummarySampleUnits,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 4, rows: 4)
        )
        .frame(width: 560, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact (1×4)") {
        TripSummaryWidget(
            model: tripSummaryPreviewModel(
                TripSummaryUpdate(
                    status: .loaded,
                    connection: .live,
                    trips: tripSummarySample,
                    units: tripSummarySampleUnits,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 4)
        )
        .frame(width: 180, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        TripSummaryWidget(
            model: tripSummaryPreviewModel(TripSummaryUpdate(status: .loading, trips: nil)),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 300, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        TripSummaryWidget(
            model: tripSummaryPreviewModel(TripSummaryUpdate(status: .loaded, trips: [])),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 300, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        TripSummaryWidget(
            model: tripSummaryPreviewModel(
                TripSummaryUpdate(status: .failed("Network unavailable"), trips: nil)
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 300, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        TripSummaryWidget(
            model: tripSummaryPreviewModel(
                TripSummaryUpdate(
                    status: .loaded,
                    connection: .stale,
                    isFetching: true,
                    trips: tripSummarySample,
                    units: tripSummarySampleUnits,
                    updatedAt: Date().addingTimeInterval(-300)
                )
            ),
            size: DashboardWidgetSize(cols: 4, rows: 4)
        )
        .frame(width: 560, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        TripSummaryWidget(
            model: tripSummaryPreviewModel(
                TripSummaryUpdate(
                    status: .loaded,
                    connection: .offline,
                    trips: tripSummarySample,
                    units: tripSummarySampleUnits,
                    updatedAt: Date().addingTimeInterval(-1800)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 300, height: 380)
        .padding()
        .background(Color.TS.bg)
    }
#endif
