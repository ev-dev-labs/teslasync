//
//  AutomationActivityFeed.Previews.swift
//  TeslaSync — P4 feature view · 0081 · AutomationActivityFeed (Apple)
//
//  Xcode previews for each surface state (loading / data / live+data / empty / error /
//  stale / offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: AutomationFeedInput) -> AutomationFeedModel {
        let source = InMemoryAutomationFeedSource(initial: input)
        let model = AutomationFeedModel(source: source)
        model.start()
        return model
    }

    private let previewHistory: [AutomationHistoryInput] = [
        AutomationHistoryInput(
            id: "1",
            automationName: "Precondition at 7 AM",
            status: "success",
            triggeredAt: "2026-01-05T15:04:05Z",
            durationMs: 1840,
            actionsTotal: 3,
            actionsSucceeded: 3
        ),
        AutomationHistoryInput(
            id: "2",
            automationName: "Charge to 80%",
            status: "partial",
            triggeredAt: "2026-01-05T14:30:00Z",
            durationMs: 920,
            actionsTotal: 2,
            actionsSucceeded: 1
        ),
        AutomationHistoryInput(
            id: "3",
            automationName: "Lock when away",
            status: "failed",
            error: "Vehicle unreachable",
            triggeredAt: "2026-01-05T12:10:00Z",
            durationMs: 450,
            actionsTotal: 1,
            actionsSucceeded: 0
        ),
        AutomationHistoryInput(
            id: "4",
            automationName: "Sentry on departure",
            status: "skipped",
            triggeredAt: "2026-01-04T22:00:00Z",
            durationMs: 120
        )
    ]

    private let previewStats = AutomationHistoryStatsInput(
        totalExecutions: 142,
        successRate: 93,
        avgDurationMs: 1320
    )

    private let previewLive: [AutomationLiveEventInput] = [
        AutomationLiveEventInput(
            id: "ae-1",
            type: "automation.triggered",
            automationId: 7,
            name: "Precondition at 7 AM"
        ),
        AutomationLiveEventInput(
            id: "ae-2",
            type: "automation.failed",
            automationId: 9,
            name: "Lock when away",
            error: "Vehicle unreachable"
        ),
        AutomationLiveEventInput(
            id: "ae-3",
            type: "automation.skipped",
            automationId: 4,
            name: "Sentry on departure",
            reason: "Condition not met"
        )
    ]

    @MainActor
    private func previewSurface(_ input: AutomationFeedInput) -> some View {
        AutomationActivityFeed(model: previewModel(input))
            .frame(maxWidth: 560)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        previewSurface(AutomationFeedInput(isLoading: true))
    }

    #Preview("Data") {
        previewSurface(AutomationFeedInput(history: previewHistory, stats: previewStats))
    }

    #Preview("Live + Data") {
        previewSurface(AutomationFeedInput(
            history: previewHistory,
            stats: previewStats,
            liveEvents: previewLive
        ))
    }

    #Preview("Empty") {
        previewSurface(AutomationFeedInput(history: []))
    }

    #Preview("Error") {
        previewSurface(AutomationFeedInput(
            errorMessage: "Automation history endpoint returned 503 Service Unavailable"
        ))
    }

    #Preview("Stale") {
        previewSurface(AutomationFeedInput(
            history: previewHistory,
            stats: previewStats,
            liveEvents: previewLive,
            connection: .stale
        ))
    }

    #Preview("Offline") {
        previewSurface(AutomationFeedInput(
            history: previewHistory,
            stats: previewStats,
            connection: .offline
        ))
    }
#endif
