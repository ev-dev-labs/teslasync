//
//  ImportPreviewModal.ModelTests.swift
//  TeslaSync — P4 modal / dialog · 0024 · ImportPreviewModal (Apple)
//
//  State-holder coverage for `ImportPreviewModalModel`: the P1/S11 `view.opened` telemetry (once +
//  idempotent), the input-tab selection, the validate / file / url / back / confirm / reset commands,
//  the parse-error branches (empty input, file read, invalid drop type, no-param URL, invalid URL),
//  the derived preview projection (title, badges, widget rows, mini-grid, canConfirm), the confirm
//  seam (applies the dashboard + resets), and the `initialJson` auto-validate on start. Driven
//  through an identity localizer + the real default registry — no network.
//

import XCTest
@testable import TeslaSync

/// Records the `view.opened` surfaces. Lock-guarded for the `Sendable` seam under Swift 6.
private final class SpyImportPreviewTelemetry: ImportPreviewModalTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    func viewOpened(surface: String) {
        lock.lock(); storage.append(surface); lock.unlock()
    }

    var surfaces: [String] {
        lock.lock(); defer { lock.unlock() }; return storage
    }
}

/// Records the confirm-action seam calls.
private final class RecordingImportPreviewConfirmAction: ImportPreviewConfirmAction, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [ImportPreviewDashboard] = []

    func confirm(_ dashboard: ImportPreviewDashboard) {
        lock.lock(); storage.append(dashboard); lock.unlock()
    }

    var confirmed: [ImportPreviewDashboard] {
        lock.lock(); defer { lock.unlock() }; return storage
    }
}

private enum ImportPreviewModelSamples {
    /// Two registry widgets + an `lg` layout — a clean valid import (ids exist in the default catalog).
    static let valid = #"""
    {
      "name": "Trip Dashboard",
      "widgets": [
        { "id": "w1", "widgetId": "battery-gauge" },
        { "id": "w2", "widgetId": "range-bar" }
      ],
      "layouts": { "lg": [ { "i": "w1", "x": 0, "y": 0, "w": 1, "h": 2 } ] }
    }
    """#

    /// Only an unknown widget — resolves to the "Cannot preview this layout" empty branch.
    static let incompatible = #"""
    { "name": "Broken", "widgets": [{ "id": "w1", "widgetId": "nope" }], "layouts": {} }
    """#

    static func urlSafeBase64(_ value: String) -> String {
        Data(value.utf8).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

@MainActor
final class ImportPreviewModalModelTests: XCTestCase {
    private func makeModel(
        initialJSON: String? = nil,
        telemetry: SpyImportPreviewTelemetry = SpyImportPreviewTelemetry(),
        confirmAction: RecordingImportPreviewConfirmAction = RecordingImportPreviewConfirmAction()
    ) -> ImportPreviewModalModel {
        ImportPreviewModalModel(
            initialJSON: initialJSON,
            catalog: DefaultImportPreviewWidgetCatalog(),
            telemetry: telemetry,
            confirmAction: confirmAction,
            localize: { _, fallback in fallback }
        )
    }

    // MARK: Telemetry + initial state

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyImportPreviewTelemetry()
        let model = makeModel(telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["ImportPreviewModal"])
    }

    func testInitialStateIsFileInput() {
        let model = makeModel()
        XCTAssertEqual(model.activeTab, .file)
        XCTAssertFalse(model.isPreview)
        XCTAssertEqual(model.title, "Import Dashboard")
        XCTAssertNil(model.parseError)
    }

    func testSelectTabSwitchesSource() {
        let model = makeModel()
        model.selectTab(.url)
        XCTAssertEqual(model.activeTab, .url)
    }

    // MARK: Validate (paste)

    func testValidatePastedValidEntersPreview() {
        let model = makeModel()
        model.pastedJSON = ImportPreviewModelSamples.valid
        XCTAssertTrue(model.canValidatePaste)
        model.validatePasted()
        XCTAssertTrue(model.isPreview)
        XCTAssertEqual(model.title, "Import Preview")
        XCTAssertTrue(model.canConfirm)
        XCTAssertEqual(model.dashboard?.name, "Trip Dashboard")
        XCTAssertEqual(model.badges.map(\.text), ["2 widgets"])
        XCTAssertEqual(model.widgetRows.count, 2)
        XCTAssertEqual(model.grid?.tiles.count, 1)
    }

    func testValidatePastedEmptySurfacesEmptyInput() {
        let model = makeModel()
        model.pastedJSON = "   "
        XCTAssertFalse(model.canValidatePaste)
        model.validatePasted()
        XCTAssertFalse(model.isPreview)
        XCTAssertEqual(model.parseError, "No data to validate")
    }

    func testIncompatibleImportResolvesEmptyPreview() {
        let model = makeModel()
        model.pastedJSON = ImportPreviewModelSamples.incompatible
        model.validatePasted()
        XCTAssertTrue(model.isPreview)
        XCTAssertNil(model.dashboard)
        XCTAssertFalse(model.canConfirm)
        XCTAssertEqual(model.errors, ["No compatible widgets found in this layout"])
    }

    // MARK: File intake

    func testImportFileTextValidEntersPreview() {
        let model = makeModel()
        model.importFileText(ImportPreviewModelSamples.valid)
        XCTAssertTrue(model.isPreview)
        XCTAssertNotNil(model.dashboard)
    }

    func testReportFileReadErrorSurfacesReadError() {
        let model = makeModel()
        model.reportFileReadError()
        XCTAssertEqual(model.parseError, "Failed to read file")
        XCTAssertFalse(model.isPreview)
    }

    func testReportInvalidDropTypeSurfacesFileTypeError() {
        let model = makeModel()
        model.reportInvalidDropType()
        XCTAssertEqual(model.parseError, "Please drop a .json file")
    }

    // MARK: URL intake

    func testLoadFromURLValidEntersPreview() {
        let model = makeModel()
        let encoded = ImportPreviewModelSamples.urlSafeBase64(ImportPreviewModelSamples.valid)
        model.importURL = "https://x.example/d#import=\(encoded)"
        XCTAssertTrue(model.canLoadURL)
        model.loadFromURL()
        XCTAssertTrue(model.isPreview)
        XCTAssertEqual(model.dashboard?.name, "Trip Dashboard")
    }

    func testLoadFromURLNoParamSurfacesError() {
        let model = makeModel()
        model.importURL = "https://x.example/dashboard"
        model.loadFromURL()
        XCTAssertEqual(model.parseError, "URL does not contain an import parameter")
    }

    func testLoadFromURLInvalidSurfacesError() {
        let model = makeModel()
        model.importURL = "not a url"
        model.loadFromURL()
        XCTAssertEqual(model.parseError, "Invalid URL format")
    }

    // MARK: Back / confirm / reset

    func testBackReturnsToInput() {
        let model = makeModel()
        model.importFileText(ImportPreviewModelSamples.valid)
        XCTAssertTrue(model.isPreview)
        model.back()
        XCTAssertFalse(model.isPreview)
        XCTAssertNil(model.parseError)
    }

    func testConfirmAppliesDashboardAndResets() {
        let recorder = RecordingImportPreviewConfirmAction()
        let model = makeModel(confirmAction: recorder)
        model.importFileText(ImportPreviewModelSamples.valid)
        XCTAssertTrue(model.confirm())
        XCTAssertEqual(recorder.confirmed.count, 1)
        XCTAssertEqual(recorder.confirmed.first?.name, "Trip Dashboard")
        // resetState parity — back to the file input.
        XCTAssertFalse(model.isPreview)
        XCTAssertEqual(model.activeTab, .file)
        XCTAssertEqual(model.pastedJSON, "")
    }

    func testConfirmWithoutDashboardIsNoOp() {
        let recorder = RecordingImportPreviewConfirmAction()
        let model = makeModel(confirmAction: recorder)
        model.pastedJSON = ImportPreviewModelSamples.incompatible
        model.validatePasted()
        XCTAssertFalse(model.confirm())
        XCTAssertTrue(recorder.confirmed.isEmpty)
    }

    func testResetClearsAllLocalState() {
        let model = makeModel()
        model.selectTab(.paste)
        model.pastedJSON = "x"
        model.importURL = "y"
        model.reportInvalidDropType()
        model.reset()
        XCTAssertEqual(model.activeTab, .file)
        XCTAssertEqual(model.pastedJSON, "")
        XCTAssertEqual(model.importURL, "")
        XCTAssertNil(model.parseError)
        XCTAssertFalse(model.isPreview)
    }

    // MARK: initialJson auto-validate

    func testInitialJSONAutoValidatesOnStart() {
        let model = makeModel(initialJSON: ImportPreviewModelSamples.valid)
        XCTAssertFalse(model.isPreview) // not until start
        model.start()
        XCTAssertTrue(model.isPreview)
        XCTAssertEqual(model.dashboard?.name, "Trip Dashboard")
    }
}
