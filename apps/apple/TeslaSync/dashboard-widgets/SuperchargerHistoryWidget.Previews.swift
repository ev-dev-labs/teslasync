//
//  SuperchargerHistoryWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0098 · SuperchargerHistoryWidget (Apple)
//
//  Xcode previews for each surface state (content / compact / loading / empty /
//  error / offline). DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: SuperchargerHistoryUpdate) -> SuperchargerHistoryModel {
        let source = InMemorySuperchargerHistorySource(initial: update)
        let model = SuperchargerHistoryModel(source: source)
        model.start()
        return model
    }

    private func hoursAgo(_ hours: Int) -> Date {
        Date().addingTimeInterval(TimeInterval(-hours * 3600))
    }

    private let sampleSessions: [SuperchargerSession] = [
        SuperchargerSession(
            id: 1,
            siteName: "Mountain View, CA — Supercharger",
            startedAt: hoursAgo(6),
            usageWh: 42600,
            totalDue: 12.84
        ),
        SuperchargerSession(
            id: 2,
            siteName: "Harris Ranch, CA",
            startedAt: hoursAgo(30),
            usageWh: 58200,
            totalDue: 18.21
        ),
        SuperchargerSession(
            id: 3,
            siteName: "Kettleman City, CA",
            startedAt: hoursAgo(54),
            usageWh: 31100,
            totalDue: 9.45
        ),
        SuperchargerSession(
            id: 4,
            siteName: "Gilroy, CA",
            startedAt: hoursAgo(80),
            usageWh: 17900,
            totalDue: 0
        ),
        SuperchargerSession(
            id: 5,
            siteName: "Buellton, CA",
            startedAt: hoursAgo(120),
            usageWh: 49500,
            totalDue: 15.02
        )
    ]

    private let sampleSummary = SuperchargerSummary(totalWh: 199_300, totalSpend: 55.52)

    #Preview("Content") {
        SuperchargerHistoryWidget(
            model: previewModel(
                SuperchargerHistoryUpdate(
                    status: .loaded,
                    connection: .live,
                    sessions: sampleSessions,
                    summary: sampleSummary,
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
        SuperchargerHistoryWidget(
            model: previewModel(
                SuperchargerHistoryUpdate(
                    status: .loaded,
                    connection: .live,
                    sessions: sampleSessions,
                    summary: sampleSummary
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 160, height: 160)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        SuperchargerHistoryWidget(model: previewModel(SuperchargerHistoryUpdate(status: .loading)))
            .frame(width: 320, height: 380)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        SuperchargerHistoryWidget(
            model: previewModel(SuperchargerHistoryUpdate(status: .loaded, sessions: [], summary: nil))
        )
        .frame(width: 320, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        SuperchargerHistoryWidget(
            model: previewModel(SuperchargerHistoryUpdate(status: .failed("Network unavailable")))
        )
        .frame(width: 320, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        SuperchargerHistoryWidget(
            model: previewModel(
                SuperchargerHistoryUpdate(
                    status: .loaded,
                    connection: .offline,
                    sessions: sampleSessions,
                    summary: sampleSummary,
                    updatedAt: Date().addingTimeInterval(-900)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 6)
        )
        .frame(width: 320, height: 380)
        .padding()
        .background(Color.TS.bg)
    }
#endif
