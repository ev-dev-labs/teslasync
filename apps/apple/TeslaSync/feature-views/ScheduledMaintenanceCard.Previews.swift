//
//  ScheduledMaintenanceCard.Previews.swift
//  TeslaSync — P4 feature view · 0251 · ScheduledMaintenanceCard (Apple)
//
//  Xcode previews for each surface state (loading / scheduler idle / active with countdown / active
//  within 24h / active elapsed / error / stale / offline). DEBUG-only; compiled by the app targets
//  and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum ScheduledMaintenancePreviewData {
        static func snapshot(
            mode: MaintenanceMode,
            message: String,
            untilOffset: TimeInterval?
        ) -> MaintenanceSnapshot {
            MaintenanceSnapshot(
                mode: mode,
                message: message,
                until: untilOffset.map { MaintenanceInstant.iso(from: Date().addingTimeInterval($0)) },
                updatedAt: MaintenanceInstant.iso(from: Date()),
                source: "db"
            )
        }
    }

    @MainActor
    private func previewModel(_ input: ScheduledMaintenanceInput) -> ScheduledMaintenanceModel {
        let source = InMemoryScheduledMaintenanceSource(initial: input)
        let model = ScheduledMaintenanceModel(source: source)
        model.start()
        return model
    }

    #Preview("Loading") {
        ScheduledMaintenanceCard(model: previewModel(ScheduledMaintenanceInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Scheduler · idle") {
        ScheduledMaintenanceCard(model: previewModel(ScheduledMaintenanceInput(snapshot: .ok)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Active · countdown") {
        ScheduledMaintenanceCard(model: previewModel(ScheduledMaintenanceInput(
            snapshot: ScheduledMaintenancePreviewData.snapshot(
                mode: .maintenance,
                message: "Upgrading TimescaleDB — read-only during the window.",
                untilOffset: 48 * 60 * 60
            )
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Active · within 24h") {
        ScheduledMaintenanceCard(model: previewModel(ScheduledMaintenanceInput(
            snapshot: ScheduledMaintenancePreviewData.snapshot(
                mode: .maintenance,
                message: "Hardware move scheduled — brief downtime expected.",
                untilOffset: 6 * 60 * 60
            )
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Active · elapsed") {
        ScheduledMaintenanceCard(model: previewModel(ScheduledMaintenanceInput(
            snapshot: ScheduledMaintenancePreviewData.snapshot(
                mode: .maintenance,
                message: "",
                untilOffset: -60 * 60
            )
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        ScheduledMaintenanceCard(model: previewModel(
            ScheduledMaintenanceInput(errorMessage: "Network request timed out")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        ScheduledMaintenanceCard(model: previewModel(ScheduledMaintenanceInput(
            snapshot: ScheduledMaintenancePreviewData.snapshot(
                mode: .maintenance,
                message: "Upgrading TimescaleDB — read-only during the window.",
                untilOffset: 48 * 60 * 60
            ),
            connection: .stale
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        ScheduledMaintenanceCard(model: previewModel(ScheduledMaintenanceInput(
            snapshot: .ok,
            connection: .offline
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
