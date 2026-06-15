//
//  BackupMonitorWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0009 · BackupMonitorWidget (Apple)
//
//  Xcode previews for each surface state (content / wide / compact / loading /
//  empty / error / stale / offline). DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: BackupMonitorUpdate) -> BackupMonitorModel {
        let source = InMemoryBackupMonitorSource(initial: update)
        let model = BackupMonitorModel(source: source)
        model.start()
        return model
    }

    private func minutesAgo(_ minutes: Int) -> Date {
        Date().addingTimeInterval(TimeInterval(-minutes * 60))
    }

    private func daysAgo(_ days: Int) -> Date {
        Date().addingTimeInterval(TimeInterval(-days * 86400))
    }

    private let sampleRuns: [BackupMonitorRun] = [
        BackupMonitorRun(
            id: "1", status: .completed, backupType: "full", fileSize: 1_288_490_188,
            durationMs: 4200, createdAt: minutesAgo(45), completedAt: minutesAgo(42)
        ),
        BackupMonitorRun(
            id: "2", status: .completed, backupType: "incremental", fileSize: 471_859_200,
            durationMs: 1100, createdAt: minutesAgo(200), completedAt: minutesAgo(199)
        ),
        BackupMonitorRun(
            id: "3", status: .failed, backupType: "full", fileSize: 0,
            durationMs: 380, createdAt: daysAgo(1), completedAt: daysAgo(1)
        ),
        BackupMonitorRun(
            id: "4", status: .running, backupType: "full", fileSize: 838_860_800,
            durationMs: nil, createdAt: daysAgo(2), completedAt: nil
        ),
        BackupMonitorRun(
            id: "5", status: .completed, backupType: "incremental", fileSize: 9_437_184,
            durationMs: 240, createdAt: daysAgo(3), completedAt: daysAgo(3)
        )
    ]

    #Preview("Content (2×2)") {
        BackupMonitorWidget(
            model: previewModel(
                BackupMonitorUpdate(status: .loaded, connection: .live, runs: sampleRuns, updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2),
            onOpen: {}
        )
        .frame(width: 320, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Wide (4×3)") {
        BackupMonitorWidget(
            model: previewModel(
                BackupMonitorUpdate(status: .loaded, connection: .live, runs: sampleRuns, updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 4, rows: 3),
            onOpen: {}
        )
        .frame(width: 520, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact (1×2)") {
        BackupMonitorWidget(
            model: previewModel(BackupMonitorUpdate(status: .loaded, connection: .live, runs: sampleRuns)),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 170, height: 150)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        BackupMonitorWidget(model: previewModel(BackupMonitorUpdate(status: .loading)))
            .frame(width: 320, height: 240)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        BackupMonitorWidget(model: previewModel(BackupMonitorUpdate(status: .loaded, runs: [])))
            .frame(width: 320, height: 240)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        BackupMonitorWidget(model: previewModel(BackupMonitorUpdate(status: .failed("Network unavailable"))))
            .frame(width: 320, height: 240)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        BackupMonitorWidget(
            model: previewModel(
                BackupMonitorUpdate(
                    status: .loaded, connection: .stale, runs: sampleRuns, updatedAt: minutesAgo(5)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 320, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        BackupMonitorWidget(
            model: previewModel(
                BackupMonitorUpdate(
                    status: .loaded, connection: .offline, runs: sampleRuns, updatedAt: minutesAgo(30)
                )
            ),
            size: DashboardWidgetSize(cols: 4, rows: 3)
        )
        .frame(width: 520, height: 380)
        .padding()
        .background(Color.TS.bg)
    }
#endif
