//
//  WatchSummaryWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0114 · WatchSummaryWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / offline / stale / content) and
//  the compact (1×2) / standard (2×n) layouts. DEBUG-only; skipped by the host compile + format
//  gates.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func watchSummaryPreviewModel(_ update: WatchSummaryUpdate) -> WatchSummaryModel {
        let source = InMemoryWatchSummarySource(initial: update)
        let model = WatchSummaryModel(source: source)
        model.start()
        return model
    }

    private let watchSummarySample = WatchSummaryDTO(
        state: "online",
        batteryLevel: 82,
        rangeKm: 312,
        isLocked: true,
        insideTempC: 21.5,
        lastUpdated: Date().addingTimeInterval(-180),
        charging: false
    )

    private let watchSummaryChargingSample = WatchSummaryDTO(
        state: "charging",
        batteryLevel: 47,
        rangeKm: 180,
        isLocked: false,
        insideTempC: 19,
        lastUpdated: Date().addingTimeInterval(-30),
        charging: true
    )

    private let watchSummarySampleUnits = WatchSummaryUnitPrefs(
        distance: .miles,
        temperature: .fahrenheit,
        localeIdentifier: "en_US"
    )

    #Preview("Compact (1×2) · content") {
        WatchSummaryWidget(
            model: watchSummaryPreviewModel(
                WatchSummaryUpdate(
                    status: .loaded,
                    connection: .live,
                    summary: watchSummaryChargingSample,
                    units: watchSummarySampleUnits,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 150, height: 280)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Standard (2×3) · content") {
        WatchSummaryWidget(
            model: watchSummaryPreviewModel(
                WatchSummaryUpdate(
                    status: .loaded,
                    connection: .live,
                    summary: watchSummarySample,
                    units: watchSummarySampleUnits,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 3)
        )
        .frame(width: 300, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading (compact)") {
        WatchSummaryWidget(
            model: watchSummaryPreviewModel(WatchSummaryUpdate(status: .loading, summary: nil)),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 150, height: 280)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading (standard)") {
        WatchSummaryWidget(
            model: watchSummaryPreviewModel(WatchSummaryUpdate(status: .loading, summary: nil)),
            size: DashboardWidgetSize(cols: 2, rows: 3)
        )
        .frame(width: 300, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        WatchSummaryWidget(
            model: watchSummaryPreviewModel(WatchSummaryUpdate(status: .loaded, summary: nil)),
            size: DashboardWidgetSize(cols: 2, rows: 3)
        )
        .frame(width: 300, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        WatchSummaryWidget(
            model: watchSummaryPreviewModel(
                WatchSummaryUpdate(status: .failed("Network unavailable"), summary: nil)
            ),
            size: DashboardWidgetSize(cols: 2, rows: 3)
        )
        .frame(width: 300, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        WatchSummaryWidget(
            model: watchSummaryPreviewModel(
                WatchSummaryUpdate(
                    status: .loaded,
                    connection: .stale,
                    isFetching: true,
                    summary: watchSummarySample,
                    units: watchSummarySampleUnits,
                    updatedAt: Date().addingTimeInterval(-300)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 3)
        )
        .frame(width: 300, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        WatchSummaryWidget(
            model: watchSummaryPreviewModel(
                WatchSummaryUpdate(
                    status: .loaded,
                    connection: .offline,
                    summary: watchSummarySample,
                    units: watchSummarySampleUnits,
                    updatedAt: Date().addingTimeInterval(-1800)
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 150, height: 280)
        .padding()
        .background(Color.TS.bg)
    }
#endif
