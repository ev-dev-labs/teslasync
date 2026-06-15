import Foundation

/// The create/edit, delete, trigger, quick-backup, verify, and restore-preview commands
/// the Backup & Restore page drives (web `useMutation` handlers + `handlePreview`). Split
/// into an extension so the primary `@Observable` type body stays focused on state. Every
/// command refreshes the affected feed(s) on success and records a `BackupOutcome` banner,
/// mirroring the web toast feedback.
public extension BackupRestorePageModel {
    // MARK: - Editor (web `openCreate` / `openEdit` / `handleSave`)

    /// Web `openCreate` — opens the editor in create mode with the default form.
    func openCreate() {
        editingConfig = nil
        form = .empty
        saveError = nil
        editorPresented = true
    }

    /// Web `openEdit(cfg)` — opens the editor seeded from an existing config.
    func openEdit(_ config: BackupConfig) {
        editingConfig = config
        form = BackupConfigForm(from: config)
        saveError = nil
        editorPresented = true
    }

    /// Web `closeModal` (ignored while a save is in flight).
    func closeEditor() {
        guard !isSaving else { return }
        editorPresented = false
        editingConfig = nil
        form = .empty
    }

    /// Web provider `onChange` — switches provider and clears the credential bag.
    func selectProvider(_ provider: BackupProvider) {
        form.provider = provider
        form.providerConfig = [:]
    }

    /// The current value for a provider credential field (`'' ` when unset).
    func providerValue(_ key: String) -> String {
        form.providerConfig[key] ?? ""
    }

    /// Web `setProviderField` — writes one credential field.
    func setProviderField(_ key: String, _ value: String) {
        form.providerConfig[key] = value
    }

    /// Web `handleSave` — create or update, then close + refresh on success; on failure the
    /// editor stays open so the operator can retry without re-typing.
    func save() async {
        guard canSave else { return }
        let editing = editingConfig
        isSaving = true
        saveError = nil
        do {
            if let editing {
                try await dataSource.updateConfig(id: editing.id, form: form)
            } else {
                try await dataSource.createConfig(form)
            }
            isSaving = false
            editorPresented = false
            editingConfig = nil
            outcome = editing == nil ? .configCreated : .configUpdated
            await reloadConfigs()
            await reloadRuns()
        } catch {
            saveError = error.localizedDescription
            outcome = editing == nil ? .configCreateFailed : .configUpdateFailed
            isSaving = false
        }
    }

    // MARK: - Delete (web `deleteMutation`)

    /// Web `setDeleteTarget(row)` — opens the delete confirmation.
    func askDelete(_ config: BackupConfig) {
        deleteTarget = config
        deleteError = nil
    }

    /// Web `ConfirmDialog` cancel (ignored while a delete is in flight).
    func cancelDelete() {
        guard !isDeleting else { return }
        deleteTarget = nil
        deleteError = nil
    }

    /// Web `deleteMutation` — removes the config, then dismisses + refreshes on success.
    func confirmDelete() async {
        guard let target = deleteTarget, !isDeleting else { return }
        isDeleting = true
        deleteError = nil
        do {
            try await dataSource.deleteConfig(id: target.id)
            isDeleting = false
            deleteTarget = nil
            outcome = .configDeleted
            await reloadConfigs()
            await reloadRuns()
        } catch {
            deleteError = error.localizedDescription
            outcome = .configDeleteFailed
            isDeleting = false
        }
    }

    // MARK: - Commands (web `triggerMutation` / `quickBackupMutation` / `verifyMutation`)

    /// Web `triggerMutation` — runs a configured backup now, then refreshes the history.
    func trigger(_ config: BackupConfig) async {
        triggeringConfigID = config.id
        do {
            try await dataSource.triggerConfig(id: config.id)
            outcome = .triggered
            await reloadRuns()
        } catch {
            outcome = .triggerFailed
        }
        triggeringConfigID = nil
    }

    /// Web `quickBackupMutation` — kicks off an ad-hoc backup, then refreshes the history.
    func quickBackup() async {
        isQuickRunning = true
        do {
            try await dataSource.quickBackup()
            outcome = .quickStarted
            await reloadRuns()
        } catch {
            outcome = .quickFailed
        }
        isQuickRunning = false
    }

    /// Web `verifyMutation` — re-checks a run's stored checksum.
    func verify(_ run: BackupRun) async {
        verifyingRunID = run.id
        do {
            let verified = try await dataSource.verifyRun(id: run.id)
            outcome = verified ? .checksumVerified : .checksumMismatch
        } catch {
            outcome = .verifyFailed
        }
        verifyingRunID = nil
    }

    // MARK: - Restore preview + download (web `handlePreview` / `handleDownload`)

    /// Web `handlePreview` — presents the sheet, fetches the preview, and surfaces a failure
    /// banner (dismissing the sheet) if the fetch fails.
    func openPreview(_ run: BackupRun) async {
        previewState = .loading
        previewPresented = true
        do {
            let preview = try await dataSource.loadPreview(runID: run.id)
            previewState = .loaded(preview)
        } catch {
            previewPresented = false
            outcome = .previewFailed
        }
    }

    /// Dismisses the restore-preview sheet.
    func closePreview() {
        previewPresented = false
    }

    /// Web `handleDownload` — the resolved download URL the view opens.
    func downloadURL(for run: BackupRun) -> URL? {
        dataSource.downloadURL(runID: run.id)
    }

    /// Dismisses the current outcome banner.
    func dismissOutcome() {
        outcome = nil
    }
}
