//
//  SettingsExportImport.Tests.swift
//  TeslaSync — P4 feature view · 0214 · SettingsExportImport (Apple)
//
//  Unit coverage for the bundle data model + the local validator (a faithful port of
//  web/src/lib/settingsImportSchema.ts): the section-key model, the import-result summary
//  (web `summariseImportResult`), every branch of the validator (web
//  `validateSettingsBundle`), and the inline parse-error + validation messages. The
//  view-facing projection tests live in SettingsExportImport.AdapterTests.swift.
//
//  These run in the TeslaSync(/-macOS) XCTest targets — pure, no network, no host.
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - Bundle-free localizers (return the English fallback)

let backupEcho: @Sendable (String, String) -> String = { _, fallback in fallback }
let backupFmt: @Sendable (String, String, [CVarArg]) -> String = { _, fallbackFormat, args in
    String(format: fallbackFormat, arguments: args)
}

// MARK: - Section keys (web `SETTINGS_BUNDLE_SECTION_KEYS`)

final class SettingsBundleSectionKeyTests: XCTestCase {
    func testWireKeysMatchGoTags() {
        XCTAssertEqual(SettingsBundleSectionKey.settings.wireKey, "settings")
        XCTAssertEqual(SettingsBundleSectionKey.alertRules.wireKey, "alert_rules")
        XCTAssertEqual(SettingsBundleSectionKey.geofences.wireKey, "geofences")
        XCTAssertEqual(SettingsBundleSectionKey.quietHours.wireKey, "quiet_hours")
    }

    func testOrderMatchesWebRenderOrder() {
        XCTAssertEqual(
            SettingsBundleSectionKey.allCases,
            [.settings, .alertRules, .geofences, .quietHours]
        )
    }

    func testLabelFallbacksMatchWeb() {
        XCTAssertEqual(SettingsBundleSectionKey.settings.labelFallback, "General settings")
        XCTAssertEqual(SettingsBundleSectionKey.alertRules.labelFallback, "Alert rules")
        XCTAssertEqual(SettingsBundleSectionKey.geofences.labelFallback, "Geofences")
        XCTAssertEqual(SettingsBundleSectionKey.quietHours.labelFallback, "Quiet hours")
    }

    func testFromWireKeyResolvesKnownAndRejectsUnknown() {
        XCTAssertEqual(SettingsBundleSectionKey.from(wireKey: "alert_rules"), .alertRules)
        XCTAssertNil(SettingsBundleSectionKey.from(wireKey: "passwords"))
    }
}

// MARK: - Import summary (web `summariseImportResult`)

final class SettingsImportSummaryTests: XCTestCase {
    func testSummariseSumsSectionsAndTotalsChangesOnly() {
        let result = SettingsImportResult(
            dryRun: true,
            sections: [
                .settings: SettingsImportSectionResult(added: 0, updated: 1, skipped: 4),
                .alertRules: SettingsImportSectionResult(added: 3, updated: 1, skipped: 2)
            ]
        )
        let summary = SettingsImportSummary.summarise(result)
        XCTAssertEqual(summary.added, 3)
        XCTAssertEqual(summary.updated, 2)
        XCTAssertEqual(summary.skipped, 6)
        XCTAssertEqual(summary.total, 5) // added + updated (skipped excluded)
    }

    func testSummariseEmptyIsAllZero() {
        let summary = SettingsImportSummary.summarise(SettingsImportResult(dryRun: true, sections: [:]))
        XCTAssertEqual(summary, SettingsImportSummary(added: 0, updated: 0, skipped: 0))
        XCTAssertEqual(summary.total, 0)
    }
}

// MARK: - Validator (port of web `validateSettingsBundle`)

final class SettingsBundleValidatorTests: XCTestCase {
    private func validate(_ object: [String: Any]) -> Result<SettingsBundle, SettingsBundleValidationError> {
        SettingsBundleValidator.validate(json: object, rawData: Data())
    }

    private func validBundleObject() -> [String: Any] {
        [
            "schema_version": 1,
            "exported_at": "2026-06-07T00:00:00Z",
            "sections": [
                "settings": ["theme": "dark"],
                "alert_rules": [["id": 1]],
                "geofences": [],
                "quiet_hours": [["start": "22:00"]]
            ]
        ]
    }

    func testValidBundleResolvesWithPresentSections() throws {
        let bundle = try validate(validBundleObject()).get()
        XCTAssertEqual(bundle.schemaVersion, 1)
        XCTAssertEqual(bundle.exportedAt, "2026-06-07T00:00:00Z")
        XCTAssertEqual(bundle.presentSections, [.settings, .alertRules, .geofences, .quietHours])
    }

    func testPartialBundleIsValid() throws {
        let bundle = try validate([
            "schema_version": 1,
            "exported_at": "2026-06-07T00:00:00Z",
            "sections": ["alert_rules": [["id": 1]]]
        ]).get()
        XCTAssertEqual(bundle.presentSections, [.alertRules])
    }

    func testNonObjectRejected() {
        XCTAssertEqual(
            SettingsBundleValidator.validate(json: [1, 2, 3], rawData: Data()).failureError,
            .notObject
        )
    }

    func testBadSchemaVersionRejected() {
        var object = validBundleObject()
        object["schema_version"] = "1"
        XCTAssertEqual(validate(object).failureError, .badSchemaVersion)

        object["schema_version"] = 0
        XCTAssertEqual(validate(object).failureError, .badSchemaVersion)

        object["schema_version"] = 1.5
        XCTAssertEqual(validate(object).failureError, .badSchemaVersion)

        object.removeValue(forKey: "schema_version")
        XCTAssertEqual(validate(object).failureError, .badSchemaVersion)
    }

    func testSchemaTooNewRejected() {
        var object = validBundleObject()
        object["schema_version"] = 2
        XCTAssertEqual(validate(object).failureError, .schemaTooNew(version: 2, max: 1))
    }

    func testBadExportedAtRejected() {
        var object = validBundleObject()
        object["exported_at"] = "   "
        XCTAssertEqual(validate(object).failureError, .badExportedAt)

        object.removeValue(forKey: "exported_at")
        XCTAssertEqual(validate(object).failureError, .badExportedAt)
    }

    func testSectionsNotObjectRejected() {
        var object = validBundleObject()
        object["sections"] = "nope"
        XCTAssertEqual(validate(object).failureError, .sectionsNotObject)
    }

    func testUnknownSectionRejected() {
        var object = validBundleObject()
        object["sections"] = ["passwords": ["secret"]]
        XCTAssertEqual(validate(object).failureError, .unknownSection("passwords"))
    }

    func testSettingsNotObjectRejected() {
        var object = validBundleObject()
        object["sections"] = ["settings": ["not", "an", "object"]]
        XCTAssertEqual(validate(object).failureError, .settingsNotObject)
    }

    func testSectionNotArrayRejected() {
        var object = validBundleObject()
        object["sections"] = ["geofences": ["should": "be array"]]
        XCTAssertEqual(validate(object).failureError, .sectionNotArray(.geofences))
    }

    func testParseRejectsMalformedJSON() {
        switch SettingsBundleValidator.parse(Data("{ not json".utf8)) {
        case .success: XCTFail("expected malformed JSON to fail parsing")
        case .failure: break
        }
    }

    func testParseAcceptsValidJSON() throws {
        let parsed = try SettingsBundleValidator.parse(Data("{\"schema_version\":1}".utf8)).get()
        XCTAssertEqual((parsed as? [String: Any])?["schema_version"] as? Int, 1)
    }
}

// MARK: - Validation + parse-error messages

final class SettingsImportErrorMessageTests: XCTestCase {
    func testValidationMessagesLocalize() {
        XCTAssertEqual(
            SettingsBundleValidationError.notObject.message(localize: backupEcho, format: backupFmt),
            "Bundle must be a JSON object"
        )
        XCTAssertEqual(
            SettingsBundleValidationError.schemaTooNew(version: 3, max: 1)
                .message(localize: backupEcho, format: backupFmt),
            "schema_version 3 is newer than this build supports (max 1)"
        )
        XCTAssertEqual(
            SettingsBundleValidationError.unknownSection("creds").message(localize: backupEcho, format: backupFmt),
            "Unknown section \"creds\""
        )
        XCTAssertEqual(
            SettingsBundleValidationError.sectionNotArray(.quietHours)
                .message(localize: backupEcho, format: backupFmt),
            "sections.quiet_hours must be an array"
        )
    }

    func testParseErrorMessages() {
        XCTAssertEqual(
            SettingsImportParseError.tooLarge.message(localize: backupEcho, format: backupFmt),
            "File is too large (max 1 MB)."
        )
        XCTAssertEqual(
            SettingsImportParseError.readFailed.message(localize: backupEcho, format: backupFmt),
            "Failed to read the file."
        )
        XCTAssertEqual(
            SettingsImportParseError.invalidJSON(detail: "boom").message(localize: backupEcho, format: backupFmt),
            "File is not valid JSON: boom"
        )
        XCTAssertEqual(
            SettingsImportParseError.invalidBundle(.badExportedAt)
                .message(localize: backupEcho, format: backupFmt),
            "exported_at must be a non-empty ISO-8601 string"
        )
    }

    func testPreviewFailedUsesServerMessageThenFallback() {
        XCTAssertEqual(
            SettingsImportParseError.previewFailed(message: "503 down")
                .message(localize: backupEcho, format: backupFmt),
            "503 down"
        )
        XCTAssertEqual(
            SettingsImportParseError.previewFailed(message: nil)
                .message(localize: backupEcho, format: backupFmt),
            "Failed to preview import."
        )
        XCTAssertEqual(
            SettingsImportParseError.previewFailed(message: "   ")
                .message(localize: backupEcho, format: backupFmt),
            "Failed to preview import."
        )
    }
}

// MARK: - Result helper

private extension Result {
    /// The failure value, or `nil` on success — keeps the validator assertions terse.
    var failureError: Failure? {
        if case let .failure(error) = self { return error }
        return nil
    }
}
