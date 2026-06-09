//
//  ChargingOptimizerWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0022 · ChargingOptimizerWidget (Apple)
//
//  Xcode previews for each surface state (content / compact / wide-with-timeline /
//  no-recommendations / loading / empty / error / stale / offline). DEBUG-only;
//  skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: ChargingOptimizerWidgetUpdate) -> ChargingOptimizerModel {
        let source = InMemoryChargingOptimizerSource(initial: update)
        let model = ChargingOptimizerModel(source: source)
        model.start()
        return model
    }

    private let previewData = ChargingOptimizerInput(
        schedule: ChargingOptimizerScheduleInput(mostCommonStartHour: 1, avgChargeToPct: 80),
        cost: ChargingOptimizerCostInput(
            potentialMonthlySavings: 42,
            sessionsDuringPeakPct: 18,
            peakHours: [16, 17, 18, 19, 20],
            offpeakHours: [0, 1, 2, 3, 4, 5]
        ),
        recommendations: [
            ChargingOptimizerRecommendationInput(
                id: 0,
                title: "Shift charging to off-peak",
                detail: "Start charging after midnight to use the lowest time-of-use rate.",
                priority: "high"
            ),
            ChargingOptimizerRecommendationInput(
                id: 1,
                title: "Lower your charge target",
                detail: "Charging to 80% instead of 100% extends battery longevity.",
                priority: "medium"
            ),
            ChargingOptimizerRecommendationInput(
                id: 2,
                title: "Enable scheduled departure",
                detail: "Precondition while still plugged in to save range.",
                priority: "low"
            )
        ]
    )

    /// A high-peak schedule so the "Can improve" warning chip renders.
    private let previewSuboptimal = ChargingOptimizerInput(
        schedule: ChargingOptimizerScheduleInput(mostCommonStartHour: 18, avgChargeToPct: 90),
        cost: ChargingOptimizerCostInput(
            potentialMonthlySavings: 0,
            sessionsDuringPeakPct: 62,
            peakHours: [16, 17, 18, 19, 20],
            offpeakHours: [0, 1, 2, 3, 4, 5]
        ),
        recommendations: []
    )

    private let previewFormat = ChargingOptimizerFormatting(localeIdentifier: "en_US", currencySymbol: "$")

    private let previewNow: Date =
        ISO8601DateFormatter().date(from: "2026-06-01T00:00:00Z") ?? Date()

    private func previewUpdate(
        status: ChargingOptimizerLoadStatus = .loaded,
        connection: ChargingOptimizerConnection = .live,
        data: ChargingOptimizerInput? = previewData,
        ageSeconds: TimeInterval = 0
    ) -> ChargingOptimizerWidgetUpdate {
        ChargingOptimizerWidgetUpdate(
            status: status,
            connection: connection,
            data: data,
            format: previewFormat,
            updatedAt: previewNow.addingTimeInterval(-ageSeconds)
        )
    }

    #Preview("Content (standard)") {
        ChargingOptimizerWidget(
            model: previewModel(previewUpdate()),
            size: DashboardWidgetSize(cols: 2, rows: 4),
            onOpen: {}
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content (compact)") {
        ChargingOptimizerWidget(
            model: previewModel(previewUpdate()),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 160, height: 170)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Wide (timeline)") {
        ChargingOptimizerWidget(
            model: previewModel(previewUpdate()),
            size: DashboardWidgetSize(cols: 4, rows: 6),
            onOpen: {}
        )
        .frame(width: 560, height: 460)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Can improve (no tips)") {
        ChargingOptimizerWidget(
            model: previewModel(previewUpdate(data: previewSuboptimal)),
            size: DashboardWidgetSize(cols: 4, rows: 6)
        )
        .frame(width: 560, height: 460)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        ChargingOptimizerWidget(model: previewModel(previewUpdate(status: .loading, data: nil)))
            .frame(width: 320, height: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        ChargingOptimizerWidget(model: previewModel(previewUpdate(status: .loaded, data: nil)))
            .frame(width: 320, height: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        ChargingOptimizerWidget(
            model: previewModel(previewUpdate(status: .failed("Network unavailable"), data: nil))
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        ChargingOptimizerWidget(
            model: previewModel(previewUpdate(connection: .stale, ageSeconds: 180)),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        ChargingOptimizerWidget(
            model: previewModel(previewUpdate(connection: .offline, ageSeconds: 900)),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }
#endif
