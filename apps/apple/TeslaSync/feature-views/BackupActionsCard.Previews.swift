//
//  BackupActionsCard.Previews.swift
//  TeslaSync — P4 feature view · 0241 · BackupActionsCard (Apple)
//
//  Xcode previews for each surface state (ready / section-loading / section-empty /
//  section-error + idle / running / succeeded / admin-permission / offline /
//  generic-failure). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope. No networking — the model is driven by the in-memory
//  source + the DEBUG preview seams.
//

#if DEBUG
    import Foundation
    import SwiftUI

    private let previewRows: [BackupStatusRow] = [
        BackupStatusRow(id: "schedules", label: "Configured schedules", value: "2"),
        BackupStatusRow(id: "runs", label: "Total runs", value: "47"),
        BackupStatusRow(id: "last", label: "Last successful", value: "Jun 7, 2026 at 3:14 PM"),
        BackupStatusRow(id: "size", label: "Last successful size", value: "184.2 MB"),
        BackupStatusRow(id: "failures", label: "Failures (recent)", value: "1")
    ]

    @MainActor
    private func previewModel(
        source: any QuickBackupRunning = InMemoryQuickBackupSource(),
        outcome: QuickBackupOutcome? = nil,
        running: Bool = false
    ) -> BackupActionsCardModel {
        let model = BackupActionsCardModel(source: source)
        model.start()
        if running {
            model.previewSetRunning()
        }
        if let outcome {
            model.previewApply(outcome)
        }
        return model
    }

    private func framed(_ view: some View) -> some View {
        view
            .frame(width: 360, alignment: .leading)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Ready (idle)") {
        framed(BackupActionsCard(
            content: .ready(previewRows),
            model: previewModel(),
            onManageBackups: {}
        ))
    }

    #Preview("Section loading") {
        framed(BackupActionsCard(
            content: .loading,
            model: previewModel(),
            onManageBackups: {}
        ))
    }

    #Preview("Section empty") {
        framed(BackupActionsCard(
            content: .ready([]),
            model: previewModel(),
            onManageBackups: {}
        ))
    }

    #Preview("Section error") {
        framed(BackupActionsCard(
            content: .failed(message: "502 Bad Gateway"),
            model: previewModel(),
            onManageBackups: {},
            onReloadStatus: {}
        ))
    }

    #Preview("Running") {
        framed(BackupActionsCard(
            content: .ready(previewRows),
            model: previewModel(running: true),
            onManageBackups: {}
        ))
    }

    #Preview("Succeeded") {
        framed(BackupActionsCard(
            content: .ready(previewRows),
            model: previewModel(outcome: .succeeded),
            onManageBackups: {}
        ))
    }

    #Preview("Admin permission") {
        framed(BackupActionsCard(
            content: .ready(previewRows),
            model: previewModel(outcome: .permissionDenied),
            onManageBackups: {}
        ))
    }

    #Preview("Offline") {
        framed(BackupActionsCard(
            content: .ready(previewRows),
            model: previewModel(outcome: .offline),
            onManageBackups: {}
        ))
    }

    #Preview("Failed (generic)") {
        framed(BackupActionsCard(
            content: .ready(previewRows),
            model: previewModel(outcome: .failed(message: "disk full")),
            onManageBackups: {}
        ))
    }
#endif
