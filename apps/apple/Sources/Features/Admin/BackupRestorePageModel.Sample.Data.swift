import Foundation

/// The fixed seed rows for `SampleBackupRestoreDataSource`, split out so the actor file
/// stays focused on behavior. Representative, non-production data exercising every render
/// branch: enabled + disabled configs across all four providers, and runs spanning
/// completed / failed-with-message (x2, for Recent Errors) / running / queued statuses.
extension SampleBackupRestoreDataSource {
    static let seedMetadata: [BackupMetaEntry] = [
        BackupMetaEntry(key: "version", value: "6.4.1"),
        BackupMetaEntry(key: "engine", value: "timescaledb-2.14"),
        BackupMetaEntry(key: "compression", value: "zstd"),
        BackupMetaEntry(key: "schema_revision", value: "000185")
    ]

    static let seedConfigs: [BackupConfig] = [
        BackupConfig(
            id: 1,
            name: "Daily Full — Local",
            enabled: true,
            backupType: .full,
            frequencyDays: 1,
            maxRetention: 7,
            provider: .local,
            providerConfig: ["path": "/var/backups/teslasync"],
            compress: true,
            encrypt: false,
            lastRunAt: "2026-06-15T03:00:42Z",
            nextRunAt: "2026-06-16T03:00:00Z",
            createdAt: "2026-01-04T12:00:00Z",
            updatedAt: "2026-06-15T03:00:42Z"
        ),
        BackupConfig(
            id: 2,
            name: "Weekly Incremental — S3 Offsite",
            enabled: true,
            backupType: .incremental,
            frequencyDays: 7,
            maxRetention: 4,
            provider: .s3,
            providerConfig: ["bucket": "ts-offsite", "region": "us-east-1", "prefix": "backups/"],
            compress: true,
            encrypt: true,
            lastRunAt: "2026-06-09T02:00:05Z",
            nextRunAt: "2026-06-16T02:00:00Z",
            createdAt: "2026-02-11T09:30:00Z",
            updatedAt: "2026-06-09T02:00:05Z"
        ),
        BackupConfig(
            id: 3,
            name: "Monthly Archive — GCS",
            enabled: false,
            backupType: .full,
            frequencyDays: 30,
            maxRetention: 12,
            provider: .gcs,
            providerConfig: ["bucket": "ts-archive", "prefix": "monthly/"],
            compress: true,
            encrypt: true,
            lastRunAt: nil,
            nextRunAt: nil,
            createdAt: "2026-03-01T00:00:00Z",
            updatedAt: "2026-05-20T18:45:00Z"
        )
    ]

    static let seedRuns: [BackupRun] = [
        BackupRun(
            id: 102,
            configID: 1,
            runType: "backup",
            status: BackupRunStatus.running.rawValue,
            provider: .local,
            durationMs: 0,
            startedAt: "2026-06-15T09:00:00Z",
            createdAt: "2026-06-15T09:00:00Z"
        ),
        BackupRun(
            id: 101,
            configID: 1,
            runType: "backup",
            status: BackupRunStatus.completed.rawValue,
            provider: .local,
            fileName: "teslasync-20260615-030000.sql.gz",
            fileSize: 734_003_200,
            recordCount: 1_250_400,
            tableCount: 48,
            checksum: "sha256:ab12cd",
            durationMs: 42100,
            metadata: seedMetadata,
            startedAt: "2026-06-15T03:00:00Z",
            completedAt: "2026-06-15T03:00:42Z",
            createdAt: "2026-06-15T03:00:00Z"
        ),
        BackupRun(
            id: 100,
            configID: nil,
            runType: "quick",
            status: BackupRunStatus.completed.rawValue,
            provider: .local,
            fileName: "quick-20260614-141200.sql.gz",
            fileSize: 524_288_000,
            recordCount: 982_140,
            tableCount: 48,
            checksum: "sha256:77ef01",
            durationMs: 30500,
            metadata: seedMetadata,
            startedAt: "2026-06-14T14:12:00Z",
            completedAt: "2026-06-14T14:12:30Z",
            createdAt: "2026-06-14T14:12:00Z"
        ),
        BackupRun(
            id: 99,
            configID: 2,
            runType: "backup",
            backupType: "incremental",
            status: BackupRunStatus.failed.rawValue,
            provider: .s3,
            fileSize: 0,
            durationMs: 5300,
            errorMessage: "S3 upload failed: AccessDenied — verify the bucket IAM policy.",
            createdAt: "2026-06-09T02:00:00Z"
        ),
        BackupRun(
            id: 98,
            configID: 2,
            runType: "backup",
            backupType: "incremental",
            status: BackupRunStatus.failed.rawValue,
            provider: .s3,
            fileSize: 0,
            durationMs: 8200,
            errorMessage: "Checksum mismatch on shard 3 — backup aborted before upload.",
            createdAt: "2026-06-02T02:00:00Z"
        ),
        BackupRun(
            id: 97,
            configID: 3,
            runType: "backup",
            status: BackupRunStatus.queued.rawValue,
            provider: .gcs,
            createdAt: "2026-06-01T00:00:00Z"
        )
    ]

    static let seedPreview = RestorePreview(
        tables: [
            RestorePreviewTable(name: "signal_log", rows: 1_184_220),
            RestorePreviewTable(name: "drives", rows: 8421),
            RestorePreviewTable(name: "charging_sessions", rows: 3120),
            RestorePreviewTable(name: "vehicles", rows: 6),
            RestorePreviewTable(name: "energy_daily_summary", rows: 540)
        ],
        metadata: seedMetadata,
        checksumVerified: true
    )
}
