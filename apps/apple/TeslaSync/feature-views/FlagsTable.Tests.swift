//
//  FlagsTable.Tests.swift
//  TeslaSync — P4 feature view · 0031 · FlagsTable (Apple)
//
//  Unit coverage for the FlagsTable surface:
//    • Adapter (cached → projection) — `FlagsValuePreview` parity with the web
//      `previewValue` branches, and the `FlagsSort` key ordering + toggle.
//    • State holder — `FlagsTableModel` phase resolution across loading /
//      loaded / empty / error / content (cached rows kept behind refresh), plus
//      the P1/S11 `view.opened` telemetry + source wiring.
//    • Accessibility — the VoiceOver container summary + per-row / action labels.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemoryFlagsTableSource`.
//

import XCTest

// MARK: - Adapter: value preview (parity with the web `previewValue`)

@MainActor final class FlagsValuePreviewTests: XCTestCase {
    func testNullRendersLiteralNull() {
        XCTAssertEqual(FlagsValuePreview.preview(.null), "null")
    }

    func testUndefinedRendersAbsentDash() {
        XCTAssertEqual(FlagsValuePreview.preview(.undefined), "\u{2014}")
    }

    func testStringIsJSONQuotedAndEscaped() {
        XCTAssertEqual(FlagsValuePreview.preview(.string("hi")), "\"hi\"")
        XCTAssertEqual(FlagsValuePreview.preview(.string("a\"b")), "\"a\\\"b\"")
        XCTAssertEqual(FlagsValuePreview.preview(.string("a\nb")), "\"a\\nb\"")
    }

    func testBooleanRendersUnquoted() {
        XCTAssertEqual(FlagsValuePreview.preview(.bool(true)), "true")
        XCTAssertEqual(FlagsValuePreview.preview(.bool(false)), "false")
    }

    func testNumbersRenderLikeJavaScriptString() {
        XCTAssertEqual(FlagsValuePreview.preview(.number(5000)), "5000")
        XCTAssertEqual(FlagsValuePreview.preview(.number(-3)), "-3")
        XCTAssertEqual(FlagsValuePreview.preview(.number(2.5)), "2.5")
    }

    func testObjectRendersCompactSortedJSON() {
        let value = FlagValue.object(["percent": .number(25), "cohort": .string("internal")])
        XCTAssertEqual(FlagsValuePreview.preview(value), "{\"cohort\":\"internal\",\"percent\":25}")
    }

    func testArrayRendersCompactJSON() {
        let value = FlagValue.array([.string("us"), .string("eu"), .string("apac")])
        XCTAssertEqual(FlagsValuePreview.preview(value), "[\"us\",\"eu\",\"apac\"]")
    }

    func testLongValueTruncatesToPrefixPlusEllipsis() {
        let value = FlagValue.array((0 ..< 40).map { .string("region-\($0)") })
        let preview = FlagsValuePreview.preview(value)
        XCTAssertEqual(preview.count, FlagsValuePreview.truncatedPrefix + 1)
        XCTAssertTrue(preview.hasSuffix("\u{2026}"))
    }

    func testFromJSONProjectsEveryKind() {
        XCTAssertEqual(FlagValue.from(json: nil), .undefined)
        XCTAssertEqual(FlagValue.from(json: NSNull()), .null)
        XCTAssertEqual(FlagValue.from(json: true), .bool(true))
        XCTAssertEqual(FlagValue.from(json: 3), .number(3))
        XCTAssertEqual(FlagValue.from(json: "x"), .string("x"))
        XCTAssertEqual(FlagValue.from(json: ["a": 1]), .object(["a": .number(1)]))
    }
}

// MARK: - Adapter: key sort + toggle (parity with the web `useSortToggle`)

@MainActor final class FlagsSortTests: XCTestCase {
    private func rows(_ keys: [String]) -> [FlagsTableEntry] {
        keys.map { FlagsTableEntry(key: $0, value: .null) }
    }

    func testSortsAscendingByKey() {
        let sorted = FlagsSort.sorted(rows(["c", "a", "b"]), by: FlagsSortToggle())
        XCTAssertEqual(sorted.map(\.key), ["a", "b", "c"])
    }

    func testSortsDescendingByKey() {
        let toggle = FlagsSortToggle(field: .key, direction: .descending)
        let sorted = FlagsSort.sorted(rows(["c", "a", "b"]), by: toggle)
        XCTAssertEqual(sorted.map(\.key), ["c", "b", "a"])
    }

    func testToggleFlipsDirectionOnActiveField() {
        var toggle = FlagsSortToggle()
        XCTAssertEqual(toggle.direction, .ascending)
        toggle.toggle(.key)
        XCTAssertEqual(toggle.direction, .descending)
        toggle.toggle(.key)
        XCTAssertEqual(toggle.direction, .ascending)
    }

    func testSortIsStableForEqualKeys() {
        let duplicates = [
            FlagsTableEntry(key: "dup", value: .number(1)),
            FlagsTableEntry(key: "dup", value: .number(2))
        ]
        let sorted = FlagsSort.sorted(duplicates, by: FlagsSortToggle())
        XCTAssertEqual(sorted.map(\.value), [.number(1), .number(2)])
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class FlagsTableModelTests: XCTestCase {
    private let sampleRows = [
        FlagsTableEntry(key: "beta_dashboard", value: .bool(true)),
        FlagsTableEntry(key: "max_export_rows", value: .number(5000))
    ]

    private func makeModel(
        _ update: FlagsTableUpdate,
        telemetry: FlagsTableTelemetry = OSLogFlagsTableTelemetry()
    ) -> (FlagsTableModel, InMemoryFlagsTableSource) {
        let source = InMemoryFlagsTableSource(initial: update)
        let model = FlagsTableModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutRowsShowsLoading() {
        let (model, _) = makeModel(FlagsTableUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadingWithCachedRowsShowsContent() {
        let (model, _) = makeModel(FlagsTableUpdate(status: .loading, flags: sampleRows))
        model.start()
        XCTAssertEqual(model.phase, .content)
    }

    func testEmptyStatusShowsEmpty() {
        let (model, _) = makeModel(FlagsTableUpdate(status: .empty, flags: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testLoadedWithoutRowsShowsEmpty() {
        let (model, _) = makeModel(FlagsTableUpdate(status: .loaded, flags: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testLoadedWithRowsShowsContent() {
        let (model, _) = makeModel(FlagsTableUpdate(status: .loaded, flags: sampleRows))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.rows.count, 2)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(FlagsTableUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testFailedWithCachedRowsKeepsContent() {
        let (model, _) = makeModel(FlagsTableUpdate(status: .failed("net"), flags: sampleRows))
        model.start()
        XCTAssertEqual(model.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyFlagsTableTelemetry()
        let (model, source) = makeModel(FlagsTableUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [FlagsTable.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(FlagsTableUpdate(status: .loaded, flags: sampleRows))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(FlagsTableUpdate(status: .loading))
        model.start()
        source.push(
            FlagsTableUpdate(status: .loaded, connection: .offline, flags: sampleRows, updatedAt: Date())
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.rows.count, 2)
    }

    func testResolvePhaseIsPure() {
        XCTAssertEqual(FlagsTableModel.resolvePhase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(FlagsTableModel.resolvePhase(status: .loading, hasData: true), .content)
        XCTAssertEqual(FlagsTableModel.resolvePhase(status: .empty, hasData: false), .empty)
        XCTAssertEqual(FlagsTableModel.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(FlagsTableModel.resolvePhase(status: .loaded, hasData: true), .content)
        XCTAssertEqual(FlagsTableModel.resolvePhase(status: .failed("x"), hasData: false), .error("x"))
        XCTAssertEqual(FlagsTableModel.resolvePhase(status: .failed("x"), hasData: true), .content)
    }
}

// MARK: - Accessibility content

@MainActor final class FlagsTableAccessibilityTests: XCTestCase {
    func testSummaryFallsBackWhenEmpty() {
        let summary = FlagsTableAccessibility.summary(for: .empty)
        XCTAssertTrue(summary.contains("No feature flags"))
    }

    func testSummaryCountsRows() {
        let projection = FlagsProjection(rows: [
            FlagsTableEntry(key: "a", value: .null),
            FlagsTableEntry(key: "b", value: .null)
        ])
        let summary = FlagsTableAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("2"))
        XCTAssertTrue(summary.contains("feature flags"))
    }

    func testRowLabelListsKeyAndValue() {
        let entry = FlagsTableEntry(key: "beta_dashboard", value: .bool(true))
        let label = FlagsTableAccessibility.rowLabel(entry)
        XCTAssertTrue(label.contains("beta_dashboard"))
        XCTAssertTrue(label.contains("true"))
    }

    func testActionLabelsScopeToKey() {
        let entry = FlagsTableEntry(key: "beta_dashboard", value: .bool(true))
        XCTAssertTrue(FlagsTableAccessibility.editLabel(entry).contains("beta_dashboard"))
        XCTAssertTrue(FlagsTableAccessibility.deleteLabel(entry).contains("beta_dashboard"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyFlagsTableTelemetry: FlagsTableTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

@testable import TeslaSync
