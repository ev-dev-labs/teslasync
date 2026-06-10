//
//  SettingsExportImport.ModelTests.swift
//  TeslaSync — P4 feature view · 0214 · SettingsExportImport (Apple)
//
//  State-holder coverage for `SettingsExportImportModel` — part 1: the export lifecycle
//  (idle → exporting → idle, success toast, offline/failed classification, re-entrancy
//  guard), the import intake pipeline (web `ingestFile`: too-large / read-failure /
//  invalid-JSON / invalid-bundle / dry-run preview / preview-failure branches + the
//  in-flight parsing state), and the P1/S11 `view.opened` telemetry. The apply-path +
//  projection coverage lives in SettingsExportImport.ApplyTests.swift.
//
//  These run in the TeslaSync(/-macOS) XCTest targets — no network, no host: the model is
//  driven by the in-memory + controllable seams.
//

import Foundation
import XCTest
@testable import TeslaSync

@MainActor
final class SettingsExportImportModelTests: XCTestCase {
    private var validBundleData: Data {
        Data(#"{"schema_version":1,"exported_at":"2026-06-07T00:00:00Z","sections":{"alert_rules":[{"id":1}]}}"#.utf8)
    }

    private func makeModel(
        source: InMemorySettingsBackupSource = InMemorySettingsBackupSource(),
        telemetry: any SettingsExportImportTelemetry = SettingsBackupSpy()
    ) -> SettingsExportImportModel {
        SettingsExportImportModel(
            exporter: source,
            importer: source,
            telemetry: telemetry,
            locale: Locale(identifier: "en_US")
        )
    }

    private func poll(until predicate: () -> Bool) async {
        for _ in 0 ..< 200 where !predicate() {
            try? await Task.sleep(for: .milliseconds(1))
        }
    }

    // MARK: Initial state

    func testInitialState() {
        let model = makeModel()
        XCTAssertEqual(model.exportPhase, .idle)
        XCTAssertEqual(model.importStage, .idle)
        XCTAssertFalse(model.isExporting)
        XCTAssertTrue(model.showsDropzone)
        XCTAssertNil(model.pending)
        XCTAssertNil(model.parseError)
        XCTAssertNil(model.toast)
        XCTAssertNil(model.previewSummary)
        XCTAssertTrue(model.isApplyDisabled)
    }

    // MARK: Export (web `handleExport`)

    func testExportSuccessSurfacesSavedToast() async {
        let source = InMemorySettingsBackupSource()
        let model = makeModel(source: source)
        await model.export()
        XCTAssertEqual(model.exportPhase, .idle)
        XCTAssertEqual(model.toast?.kind, .exportSucceeded)
        XCTAssertEqual(model.toast?.title, "Settings exported")
        XCTAssertEqual(model.toast?.message, "Saved to your downloads folder.")
        XCTAssertEqual(model.lastExport?.filename, "teslasync-settings.json")
        XCTAssertEqual(source.exportCount, 1)
    }

    func testExportOfflineSurfacesOfflineToast() async {
        let source = InMemorySettingsBackupSource(exportResult: .failure(.offline))
        let model = makeModel(source: source)
        await model.export()
        XCTAssertEqual(model.toast?.kind, .exportOffline)
        XCTAssertEqual(model.toast?.tone, .neutral)
        XCTAssertEqual(model.exportPhase, .idle)
    }

    func testExportFailureSurfacesMessage() async {
        let source = InMemorySettingsBackupSource(exportResult: .failure(.failed(message: "disk full")))
        let model = makeModel(source: source)
        await model.export()
        XCTAssertEqual(model.toast?.kind, .exportFailed)
        XCTAssertEqual(model.toast?.message, "disk full")
    }

    func testExportInFlightAndGuard() async {
        let source = ControllableSettingsBackupSource()
        let model = SettingsExportImportModel(
            exporter: source,
            importer: source,
            locale: Locale(identifier: "en_US")
        )
        let task = Task { await model.export() }
        await poll { model.isExporting }
        XCTAssertTrue(model.isExporting)
        XCTAssertTrue(model.isExportDisabled)
        XCTAssertEqual(model.exportButtonLabel.fallback, "Exporting…")

        await model.export() // guarded — must not start a second export
        XCTAssertEqual(source.exportCount, 1)

        source.completeExport()
        await task.value
        XCTAssertEqual(model.exportPhase, .idle)
        XCTAssertEqual(model.toast?.kind, .exportSucceeded)
    }

    // MARK: Import intake (web `ingestFile`)

    func testIngestTooLarge() async {
        let model = makeModel()
        await model.ingest(filename: "big.json", sizeBytes: maxImportFileBytes + 1, data: nil)
        XCTAssertEqual(model.importStage, .idle)
        XCTAssertEqual(model.parseError, .tooLarge)
        XCTAssertEqual(model.parseErrorMessage(), "File is too large (max 1 MB).")
    }

    func testIngestReadFailure() async {
        let model = makeModel()
        await model.ingest(filename: "x.json", sizeBytes: 10, data: nil)
        XCTAssertEqual(model.parseError, .readFailed)
        XCTAssertEqual(model.importStage, .idle)
    }

    func testIngestInvalidJSON() async {
        let model = makeModel()
        let data = Data("{ not json".utf8)
        await model.ingest(filename: "x.json", sizeBytes: data.count, data: data)
        guard case .invalidJSON = model.parseError else {
            return XCTFail("expected invalidJSON, got \(String(describing: model.parseError))")
        }
        XCTAssertEqual(model.importStage, .idle)
    }

    func testIngestInvalidBundle() async {
        let model = makeModel()
        let data = Data(#"{"schema_version":9,"exported_at":"x","sections":{}}"#.utf8)
        await model.ingest(filename: "x.json", sizeBytes: data.count, data: data)
        XCTAssertEqual(model.parseError, .invalidBundle(.schemaTooNew(version: 9, max: 1)))
        XCTAssertEqual(model.importStage, .idle)
    }

    func testIngestValidAdvancesToPreview() async {
        let source = InMemorySettingsBackupSource()
        let model = makeModel(source: source)
        await model.ingest(filename: "ok.json", sizeBytes: validBundleData.count, data: validBundleData)
        XCTAssertEqual(model.importStage, .preview)
        XCTAssertEqual(model.previewResult, InMemorySettingsBackupSource.sampleDryRun)
        XCTAssertEqual(model.pending?.filename, "ok.json")
        XCTAssertEqual(source.dryRunCount, 1)
        XCTAssertNil(model.parseError)
        XCTAssertFalse(model.showsDropzone)
    }

    func testIngestPreviewFailureKeepsErrorAndClearsPending() async {
        let source = InMemorySettingsBackupSource(dryRunResult: .failure(.failed(message: "422 invalid")))
        let model = makeModel(source: source)
        await model.ingest(filename: "ok.json", sizeBytes: validBundleData.count, data: validBundleData)
        XCTAssertEqual(model.importStage, .idle)
        XCTAssertEqual(model.parseError, .previewFailed(message: "422 invalid"))
        XCTAssertNil(model.pending)
    }

    func testIngestInFlightParsingState() async {
        let source = ControllableSettingsBackupSource()
        let model = SettingsExportImportModel(
            exporter: source,
            importer: source,
            locale: Locale(identifier: "en_US")
        )
        let task = Task {
            await model.ingest(filename: "ok.json", sizeBytes: validBundleData.count, data: validBundleData)
        }
        await poll { source.dryRunCount == 1 }
        XCTAssertTrue(model.isParsing)
        XCTAssertNotNil(model.pending)

        source.completeDryRun()
        await task.value
        XCTAssertEqual(model.importStage, .preview)
    }

    // MARK: Telemetry + toast dismiss

    func testStartEmitsViewOpenedOnce() {
        let spy = SettingsBackupSpy()
        let model = makeModel(telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["SettingsExportImport"])
    }

    func testDismissToastClears() async {
        let model = makeModel()
        await model.export()
        XCTAssertNotNil(model.toast)
        model.dismissToast()
        XCTAssertNil(model.toast)
    }
}

// MARK: - Shared telemetry spy (internal so the apply-test file reuses it)

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Named uniquely
/// to avoid colliding with other surfaces' test doubles in the shared XCTest target.
final class SettingsBackupSpy: SettingsExportImportTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
