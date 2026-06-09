//
//  SignalHistoryTable.Tests.swift
//  TeslaSync — P4 feature view · 0269 · SignalHistoryTable (Apple)
//
//  Unit coverage for the SignalHistoryTable surface:
//    • Adapter — the SignalQueryControls ports (`formatValue` / `valueType` priority +
//      the JS `String(Number)` rendering), the raw-payload JSON projection (web
//      `JSON.stringify(r, null, 2)` + string escaping), the timestamp parser/formatter,
//      the grouped-integer + page-count math, the row projection (palette index from
//      `selectedSignals`, unique ids for duplicate composite keys), and the comparator.
//    • State holder — `SignalHistoryProjection` phase resolution across loading / error /
//      data / empty + the carried pagination metadata, plus the `SignalHistoryModel`
//      wiring, the P1/S11 `view.opened`, the clamped `goToPage`, and the stale auto-refresh.
//    • Accessibility — the Type label, the VoiceOver row summary, and the header meta.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store: the model is driven by `InMemorySignalHistorySource`, and the locale is
//  injected for determinism.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

// MARK: - Value resolution (SignalQueryControls.formatValue / valueType ports)

@MainActor final class SignalValueFormatTests: XCTestCase {
    func testFormatValuePriorityNumberFirst() {
        // Number wins over every other slot (web `formatValue` checks value_num first).
        let input = SignalLogInput(createdAt: "t", signal: "s", valueNum: 12, valueStr: "ignored", valueBool: true)
        XCTAssertEqual(SignalValueFormat.formatValue(input), "12")
    }

    func testFormatValueStringThenBoolThenDash() {
        XCTAssertEqual(
            SignalValueFormat.formatValue(SignalLogInput(createdAt: "t", signal: "s", valueStr: "Charging")),
            "Charging"
        )
        XCTAssertEqual(
            SignalValueFormat.formatValue(SignalLogInput(createdAt: "t", signal: "s", valueBool: true)),
            "true"
        )
        XCTAssertEqual(
            SignalValueFormat.formatValue(SignalLogInput(createdAt: "t", signal: "s", valueBool: false)),
            "false"
        )
        XCTAssertEqual(SignalValueFormat.formatValue(SignalLogInput(createdAt: "t", signal: "s")), "—")
    }

    func testValueTypePriority() {
        // num → number even when bool is also set; bool → boolean when no num; else string.
        XCTAssertEqual(SignalValueFormat.valueType(SignalLogInput(createdAt: "t", signal: "s", valueNum: 1)), .number)
        XCTAssertEqual(
            SignalValueFormat.valueType(SignalLogInput(createdAt: "t", signal: "s", valueNum: 1, valueBool: true)),
            .number
        )
        XCTAssertEqual(
            SignalValueFormat.valueType(SignalLogInput(createdAt: "t", signal: "s", valueBool: true)),
            .boolean
        )
        // A string value is typed `string`, and so is an all-null row (web default).
        XCTAssertEqual(SignalValueFormat.valueType(SignalLogInput(createdAt: "t", signal: "s", valueStr: "x")), .string)
        XCTAssertEqual(SignalValueFormat.valueType(SignalLogInput(createdAt: "t", signal: "s")), .string)
    }

    func testNumberStringMatchesJSRendering() {
        XCTAssertEqual(SignalValueFormat.numberString(78), "78")
        XCTAssertEqual(SignalValueFormat.numberString(62.5), "62.5")
        XCTAssertEqual(SignalValueFormat.numberString(-3.25), "-3.25")
        XCTAssertEqual(SignalValueFormat.numberString(0), "0")
        // Non-finite values are guarded to the em-dash (the BE adapter nulls them out).
        XCTAssertEqual(SignalValueFormat.numberString(.infinity), "—")
        XCTAssertEqual(SignalValueFormat.numberString(.nan), "—")
    }
}

// MARK: - Raw-payload JSON (web JSON.stringify(r, null, 2))

@MainActor final class SignalHistoryJSONTests: XCTestCase {
    func testPrettyPrintedNumberRow() {
        let input = SignalLogInput(createdAt: "2026-01-05T15:04:05Z", signal: "VehicleSpeed", valueNum: 62.5)
        let expected = """
        {
          "created_at": "2026-01-05T15:04:05Z",
          "signal": "VehicleSpeed",
          "value_num": 62.5,
          "value_str": null,
          "value_bool": null
        }
        """
        XCTAssertEqual(SignalHistoryJSON.prettyPrinted(input), expected)
    }

    func testPrettyPrintedStringAndBoolRows() {
        let str = SignalLogInput(createdAt: "t", signal: "ChargeState", valueStr: "Charging")
        XCTAssertTrue(SignalHistoryJSON.prettyPrinted(str).contains("\"value_str\": \"Charging\""))
        XCTAssertTrue(SignalHistoryJSON.prettyPrinted(str).contains("\"value_num\": null"))

        let flag = SignalLogInput(createdAt: "t", signal: "SentryMode", valueBool: true)
        XCTAssertTrue(SignalHistoryJSON.prettyPrinted(flag).contains("\"value_bool\": true"))
    }

    func testJSONStringEscaping() {
        let tricky = SignalLogInput(createdAt: "t", signal: "a\"b\\c\nd", valueStr: "x\ty")
        let json = SignalHistoryJSON.prettyPrinted(tricky)
        XCTAssertTrue(json.contains("\"signal\": \"a\\\"b\\\\c\\nd\""))
        XCTAssertTrue(json.contains("\"value_str\": \"x\\ty\""))
    }
}

// MARK: - Timestamp + numeric formatting

@MainActor final class SignalHistoryFormatTests: XCTestCase {
    func testParseHandlesISOFractionalEpochAndInvalid() {
        XCTAssertNotNil(SignalHistoryFormat.parse("2026-01-05T15:04:05Z"))
        XCTAssertNotNil(SignalHistoryFormat.parse("2026-01-05T15:04:05.123Z"))
        XCTAssertNotNil(SignalHistoryFormat.parse("1736089445"))
        XCTAssertNil(SignalHistoryFormat.parse(""))
        XCTAssertNil(SignalHistoryFormat.parse("not-a-date"))
    }

    func testAbsoluteRendersOrDashes() {
        XCTAssertEqual(SignalHistoryFormat.absolute(for: nil), "—")
        let utc = TimeZone(identifier: "UTC") ?? .current
        let date = SignalHistoryFormat.parse("2026-01-05T15:04:05Z")
        let out = SignalHistoryFormat.absolute(for: date, locale: Locale(identifier: "en_US_POSIX"), timeZone: utc)
        XCTAssertNotEqual(out, "—")
        XCTAssertTrue(out.contains("2026"))
    }

    func testGroupedIntAndPageCount() {
        XCTAssertEqual(SignalHistoryFormat.groupedInt(1342, locale: enUS), "1,342")
        XCTAssertEqual(SignalHistoryFormat.groupedInt(0, locale: enUS), "0")
        XCTAssertEqual(SignalHistoryFormat.pageCount(total: 1342, pageSize: 25), 54)
        XCTAssertEqual(SignalHistoryFormat.pageCount(total: 0, pageSize: 25), 1)
        XCTAssertEqual(SignalHistoryFormat.pageCount(total: 25, pageSize: 25), 1)
        XCTAssertEqual(SignalHistoryFormat.pageCount(total: 26, pageSize: 25), 2)
        // Defensive: a non-positive page size collapses to one page.
        XCTAssertEqual(SignalHistoryFormat.pageCount(total: 10, pageSize: 0), 1)
    }
}

// MARK: - Row projection + comparator

@MainActor final class SignalHistoryAdapterTests: XCTestCase {
    func testRowProjectionColorIndexAndValue() {
        let selected = ["VehicleSpeed", "BatteryLevel", "ChargeState"]
        let input = SignalLogInput(createdAt: "2026-01-05T15:04:05Z", signal: "BatteryLevel", valueNum: 78)
        let row = SignalHistoryAdapter.row(from: input, index: 3, selectedSignals: selected)
        XCTAssertEqual(row.colorIndex, 1)
        XCTAssertEqual(row.value, "78")
        XCTAssertEqual(row.valueType, .number)
        XCTAssertEqual(row.compositeKey, "2026-01-05T15:04:05Z-BatteryLevel")
        XCTAssertEqual(row.id, "3|2026-01-05T15:04:05Z-BatteryLevel")
        XCTAssertNotNil(row.createdAt)

        let unselected = SignalHistoryAdapter.row(
            from: SignalLogInput(createdAt: "t", signal: "Other"),
            index: 0,
            selectedSignals: selected
        )
        XCTAssertNil(unselected.colorIndex)
    }

    func testRowsPreserveOrderAndProduceUniqueIDs() {
        // Two rows with an identical created_at/signal pair must still get distinct ids.
        let dupe = SignalLogInput(createdAt: "2026-01-05T15:04:05Z", signal: "VehicleSpeed", valueNum: 10)
        let rows = SignalHistoryAdapter.rows(from: [dupe, dupe], selectedSignals: [])
        XCTAssertEqual(rows.count, 2)
        XCTAssertEqual(rows[0].compositeKey, rows[1].compositeKey)
        XCTAssertNotEqual(rows[0].id, rows[1].id)
    }

    func testCompareByTime() {
        let older = SignalHistoryAdapter.row(
            from: SignalLogInput(createdAt: "2026-01-01T00:00:00Z", signal: "s"),
            index: 0,
            selectedSignals: []
        )
        let newer = SignalHistoryAdapter.row(
            from: SignalLogInput(createdAt: "2026-01-05T15:04:05Z", signal: "s"),
            index: 1,
            selectedSignals: []
        )
        XCTAssertEqual(SignalHistoryAdapter.compareByTime(older, newer), .orderedAscending)
        XCTAssertEqual(SignalHistoryAdapter.compareByTime(newer, older), .orderedDescending)
        XCTAssertEqual(SignalHistoryAdapter.compareByTime(older, older), .orderedSame)
        let undated = SignalHistoryAdapter.row(
            from: SignalLogInput(createdAt: "", signal: "s"),
            index: 2,
            selectedSignals: []
        )
        XCTAssertEqual(SignalHistoryAdapter.compareByTime(undated, newer), .orderedAscending)
    }
}

// MARK: - Projection: phase resolution + carried metadata

@MainActor final class SignalHistoryProjectionTests: XCTestCase {
    private var sampleRows: [SignalLogInput] {
        [SignalLogInput(createdAt: "2026-01-05T15:04:05Z", signal: "VehicleSpeed", valueNum: 62.5)]
    }

    func testLoadingTakesPrecedence() {
        let resolved = SignalHistoryProjection.resolve(
            SignalHistoryInput(rows: sampleRows, isLoading: true, errorMessage: "ignored")
        )
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertTrue(resolved.rows.isEmpty)
    }

    func testErrorWhenNotLoading() {
        let resolved = SignalHistoryProjection.resolve(
            SignalHistoryInput(rows: sampleRows, errorMessage: "boom")
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertTrue(resolved.rows.isEmpty)
    }

    func testDataAndEmpty() {
        let data = SignalHistoryProjection.resolve(SignalHistoryInput(rows: sampleRows))
        XCTAssertEqual(data.phase, .data)
        XCTAssertEqual(data.rows.count, 1)

        let empty = SignalHistoryProjection.resolve(SignalHistoryInput(rows: []))
        XCTAssertEqual(empty.phase, .empty)
        XCTAssertTrue(empty.rows.isEmpty)
    }

    func testCarriesPaginationAndHeaderMetadata() {
        let resolved = SignalHistoryProjection.resolve(SignalHistoryInput(
            rows: sampleRows,
            page: 2,
            pageSize: 25,
            totalRows: 1342,
            title: "Custom Title",
            showHeaderMeta: false,
            expandable: false
        ))
        XCTAssertEqual(resolved.page, 2)
        XCTAssertEqual(resolved.pageSize, 25)
        XCTAssertEqual(resolved.totalRows, 1342)
        XCTAssertEqual(resolved.pageCount, 54)
        XCTAssertEqual(resolved.title, "Custom Title")
        XCTAssertFalse(resolved.showHeaderMeta)
        XCTAssertFalse(resolved.expandable)
    }
}

// MARK: - State holder: wiring + telemetry + pagination + freshness

@MainActor final class SignalHistoryModelTests: XCTestCase {
    private func dataInput(connection: SignalHistoryConnection = .live) -> SignalHistoryInput {
        SignalHistoryInput(
            rows: [SignalLogInput(createdAt: "2026-01-05T15:04:05Z", signal: "VehicleSpeed", valueNum: 62.5)],
            page: 2,
            pageSize: 25,
            totalRows: 1342,
            connection: connection
        )
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpySignalHistoryTelemetry()
        let source = InMemorySignalHistorySource(initial: dataInput())
        let model = SignalHistoryModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.rows.count, 1)
        XCTAssertEqual(spy.surfaces, [SignalHistoryDiagnostics.surface])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let source = InMemorySignalHistorySource(initial: SignalHistoryInput(isLoading: true))
        let model = SignalHistoryModel(source: source)
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testGoToPageClampsAndForwards() {
        let source = InMemorySignalHistorySource(initial: dataInput())
        let model = SignalHistoryModel(source: source)
        model.start()
        XCTAssertEqual(model.resolved.pageCount, 54)
        model.goToPage(3)
        model.goToPage(99)
        model.goToPage(0)
        XCTAssertEqual(source.requestedPages, [3, 54, 1])
    }

    func testPushUpdatesProjection() {
        let source = InMemorySignalHistorySource(initial: SignalHistoryInput(isLoading: true))
        let model = SignalHistoryModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(dataInput())
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.page, 2)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let source = InMemorySignalHistorySource(initial: dataInput())
        let model = SignalHistoryModel(source: source)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(dataInput(connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        // Staying stale must not re-trigger the one-shot auto-refresh.
        source.push(dataInput(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefresh() {
        let source = InMemorySignalHistorySource(initial: dataInput())
        let model = SignalHistoryModel(source: source)
        model.start()
        source.push(dataInput(connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }
}

// MARK: - Accessibility + display text content

@MainActor final class SignalHistoryAccessibilityTests: XCTestCase {
    /// Bundle-free localizer that returns the English fallback (the web `t` default).
    private let localize: SignalHistoryAccessibility.Localize = { _, fallback in fallback }

    func testValueTypeLabel() {
        XCTAssertEqual(SignalHistoryAccessibility.valueTypeLabel(.number, localize), "number")
        XCTAssertEqual(SignalHistoryAccessibility.valueTypeLabel(.string, localize), "string")
        XCTAssertEqual(SignalHistoryAccessibility.valueTypeLabel(.boolean, localize), "boolean")
    }

    func testRowSummaryCombinesEveryColumn() {
        let row = SignalHistoryAdapter.row(
            from: SignalLogInput(createdAt: "2026-01-05T15:04:05Z", signal: "VehicleSpeed", valueNum: 62.5),
            index: 0,
            selectedSignals: ["VehicleSpeed"]
        )
        let summary = SignalHistoryAccessibility.rowSummary(for: row, localize)
        XCTAssertTrue(summary.contains("Timestamp:"))
        XCTAssertTrue(summary.contains("Signal: VehicleSpeed"))
        XCTAssertTrue(summary.contains("Value: 62.5"))
        XCTAssertTrue(summary.contains("Type: number"))
    }

    func testHeaderMeta() {
        let meta = SignalHistoryAccessibility.headerMeta(page: 2, totalRows: 1342, localize, locale: enUS)
        XCTAssertEqual(meta, "Page 2 · 1,342 total")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpySignalHistoryTelemetry: SignalHistoryTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
