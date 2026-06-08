//
//  NotificationStatsWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0069 · NotificationStatsWidget (Apple)
//
//  Xcode previews for each surface state (content / wide+log / compact / loading /
//  empty / offline / error). DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum NotificationStatsPreviewData {
        static func data(failed: Int = 3) -> NotificationStatsData {
            let now = Date()
            let stats = NotificationStats(
                totalSent: 1284,
                sent: 1268,
                failed: failed,
                pending: 13,
                totalChannels: 5,
                enabledChannels: 4
            )
            let logs = [
                NotificationLog(
                    id: 1, title: "Pushover", message: "Charge complete",
                    status: .sent, createdAt: now.addingTimeInterval(-30)
                ),
                NotificationLog(
                    id: 2, title: "Email", message: "Sentry triggered",
                    status: .failed, createdAt: now.addingTimeInterval(-540)
                ),
                NotificationLog(
                    id: 3, title: "Webhook", message: "Drive started",
                    status: .pending, createdAt: now.addingTimeInterval(-3600)
                ),
                NotificationLog(
                    id: 4, title: "Slack", message: "Tire pressure low",
                    status: .sent, createdAt: now.addingTimeInterval(-9000)
                ),
                NotificationLog(
                    id: 5, title: "SMS", message: "Software update",
                    status: .deferredDnd, createdAt: now.addingTimeInterval(-90000)
                )
            ]
            return NotificationStatsData(stats: stats, logs: logs)
        }
    }

    @MainActor
    private func previewModel(_ state: NotificationStatsLoadState<NotificationStatsData>) -> NotificationStatsModel {
        NotificationStatsModel(previewState: state)
    }

    #Preview("Content · 2×2") {
        NotificationStatsWidget(
            props: DashboardWidgetProps(size: DashboardWidgetSize(cols: 2, rows: 2)),
            model: previewModel(.loaded(NotificationStatsPreviewData.data(), stale: false)),
            telemetry: nil
        )
        .frame(width: 300, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Wide · 4×4 + log") {
        NotificationStatsWidget(
            props: DashboardWidgetProps(size: DashboardWidgetSize(cols: 4, rows: 4)),
            model: previewModel(.loaded(NotificationStatsPreviewData.data(), stale: true))
        )
        .frame(width: 560, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact · 1×2") {
        NotificationStatsWidget(
            props: DashboardWidgetProps(size: DashboardWidgetSize(cols: 1, rows: 2)),
            model: previewModel(.loaded(NotificationStatsPreviewData.data(), stale: false))
        )
        .frame(width: 150, height: 150)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        NotificationStatsWidget(
            props: DashboardWidgetProps(size: DashboardWidgetSize(cols: 2, rows: 2)),
            model: previewModel(.idle)
        )
        .frame(width: 300, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        NotificationStatsWidget(
            props: DashboardWidgetProps(size: DashboardWidgetSize(cols: 2, rows: 2)),
            model: previewModel(.empty(stale: false))
        )
        .frame(width: 300, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        NotificationStatsWidget(
            props: DashboardWidgetProps(size: DashboardWidgetSize(cols: 4, rows: 4)),
            model: previewModel(.failed(.offline, cached: NotificationStatsPreviewData.data(), stale: true))
        )
        .frame(width: 560, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        NotificationStatsWidget(
            props: DashboardWidgetProps(size: DashboardWidgetSize(cols: 2, rows: 2)),
            model: previewModel(.failed(.network(message: "boom"), cached: nil, stale: false))
        )
        .frame(width: 300, height: 240)
        .padding()
        .background(Color.TS.bg)
    }
#endif
