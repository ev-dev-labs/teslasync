//
//  DriveScoreWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0040 · DriveScoreWidget (Apple)
//
//  Xcode previews for each surface state (content / weak-score / miles / loading / empty /
//  error / stale / offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: DriveScoreUpdate) -> DriveScoreModel {
        let source = InMemoryDriveScoreSource(initial: update)
        let model = DriveScoreModel(source: source)
        model.start()
        return model
    }

    #Preview("Content (1×2, strong)") {
        DriveScoreWidget(
            model: previewModel(
                DriveScoreUpdate(
                    status: .loaded,
                    connection: .live,
                    analytics: DriveScoreInput(avgEfficiencyWhKm: 165),
                    unit: .kilometers,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2),
            onOpen: {}
        )
        .frame(width: 200, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content (weak score)") {
        DriveScoreWidget(
            model: previewModel(
                DriveScoreUpdate(
                    status: .loaded,
                    connection: .live,
                    analytics: DriveScoreInput(avgEfficiencyWhKm: 520),
                    unit: .kilometers,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 360, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content (miles)") {
        DriveScoreWidget(
            model: previewModel(
                DriveScoreUpdate(
                    status: .loaded,
                    connection: .live,
                    analytics: DriveScoreInput(avgEfficiencyWhKm: 230),
                    unit: .miles,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 200, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        DriveScoreWidget(model: previewModel(DriveScoreUpdate(status: .loading, analytics: nil)))
            .frame(width: 200, height: 320)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("No data yet") {
        DriveScoreWidget(model: previewModel(DriveScoreUpdate(status: .loaded, analytics: nil)))
            .frame(width: 200, height: 320)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        DriveScoreWidget(
            model: previewModel(DriveScoreUpdate(status: .failed("Network unavailable"), analytics: nil))
        )
        .frame(width: 200, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        DriveScoreWidget(
            model: previewModel(
                DriveScoreUpdate(
                    status: .loaded,
                    connection: .stale,
                    analytics: DriveScoreInput(avgEfficiencyWhKm: 210),
                    unit: .kilometers,
                    updatedAt: Date().addingTimeInterval(-180)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 360, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        DriveScoreWidget(
            model: previewModel(
                DriveScoreUpdate(
                    status: .loaded,
                    connection: .offline,
                    analytics: DriveScoreInput(avgEfficiencyWhKm: 300),
                    unit: .kilometers,
                    updatedAt: Date().addingTimeInterval(-900)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 360, height: 320)
        .padding()
        .background(Color.TS.bg)
    }
#endif
