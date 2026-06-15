import XCTest
@testable import TeslaSync

/// State-machine tests for `BackupRestorePageModel` — every data state both feeds render
/// (loading / empty / error / success), the derived stat tiles, and the create/edit /
/// delete / trigger / quick / verify / preview interaction state (success + failure paths).
/// Mirrors the sibling `FeatureFlagsPageModelTests`.
@MainActor
final class BackupRestorePageModelTests: XCTestCase {
    private actor StubBackupSource: BackupRestoreDataSource {
        var configs: [BackupConfig]
        var runs: [BackupRun]
        let configsFails: Bool
        let runsFails: Bool
        let failWrites: Bool
        let verifyFails: Bool
        let previewFails: Bool
        let verifyResult: Bool
        private(set) var createCount = 0
        private(set) var updateCount = 0
        private(set) var deleteCount = 0
        private(set) var triggerCount = 0
        private(set) var quickCount = 0

        init(
            configs: [BackupConfig] = [],
            runs: [BackupRun] = [],
            configsFails: Bool = false,
            runsFails: Bool = false,
            failWrites: Bool = false,
            verifyFails: Bool = false,
            previewFails: Bool = false,
            verifyResult: Bool = true
        ) {
            self.configs = configs
            self.runs = runs
            self.configsFails = configsFails
            self.runsFails = runsFails
            self.failWrites = failWrites
            self.verifyFails = verifyFails
            self.previewFails = previewFails
            self.verifyResult = verifyResult
        }

        func loadConfigs() async throws -> [BackupConfig] {
            if configsFails { throw StubError() }
            return configs
        }

        func loadRuns() async throws -> [BackupRun] {
            if runsFails { throw StubError() }
            return runs
        }

        func createConfig(_ form: BackupConfigForm) async throws {
            if failWrites { throw StubError() }
            createCount += 1
            configs.append(BackupConfig(
                id: Int64(900 + createCount),
                name: form.name,
                enabled: form.enabled,
                backupType: form.backupType,
                frequencyDays: form.frequencyDays,
                maxRetention: form.maxRetention,
                provider: form.provider
            ))
        }

        func updateConfig(id _: Int64, form _: BackupConfigForm) async throws {
            if failWrites { throw StubError() }
            updateCount += 1
        }

        func deleteConfig(id: Int64) async throws {
            if failWrites { throw StubError() }
            deleteCount += 1
            configs.removeAll { $0.id == id }
        }

        func triggerConfig(id _: Int64) async throws {
            if failWrites { throw StubError() }
            triggerCount += 1
        }

        func quickBackup() async throws {
            if failWrites { throw StubError() }
            quickCount += 1
        }

        func verifyRun(id _: Int64) async throws -> Bool {
            if verifyFails { throw StubError() }
            return verifyResult
        }

        func loadPreview(runID _: Int64) async throws -> RestorePreview {
            if previewFails { throw StubError() }
            return RestorePreview(
                tables: [RestorePreviewTable(name: "drives", rows: 10)],
                metadata: [BackupMetaEntry(key: "version", value: "6.4")],
                checksumVerified: true
            )
        }

        nonisolated func downloadURL(runID: Int64) -> URL? {
            URL(string: "https://example.test/backup/runs/\(runID)/download")
        }
    }

    private struct StubError: Error {}

    private func config(_ id: Int64, name: String = "cfg", enabled: Bool = true) -> BackupConfig {
        BackupConfig(
            id: id,
            name: name,
            enabled: enabled,
            backupType: .full,
            frequencyDays: 1,
            maxRetention: 7,
            provider: .local
        )
    }

    private func run(_ id: Int64, status: String, size: Int64 = 0, error: String? = nil) -> BackupRun {
        BackupRun(
            id: id,
            runType: "backup",
            status: status,
            provider: .local,
            fileSize: size,
            errorMessage: error,
            createdAt: "2026-06-15T03:00:00Z"
        )
    }

    // MARK: - Feed states

    func testInitialStateIsLoading() {
        let model = BackupRestorePageModel(dataSource: StubBackupSource())
        XCTAssertEqual(model.configsState, .loading)
        XCTAssertEqual(model.runsState, .loading)
        XCTAssertTrue(model.configs.isEmpty)
        XCTAssertTrue(model.runs.isEmpty)
    }

    func testLoadSuccessPopulatesBothFeeds() async {
        let model = BackupRestorePageModel(dataSource: StubBackupSource(
            configs: [config(1), config(2)],
            runs: [run(10, status: "completed")]
        ))
        await model.load()
        XCTAssertEqual(model.configs.count, 2)
        XCTAssertEqual(model.runs.count, 1)
        if case .loaded = model.configsState {} else { XCTFail("expected loaded configs") }
        if case .loaded = model.runsState {} else { XCTFail("expected loaded runs") }
    }

    func testLoadEmptyYieldsEmptyStates() async {
        let model = BackupRestorePageModel(dataSource: StubBackupSource())
        await model.load()
        XCTAssertEqual(model.configsState, .empty)
        XCTAssertEqual(model.runsState, .empty)
        XCTAssertFalse(model.hasLoadError)
    }

    func testLoadFailureYieldsErrorStates() async {
        let model = BackupRestorePageModel(dataSource: StubBackupSource(configsFails: true, runsFails: true))
        await model.load()
        guard case .error = model.configsState else { return XCTFail("expected error configs") }
        guard case .error = model.runsState else { return XCTFail("expected error runs") }
        XCTAssertTrue(model.hasLoadError)
    }

    func testReloadConfigsIsIndependentOfRuns() async {
        let model = BackupRestorePageModel(dataSource: StubBackupSource(configs: [config(1)], runsFails: true))
        await model.load()
        XCTAssertEqual(model.configs.count, 1)
        guard case .error = model.runsState else { return XCTFail("expected runs error") }
    }

    // MARK: - Derived stats

    func testDerivedStats() async {
        let runs = [
            run(5, status: "running"),
            run(4, status: "completed", size: 1000),
            run(3, status: "completed", size: 2000),
            run(2, status: "failed", error: "boom"),
            run(1, status: "failed", error: "bang")
        ]
        let model = BackupRestorePageModel(dataSource: StubBackupSource(configs: [config(1), config(2)], runs: runs))
        await model.load()
        XCTAssertEqual(model.totalConfigs, 2)
        XCTAssertEqual(model.totalBackups, 5)
        XCTAssertEqual(model.totalSize, 3000)
        XCTAssertEqual(model.lastBackup?.id, 4)
        XCTAssertEqual(model.failedRuns.count, 2)
    }
}

/// Editor / delete / command / preview interaction tests, in an extension so the primary
/// `XCTestCase` body stays within the lint budget (mirrors the sibling test split).
extension BackupRestorePageModelTests {
    // MARK: - Editor

    func testOpenCreateSeedsEmptyForm() {
        let model = BackupRestorePageModel(dataSource: StubBackupSource())
        model.openCreate()
        XCTAssertTrue(model.editorPresented)
        XCTAssertFalse(model.isEditing)
        XCTAssertEqual(model.form.name, "")
        XCTAssertEqual(model.form.provider, .local)
    }

    func testOpenEditSeedsFromConfig() {
        let model = BackupRestorePageModel(dataSource: StubBackupSource())
        model.openEdit(config(7, name: "Nightly", enabled: false))
        XCTAssertTrue(model.editorPresented)
        XCTAssertTrue(model.isEditing)
        XCTAssertEqual(model.form.name, "Nightly")
        XCTAssertFalse(model.form.enabled)
    }

    func testSelectProviderClearsCredentials() {
        let model = BackupRestorePageModel(dataSource: StubBackupSource())
        model.openCreate()
        model.setProviderField("path", "/data")
        model.selectProvider(.s3)
        XCTAssertEqual(model.form.provider, .s3)
        XCTAssertTrue(model.form.providerConfig.isEmpty)
        model.setProviderField("bucket", "b1")
        XCTAssertEqual(model.providerValue("bucket"), "b1")
    }

    func testCanSaveRequiresName() {
        let model = BackupRestorePageModel(dataSource: StubBackupSource())
        model.openCreate()
        XCTAssertFalse(model.canSave)
        model.form.name = "  "
        XCTAssertFalse(model.canSave)
        model.form.name = "Daily"
        XCTAssertTrue(model.canSave)
    }

    func testSaveCreateSuccess() async {
        let source = StubBackupSource()
        let model = BackupRestorePageModel(dataSource: source)
        model.openCreate()
        model.form.name = "Daily"
        await model.save()
        XCTAssertFalse(model.editorPresented)
        XCTAssertEqual(model.outcome, .configCreated)
        let count = await source.createCount
        XCTAssertEqual(count, 1)
    }

    func testSaveUpdateSuccess() async {
        let source = StubBackupSource(configs: [config(3, name: "X")])
        let model = BackupRestorePageModel(dataSource: source)
        await model.load()
        model.openEdit(config(3, name: "X"))
        model.form.name = "Renamed"
        await model.save()
        XCTAssertFalse(model.editorPresented)
        XCTAssertEqual(model.outcome, .configUpdated)
        let count = await source.updateCount
        XCTAssertEqual(count, 1)
    }

    func testSaveFailureKeepsEditorOpen() async {
        let model = BackupRestorePageModel(dataSource: StubBackupSource(failWrites: true))
        model.openCreate()
        model.form.name = "Daily"
        await model.save()
        XCTAssertTrue(model.editorPresented)
        XCTAssertNotNil(model.saveError)
        XCTAssertEqual(model.outcome, .configCreateFailed)
        XCTAssertFalse(model.isSaving)
    }

    // MARK: - Delete

    func testConfirmDeleteSuccessClearsTarget() async {
        let source = StubBackupSource(configs: [config(8)])
        let model = BackupRestorePageModel(dataSource: source)
        await model.load()
        model.askDelete(config(8))
        await model.confirmDelete()
        XCTAssertNil(model.deleteTarget)
        XCTAssertEqual(model.outcome, .configDeleted)
        let count = await source.deleteCount
        XCTAssertEqual(count, 1)
    }

    func testConfirmDeleteFailureKeepsTarget() async {
        let model = BackupRestorePageModel(dataSource: StubBackupSource(failWrites: true))
        model.askDelete(config(8))
        await model.confirmDelete()
        XCTAssertNotNil(model.deleteTarget)
        XCTAssertEqual(model.outcome, .configDeleteFailed)
        XCTAssertFalse(model.isDeleting)
    }

    func testCancelDeleteClearsState() {
        let model = BackupRestorePageModel(dataSource: StubBackupSource())
        model.askDelete(config(8))
        model.cancelDelete()
        XCTAssertNil(model.deleteTarget)
    }

    // MARK: - Commands

    func testTriggerSuccessAndFailure() async {
        let okSource = StubBackupSource(configs: [config(1)])
        let okModel = BackupRestorePageModel(dataSource: okSource)
        await okModel.trigger(config(1))
        XCTAssertEqual(okModel.outcome, .triggered)
        XCTAssertNil(okModel.triggeringConfigID)
        let count = await okSource.triggerCount
        XCTAssertEqual(count, 1)

        let failModel = BackupRestorePageModel(dataSource: StubBackupSource(failWrites: true))
        await failModel.trigger(config(1))
        XCTAssertEqual(failModel.outcome, .triggerFailed)
    }

    func testQuickBackupSuccessAndFailure() async {
        let okModel = BackupRestorePageModel(dataSource: StubBackupSource())
        await okModel.quickBackup()
        XCTAssertEqual(okModel.outcome, .quickStarted)
        XCTAssertFalse(okModel.isQuickRunning)

        let failModel = BackupRestorePageModel(dataSource: StubBackupSource(failWrites: true))
        await failModel.quickBackup()
        XCTAssertEqual(failModel.outcome, .quickFailed)
    }

    func testVerifyOutcomes() async {
        let verified = BackupRestorePageModel(dataSource: StubBackupSource(verifyResult: true))
        await verified.verify(run(1, status: "completed"))
        XCTAssertEqual(verified.outcome, .checksumVerified)

        let mismatch = BackupRestorePageModel(dataSource: StubBackupSource(verifyResult: false))
        await mismatch.verify(run(1, status: "completed"))
        XCTAssertEqual(mismatch.outcome, .checksumMismatch)

        let failed = BackupRestorePageModel(dataSource: StubBackupSource(verifyFails: true))
        await failed.verify(run(1, status: "completed"))
        XCTAssertEqual(failed.outcome, .verifyFailed)
        XCTAssertNil(failed.verifyingRunID)
    }

    // MARK: - Preview + download

    func testOpenPreviewSuccessPresentsSheet() async {
        let model = BackupRestorePageModel(dataSource: StubBackupSource())
        await model.openPreview(run(1, status: "completed"))
        XCTAssertTrue(model.previewPresented)
        XCTAssertNotNil(model.previewData)
        XCTAssertEqual(model.previewData?.tables.count, 1)
    }

    func testOpenPreviewFailureDismissesWithBanner() async {
        let model = BackupRestorePageModel(dataSource: StubBackupSource(previewFails: true))
        await model.openPreview(run(1, status: "completed"))
        XCTAssertFalse(model.previewPresented)
        XCTAssertEqual(model.outcome, .previewFailed)
    }

    func testDownloadURLComesFromSource() {
        let model = BackupRestorePageModel(dataSource: StubBackupSource())
        let url = model.downloadURL(for: run(42, status: "completed"))
        XCTAssertEqual(url?.absoluteString, "https://example.test/backup/runs/42/download")
    }

    func testDismissOutcomeClearsBanner() {
        let model = BackupRestorePageModel(dataSource: StubBackupSource())
        model.outcome = .triggered
        model.dismissOutcome()
        XCTAssertNil(model.outcome)
    }
}
