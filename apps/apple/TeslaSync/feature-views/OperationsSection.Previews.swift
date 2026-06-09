//
//  OperationsSection.Previews.swift
//  TeslaSync — P4 feature view · 0250 · OperationsSection (Apple)
//
//  Xcode previews for each surface state (data / logs-empty / stats-empty / loading /
//  error / stale / offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum OperationsPreviewData {
        static let stats = NotificationStatsSnapshot(
            totalSent: 1284,
            sent: 1247,
            failed: 37,
            totalChannels: 6,
            enabledChannels: 4
        )

        static let notifLogs: [NotificationLogItem] = [
            NotificationLogItem(
                id: 1,
                status: "sent",
                title: "Charging complete",
                message: "Model Y finished charging at 80% (Home).",
                createdAt: Date(timeIntervalSince1970: 1_775_649_900)
            ),
            NotificationLogItem(
                id: 2,
                status: "failed",
                title: "Battery low",
                message: "Webhook delivery to Slack failed after 3 retries.",
                createdAt: Date(timeIntervalSince1970: 1_775_653_500)
            ),
            NotificationLogItem(
                id: 3,
                status: "pending",
                title: "Software update available",
                message: "2026.8.1 is ready to install.",
                createdAt: Date(timeIntervalSince1970: 1_775_657_100)
            )
        ]

        static let auditLogs: [AuditLogItem] = [
            AuditLogItem(
                id: 1,
                action: "vehicle.command",
                resource: "vehicle/42/wake",
                details: "Woke vehicle for scheduled charge.",
                createdAt: Date(timeIntervalSince1970: 1_775_660_700)
            ),
            AuditLogItem(
                id: 2,
                action: "settings.update",
                resource: "notifications/channels/3",
                details: "Enabled the Slack channel.",
                createdAt: Date(timeIntervalSince1970: 1_775_664_300)
            )
        ]
    }

    @MainActor
    private func previewSection(_ input: OperationsInput) -> OperationsSection {
        let source = InMemoryOperationsSource(initial: input)
        return OperationsSection(source: source, initiallyExpanded: true)
    }

    #Preview("Data") {
        ScrollView {
            previewSection(OperationsInput(
                stats: OperationsPreviewData.stats,
                notifLogs: OperationsPreviewData.notifLogs,
                auditLogs: OperationsPreviewData.auditLogs
            ))
            .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Logs empty") {
        ScrollView {
            previewSection(OperationsInput(
                stats: OperationsPreviewData.stats,
                notifLogs: [],
                auditLogs: []
            ))
            .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Stats empty") {
        ScrollView {
            previewSection(OperationsInput(
                stats: nil,
                notifLogs: nil,
                auditLogs: OperationsPreviewData.auditLogs
            ))
            .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        ScrollView {
            previewSection(OperationsInput(isLoading: true))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        ScrollView {
            previewSection(OperationsInput(errorMessage: "Network request timed out"))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        ScrollView {
            previewSection(OperationsInput(
                stats: OperationsPreviewData.stats,
                notifLogs: OperationsPreviewData.notifLogs,
                auditLogs: OperationsPreviewData.auditLogs,
                connection: .stale
            ))
            .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        ScrollView {
            previewSection(OperationsInput(
                stats: OperationsPreviewData.stats,
                notifLogs: OperationsPreviewData.notifLogs,
                auditLogs: OperationsPreviewData.auditLogs,
                connection: .offline
            ))
            .padding()
        }
        .background(Color.TS.bg)
    }
#endif
