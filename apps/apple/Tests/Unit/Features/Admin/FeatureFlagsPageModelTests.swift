import SwiftUI
import XCTest
@testable import TeslaSync

/// A recorded `setFlag` call (file-scoped so it stays a single-level type under the
/// nesting rule).
private struct FlagSetCall {
    let key: String
    let value: FlagJSONValue
    let reason: String
}

/// State-machine tests for `FeatureFlagsPageModel` — every data state the two panels
/// render (loading / empty / error / success), the create/edit + delete interaction
/// state (form seeding, validation, save / delete success + failure), the JSON value
/// helpers ported from the web (`previewValue` / `compact` / `JSON.stringify`), and the
/// display-boundary date formatter. Mirrors the sibling `AuditLogPageModelTests`.
@MainActor final class FeatureFlagsPageModelTests: XCTestCase {
    private actor StubSource: FeatureFlagsDataSource {
        var flags: [FeatureFlagEntry]
        var changes: [FeatureFlagChange]
        let flagsFails: Bool
        let changesFails: Bool
        let setFails: Bool
        let deleteFails: Bool
        private(set) var setCalls: [FlagSetCall] = []
        private(set) var deleteCalls: [(key: String, reason: String)] = []

        init(
            flags: [FeatureFlagEntry] = [],
            changes: [FeatureFlagChange] = [],
            flagsFails: Bool = false,
            changesFails: Bool = false,
            setFails: Bool = false,
            deleteFails: Bool = false
        ) {
            self.flags = flags
            self.changes = changes
            self.flagsFails = flagsFails
            self.changesFails = changesFails
            self.setFails = setFails
            self.deleteFails = deleteFails
        }

        func loadFlags() async throws -> [FeatureFlagEntry] {
            if flagsFails { throw StubError() }
            return flags
        }

        func loadChanges(limit _: Int) async throws -> [FeatureFlagChange] {
            if changesFails { throw StubError() }
            return changes
        }

        func setFlag(key: String, value: FlagJSONValue, reason: String) async throws {
            if setFails { throw StubError() }
            setCalls.append(FlagSetCall(key: key, value: value, reason: reason))
            flags.removeAll { $0.key == key }
            flags.append(FeatureFlagEntry(key: key, value: value))
        }

        func deleteFlag(key: String, reason: String) async throws {
            if deleteFails { throw StubError() }
            deleteCalls.append((key, reason))
            flags.removeAll { $0.key == key }
        }
    }

    private struct StubError: Error {}

    private func entry(_ key: String, _ value: FlagJSONValue = .bool(true)) -> FeatureFlagEntry {
        FeatureFlagEntry(key: key, value: value)
    }

    private func change(_ id: Int64, op: FeatureFlagOperation = .set) -> FeatureFlagChange {
        FeatureFlagChange(id: id, changedAt: "2026-06-13T17:42:09Z", actor: "admin@local", flagKey: "f", operation: op)
    }

    // MARK: - List + changes states

    func testInitialStateIsLoading() {
        let model = FeatureFlagsPageModel(dataSource: StubSource())
        XCTAssertEqual(model.flagsState, .loading)
        XCTAssertEqual(model.changesState, .loading)
        XCTAssertTrue(model.flags.isEmpty)
        XCTAssertTrue(model.changes.isEmpty)
    }

    func testLoadSuccessPopulatesBothFeeds() async {
        let model = FeatureFlagsPageModel(dataSource: StubSource(
            flags: [entry("a"), entry("b")],
            changes: [change(2), change(1)]
        ))
        await model.load()
        XCTAssertEqual(model.flags.count, 2)
        XCTAssertEqual(model.changes.count, 2)
        if case .loaded = model.flagsState {} else { XCTFail("expected loaded flags") }
        if case .loaded = model.changesState {} else { XCTFail("expected loaded changes") }
    }

    func testLoadEmptyYieldsEmptyStates() async {
        let model = FeatureFlagsPageModel(dataSource: StubSource())
        await model.load()
        XCTAssertEqual(model.flagsState, .empty)
        XCTAssertEqual(model.changesState, .empty)
    }

    func testLoadFailureYieldsErrorStates() async {
        let model = FeatureFlagsPageModel(dataSource: StubSource(flagsFails: true, changesFails: true))
        await model.load()
        guard case .error = model.flagsState else { return XCTFail("expected error flags") }
        guard case .error = model.changesState else { return XCTFail("expected error changes") }
    }

    func testReloadFlagsIsIndependentOfChanges() async {
        let model = FeatureFlagsPageModel(dataSource: StubSource(flags: [entry("a")], changesFails: true))
        await model.load()
        XCTAssertEqual(model.flags.count, 1)
        guard case .error = model.changesState else { return XCTFail("expected changes error") }
    }

    // MARK: - Editor seeding + validation

    func testBeginCreateSeedsEmptyEditor() {
        let model = FeatureFlagsPageModel(dataSource: StubSource())
        model.beginCreate()
        XCTAssertTrue(model.editorPresented)
        XCTAssertFalse(model.isEditing)
        XCTAssertEqual(model.editorKey, "")
        XCTAssertEqual(model.editorValueText, "")
        XCTAssertEqual(model.editorReason, "")
    }

    func testBeginEditSeedsFromEntry() {
        let model = FeatureFlagsPageModel(dataSource: StubSource())
        model.beginEdit(entry("feature.x", .object(["enabled": .bool(true)])))
        XCTAssertTrue(model.editorPresented)
        XCTAssertTrue(model.isEditing)
        XCTAssertEqual(model.editorKey, "feature.x")
        XCTAssertTrue(model.editorValueText.contains("enabled"))
        XCTAssertEqual(model.editorReason, "")
    }

    func testEditorValidation() {
        let model = FeatureFlagsPageModel(dataSource: StubSource())
        model.beginCreate()
        XCTAssertEqual(model.editorValueError, .empty)
        XCTAssertFalse(model.canSave)

        model.editorKey = "feature.x"
        model.editorValueText = "{ bad json"
        XCTAssertEqual(model.editorValueError, .invalid)
        XCTAssertFalse(model.canSave)

        model.editorValueText = "{\"enabled\": true}"
        model.editorReason = "rollout"
        XCTAssertEqual(model.editorValueError, .none)
        XCTAssertTrue(model.canSave)
    }

    func testSaveSuccessClosesEditorAndPersists() async {
        let source = StubSource(flags: [entry("feature.x", .bool(false))])
        let model = FeatureFlagsPageModel(dataSource: source)
        await model.load()
        model.beginEdit(entry("feature.x", .bool(false)))
        model.editorValueText = "true"
        model.editorReason = "enable"
        await model.save()
        XCTAssertFalse(model.editorPresented)
        XCTAssertNil(model.saveError)
        let calls = await source.setCalls
        XCTAssertEqual(calls.count, 1)
        XCTAssertEqual(calls.first?.key, "feature.x")
    }

    func testSaveFailureKeepsEditorOpen() async {
        let model = FeatureFlagsPageModel(dataSource: StubSource(setFails: true))
        model.beginCreate()
        model.editorKey = "feature.x"
        model.editorValueText = "true"
        model.editorReason = "why"
        await model.save()
        XCTAssertTrue(model.editorPresented)
        XCTAssertNotNil(model.saveError)
        XCTAssertFalse(model.isSaving)
    }

    // MARK: - Delete

    func testAskDeleteSetsTarget() {
        let model = FeatureFlagsPageModel(dataSource: StubSource())
        model.askDelete(entry("feature.x"))
        XCTAssertEqual(model.deleteTarget?.key, "feature.x")
        XCTAssertFalse(model.canConfirmDelete) // reason still empty
        model.deleteReason = "cleanup"
        XCTAssertTrue(model.canConfirmDelete)
    }

    func testConfirmDeleteSuccessClearsTarget() async {
        let source = StubSource(flags: [entry("feature.x")])
        let model = FeatureFlagsPageModel(dataSource: source)
        await model.load()
        model.askDelete(entry("feature.x"))
        model.deleteReason = "cleanup"
        await model.confirmDelete()
        XCTAssertNil(model.deleteTarget)
        let calls = await source.deleteCalls
        XCTAssertEqual(calls.first?.key, "feature.x")
        XCTAssertEqual(model.flagsState, .empty)
    }

    func testConfirmDeleteFailureKeepsDialog() async {
        let model = FeatureFlagsPageModel(dataSource: StubSource(deleteFails: true))
        model.askDelete(entry("feature.x"))
        model.deleteReason = "cleanup"
        await model.confirmDelete()
        XCTAssertNotNil(model.deleteTarget)
        XCTAssertNotNil(model.deleteError)
        XCTAssertFalse(model.isDeleting)
    }

    func testCancelDeleteClearsState() {
        let model = FeatureFlagsPageModel(dataSource: StubSource())
        model.askDelete(entry("feature.x"))
        model.deleteReason = "x"
        model.cancelDelete()
        XCTAssertNil(model.deleteTarget)
        XCTAssertEqual(model.deleteReason, "")
    }
}

/// Pure JSON-value + badge + formatter + seed tests (split into an extension so the
/// primary `XCTestCase` body stays within the lint budget).
extension FeatureFlagsPageModelTests {
    // MARK: - FlagJSONValue parsing + serialization (web `JSON.parse` / `JSON.stringify`)

    func testParseScalarsObjectsAndArrays() {
        XCTAssertEqual(FlagJSONValue.parse("true"), .bool(true))
        XCTAssertEqual(FlagJSONValue.parse("42"), .number(42))
        XCTAssertEqual(FlagJSONValue.parse("\"x\""), .string("x"))
        XCTAssertEqual(FlagJSONValue.parse("null"), .null)
        XCTAssertEqual(FlagJSONValue.parse("[1,2]"), .array([.number(1), .number(2)]))
        XCTAssertEqual(FlagJSONValue.parse("{\"a\":1}"), .object(["a": .number(1)]))
    }

    func testParseRejectsEmptyAndMalformed() {
        XCTAssertNil(FlagJSONValue.parse(""))
        XCTAssertNil(FlagJSONValue.parse("   "))
        XCTAssertNil(FlagJSONValue.parse("{ bad"))
        XCTAssertNil(FlagJSONValue.parse("nope"))
    }

    func testCompactAndPreview() {
        XCTAssertEqual(FlagJSONValue.bool(true).compactJSON, "true")
        XCTAssertEqual(FlagJSONValue.string("x").compactJSON, "\"x\"")
        XCTAssertEqual(FlagJSONValue.number(42).compactJSON, "42")
        XCTAssertEqual(FlagJSONValue.number(42.5).compactJSON, "42.5")
        XCTAssertEqual(FlagJSONValue.object(["a": .number(1)]).compactJSON, "{\"a\":1}")
        XCTAssertEqual(FlagJSONValue.null.preview, "null")
    }

    func testCompactStaticTreatsNullAsDash() {
        XCTAssertEqual(FlagJSONValue.compact(nil), "—")
        XCTAssertEqual(FlagJSONValue.compact(.null), "—")
        XCTAssertEqual(FlagJSONValue.compact(.bool(false)), "false")
    }

    func testPreviewTruncatesLongContainers() {
        let big = FlagJSONValue.array((0 ..< 60).map { .number(Double($0)) })
        XCTAssertTrue(big.preview.hasSuffix("…"))
        XCTAssertLessThanOrEqual(big.preview.count, 118)
    }

    func testPrettyJSONIsMultilineForContainers() {
        let pretty = FlagJSONValue.object(["enabled": .bool(true)]).prettyJSON
        XCTAssertTrue(pretty.contains("\n"))
        XCTAssertTrue(pretty.contains("enabled"))
    }

    func testNumberStringDropsIntegralDecimal() {
        XCTAssertEqual(FlagJSONValue.numberString(42), "42")
        XCTAssertEqual(FlagJSONValue.numberString(42.5), "42.5")
    }

    // MARK: - Operation badge (web `OP_VARIANT`)

    func testOperationBadgeTone() {
        XCTAssertEqual(FeatureFlagOpBadge.tone(.set), .success)
        XCTAssertEqual(FeatureFlagOpBadge.tone(.delete), .danger)
    }

    // MARK: - Date formatter (web `formatDateTime`)

    func testDateTimeFormatsValidAndFallsBack() {
        XCTAssertEqual(FeatureFlagsFormat.dateTime(nil), "—")
        XCTAssertEqual(FeatureFlagsFormat.dateTime("not-a-date"), "—")
        XCTAssertNotEqual(FeatureFlagsFormat.dateTime("2026-06-13T17:42:09Z"), "—")
    }

    // MARK: - Default seed

    func testSampleDataSourceSeedsAndMutates() async throws {
        let source = SampleFeatureFlagsDataSource()
        let flags = try await source.loadFlags()
        XCTAssertFalse(flags.isEmpty)
        let changes = try await source.loadChanges(limit: 50)
        XCTAssertFalse(changes.isEmpty)

        try await source.setFlag(key: "feature.new", value: .bool(true), reason: "add")
        let afterSet = try await source.loadFlags()
        XCTAssertTrue(afterSet.contains { $0.key == "feature.new" })

        try await source.deleteFlag(key: "feature.new", reason: "remove")
        let afterDelete = try await source.loadFlags()
        XCTAssertFalse(afterDelete.contains { $0.key == "feature.new" })
    }
}
