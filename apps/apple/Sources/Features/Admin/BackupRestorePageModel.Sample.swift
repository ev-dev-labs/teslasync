import Foundation

/// A representative in-memory seed used as the page/preview default until the shared-core
/// backed source is injected at composition time. It is NOT production data — it exists so
/// the surface renders its populated state out of the box (mirroring the sibling
/// `SampleFeatureFlagsDataSource`) and so create / edit / delete / trigger / quick visibly
/// mutate the feeds in previews. An `actor` so its mutable state stays isolated + `Sendable`.
public actor SampleBackupRestoreDataSource: BackupRestoreDataSource {
    private var configs: [BackupConfig]
    private var runs: [BackupRun]
    private var nextConfigID: Int64 = 4
    private var nextRunID: Int64 = 103

    public init() {
        configs = Self.seedConfigs
        runs = Self.seedRuns
    }

    public func loadConfigs() async throws -> [BackupConfig] {
        configs.sorted { $0.id < $1.id }
    }

    public func loadRuns() async throws -> [BackupRun] {
        runs.sorted { $0.id > $1.id }
    }

    public func createConfig(_ form: BackupConfigForm) async throws {
        configs.append(makeConfig(id: nextConfigID, form: form))
        nextConfigID += 1
    }

    public func updateConfig(id: Int64, form: BackupConfigForm) async throws {
        guard let index = configs.firstIndex(where: { $0.id == id }) else { return }
        configs[index] = makeConfig(id: id, form: form, lastRunAt: configs[index].lastRunAt)
    }

    public func deleteConfig(id: Int64) async throws {
        configs.removeAll { $0.id == id }
    }

    public func triggerConfig(id: Int64) async throws {
        let provider = configs.first { $0.id == id }?.provider ?? .local
        runs.append(makeCompletedRun(configID: id, runType: "backup", provider: provider))
        nextRunID += 1
    }

    public func quickBackup() async throws {
        runs.append(makeCompletedRun(configID: nil, runType: "quick", provider: .local))
        nextRunID += 1
    }

    public func verifyRun(id _: Int64) async throws -> Bool {
        true
    }

    public func loadPreview(runID _: Int64) async throws -> RestorePreview {
        Self.seedPreview
    }

    public nonisolated func downloadURL(runID: Int64) -> URL? {
        URL(string: "https://teslasync.local/api/v1/backup/runs/\(runID)/download")
    }

    // MARK: - Builders

    private func makeConfig(
        id: Int64,
        form: BackupConfigForm,
        lastRunAt: String? = nil
    ) -> BackupConfig {
        let nowISO = ISO8601DateFormatter().string(from: Date())
        return BackupConfig(
            id: id,
            name: form.name,
            enabled: form.enabled,
            backupType: form.backupType,
            frequencyDays: form.frequencyDays,
            maxRetention: form.maxRetention,
            provider: form.provider,
            providerConfig: form.providerConfig,
            compress: form.compress,
            encrypt: form.encrypt,
            lastRunAt: lastRunAt,
            createdAt: nowISO,
            updatedAt: nowISO
        )
    }

    private func makeCompletedRun(configID: Int64?, runType: String, provider: BackupProvider) -> BackupRun {
        let nowISO = ISO8601DateFormatter().string(from: Date())
        return BackupRun(
            id: nextRunID,
            configID: configID,
            runType: runType,
            status: BackupRunStatus.completed.rawValue,
            provider: provider,
            fileName: "teslasync-\(nextRunID).sql.gz",
            fileSize: 612_368_384,
            recordCount: 1_184_220,
            tableCount: 48,
            checksum: "sha256:5f2e",
            durationMs: 38400,
            metadata: Self.seedMetadata,
            startedAt: nowISO,
            completedAt: nowISO,
            createdAt: nowISO
        )
    }
}
