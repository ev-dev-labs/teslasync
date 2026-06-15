import Foundation
import Observation

/// The `@Observable` state holder the Backup & Restore page binds to (ADR-004 — no
/// networking in the view). Owns the two feeds (configurations + run history), the derived
/// stat tiles, and the create/edit + delete + restore-preview interaction state, reading +
/// writing through the injected `BackupRestoreDataSource`. Interaction commands live in
/// `BackupRestorePageModel.Actions.swift`. Mirrors the sibling `FeatureFlagsPageModel`.
@MainActor
@Observable
public final class BackupRestorePageModel {
    public private(set) var configsState: BackupConfigsState = .loading
    public private(set) var runsState: BackupRunsState = .loading

    // Create / edit sheet (web create/edit `Modal`) — `editingConfig == nil` is create mode.
    public var editorPresented = false
    public internal(set) var editingConfig: BackupConfig?
    public var form: BackupConfigForm = .empty
    public internal(set) var isSaving = false
    public internal(set) var saveError: String?

    // Delete confirmation (web `ConfirmDialog`).
    public var deleteTarget: BackupConfig?
    public internal(set) var isDeleting = false
    public internal(set) var deleteError: String?

    // Restore-preview sheet (web preview `Modal`).
    public var previewPresented = false
    public internal(set) var previewState: BackupPreviewState = .loading

    // In-flight command flags (web mutation `isPending`).
    public internal(set) var isQuickRunning = false
    public internal(set) var triggeringConfigID: Int64?
    public internal(set) var verifyingRunID: Int64?

    /// The most recent command result, shown as a dismissible banner (web toast).
    public var outcome: BackupOutcome?

    @ObservationIgnored let dataSource: any BackupRestoreDataSource

    public init(dataSource: any BackupRestoreDataSource = SampleBackupRestoreDataSource()) {
        self.dataSource = dataSource
    }

    // MARK: - Derived feeds

    /// The loaded configurations (empty unless the state is `.loaded`).
    public var configs: [BackupConfig] {
        if case let .loaded(rows) = configsState { return rows }
        return []
    }

    /// The loaded runs (empty unless the state is `.loaded`).
    public var runs: [BackupRun] {
        if case let .loaded(rows) = runsState { return rows }
        return []
    }

    // MARK: - Derived stats (web `stats` memo)

    /// Web stat tile 1 — `fmtInt(configs.length)`.
    public var totalConfigs: Int {
        configs.count
    }

    /// Web stat tile 2 — `stats.totalBackups = runs.length`.
    public var totalBackups: Int {
        runs.count
    }

    /// Web stat tile 3 — `stats.lastBackup = runs.find(status === 'completed')`.
    public var lastBackup: BackupRun? {
        runs.first { $0.isCompleted }
    }

    /// Web stat tile 4 — `stats.totalSize = sum(file_size)`.
    public var totalSize: Int64 {
        runs.reduce(0) { $0 + $1.fileSize }
    }

    /// Web `failedRuns = runs.filter(failed && error_message).slice(0, 5)`.
    public var failedRuns: [BackupRun] {
        Array(runs.filter(\.isFailedWithMessage).prefix(5))
    }

    // MARK: - Derived interaction

    /// Web `editing` flag (`editingConfig !== null`).
    public var isEditing: Bool {
        editingConfig != nil
    }

    /// Web Save guard (`!form.name.trim() || isPending`), inverted.
    public var canSave: Bool {
        form.isNameValid && !isSaving
    }

    /// The loaded preview, if the sheet finished loading.
    public var previewData: RestorePreview? {
        if case let .loaded(preview) = previewState { return preview }
        return nil
    }

    /// Whether either feed failed (web `anyError` → the top `error.loadFailed` banner).
    public var hasLoadError: Bool {
        if case .error = configsState { return true }
        if case .error = runsState { return true }
        return false
    }

    // MARK: - Loading (web `useQuery(['backup-configs'])` + `['backup-runs']`)

    /// Mounts both feeds (web renders the config table + run history side-by-side).
    public func load() async {
        await reloadConfigs()
        await reloadRuns()
    }

    /// Re-runs the configurations query (web `request('/backup/configs')`).
    public func reloadConfigs() async {
        configsState = .loading
        do {
            let rows = try await dataSource.loadConfigs()
            configsState = rows.isEmpty ? .empty : .loaded(rows)
        } catch {
            configsState = .error(error.localizedDescription)
        }
    }

    /// Re-runs the run-history query (web `request('/backup/runs')`).
    public func reloadRuns() async {
        runsState = .loading
        do {
            let rows = try await dataSource.loadRuns()
            runsState = rows.isEmpty ? .empty : .loaded(rows)
        } catch {
            runsState = .error(error.localizedDescription)
        }
    }
}
