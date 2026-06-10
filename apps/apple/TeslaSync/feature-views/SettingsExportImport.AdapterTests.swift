//
//  SettingsExportImport.AdapterTests.swift
//  TeslaSync — P4 feature view · 0214 · SettingsExportImport (Apple)
//
//  Unit coverage for the view-facing projections: the export/choose/apply button-label
//  projections (web ternaries), the per-section diff rows (web `SectionDiffList`, incl. the
//  em-dash for absent sections), the toast content for every outcome (web `useToast`), the
//  dry-run preview-header / summary builders (web `Previewing {{name}} ({{size}} bytes)`),
//  the accessibility builders + automation identifiers (web `data-testid`), and the i18n
//  facade. Pure — no network, no host. Uses the shared `backupEcho`/`backupFmt` localizers.
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - Button-label projections (web ternaries)

final class SettingsBackupLabelTests: XCTestCase {
    func testExportButtonLabel() {
        XCTAssertEqual(SettingsBackupLabel.exportButton(isExporting: false).key, "backup.export.cta")
        XCTAssertEqual(SettingsBackupLabel.exportButton(isExporting: false).fallback, "Export JSON")
        XCTAssertEqual(SettingsBackupLabel.exportButton(isExporting: true).key, "backup.export.busy")
        XCTAssertEqual(SettingsBackupLabel.exportButton(isExporting: true).fallback, "Exporting…")
    }

    func testChooseButtonLabel() {
        XCTAssertEqual(SettingsBackupLabel.chooseButton(isParsing: false).fallback, "Choose a file")
        XCTAssertEqual(SettingsBackupLabel.chooseButton(isParsing: true).fallback, "Reading…")
    }

    func testApplyButtonLabel() {
        XCTAssertEqual(SettingsBackupLabel.applyButton(isApplying: true, total: 5).fallback, "Applying…")

        let withChanges = SettingsBackupLabel.applyButton(isApplying: false, total: 5)
        XCTAssertEqual(withChanges.key, "backup.import.applyCount")
        XCTAssertEqual(withChanges.fallback, "Apply %lld change(s)")
        XCTAssertEqual(withChanges.count, 5)

        let noChanges = SettingsBackupLabel.applyButton(isApplying: false, total: 0)
        XCTAssertEqual(noChanges.key, "backup.import.applyNoChanges")
        XCTAssertEqual(noChanges.fallback, "Nothing to apply")
        XCTAssertNil(noChanges.count)
    }
}

// MARK: - Section diff rows (web `SectionDiffList`)

final class SettingsSectionDiffRowTests: XCTestCase {
    func testRowsCoverAllSectionsInOrder() {
        let result = SettingsImportResult(
            dryRun: true,
            sections: [.alertRules: SettingsImportSectionResult(added: 2, updated: 1, skipped: 3)]
        )
        XCTAssertEqual(
            SettingsSectionDiffRow.rows(from: result).map(\.key),
            [.settings, .alertRules, .geofences, .quietHours]
        )
    }

    func testCodeTextFormatsCountsAndEmDashForAbsent() {
        let result = SettingsImportResult(
            dryRun: true,
            sections: [.alertRules: SettingsImportSectionResult(added: 2, updated: 1, skipped: 3)]
        )
        let rows = SettingsSectionDiffRow.rows(from: result)
        XCTAssertEqual(rows.first { $0.key == .alertRules }?.codeText, "+2 ~1 =3")

        let settingsRow = rows.first { $0.key == .settings }
        XCTAssertNil(settingsRow?.counts)
        XCTAssertNil(settingsRow?.codeText)
    }
}

// MARK: - Toast content (web `useToast`)

final class SettingsBackupToastTests: XCTestCase {
    func testExportSucceeded() {
        let toast = SettingsBackupToast.exportSucceeded(localize: backupEcho)
        XCTAssertEqual(toast.kind, .exportSucceeded)
        XCTAssertEqual(toast.tone, .success)
        XCTAssertEqual(toast.title, "Settings exported")
        XCTAssertEqual(toast.message, "Saved to your downloads folder.")
        XCTAssertEqual(toast.systemImage, "checkmark.circle.fill")
    }

    func testImportAppliedInterpolatesCounts() {
        let summary = SettingsImportSummary(added: 6, updated: 2, skipped: 9)
        let toast = SettingsBackupToast.importApplied(summary: summary, localize: backupEcho, format: backupFmt)
        XCTAssertEqual(toast.kind, .importApplied)
        XCTAssertEqual(toast.tone, .success)
        XCTAssertEqual(toast.title, "Settings imported")
        XCTAssertEqual(toast.message, "6 added, 2 updated, 9 skipped.")
        XCTAssertFalse(toast.message.contains("%lld"))
    }

    func testExportOfflineAndFailed() {
        let offline = SettingsBackupToast.exportOffline(localize: backupEcho)
        XCTAssertEqual(offline.kind, .exportOffline)
        XCTAssertEqual(offline.tone, .neutral)
        XCTAssertEqual(offline.systemImage, "wifi.slash")

        let failed = SettingsBackupToast.exportFailed(message: "disk full", localize: backupEcho, format: backupFmt)
        XCTAssertEqual(failed.kind, .exportFailed)
        XCTAssertEqual(failed.tone, .danger)
        XCTAssertEqual(failed.message, "disk full")

        let blank = SettingsBackupToast.exportFailed(message: "  ", localize: backupEcho, format: backupFmt)
        XCTAssertEqual(blank.message, "Failed to export settings")
    }

    func testImportOfflineAndFailed() {
        let offline = SettingsBackupToast.importOffline(localize: backupEcho)
        XCTAssertEqual(offline.kind, .importOffline)
        XCTAssertEqual(offline.tone, .neutral)

        let failed = SettingsBackupToast.importFailed(message: "409 Conflict", localize: backupEcho)
        XCTAssertEqual(failed.kind, .importFailed)
        XCTAssertEqual(failed.tone, .danger)
        XCTAssertEqual(failed.message, "409 Conflict")

        let blank = SettingsBackupToast.importFailed(message: "", localize: backupEcho)
        XCTAssertEqual(blank.message, "Failed to apply import")
    }
}

// MARK: - Preview header builders (web `Previewing {{name}} ({{size}} bytes)`)

final class SettingsImportPreviewHeaderTests: XCTestCase {
    func testFormattedSizeGroups() {
        XCTAssertEqual(
            SettingsImportPreviewHeader.formattedSize(8421, locale: Locale(identifier: "en_US")),
            "8,421"
        )
    }

    func testHeaderTextInterpolates() {
        let text = SettingsImportPreviewHeader.text(
            name: "bundle.json",
            sizeBytes: 1024,
            locale: Locale(identifier: "en_US"),
            format: backupFmt
        )
        XCTAssertEqual(text, "Previewing bundle.json (1,024 bytes)")
    }

    func testSummaryLineInterpolates() {
        let line = SettingsImportPreviewHeader.summaryLine(
            SettingsImportSummary(added: 3, updated: 2, skipped: 6),
            format: backupFmt
        )
        XCTAssertEqual(line, "3 added, 2 updated, 6 unchanged")
    }
}

// MARK: - Accessibility builders + automation identifiers (web `data-testid`)

final class SettingsExportImportAccessibilityTests: XCTestCase {
    func testStableAutomationIdentifiers() {
        XCTAssertEqual(SettingsExportImportAccessibility.rootTestID, "settings-export-import")
        XCTAssertEqual(SettingsExportImportAccessibility.exportTestID, "settings-export-button")
        XCTAssertEqual(SettingsExportImportAccessibility.dropzoneTestID, "settings-import-dropzone")
        XCTAssertEqual(SettingsExportImportAccessibility.fileInputTestID, "settings-import-file-input")
        XCTAssertEqual(SettingsExportImportAccessibility.errorTestID, "settings-import-error")
        XCTAssertEqual(SettingsExportImportAccessibility.previewTestID, "settings-import-preview")
        XCTAssertEqual(SettingsExportImportAccessibility.applyTestID, "settings-import-apply")
        XCTAssertEqual(SettingsExportImportAccessibility.appliedTestID, "settings-import-applied")
        XCTAssertEqual(SettingsExportImportAccessibility.sectionListTestID, "settings-import-section-list")
    }

    func testSpokenLabels() {
        XCTAssertEqual(SettingsExportImportAccessibility.surfaceLabel(localize: backupEcho), "Backup & Restore")
        XCTAssertEqual(SettingsExportImportAccessibility.exportLabel(localize: backupEcho), "Export JSON")
        XCTAssertEqual(
            SettingsExportImportAccessibility.dropzoneLabel(localize: backupEcho),
            "Drag a JSON bundle here, or"
        )
    }
}

// MARK: - i18n facade + surface slug

final class SettingsExportImportStringsTests: XCTestCase {
    func testStringReturnsFallback() {
        XCTAssertEqual(SettingsExportImportStrings.string("backup.export.cta", "Export JSON"), "Export JSON")
    }

    func testFormatInterpolates() {
        XCTAssertEqual(
            SettingsExportImportStrings.format("backup.import.applyCount", "Apply %lld change(s)", [5]),
            "Apply 5 change(s)"
        )
    }

    func testSurfaceSlugIsStable() {
        XCTAssertEqual(SettingsExportImportSurface.slug, "SettingsExportImport")
        XCTAssertEqual(SettingsExportImport.surfaceSlug, "SettingsExportImport")
    }
}
