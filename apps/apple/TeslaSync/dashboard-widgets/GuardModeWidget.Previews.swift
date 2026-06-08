//
//  GuardModeWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0054 · GuardModeWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / offline /
//  stale / compact / content). DEBUG-only; compiled by the app targets and skipped
//  by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: GuardUpdate) -> GuardModel {
        let source = InMemoryGuardSource(initial: update)
        let model = GuardModel(source: source)
        model.start()
        return model
    }

    private let previewConfig = GuardConfigInput(enabled: true, sensitivity: "high", autoPanic: true)

    private func previewEvents(now: Date = Date()) -> [GuardEventInput] {
        [
            GuardEventInput(id: 1, eventType: "vehicle_moved", timestamp: now.addingTimeInterval(-120)),
            GuardEventInput(
                id: 2, eventType: "unauthorized_unlock",
                timestamp: now.addingTimeInterval(-1800), acknowledgedAt: now.addingTimeInterval(-1700)
            ),
            GuardEventInput(id: 3, eventType: "sentry_triggered", timestamp: now.addingTimeInterval(-5400)),
            GuardEventInput(id: 4, eventType: "test_alert", timestamp: now.addingTimeInterval(-9000))
        ]
    }

    #Preview("Content") {
        GuardModeWidget(
            model: previewModel(
                GuardUpdate(
                    status: .loaded,
                    connection: .live,
                    config: previewConfig,
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

    #Preview("Compact (1×2)") {
        GuardModeWidget(
            model: previewModel(
                GuardUpdate(
                    status: .loaded,
                    config: GuardConfigInput(enabled: false, sensitivity: "medium"),
                    events: previewEvents()
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 200, height: 130)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty feed") {
        GuardModeWidget(
            model: previewModel(GuardUpdate(status: .loaded, config: previewConfig, events: []))
        )
        .frame(width: 300, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        GuardModeWidget(model: previewModel(GuardUpdate(status: .loading, config: nil)))
            .frame(width: 300, height: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("No guard data") {
        GuardModeWidget(model: previewModel(GuardUpdate(status: .loaded, config: nil)))
            .frame(width: 300, height: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        GuardModeWidget(model: previewModel(GuardUpdate(status: .failed("Network unavailable"), config: nil)))
            .frame(width: 300, height: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        GuardModeWidget(
            model: previewModel(
                GuardUpdate(
                    status: .loaded,
                    connection: .offline,
                    config: previewConfig,
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
        GuardModeWidget(
            model: previewModel(
                GuardUpdate(
                    status: .loaded,
                    connection: .stale,
                    config: previewConfig,
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
