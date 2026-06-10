//
//  SettingsExportImport.ApplyTests.swift
//  TeslaSync — P4 feature view · 0214 · SettingsExportImport (Apple)
//
//  State-holder coverage for `SettingsExportImportModel` — part 2: the apply path (web
//  `handleApply`: applied summary + success toast, the SUDO-cancel non-error that keeps the
//  preview, offline/failed classification while the preview stays, the re-entrancy guard,
//  and the in-flight applying state), the import reset, and the dry-run preview projections
//  (header / summary line / apply-button enablement).
//
//  These run in the TeslaSync(/-macOS) XCTest targets — no network, no host. Reuses the
//  `SettingsBackupSpy` defined in SettingsExportImport.ModelTests.swift.
//

import Foundation
import XCTest
@testable import TeslaSync

@MainActor
final class SettingsExportImportApplyTests: XCTestCase {
    private var validBundleData: Data {
        Data(#"{"schema_version":1,"exported_at":"2026-06-07T00:00:00Z","sections":{"alert_rules":[{"id":1}]}}"#.utf8)
    }

    private func makeModel(source: InMemorySettingsBackupSource) -> SettingsExportImportModel {
        SettingsExportImportModel(
            exporter: source,
            importer: source,
            telemetry: SettingsBackupSpy(),
            locale: Locale(identifier: "en_US")
        )
    }

    private func poll(until predicate: () -> Bool) async {
        for _ in 0 ..< 200 where !predicate() {
            try? await Task.sleep(for: .milliseconds(1))
        }
    }

    private func seededPreviewModel(source: InMemorySettingsBackupSource) async -> SettingsExportImportModel {
        let model = makeModel(source: source)
        await model.ingest(filename: "ok.json", sizeBytes: validBundleData.count, data: validBundleData)
        XCTAssertEqual(model.importStage, .preview)
        return model
    }

    // MARK: Apply (web `handleApply`)

    func testApplySuccess() async {
        let source = InMemorySettingsBackupSource()
        let model = await seededPreviewModel(source: source)
        await model.apply()
        XCTAssertEqual(model.importStage, .applied)
        XCTAssertEqual(model.appliedResult, InMemorySettingsBackupSource.sampleApplied)
        XCTAssertEqual(model.toast?.kind, .importApplied)
        XCTAssertEqual(model.toast?.title, "Settings imported")
        XCTAssertEqual(source.applyCount, 1)
        XCTAssertFalse(model.applyInFlight)
    }

    func testApplySudoCancelKeepsPreview() async {
        let source = InMemorySettingsBackupSource(applyResult: .failure(.sudoCanceled))
        let model = await seededPreviewModel(source: source)
        await model.apply()
        XCTAssertEqual(model.importStage, .preview) // preview stays so the user can retry
        XCTAssertNil(model.toast)
        XCTAssertFalse(model.applyInFlight)
    }

    func testApplyOfflineKeepsPreviewWithToast() async {
        let source = InMemorySettingsBackupSource(applyResult: .failure(.offline))
        let model = await seededPreviewModel(source: source)
        await model.apply()
        XCTAssertEqual(model.importStage, .preview)
        XCTAssertEqual(model.toast?.kind, .importOffline)
    }

    func testApplyFailureKeepsPreviewWithToast() async {
        let source = InMemorySettingsBackupSource(applyResult: .failure(.failed(message: "409 Conflict")))
        let model = await seededPreviewModel(source: source)
        await model.apply()
        XCTAssertEqual(model.importStage, .preview)
        XCTAssertEqual(model.toast?.kind, .importFailed)
        XCTAssertEqual(model.toast?.message, "409 Conflict")
    }

    func testApplyNoPendingIsNoOp() async {
        let source = InMemorySettingsBackupSource()
        let model = makeModel(source: source)
        await model.apply()
        XCTAssertEqual(source.applyCount, 0)
        XCTAssertEqual(model.importStage, .idle)
    }

    func testApplyInFlightAndGuard() async {
        let source = ControllableSettingsBackupSource()
        let model = SettingsExportImportModel(
            exporter: source,
            importer: source,
            locale: Locale(identifier: "en_US")
        )
        let ingest = Task {
            await model.ingest(filename: "ok.json", sizeBytes: validBundleData.count, data: validBundleData)
        }
        await poll { source.dryRunCount == 1 }
        source.completeDryRun()
        await ingest.value
        XCTAssertEqual(model.importStage, .preview)

        let applyTask = Task { await model.apply() }
        await poll { model.applyInFlight }
        XCTAssertTrue(model.applyInFlight)
        XCTAssertTrue(model.isApplyDisabled)
        XCTAssertEqual(model.applyButtonLabel.fallback, "Applying…")

        await model.apply() // guarded — must not start a second apply
        XCTAssertEqual(source.applyCount, 1)

        source.completeApply()
        await applyTask.value
        XCTAssertEqual(model.importStage, .applied)
    }

    // MARK: Reset + derived projections

    func testResetImportClearsState() async {
        let model = await seededPreviewModel(source: InMemorySettingsBackupSource())
        model.resetImport()
        XCTAssertEqual(model.importStage, .idle)
        XCTAssertNil(model.pending)
        XCTAssertNil(model.previewResult)
        XCTAssertNil(model.appliedResult)
        XCTAssertNil(model.parseError)
        XCTAssertTrue(model.showsDropzone)
    }

    func testPreviewProjectionsLocalize() async throws {
        let model = await seededPreviewModel(source: InMemorySettingsBackupSource())
        let size = try SettingsImportPreviewHeader.formattedSize(
            XCTUnwrap(model.pending?.sizeBytes),
            locale: Locale(identifier: "en_US")
        )
        XCTAssertEqual(model.previewHeaderText(), "Previewing ok.json (\(size) bytes)")
        XCTAssertEqual(model.previewSummaryLine(), "6 added, 2 updated, 7 unchanged")
        XCTAssertFalse(model.isApplyDisabled)
        XCTAssertEqual(model.applyButtonLabel.key, "backup.import.applyCount")
        XCTAssertEqual(model.applyButtonLabel.count, 8)
        XCTAssertEqual(model.sectionRows.count, 4)
    }

    func testApplyDisabledWhenNothingToApply() async {
        let allSkipped = SettingsImportResult(
            dryRun: true,
            sections: [.settings: SettingsImportSectionResult(added: 0, updated: 0, skipped: 5)]
        )
        let source = InMemorySettingsBackupSource(dryRunResult: .success(allSkipped))
        let model = await seededPreviewModel(source: source)
        XCTAssertTrue(model.isApplyDisabled)
        XCTAssertEqual(model.applyButtonLabel.key, "backup.import.applyNoChanges")
    }
}
