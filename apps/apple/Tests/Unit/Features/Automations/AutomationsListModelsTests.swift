import XCTest
@testable import TeslaSync

/// Unit tests for the `AutomationsListPage` pure value types — the stats reducer (web
/// `computeStats` precedence), the UI status derivation, the toggle gate, the typed import
/// envelope validation, and the localization key mapping.
final class AutomationsListModelsTests: XCTestCase {
    func testStatsCompute() {
        let stats = AutomationListStats.compute([
            AutomationListItem(id: 1, name: "a", enabled: true),
            AutomationListItem(id: 2, name: "b", enabled: false),
            AutomationListItem(id: 3, name: "c", enabled: true, autoDisabled: true)
        ])
        XCTAssertEqual(stats.total, 3)
        XCTAssertEqual(stats.active, 1)
        XCTAssertEqual(stats.disabled, 1)
        XCTAssertEqual(stats.autoDisabled, 1)
        XCTAssertTrue(stats.hasAutoDisabled)
    }

    func testUIStatusPrecedence() {
        XCTAssertEqual(AutomationListItem(id: 1, name: "a", enabled: true).status, .active)
        XCTAssertEqual(AutomationListItem(id: 2, name: "b", enabled: false).status, .disabled)
        XCTAssertEqual(
            AutomationListItem(id: 3, name: "c", enabled: true, autoDisabled: true).status,
            .autoDisabled
        )
    }

    func testToggleIsOnRespectsAutoDisabled() {
        let auto = AutomationListItem(id: 1, name: "a", enabled: true, autoDisabled: true)
        XCTAssertFalse(auto.toggleIsOn)
        XCTAssertTrue(AutomationListItem(id: 2, name: "b", enabled: true).toggleIsOn)
    }

    func testUpdatingClearsAutoDisabled() {
        let auto = AutomationListItem(
            id: 1,
            name: "a",
            enabled: false,
            autoDisabled: true,
            autoDisabledReason: "boom"
        )
        let reEnabled = auto.updating(enabled: true, autoDisabled: false, clearAutoDisabledReason: true)
        XCTAssertTrue(reEnabled.enabled)
        XCTAssertFalse(reEnabled.autoDisabled)
        XCTAssertNil(reEnabled.autoDisabledReason)
    }

    func testEmptyDescriptionFoldsToNil() {
        XCTAssertNil(AutomationListItem(id: 1, name: "a", description: "").description)
    }

    func testImportEnvelopeParse() throws {
        let envelope = try AutomationImportEnvelope.parse(
            Data(#"{"version":2,"exported_at":"2026-01-01","automations":[1,2,3]}"#.utf8)
        )
        XCTAssertEqual(envelope.version, 2)
        XCTAssertEqual(envelope.automationCount, 3)
        XCTAssertEqual(envelope.exportedAt, "2026-01-01")
    }

    func testImportEnvelopeRejectsNonRecord() {
        XCTAssertThrowsError(try AutomationImportEnvelope.parse(Data("[1,2]".utf8))) { error in
            XCTAssertEqual(error as? AutomationImportError, .typedEnvelopeRequired)
        }
    }

    func testImportEnvelopeRejectsUnreadable() {
        XCTAssertThrowsError(try AutomationImportEnvelope.parse(Data("not json".utf8))) { error in
            XCTAssertEqual(error as? AutomationImportError, .unreadable)
        }
    }

    func testStatusFilterLabelKeys() {
        XCTAssertEqual(AutomationStatusFilter.all.labelKey, "automations.filters.all")
        XCTAssertEqual(AutomationStatusFilter.autoDisabled.labelKey, "automations.filters.autoDisabled")
    }

    func testUIStatusLabelKeys() {
        XCTAssertEqual(AutomationUIStatus.active.labelKey, "automations.status.active")
        XCTAssertEqual(AutomationUIStatus.autoDisabled.labelKey, "automations.status.auto-disabled")
    }

    func testImportErrorMessageKeys() {
        XCTAssertEqual(AutomationImportError.unreadable.messageKey, "automations.importUnknownError")
        XCTAssertEqual(
            AutomationImportError.typedEnvelopeRequired.messageKey,
            "automations.importTypedEnvelopeRequired"
        )
    }
}
