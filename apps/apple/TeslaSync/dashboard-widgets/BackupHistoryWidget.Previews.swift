//
//  BackupHistoryWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0008 · BackupHistoryWidget (Apple)
//
//  Xcode previews for each surface state (content / compact / loading / empty /
//  no-site / error / offline). DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: BackupHistoryUpdate) -> BackupHistoryModel {
        let source = InMemoryBackupHistorySource(initial: update)
        let model = BackupHistoryModel(source: source)
        model.start()
        return model
    }

    private func hoursAgo(_ hours: Int) -> Date {
        Date().addingTimeInterval(TimeInterval(-hours * 3600))
    }

    private let sampleEvents: [BackupHistoryEvent] = [
        BackupHistoryEvent(id: 1, timestamp: hoursAgo(8), durationSeconds: 8100),
        BackupHistoryEvent(id: 2, timestamp: hoursAgo(54), durationSeconds: 2700),
        BackupHistoryEvent(id: 3, timestamp: hoursAgo(120), durationSeconds: 45),
        BackupHistoryEvent(id: 4, timestamp: hoursAgo(210), durationSeconds: 13500),
        BackupHistoryEvent(id: 5, timestamp: hoursAgo(360), durationSeconds: 600)
    ]

    #Preview("Content") {
        BackupHistoryWidget(
            model: previewModel(
                BackupHistoryUpdate(
                    status: .loaded,
                    connection: .live,
                    siteLinked: true,
                    events: sampleEvents,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 6),
            onOpen: {}
        )
        .frame(width: 340, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact") {
        BackupHistoryWidget(
            model: previewModel(
                BackupHistoryUpdate(
                    status: .loaded,
                    connection: .live,
                    siteLinked: true,
                    events: sampleEvents
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 3)
        )
        .frame(width: 170, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        BackupHistoryWidget(model: previewModel(BackupHistoryUpdate(status: .loading)))
            .frame(width: 340, height: 380)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty (no events)") {
        BackupHistoryWidget(
            model: previewModel(BackupHistoryUpdate(status: .loaded, siteLinked: true, events: []))
        )
        .frame(width: 340, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("No site linked") {
        BackupHistoryWidget(
            model: previewModel(BackupHistoryUpdate(status: .loaded, siteLinked: false, events: []))
        )
        .frame(width: 340, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        BackupHistoryWidget(
            model: previewModel(BackupHistoryUpdate(status: .failed("Network unavailable"), siteLinked: true))
        )
        .frame(width: 340, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        BackupHistoryWidget(
            model: previewModel(
                BackupHistoryUpdate(
                    status: .loaded,
                    connection: .offline,
                    siteLinked: true,
                    events: sampleEvents,
                    updatedAt: Date().addingTimeInterval(-1800)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 6)
        )
        .frame(width: 340, height: 380)
        .padding()
        .background(Color.TS.bg)
    }
#endif
