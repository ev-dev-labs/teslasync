import Foundation

// MARK: - Editor form (web `ConfigFormData`)

/// The create/edit form payload (web `ConfigFormData` = `BackupConfig` minus id +
/// timestamps). Value-typed so the model can mutate fields without aliasing.
public struct BackupConfigForm: Hashable, Sendable {
    public var name: String
    public var enabled: Bool
    public var backupType: BackupType
    public var frequencyDays: Int
    public var maxRetention: Int
    public var provider: BackupProvider
    public var providerConfig: [String: String]
    public var compress: Bool
    public var encrypt: Bool

    public init(
        name: String,
        enabled: Bool,
        backupType: BackupType,
        frequencyDays: Int,
        maxRetention: Int,
        provider: BackupProvider,
        providerConfig: [String: String],
        compress: Bool,
        encrypt: Bool
    ) {
        self.name = name
        self.enabled = enabled
        self.backupType = backupType
        self.frequencyDays = frequencyDays
        self.maxRetention = maxRetention
        self.provider = provider
        self.providerConfig = providerConfig
        self.compress = compress
        self.encrypt = encrypt
    }

    /// Web `EMPTY_FORM` — the create-mode defaults.
    public static let empty = BackupConfigForm(
        name: "",
        enabled: true,
        backupType: .full,
        frequencyDays: 1,
        maxRetention: 7,
        provider: .local,
        providerConfig: ["path": "/backups"],
        compress: true,
        encrypt: false
    )

    /// Web `openEdit(cfg)` — seeds the form from an existing config.
    public init(from config: BackupConfig) {
        self.init(
            name: config.name,
            enabled: config.enabled,
            backupType: config.backupType,
            frequencyDays: config.frequencyDays,
            maxRetention: config.maxRetention,
            provider: config.provider,
            providerConfig: config.providerConfig,
            compress: config.compress,
            encrypt: config.encrypt
        )
    }

    /// Web Save guard (`disabled={!form.name.trim()}`), inverted.
    public var isNameValid: Bool {
        !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

// MARK: - Page states (web `configs` / `runs` query phases)

/// The configurations feed state (web `configs` query): `.empty` is a successful load
/// with zero rows, `.error` is retryable, `.loaded` carries one or more configs.
public enum BackupConfigsState: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case loaded([BackupConfig])
}

/// The run-history feed state (web `runs` query): same phases scoped to backup runs.
public enum BackupRunsState: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case loaded([BackupRun])
}

/// The restore-preview sheet's own load phase (web `previewData` null while loading). A
/// fetch failure dismisses the sheet and surfaces a `.previewFailed` banner instead of an
/// in-sheet error (web `handlePreview` only opens the modal on success).
public enum BackupPreviewState: Equatable, Sendable {
    case loading
    case loaded(RestorePreview)
}

// MARK: - Operation outcome (web toast results)

/// The result of a mutation/command, surfaced as a dismissible banner (the HIG-native
/// peer of the web `toast.success/.warning/.error`). The localization key matches the
/// web i18n key verbatim (`backup.<case>`).
public enum BackupOutcome: String, Sendable, Identifiable, Equatable {
    case configCreated
    case configCreateFailed
    case configUpdated
    case configUpdateFailed
    case configDeleted
    case configDeleteFailed
    case triggered
    case triggerFailed
    case quickStarted
    case quickFailed
    case checksumVerified
    case checksumMismatch
    case verifyFailed
    case previewFailed

    public var id: String {
        rawValue
    }

    /// `true` for failure / mismatch outcomes (danger tone), `false` for successes.
    public var isError: Bool {
        switch self {
        case .configCreated, .configUpdated, .configDeleted, .triggered, .quickStarted, .checksumVerified:
            false
        case .configCreateFailed, .configUpdateFailed, .configDeleteFailed, .triggerFailed,
             .quickFailed, .checksumMismatch, .verifyFailed, .previewFailed:
            true
        }
    }
}

// MARK: - Data source seam (web `request()` calls under `/backup/*`)

/// Supplies the two feeds and performs the writes/commands the page drives. The
/// production implementation binds the shared core's backup endpoints (`/backup/configs`,
/// `/backup/runs`, `/backup/quick`, `…/trigger`, `…/verify`, `…/preview`, `…/download`,
/// ADR-004 — the view holds no networking); previews + tests inject doubles to drive every
/// data state. Mirrors the sibling `FeatureFlagsDataSource` seam.
public protocol BackupRestoreDataSource: Sendable {
    /// Web `GET /backup/configs`.
    func loadConfigs() async throws -> [BackupConfig]
    /// Web `GET /backup/runs`.
    func loadRuns() async throws -> [BackupRun]
    /// Web `POST /backup/configs`.
    func createConfig(_ form: BackupConfigForm) async throws
    /// Web `PUT /backup/configs/{id}`.
    func updateConfig(id: Int64, form: BackupConfigForm) async throws
    /// Web `DELETE /backup/configs/{id}`.
    func deleteConfig(id: Int64) async throws
    /// Web `POST /backup/configs/{id}/trigger`.
    func triggerConfig(id: Int64) async throws
    /// Web `POST /backup/quick`.
    func quickBackup() async throws
    /// Web `POST /backup/runs/{id}/verify` — returns the checksum match result.
    func verifyRun(id: Int64) async throws -> Bool
    /// Web `GET /backup/runs/{id}/preview`.
    func loadPreview(runID: Int64) async throws -> RestorePreview
    /// Web `window.open(.../backup/runs/{id}/download)` — the resolved download URL.
    func downloadURL(runID: Int64) -> URL?
}
