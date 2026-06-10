//
//  TelemetryErrorsPanel.Tests.swift
//  TeslaSync — P4 feature view · 0009 · TelemetryErrorsPanel (Apple)
//
//  Unit coverage for the TelemetryErrorsPanel surface:
//    • Adapter — `extractTelemetryErrors` / `pickString` parity across every wire
//      variant, the JSON export + filename, and the timestamp formatter.
//    • State holder — `TelemetryErrorsProjection` phase resolution across idle /
//      loading / error / data / empty, plus the `TelemetryErrorsModel` wiring and
//      the P1/S11 `view.opened` telemetry.
//    • Accessibility — the VoiceOver row summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryTelemetryErrorsSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Extractor: Tesla wire shape → rows (port of extractTelemetryErrors)

@MainActor final class TelemetryErrorsExtractorTests: XCTestCase {
    private func errorRow(_ members: [TelemetryJSON.Member]) -> TelemetryJSON {
        .object(members)
    }

    func testEnvelopeWrappedResponseExtractsRows() {
        let json = TelemetryJSON.object([
            .init("response", .object([
                .init("errors", .array([
                    errorRow([
                        .init("reported_at", .string("2026-01-05T15:04:05Z")),
                        .init("error_code", .string("telemetry_disconnected")),
                        .init("error_message", .string("stopped streaming")),
                        .init("vin", .string("VIN1"))
                    ])
                ]))
            ]))
        ])
        let (rows, ok) = TelemetryErrorsExtractor.extract(json)
        XCTAssertTrue(ok)
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].timestamp, "2026-01-05T15:04:05Z")
        XCTAssertEqual(rows[0].code, "telemetry_disconnected")
        XCTAssertEqual(rows[0].message, "stopped streaming")
        XCTAssertEqual(rows[0].rowKey, "2026-01-05T15:04:05Z|telemetry_disconnected|VIN1|0")
    }

    func testRootErrorsArrayExtracts() {
        let json = TelemetryJSON.object([.init("errors", .array([errorRow([])]))])
        let (rows, ok) = TelemetryErrorsExtractor.extract(json)
        XCTAssertTrue(ok)
        XCTAssertEqual(rows.count, 1)
        // All fields absent → empty strings, rowKey is the index-bearing composite.
        XCTAssertEqual(rows[0].rowKey, "|||0")
    }

    func testResponseAsArrayExtracts() {
        let json = TelemetryJSON.object([.init("response", .array([errorRow([]), errorRow([])]))])
        let (rows, ok) = TelemetryErrorsExtractor.extract(json)
        XCTAssertTrue(ok)
        XCTAssertEqual(rows.count, 2)
    }

    func testRootArrayOnlyExtracts() {
        let json = TelemetryJSON.array([errorRow([.init("code", .string("x_code"))])])
        let (rows, ok) = TelemetryErrorsExtractor.extract(json)
        XCTAssertTrue(ok)
        XCTAssertEqual(rows[0].code, "x_code")
    }

    func testAlternateFieldNamesAndNumberCoercion() {
        let json = TelemetryJSON.object([
            .init("errors", .array([
                errorRow([
                    .init("ts", .number(1_736_089_445)),
                    .init("topic", .string("vehicle_data")),
                    .init("body", .string("payload too large"))
                ])
            ]))
        ])
        let (rows, _) = TelemetryErrorsExtractor.extract(json)
        XCTAssertEqual(rows[0].timestamp, "1736089445")
        XCTAssertEqual(rows[0].code, "vehicle_data")
        XCTAssertEqual(rows[0].message, "payload too large")
    }

    func testUnknownShapeReturnsNotOK() {
        let json = TelemetryJSON.object([.init("status", .string("ok")), .init("weird", .bool(true))])
        let (rows, ok) = TelemetryErrorsExtractor.extract(json)
        XCTAssertFalse(ok)
        XCTAssertTrue(rows.isEmpty)
    }

    func testNilAndScalarReturnNotOK() {
        XCTAssertFalse(TelemetryErrorsExtractor.extract(nil).ok)
        XCTAssertFalse(TelemetryErrorsExtractor.extract(.null).ok)
        XCTAssertFalse(TelemetryErrorsExtractor.extract(.string("nope")).ok)
    }

    func testHealthyEmptyArrayIsOK() {
        let json = TelemetryJSON.object([.init("response", .object([.init("errors", .array([]))]))])
        let (rows, ok) = TelemetryErrorsExtractor.extract(json)
        XCTAssertTrue(ok)
        XCTAssertTrue(rows.isEmpty)
    }

    func testPickStringPrefersFirstNonEmptyKey() {
        let row = TelemetryJSON.object([.init("code", .string("")), .init("name", .string("fallback"))])
        XCTAssertEqual(TelemetryErrorsExtractor.pickString(row, ["code", "name"]), "fallback")
    }
}

// MARK: - Export + JSON serialisation (web JSON.stringify(value, null, 2))

@MainActor final class TelemetryErrorsExportTests: XCTestCase {
    func testExportProducesPrettyJSONArrayInKeyOrder() {
        let rows = [
            TelemetryErrorsPanelErrorRow(rowKey: "k1", timestamp: "t1", code: "c1", message: "m1")
        ]
        let export = TelemetryErrorsExport.make(rows: rows, vin: "VIN1")
        let expected = """
        [
          {
            "rowKey": "k1",
            "timestamp": "t1",
            "code": "c1",
            "message": "m1"
          }
        ]
        """
        XCTAssertEqual(export.json, expected)
        XCTAssertEqual(export.filename, "telemetry-errors-VIN1.json")
    }

    func testEmptyVINFilenameFallsBackToAll() {
        let export = TelemetryErrorsExport.make(rows: [], vin: "")
        XCTAssertEqual(export.filename, "telemetry-errors-all.json")
        XCTAssertEqual(export.json, "[]")
    }

    func testStringEscapingMatchesJSON() {
        let rows = [
            TelemetryErrorsPanelErrorRow(rowKey: "k", timestamp: "t", code: "c", message: "a\"b\\c\nd\te")
        ]
        let export = TelemetryErrorsExport.make(rows: rows, vin: "v")
        XCTAssertTrue(export.json.contains("\"message\": \"a\\\"b\\\\c\\nd\\te\""))
    }
}

// MARK: - Timestamp formatting (web formatDateTime)

@MainActor final class TelemetryErrorsFormatTests: XCTestCase {
    func testEmptyAndInvalidReturnDash() {
        XCTAssertEqual(TelemetryErrorsFormat.timestamp(""), "—")
        XCTAssertEqual(TelemetryErrorsFormat.timestamp("not-a-date"), "—")
    }

    func testValidISORendersHumanReadable() {
        let locale = Locale(identifier: "en_US_POSIX")
        let utc = TimeZone(identifier: "UTC") ?? .current
        let out = TelemetryErrorsFormat.timestamp("2026-01-05T15:04:05Z", locale: locale, timeZone: utc)
        XCTAssertNotEqual(out, "—")
        XCTAssertTrue(out.contains("2026"))
    }
}

// MARK: - Projection: phase resolution across every web branch

@MainActor final class TelemetryErrorsProjectionTests: XCTestCase {
    func testIdleWhenNotRequested() {
        let resolved = TelemetryErrorsProjection.resolve(TelemetryErrorsInput(requested: false))
        XCTAssertEqual(resolved.phase, .idle)
    }

    func testLoadingTakesPrecedenceOverData() {
        let resolved = TelemetryErrorsProjection.resolve(
            TelemetryErrorsInput(requested: true, loading: true)
        )
        XCTAssertEqual(resolved.phase, .loading)
    }

    func testErrorTakesPrecedenceOverExtraction() {
        let json = TelemetryJSON.object([.init("errors", .array([.object([])]))])
        let resolved = TelemetryErrorsProjection.resolve(
            TelemetryErrorsInput(requested: true, errorMessage: "boom", response: json)
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertTrue(resolved.rows.isEmpty)
    }

    func testDataWhenRowsPresent() {
        let json = TelemetryJSON.object([.init("errors", .array([.object([.init("code", .string("c"))])]))])
        let resolved = TelemetryErrorsProjection.resolve(TelemetryErrorsInput(requested: true, response: json))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.rows.count, 1)
        XCTAssertTrue(resolved.ok)
        XCTAssertNil(resolved.rawJSONText)
    }

    func testEmptyHealthyHasNoRaw() {
        let json = TelemetryJSON.object([.init("response", .object([.init("errors", .array([]))]))])
        let resolved = TelemetryErrorsProjection.resolve(TelemetryErrorsInput(requested: true, response: json))
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertTrue(resolved.ok)
        XCTAssertNil(resolved.rawJSONText)
    }

    func testEmptyUnknownShapeSurfacesRaw() {
        let json = TelemetryJSON.object([.init("status", .string("ok"))])
        let resolved = TelemetryErrorsProjection.resolve(TelemetryErrorsInput(requested: true, response: json))
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertFalse(resolved.ok)
        XCTAssertNotNil(resolved.rawJSONText)
        XCTAssertTrue(resolved.rawJSONText?.contains("\"status\": \"ok\"") ?? false)
    }

    func testEmptyWithoutResponseHasNoRaw() {
        let resolved = TelemetryErrorsProjection.resolve(TelemetryErrorsInput(requested: true))
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertFalse(resolved.ok)
        XCTAssertNil(resolved.rawJSONText)
    }
}

// MARK: - State holder: wiring + telemetry

@MainActor final class TelemetryErrorsModelTests: XCTestCase {
    private func makeModel(
        _ input: TelemetryErrorsInput,
        telemetry: TelemetryErrorsTelemetry = OSLogTelemetryErrorsTelemetry()
    ) -> (TelemetryErrorsModel, InMemoryTelemetryErrorsSource) {
        let source = InMemoryTelemetryErrorsSource(initial: input)
        let model = TelemetryErrorsModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = TelemetryErrorsPanelSpyTelemetryErrorsTelemetry()
        let json = TelemetryJSON.object([.init("errors", .array([.object([.init("code", .string("c"))])]))])
        let (model, source) = makeModel(
            TelemetryErrorsInput(requested: true, response: json, vin: "VIN1"),
            telemetry: spy
        )
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.rows.count, 1)
        XCTAssertEqual(spy.surfaces, [TelemetryErrorsPanel.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(TelemetryErrorsInput(requested: false))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testPushUpdatesProjectionAndExport() {
        let (model, source) = makeModel(TelemetryErrorsInput(requested: true, loading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        let json = TelemetryJSON.object([
            .init("errors", .array([
                .object([.init("code", .string("auth")), .init("reported_at", .string("t"))])
            ]))
        ])
        source.push(TelemetryErrorsInput(requested: true, response: json, vin: "VIN9"))
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.vin, "VIN9")
        XCTAssertEqual(model.export.filename, "telemetry-errors-VIN9.json")
        XCTAssertTrue(model.export.json.contains("\"code\": \"auth\""))
    }
}

// MARK: - Accessibility summary content

@MainActor final class TelemetryErrorsAccessibilityTests: XCTestCase {
    func testRowSummaryCombinesFields() {
        let row = TelemetryErrorsPanelErrorRow(rowKey: "k", timestamp: "", code: "c1", message: "m1")
        let summary = TelemetryErrorsAccessibility.rowSummary(for: row)
        XCTAssertTrue(summary.contains("c1"))
        XCTAssertTrue(summary.contains("m1"))
        // Empty timestamp falls back to the em-dash sentinel.
        XCTAssertTrue(summary.contains("—"))
    }

    func testRowSummaryDashesEmptyCodeAndMessage() {
        let row = TelemetryErrorsPanelErrorRow(rowKey: "k", timestamp: "", code: "", message: "")
        XCTAssertEqual(TelemetryErrorsAccessibility.rowSummary(for: row), "—, —, —")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class TelemetryErrorsPanelSpyTelemetryErrorsTelemetry: TelemetryErrorsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
