//
//  DriveScoreGaugeWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0039 · DriveScoreGaugeWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / stale / offline / content) and a
//  couple of grid sizes. DEBUG-only; skipped by the host compile + format gates outside DEBUG.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func driveScorePreviewModel(_ update: DriveScoreGaugeWidgetUpdate) -> DriveScoreGaugeWidgetModel {
        let source = DriveScoreGaugeWidgetInMemorySource(initial: update)
        let model = DriveScoreGaugeWidgetModel(source: source)
        model.start()
        return model
    }

    private let driveScoreExcellent = DriveScoreGaugeWidgetScoreDTO(
        overall: 88,
        efficiency: 92,
        smoothness: 84,
        speedDiscipline: 86,
        grade: "A"
    )

    private let driveScoreFair = DriveScoreGaugeWidgetScoreDTO(
        overall: 54,
        efficiency: 48,
        smoothness: 62,
        speedDiscipline: 51,
        grade: "C"
    )

    #Preview("Standard (1×2)") {
        DriveScoreGaugeWidget(
            model: driveScorePreviewModel(
                DriveScoreGaugeWidgetUpdate(
                    status: .loaded,
                    connection: .live,
                    score: driveScoreExcellent,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 220, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Wide (2×2) — fair") {
        DriveScoreGaugeWidget(
            model: driveScorePreviewModel(
                DriveScoreGaugeWidgetUpdate(
                    status: .loaded,
                    connection: .live,
                    score: driveScoreFair,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 420, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        DriveScoreGaugeWidget(
            model: driveScorePreviewModel(DriveScoreGaugeWidgetUpdate(status: .loading, score: nil)),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 220, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        DriveScoreGaugeWidget(
            model: driveScorePreviewModel(DriveScoreGaugeWidgetUpdate(status: .loaded, score: nil)),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 220, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        DriveScoreGaugeWidget(
            model: driveScorePreviewModel(
                DriveScoreGaugeWidgetUpdate(status: .failed("Network unavailable"), score: nil)
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 220, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        DriveScoreGaugeWidget(
            model: driveScorePreviewModel(
                DriveScoreGaugeWidgetUpdate(
                    status: .loaded,
                    connection: .stale,
                    isFetching: true,
                    score: driveScoreExcellent,
                    updatedAt: Date().addingTimeInterval(-180)
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 220, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        DriveScoreGaugeWidget(
            model: driveScorePreviewModel(
                DriveScoreGaugeWidgetUpdate(
                    status: .loaded,
                    connection: .offline,
                    score: driveScoreFair,
                    updatedAt: Date().addingTimeInterval(-600)
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 220, height: 360)
        .padding()
        .background(Color.TS.bg)
    }
#endif
