//
//  RecentDrivesListWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0078 · RecentDrivesListWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / offline / stale /
//  content) and the narrow/wide layouts. DEBUG-only; skipped by the host compile + format gates.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func recentDrivesPreviewModel(_ update: RDListUpdate) -> RDListModel {
        let source = RDListInMemoryRecentDrivesSource(initial: update)
        let model = RDListModel(source: source)
        model.start()
        return model
    }

    private let recentDrivesSample: [RecentDriveDTO] = [
        RecentDriveDTO(
            id: 1,
            distanceM: 18432,
            durationS: 1860,
            startSocPct: 82,
            endSocPct: 71,
            startAddress: "1455 Market Street, San Francisco, CA",
            endAddress: "Tesla Fremont Factory",
            startTimestamp: Date().addingTimeInterval(-3600)
        ),
        RecentDriveDTO(
            id: 2,
            distanceM: 4200,
            durationS: 540,
            startSocPct: 71,
            endSocPct: 68,
            startAddress: "Tesla Fremont Factory",
            endAddress: "Whole Foods Market",
            startTimestamp: Date().addingTimeInterval(-7200)
        ),
        RecentDriveDTO(
            id: 3,
            distanceM: 540,
            durationS: 45,
            startSocPct: 68,
            endSocPct: nil,
            startAddress: nil,
            endAddress: nil,
            startTimestamp: Date().addingTimeInterval(-9000)
        ),
        RecentDriveDTO(
            id: 4,
            distanceM: 92750,
            durationS: 7320,
            startSocPct: 95,
            endSocPct: 41,
            startAddress: "Donner Pass Rest Area",
            endAddress: "Reno Supercharger",
            startTimestamp: Date().addingTimeInterval(-90000)
        )
    ]

    private let recentDrivesSampleUnits = RecentDrivesUnitPrefs(
        distance: .miles,
        localeIdentifier: "en_US",
        timeZoneIdentifier: "America/Los_Angeles"
    )

    #Preview("Standard (2×4)") {
        RecentDrivesListWidget(
            model: recentDrivesPreviewModel(
                RDListUpdate(
                    status: .loaded,
                    connection: .live,
                    drives: recentDrivesSample,
                    units: recentDrivesSampleUnits,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4),
            onViewAll: {},
            onOpenDrive: { _ in }
        )
        .frame(width: 280, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Wide (4×4)") {
        RecentDrivesListWidget(
            model: recentDrivesPreviewModel(
                RDListUpdate(
                    status: .loaded,
                    connection: .live,
                    drives: recentDrivesSample,
                    units: recentDrivesSampleUnits,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 4, rows: 4),
            onViewAll: {},
            onOpenDrive: { _ in }
        )
        .frame(width: 560, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        RecentDrivesListWidget(
            model: recentDrivesPreviewModel(RDListUpdate(status: .loading, drives: nil)),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 280, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        RecentDrivesListWidget(
            model: recentDrivesPreviewModel(RDListUpdate(status: .loaded, drives: [])),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 280, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        RecentDrivesListWidget(
            model: recentDrivesPreviewModel(
                RDListUpdate(status: .failed("Network unavailable"), drives: nil)
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 280, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        RecentDrivesListWidget(
            model: recentDrivesPreviewModel(
                RDListUpdate(
                    status: .loaded,
                    connection: .stale,
                    isFetching: true,
                    drives: recentDrivesSample,
                    units: recentDrivesSampleUnits,
                    updatedAt: Date().addingTimeInterval(-300)
                )
            ),
            size: DashboardWidgetSize(cols: 4, rows: 4),
            onViewAll: {},
            onOpenDrive: { _ in }
        )
        .frame(width: 560, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        RecentDrivesListWidget(
            model: recentDrivesPreviewModel(
                RDListUpdate(
                    status: .loaded,
                    connection: .offline,
                    drives: recentDrivesSample,
                    units: recentDrivesSampleUnits,
                    updatedAt: Date().addingTimeInterval(-1800)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4),
            onViewAll: {},
            onOpenDrive: { _ in }
        )
        .frame(width: 280, height: 360)
        .padding()
        .background(Color.TS.bg)
    }
#endif
