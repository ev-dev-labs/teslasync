import Foundation

// MARK: - Wire value types (web `BackupConfig` / `BackupRun` / `RestorePreview`)

/// A scheduled backup destination (web `BackupConfig`, `internal/api/backup_handler.go`).
/// `providerConfig` is the free-form per-provider credential bag the editor writes; the
/// timestamps are formatted at the display boundary. Backup metadata carries no SI units.
public struct BackupConfig: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let name: String
    public let enabled: Bool
    public let backupType: BackupType
    public let frequencyDays: Int
    public let maxRetention: Int
    public let provider: BackupProvider
    public let providerConfig: [String: String]
    public let includeTables: [String]
    public let compress: Bool
    public let encrypt: Bool
    public let lastRunAt: String?
    public let nextRunAt: String?
    public let createdAt: String
    public let updatedAt: String

    public init(
        id: Int64,
        name: String,
        enabled: Bool,
        backupType: BackupType,
        frequencyDays: Int,
        maxRetention: Int,
        provider: BackupProvider,
        providerConfig: [String: String] = [:],
        includeTables: [String] = [],
        compress: Bool = true,
        encrypt: Bool = false,
        lastRunAt: String? = nil,
        nextRunAt: String? = nil,
        createdAt: String = "",
        updatedAt: String = ""
    ) {
        self.id = id
        self.name = name
        self.enabled = enabled
        self.backupType = backupType
        self.frequencyDays = frequencyDays
        self.maxRetention = maxRetention
        self.provider = provider
        self.providerConfig = providerConfig
        self.includeTables = includeTables
        self.compress = compress
        self.encrypt = encrypt
        self.lastRunAt = lastRunAt
        self.nextRunAt = nextRunAt
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

/// The two backup strategies (web `BACKUP_TYPE_OPTIONS`). `full` is a complete snapshot;
/// `incremental` only the deltas since the previous run.
public enum BackupType: String, CaseIterable, Hashable, Sendable, Identifiable {
    case full
    case incremental

    public var id: String {
        rawValue
    }
}

/// One executed backup/restore/quick run (web `BackupRun`). `status` is kept as the raw
/// wire string (rendered verbatim in the badge, web `t('backup.status.{status}', status)`
/// fallback); `BackupRunStatus` classifies the known values for tone + action gating.
public struct BackupRun: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let configID: Int64?
    public let runType: String
    public let backupType: String
    public let status: String
    public let provider: BackupProvider
    public let fileName: String?
    public let filePath: String?
    public let fileSize: Int64
    public let recordCount: Int
    public let tableCount: Int
    public let checksum: String?
    public let durationMs: Int
    public let errorMessage: String?
    public let metadata: [BackupMetaEntry]
    public let startedAt: String?
    public let completedAt: String?
    public let createdAt: String

    public init(
        id: Int64,
        configID: Int64? = nil,
        runType: String,
        backupType: String = "full",
        status: String,
        provider: BackupProvider,
        fileName: String? = nil,
        filePath: String? = nil,
        fileSize: Int64 = 0,
        recordCount: Int = 0,
        tableCount: Int = 0,
        checksum: String? = nil,
        durationMs: Int = 0,
        errorMessage: String? = nil,
        metadata: [BackupMetaEntry] = [],
        startedAt: String? = nil,
        completedAt: String? = nil,
        createdAt: String
    ) {
        self.id = id
        self.configID = configID
        self.runType = runType
        self.backupType = backupType
        self.status = status
        self.provider = provider
        self.fileName = fileName
        self.filePath = filePath
        self.fileSize = fileSize
        self.recordCount = recordCount
        self.tableCount = tableCount
        self.checksum = checksum
        self.durationMs = durationMs
        self.errorMessage = errorMessage
        self.metadata = metadata
        self.startedAt = startedAt
        self.completedAt = completedAt
        self.createdAt = createdAt
    }

    /// Web `r.status === 'completed'` — only completed runs expose download/verify/preview.
    public var isCompleted: Bool {
        status == BackupRunStatus.completed.rawValue
    }

    /// Web `r.status === 'failed' && r.error_message` — feeds the Recent Errors list.
    public var isFailedWithMessage: Bool {
        status == BackupRunStatus.failed.rawValue && !(errorMessage ?? "").isEmpty
    }
}

/// The known run statuses (web `STATUS_CONFIG`). Unknown wire values fall back to
/// `.queued` styling while still rendering their raw label verbatim.
public enum BackupRunStatus: String, Hashable, Sendable {
    case completed
    case failed
    case running
    case queued

    public init(_ raw: String) {
        self = BackupRunStatus(rawValue: raw) ?? .queued
    }
}

/// One ordered key/value pair of backup metadata (web `Object.entries(metadata)`),
/// rendered as monospaced rows in the restore-preview sheet.
public struct BackupMetaEntry: Identifiable, Hashable, Sendable {
    public let key: String
    public let value: String

    public init(key: String, value: String) {
        self.key = key
        self.value = value
    }

    public var id: String {
        key
    }
}

/// One table row of a restore preview (web `{ name, rows }`).
public struct RestorePreviewTable: Identifiable, Hashable, Sendable {
    public let name: String
    public let rows: Int

    public init(name: String, rows: Int) {
        self.name = name
        self.rows = rows
    }

    public var id: String {
        name
    }
}

/// The dry-run inspection of a completed backup (web `RestorePreview`): the tables it
/// would restore, its metadata, and whether the stored checksum still verifies.
public struct RestorePreview: Hashable, Sendable {
    public let tables: [RestorePreviewTable]
    public let metadata: [BackupMetaEntry]
    public let checksumVerified: Bool

    public init(tables: [RestorePreviewTable], metadata: [BackupMetaEntry], checksumVerified: Bool) {
        self.tables = tables
        self.metadata = metadata
        self.checksumVerified = checksumVerified
    }
}
