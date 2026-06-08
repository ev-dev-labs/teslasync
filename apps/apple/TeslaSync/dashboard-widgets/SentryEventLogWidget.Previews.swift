//
//  SentryEventLogWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0086 · SentryEventLogWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / offline / stale /
//  content / wide). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: SentryUpdate) -> SentryModel {
        let source = InMemorySentrySource(initial: update)
        let model = SentryModel(source: source)
        model.start()
        return model
    }

    private func previewEvents(now: Date = Date()) -> [SentryEventInput] {
        [
            SentryEventInput(
                id: 1,
                vehicleID: 7,
                timestamp: now.addingTimeInterval(-90),
                createdAt: now.addingTimeInterval(-90),
                doorState: "Driver Front: open",
                sentryMode: true,
                locked: false
            ),
            SentryEventInput(
                id: 2,
                vehicleID: 7,
                timestamp: now.addingTimeInterval(-1200),
                createdAt: now.addingTimeInterval(-1200),
                sentryMode: true,
                locked: true
            ),
            SentryEventInput(
                id: 3,
                vehicleID: 7,
                timestamp: now.addingTimeInterval(-3600),
                createdAt: now.addingTimeInterval(-3600),
                locked: true
            ),
            SentryEventInput(
                id: 4,
                vehicleID: 7,
                timestamp: now.addingTimeInterval(-7200),
                createdAt: now.addingTimeInterval(-7200),
                sentryMode: false,
                locked: false
            ),
            SentryEventInput(
                id: 5,
                vehicleID: 7,
                timestamp: now.addingTimeInterval(-10800),
                createdAt: now.addingTimeInterval(-10800)
            )
        ]
    }

    #Preview("Content (2×4)") {
        SentryEventLogWidget(
            model: previewModel(
                SentryUpdate(
                    status: .loaded,
                    connection: .live,
                    events: previewEvents(),
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4),
            onOpen: {}
        )
        .frame(width: 300, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Wide (4×4 · subtitles)") {
        SentryEventLogWidget(
            model: previewModel(
                SentryUpdate(status: .loaded, connection: .live, events: previewEvents(), updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 4, rows: 4)
        )
        .frame(width: 560, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        SentryEventLogWidget(model: previewModel(SentryUpdate(status: .loaded, events: [])))
            .frame(width: 300, height: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        SentryEventLogWidget(model: previewModel(SentryUpdate(status: .loading, events: [])))
            .frame(width: 300, height: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        SentryEventLogWidget(model: previewModel(SentryUpdate(status: .failed("Network unavailable"), events: [])))
            .frame(width: 300, height: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        SentryEventLogWidget(
            model: previewModel(
                SentryUpdate(
                    status: .loaded,
                    connection: .offline,
                    events: previewEvents(),
                    updatedAt: Date().addingTimeInterval(-600)
                )
            )
        )
        .frame(width: 300, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        SentryEventLogWidget(
            model: previewModel(
                SentryUpdate(
                    status: .loaded,
                    connection: .stale,
                    events: previewEvents(),
                    updatedAt: Date().addingTimeInterval(-180)
                )
            )
        )
        .frame(width: 300, height: 360)
        .padding()
        .background(Color.TS.bg)
    }
#endif
