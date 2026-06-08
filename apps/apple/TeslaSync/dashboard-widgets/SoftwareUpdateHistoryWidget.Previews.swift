//
//  SoftwareUpdateHistoryWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0091 · SoftwareUpdateHistoryWidget (Apple)
//
//  Xcode previews for each surface state (content / compact / loading / empty /
//  error / stale / offline). DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: SoftwareUpdateHistoryUpdate) -> SoftwareUpdateHistoryModel {
        let source = InMemorySoftwareUpdateHistorySource(initial: update)
        let model = SoftwareUpdateHistoryModel(source: source)
        model.start()
        return model
    }

    private func minutesAgo(_ minutes: Int) -> Date {
        Date().addingTimeInterval(TimeInterval(-minutes * 60))
    }

    private func daysAgo(_ days: Int) -> Date {
        Date().addingTimeInterval(TimeInterval(-days * 86400))
    }

    private let sampleUpdates: [SoftwareUpdate] = [
        SoftwareUpdate(id: "1", version: "2024.8.7", status: .installed, installedAt: minutesAgo(40)),
        SoftwareUpdate(id: "2", version: "2024.8.3.1", status: .installing, scheduledAt: minutesAgo(120)),
        SoftwareUpdate(id: "3", version: "2024.8.1", status: .downloading, createdAt: minutesAgo(600)),
        SoftwareUpdate(id: "4", version: "2024.2.12", status: .scheduled, scheduledAt: daysAgo(2)),
        SoftwareUpdate(id: "5", version: "2023.44.30.5", status: .available, createdAt: daysAgo(9))
    ]

    #Preview("Content") {
        SoftwareUpdateHistoryWidget(
            model: previewModel(
                SoftwareUpdateHistoryUpdate(
                    status: .loaded,
                    connection: .live,
                    updates: sampleUpdates,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 6),
            onOpen: {}
        )
        .frame(width: 320, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact") {
        SoftwareUpdateHistoryWidget(
            model: previewModel(
                SoftwareUpdateHistoryUpdate(status: .loaded, connection: .live, updates: sampleUpdates)
            ),
            size: DashboardWidgetSize(cols: 1, rows: 4)
        )
        .frame(width: 170, height: 150)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        SoftwareUpdateHistoryWidget(model: previewModel(SoftwareUpdateHistoryUpdate(status: .loading)))
            .frame(width: 320, height: 380)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        SoftwareUpdateHistoryWidget(model: previewModel(SoftwareUpdateHistoryUpdate(status: .loaded, updates: [])))
            .frame(width: 320, height: 380)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        SoftwareUpdateHistoryWidget(
            model: previewModel(SoftwareUpdateHistoryUpdate(status: .failed("Network unavailable")))
        )
        .frame(width: 320, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        SoftwareUpdateHistoryWidget(
            model: previewModel(
                SoftwareUpdateHistoryUpdate(
                    status: .loaded,
                    connection: .stale,
                    updates: sampleUpdates,
                    updatedAt: minutesAgo(5)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 6)
        )
        .frame(width: 320, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        SoftwareUpdateHistoryWidget(
            model: previewModel(
                SoftwareUpdateHistoryUpdate(
                    status: .loaded,
                    connection: .offline,
                    updates: sampleUpdates,
                    updatedAt: minutesAgo(30)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 6)
        )
        .frame(width: 320, height: 380)
        .padding()
        .background(Color.TS.bg)
    }
#endif
