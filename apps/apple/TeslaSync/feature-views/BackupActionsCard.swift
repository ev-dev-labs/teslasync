//
//  BackupActionsCard.swift
//  TeslaSync — P4 feature view · 0241 · BackupActionsCard (Apple)
//
//  The composed BackupActionsCard surface — the SwiftUI parity of
//  features/system/components/status/BackupActionsCard.tsx. It wraps the backup-status
//  rows (web `children`), adds the "Run quick backup now" mutation button and the
//  "Manage backups & restore" link, and surfaces the run outcome through a transient
//  toast (web `useToast`). It binds through `BackupActionsCardModel` (P1/S8); no
//  networking lives in the view. On appear it emits the P1/S11 `view.opened`
//  diagnostics event for the surface slug `BackupActionsCard`.
//
//  Every state renders (no hidden surface): the wrapped section's loading / rows /
//  empty / error, and the action's idle / running ("Starting…") / succeeded /
//  admin-permission / offline / generic-failure feedback. The run is re-entrancy
//  guarded so a double-tap can't fire two backups, and a successful run invalidates
//  the backup views (web `qc.invalidateQueries`).
//

import SwiftUI

public struct BackupActionsCard: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        BackupActionsCardSurface.slug
    }

    private let content: BackupStatusContent
    private let onManageBackups: () -> Void
    private let onReloadStatus: (() -> Void)?

    @State private var model: BackupActionsCardModel

    /// Binds an explicitly constructed model (production wires it over the shared P1/S8
    /// holder; previews/tests inject in-memory sources).
    public init(
        content: BackupStatusContent,
        model: BackupActionsCardModel,
        onManageBackups: @escaping () -> Void,
        onReloadStatus: (() -> Void)? = nil
    ) {
        self.content = content
        self.onManageBackups = onManageBackups
        self.onReloadStatus = onReloadStatus
        _model = State(initialValue: model)
    }

    /// Convenience: builds the model from the quick-backup seam (web `useMutation` +
    /// `useQueryClient`).
    public init(
        content: BackupStatusContent,
        source: any QuickBackupRunning,
        telemetry: any BackupActionsCardTelemetry = OSLogBackupActionsCardTelemetry(),
        onManageBackups: @escaping () -> Void,
        onReloadStatus: (() -> Void)? = nil
    ) {
        self.init(
            content: content,
            model: BackupActionsCardModel(source: source, telemetry: telemetry),
            onManageBackups: onManageBackups,
            onReloadStatus: onReloadStatus
        )
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            BackupStatusSection(content: content, onReload: onReloadStatus)

            Divider()
                .overlay(Color.TS.border)

            BackupActionsBar(model: model, onManageBackups: onManageBackups)

            if let toast = model.toast {
                BackupToastView(toast: toast) { model.dismissToast() }
                    .animation(.easeInOut(duration: TSMotion.normalDuration), value: toast.id)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .task(id: model.toast?.id) { await autoDismissToast() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: BackupActionsCardStrings.string(
            "backup.actions.surfaceA11y",
            "Backup actions"
        )))
    }

    /// Clears the toast after a short delay (web `useToast` auto-dismiss). Re-armed on
    /// each new toast via `.task(id:)`; cancellation (a newer toast) skips the clear.
    private func autoDismissToast() async {
        guard model.toast != nil else { return }
        try? await Task.sleep(for: .seconds(4))
        if !Task.isCancelled {
            model.dismissToast()
        }
    }
}
