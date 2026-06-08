//
//  RecentDrivesWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0079 · RecentDrivesWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / stale / offline / content) and a
//  couple of grid sizes. DEBUG-only; skipped by the host compile + format gates outside DEBUG.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func recentDrivesPreviewModel(_ update: RecentDrivesWidgetUpdate) -> RecentDrivesWidgetModel {
        let source = RecentDrivesWidgetInMemoryRecentDrivesSource(initial: update)
        let model = RecentDrivesWidgetModel(source: source)
        model.start()
        return model
    }

    private let recentDrivesSample: [RecentDrivesWidgetDriveDTO] = [
        RecentDrivesWidgetDriveDTO(
            id: 5001,
            distanceM: 18234,
            durationS: 1500,
            startSocPct: 82,
            endSocPct: 67,
            startTs: Date().addingTimeInterval(-3600)
        ),
        RecentDrivesWidgetDriveDTO(
            id: 5002,
            distanceM: 4120,
            durationS: 540,
            startSocPct: 67,
            endSocPct: 63,
            startTs: Date().addingTimeInterval(-26 * 3600)
        ),
        RecentDrivesWidgetDriveDTO(
            id: 5003,
            distanceM: 51890,
            durationS: 3180,
            startSocPct: 90,
            endSocPct: nil,
            startTs: Date().addingTimeInterval(-50 * 3600)
        ),
        RecentDrivesWidgetDriveDTO(
            id: 5004,
            distanceM: 9730,
            durationS: 960,
            startSocPct: 55,
            endSocPct: 48,
            startTs: Date().addingTimeInterval(-74 * 3600)
        ),
        RecentDrivesWidgetDriveDTO(
            id: 5005,
            distanceM: 2240,
            durationS: 300,
            startSocPct: 48,
            endSocPct: 46,
            startTs: nil
        )
    ]

    private let recentDrivesSampleUnits = RecentDrivesWidgetUnitPrefs(distance: .miles, localeIdentifier: "en_US")

    #Preview("Standard (2×4)") {
        RecentDrivesWidget(
            model: recentDrivesPreviewModel(
                RecentDrivesWidgetUpdate(
                    status: .loaded,
                    connection: .live,
                    drives: recentDrivesSample,
                    units: recentDrivesSampleUnits,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4),
            onOpenAll: {},
            onOpenDrive: { _ in }
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Wide (4×4)") {
        RecentDrivesWidget(
            model: recentDrivesPreviewModel(
                RecentDrivesWidgetUpdate(
                    status: .loaded,
                    connection: .live,
                    drives: recentDrivesSample,
                    units: RecentDrivesWidgetUnitPrefs(distance: .kilometers),
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 4, rows: 4),
            onOpenAll: {},
            onOpenDrive: { _ in }
        )
        .frame(width: 560, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        RecentDrivesWidget(
            model: recentDrivesPreviewModel(RecentDrivesWidgetUpdate(status: .loading, drives: nil)),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        RecentDrivesWidget(
            model: recentDrivesPreviewModel(RecentDrivesWidgetUpdate(status: .loaded, drives: [])),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        RecentDrivesWidget(
            model: recentDrivesPreviewModel(
                RecentDrivesWidgetUpdate(status: .failed("Network unavailable"), drives: nil)
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        RecentDrivesWidget(
            model: recentDrivesPreviewModel(
                RecentDrivesWidgetUpdate(
                    status: .loaded,
                    connection: .stale,
                    isFetching: true,
                    drives: recentDrivesSample,
                    units: recentDrivesSampleUnits,
                    updatedAt: Date().addingTimeInterval(-180)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4),
            onOpenAll: {},
            onOpenDrive: { _ in }
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        RecentDrivesWidget(
            model: recentDrivesPreviewModel(
                RecentDrivesWidgetUpdate(
                    status: .loaded,
                    connection: .offline,
                    drives: recentDrivesSample,
                    units: recentDrivesSampleUnits,
                    updatedAt: Date().addingTimeInterval(-600)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4),
            onOpenAll: {},
            onOpenDrive: { _ in }
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }
#endif
