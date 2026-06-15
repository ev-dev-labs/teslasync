import XCTest
@testable import TeslaSync

/// Pure tests for the Backup & Restore display formatters (ports of the web `formatBytes` /
/// `fmtInt` / `formatDurationMsCompact` / `formatRelative`), the provider/field catalog, the
/// value types, and the sample data source's seed + mutation round-trips.
final class BackupRestoreFormatTests: XCTestCase {
    private func date(_ iso: String) -> Date {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: iso) ?? Date(timeIntervalSince1970: 0)
    }

    // MARK: - Formatters

    func testBytes() {
        XCTAssertEqual(BackupRestoreFormat.bytes(512), "512 B")
        XCTAssertEqual(BackupRestoreFormat.bytes(1536), "1.5 KB")
        XCTAssertEqual(BackupRestoreFormat.bytes(5 * 1024 * 1024), "5.0 MB")
        XCTAssertEqual(BackupRestoreFormat.bytes(3 * 1024 * 1024 * 1024), "3.0 GB")
    }

    func testInt() {
        XCTAssertEqual(BackupRestoreFormat.int(0), "0")
        XCTAssertEqual(BackupRestoreFormat.int(1_250_400), "1,250,400")
    }

    func testDurationMs() {
        XCTAssertEqual(BackupRestoreFormat.durationMs(500), "500ms")
        XCTAssertEqual(BackupRestoreFormat.durationMs(1500), "1.5s")
        XCTAssertEqual(BackupRestoreFormat.durationMs(90000), "1.5m")
    }

    func testRelative() {
        let now = date("2026-06-15T10:00:00Z")
        XCTAssertEqual(BackupRestoreFormat.relative(nil, now: now), "—")
        XCTAssertEqual(BackupRestoreFormat.relative("2026-06-15T09:59:30Z", now: now), "just now")
        XCTAssertEqual(BackupRestoreFormat.relative("2026-06-15T09:30:00Z", now: now), "30m ago")
        XCTAssertEqual(BackupRestoreFormat.relative("2026-06-15T07:00:00Z", now: now), "3h ago")
        XCTAssertEqual(BackupRestoreFormat.relative("2026-06-13T10:00:00Z", now: now), "2d ago")
        XCTAssertEqual(BackupRestoreFormat.relative("2026-06-01T10:00:00Z", now: now), "Jun 1, 2026")
    }

    func testDateTime() {
        XCTAssertEqual(BackupRestoreFormat.dateTime(nil), "—")
        XCTAssertEqual(BackupRestoreFormat.dateTime("not-a-date"), "—")
        XCTAssertNotEqual(BackupRestoreFormat.dateTime("2026-06-15T03:00:42Z"), "—")
    }

    // MARK: - Provider catalog

    func testProviderCatalog() {
        XCTAssertEqual(BackupProvider.local.fields.count, 1)
        XCTAssertEqual(BackupProvider.s3.fields.count, 6)
        XCTAssertEqual(BackupProvider.azure.fields.count, 4)
        XCTAssertEqual(BackupProvider.gcs.fields.count, 3)
        XCTAssertEqual(BackupProvider.s3.displayName, "Amazon S3")
        XCTAssertEqual(BackupProvider("nonsense"), .local)
        XCTAssertEqual(BackupProvider.local.symbolName, "folder")
    }

    func testProviderFieldDisplayLabel() {
        let required = BackupProviderField(key: "bucket", label: "Bucket", required: true)
        let optional = BackupProviderField(key: "prefix", label: "Prefix")
        XCTAssertEqual(required.displayLabel, "Bucket *")
        XCTAssertEqual(optional.displayLabel, "Prefix")
    }

    // MARK: - Value types

    func testFormDefaultsAndSeeding() {
        XCTAssertEqual(BackupConfigForm.empty.frequencyDays, 1)
        XCTAssertEqual(BackupConfigForm.empty.maxRetention, 7)
        XCTAssertTrue(BackupConfigForm.empty.compress)
        XCTAssertFalse(BackupConfigForm.empty.isNameValid)

        let config = BackupConfig(
            id: 5, name: "Nightly", enabled: false, backupType: .incremental,
            frequencyDays: 3, maxRetention: 14, provider: .s3,
            providerConfig: ["bucket": "b"], compress: false, encrypt: true
        )
        let form = BackupConfigForm(from: config)
        XCTAssertEqual(form.name, "Nightly")
        XCTAssertEqual(form.backupType, .incremental)
        XCTAssertEqual(form.provider, .s3)
        XCTAssertEqual(form.providerConfig["bucket"], "b")
        XCTAssertTrue(form.encrypt)
        XCTAssertTrue(form.isNameValid)
    }

    func testRunStatusFallback() {
        XCTAssertEqual(BackupRunStatus("completed"), .completed)
        XCTAssertEqual(BackupRunStatus("mystery"), .queued)
    }

    func testRunClassifiers() {
        let done = BackupRun(id: 1, runType: "backup", status: "completed", provider: .local, createdAt: "x")
        let failed = BackupRun(
            id: 2,
            runType: "backup",
            status: "failed",
            provider: .local,
            errorMessage: "boom",
            createdAt: "x"
        )
        let failedNoMsg = BackupRun(id: 3, runType: "backup", status: "failed", provider: .local, createdAt: "x")
        XCTAssertTrue(done.isCompleted)
        XCTAssertTrue(failed.isFailedWithMessage)
        XCTAssertFalse(failedNoMsg.isFailedWithMessage)
    }

    func testOutcomeErrorClassification() {
        XCTAssertFalse(BackupOutcome.configCreated.isError)
        XCTAssertFalse(BackupOutcome.checksumVerified.isError)
        XCTAssertTrue(BackupOutcome.configCreateFailed.isError)
        XCTAssertTrue(BackupOutcome.checksumMismatch.isError)
    }

    // MARK: - Sample data source

    func testSampleSeedsAndMutates() async throws {
        let source = SampleBackupRestoreDataSource()
        let configs = try await source.loadConfigs()
        let runs = try await source.loadRuns()
        XCTAssertEqual(configs.count, 3)
        XCTAssertFalse(runs.isEmpty)
        XCTAssertTrue(runs.contains { $0.isFailedWithMessage })

        try await source.createConfig(.empty)
        let afterCreate = try await source.loadConfigs()
        XCTAssertEqual(afterCreate.count, 4)

        try await source.deleteConfig(id: 1)
        let afterDelete = try await source.loadConfigs()
        XCTAssertFalse(afterDelete.contains { $0.id == 1 })

        let runsBefore = try await source.loadRuns().count
        try await source.triggerConfig(id: 2)
        try await source.quickBackup()
        let runsAfter = try await source.loadRuns().count
        XCTAssertEqual(runsAfter, runsBefore + 2)

        let verified = try await source.verifyRun(id: 101)
        XCTAssertTrue(verified)
        let preview = try await source.loadPreview(runID: 101)
        XCTAssertFalse(preview.tables.isEmpty)
        XCTAssertNotNil(source.downloadURL(runID: 101))
    }
}
