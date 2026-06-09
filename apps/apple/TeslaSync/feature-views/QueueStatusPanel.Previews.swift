//
//  QueueStatusPanel.Previews.swift
//  TeslaSync — P4 feature view · 0037 · QueueStatusPanel (Apple)
//
//  Xcode previews for each surface state (loading / populated / backlog+failures
//  / empty / error / stale / offline). DEBUG-only; compiled by the app targets
//  and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: QueueStatusInput) -> QueueStatusModel {
        let source = InMemoryQueueStatusSource(initial: input)
        let model = QueueStatusModel(source: source)
        model.start()
        return model
    }

    private let previewNow = Date()

    private let healthySnapshot = QueueStatusSnapshot(
        generatedAt: previewNow.addingTimeInterval(-12),
        workers: [
            QueueStat(
                worker: "notification",
                displayName: "Notification worker",
                pending: 3,
                inProgress: 1,
                succeeded24h: 1842,
                failed24h: 0,
                oldestPendingAgeSeconds: 0,
                heartbeatSeverity: .ok,
                lastHeartbeatAt: previewNow.addingTimeInterval(-8),
                host: "notification-worker-1",
                version: "1.8.2"
            ),
            QueueStat(
                worker: "export",
                displayName: "Export worker",
                pending: 12,
                inProgress: 2,
                succeeded24h: 96,
                failed24h: 3,
                oldestPendingAgeSeconds: 185,
                heartbeatSeverity: .warn,
                lastHeartbeatAt: previewNow.addingTimeInterval(-95),
                host: "export-worker-1",
                version: "1.8.2"
            ),
            QueueStat(
                worker: "automation",
                displayName: "Automation worker",
                pending: 0,
                inProgress: 0,
                succeeded24h: 540,
                failed24h: 0,
                oldestPendingAgeSeconds: 0,
                heartbeatSeverity: .down,
                heartbeatDetail: "No heartbeat in 6m",
                lastHeartbeatAt: nil,
                host: nil,
                version: nil
            )
        ]
    )

    private let criticalSnapshot = QueueStatusSnapshot(
        generatedAt: previewNow.addingTimeInterval(-4),
        workers: [
            QueueStat(
                worker: "export",
                displayName: "Export worker",
                pending: 248,
                inProgress: 1,
                succeeded24h: 71,
                failed24h: 36,
                oldestPendingAgeSeconds: 4215,
                heartbeatSeverity: .critical,
                lastHeartbeatAt: previewNow.addingTimeInterval(-380),
                host: "export-worker-2",
                version: "1.8.1"
            )
        ]
    )

    #Preview("Loading") {
        QueueStatusPanel(model: previewModel(QueueStatusInput(isLoading: true, isFetching: true)))
            .padding()
            .frame(maxWidth: 760)
            .background(Color.TS.bg)
    }

    #Preview("Populated") {
        QueueStatusPanel(model: previewModel(QueueStatusInput(response: healthySnapshot)))
            .padding()
            .frame(maxWidth: 760)
            .background(Color.TS.bg)
    }

    #Preview("Backlog + failures") {
        QueueStatusPanel(model: previewModel(QueueStatusInput(response: criticalSnapshot)))
            .padding()
            .frame(maxWidth: 760)
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        QueueStatusPanel(model: previewModel(
            QueueStatusInput(response: QueueStatusSnapshot(generatedAt: previewNow, workers: []))
        ))
        .padding()
        .frame(maxWidth: 760)
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        QueueStatusPanel(model: previewModel(
            QueueStatusInput(errorMessage: "GET /system/queues failed: 503 Service Unavailable")
        ))
        .padding()
        .frame(maxWidth: 760)
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        QueueStatusPanel(model: previewModel(
            QueueStatusInput(isFetching: true, response: healthySnapshot, isStale: true)
        ))
        .padding()
        .frame(maxWidth: 760)
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        QueueStatusPanel(model: previewModel(
            QueueStatusInput(response: healthySnapshot, isOffline: true)
        ))
        .padding()
        .frame(maxWidth: 760)
        .background(Color.TS.bg)
    }
#endif
