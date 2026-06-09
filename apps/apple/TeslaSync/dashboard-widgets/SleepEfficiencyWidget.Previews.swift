//
//  SleepEfficiencyWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0090 · SleepEfficiencyWidget (Apple)
//
//  Xcode previews for each surface state (content / compact / loading / empty / error / stale / offline).
//  DEBUG-only; skipped by the release build.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: SleepEfficiencyUpdate) -> SleepEfficiencyModel {
        let source = InMemorySleepEfficiencySource(initial: update)
        let model = SleepEfficiencyModel(source: source)
        model.start()
        return model
    }

    private let previewPayload = SleepEfficiencyInput(
        sleepEfficiencyPct: 92.5,
        sentryOffDrainRate: 0.5,
        stateDistribution: [
            SleepStateSlice(state: "asleep", totalMinutes: 600),
            SleepStateSlice(state: "offline", totalMinutes: 120),
            SleepStateSlice(state: "online", totalMinutes: 240),
            SleepStateSlice(state: "driving", totalMinutes: 90)
        ],
        recentEventsCount: 3
    )

    #Preview("Content (expanded)") {
        SleepEfficiencyWidget(
            model: previewModel(
                SleepEfficiencyUpdate(
                    status: .loaded,
                    connection: .live,
                    payload: previewPayload,
                    updatedAt: Date(),
                    isFetching: false
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4),
            onOpen: {}
        )
        .frame(width: 300, height: 280)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact (default)") {
        SleepEfficiencyWidget(
            model: previewModel(
                SleepEfficiencyUpdate(status: .loaded, connection: .live, payload: previewPayload, updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 150, height: 200)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        SleepEfficiencyWidget(
            model: previewModel(SleepEfficiencyUpdate(status: .loading, payload: nil)),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 300, height: 280)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        SleepEfficiencyWidget(
            model: previewModel(SleepEfficiencyUpdate(status: .loaded, payload: nil)),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 300, height: 280)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        SleepEfficiencyWidget(
            model: previewModel(SleepEfficiencyUpdate(status: .failed("Network unavailable"), payload: nil)),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 300, height: 280)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (low efficiency)") {
        SleepEfficiencyWidget(
            model: previewModel(
                SleepEfficiencyUpdate(
                    status: .loaded,
                    connection: .stale,
                    payload: SleepEfficiencyInput(
                        sleepEfficiencyPct: 78,
                        sentryOffDrainRate: 1.2,
                        stateDistribution: [
                            SleepStateSlice(state: "asleep", totalMinutes: 180),
                            SleepStateSlice(state: "online", totalMinutes: 600)
                        ],
                        recentEventsCount: 9
                    ),
                    updatedAt: Date().addingTimeInterval(-180),
                    isFetching: true
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 300, height: 280)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        SleepEfficiencyWidget(
            model: previewModel(
                SleepEfficiencyUpdate(
                    status: .loaded,
                    connection: .offline,
                    payload: previewPayload,
                    updatedAt: Date().addingTimeInterval(-900)
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 150, height: 200)
        .padding()
        .background(Color.TS.bg)
    }
#endif
