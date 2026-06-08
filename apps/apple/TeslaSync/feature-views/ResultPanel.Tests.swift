//
//  ResultPanel.Tests.swift
//  TeslaSync — P4 feature view · 0008 · ResultPanel (Apple)
//
//  Unit coverage for the ResultPanel surface:
//    • Adapter (outcome → projection) — JSON.stringify(data, null, 2) parity
//      (pretty printer + order-preserving parser) and variant/copy resolution.
//    • State holder — ResultPanelModel phase resolution across loading / empty /
//      error / content, plus P1/S11 view.opened telemetry and the copy seam.
//    • Accessibility — the VoiceOver label content for each variant + copy button.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryResultPanelSource`, and the
//  clipboard/telemetry are spies.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: JSON pretty printer (parity with JSON.stringify(_, null, 2))

@MainActor
final class ResultPanelJSONTests: XCTestCase {
    private let objectTree = ResultPanelJSONValue.object([
        JSONMember(key: "status", value: .string("ok")),
        JSONMember(key: "code", value: .number("200")),
        JSONMember(key: "items", value: .array([.string("a"), .string("b")])),
        JSONMember(key: "nested", value: .object([
            JSONMember(key: "x", value: .number("1")),
            JSONMember(key: "y", value: .null)
        ])),
        JSONMember(key: "flag", value: .bool(true))
    ])

    func testPrettyPrintsObjectLikeJSStringify() {
        XCTAssertEqual(objectTree.prettyPrinted(), """
        {
          "status": "ok",
          "code": 200,
          "items": [
            "a",
            "b"
          ],
          "nested": {
            "x": 1,
            "y": null
          },
          "flag": true
        }
        """)
    }

    func testEmptyContainersCollapse() {
        XCTAssertEqual(ResultPanelJSONValue.object([]).prettyPrinted(), "{}")
        XCTAssertEqual(ResultPanelJSONValue.array([]).prettyPrinted(), "[]")
    }

    func testScalarsRenderVerbatim() {
        XCTAssertEqual(ResultPanelJSONValue.number("42").prettyPrinted(), "42")
        XCTAssertEqual(ResultPanelJSONValue.number("3.14").prettyPrinted(), "3.14")
        XCTAssertEqual(ResultPanelJSONValue.bool(false).prettyPrinted(), "false")
        XCTAssertEqual(ResultPanelJSONValue.null.prettyPrinted(), "null")
    }

    func testStringEscapingMatchesECMAScript() {
        XCTAssertEqual(
            ResultPanelJSONValue.string("hello \"world\"\nline2\ttab").prettyPrinted(),
            "\"hello \\\"world\\\"\\nline2\\ttab\""
        )
        // C0 control (U+0001) → lowercase \u00xx; backslash doubled.
        XCTAssertEqual(ResultPanelJSONValue.string("a\u{01}b").prettyPrinted(), "\"a\\u0001b\"")
        XCTAssertEqual(ResultPanelJSONValue.string("C:\\temp").prettyPrinted(), "\"C:\\\\temp\"")
    }

    func testUnicodeIsEmittedVerbatim() {
        XCTAssertEqual(ResultPanelJSONValue.string("Tëslá ⚡🚗").prettyPrinted(), "\"Tëslá ⚡🚗\"")
    }

    func testParserPreservesKeyOrderAndRoundTrips() throws {
        let raw = "{\"status\":\"ok\",\"code\":200,\"items\":[\"a\",\"b\"]," +
            "\"nested\":{\"x\":1,\"y\":null},\"flag\":true}"
        let parsed = try ResultPanelJSONValue.parse(raw)
        XCTAssertEqual(parsed, objectTree)
        XCTAssertEqual(parsed.prettyPrinted(), objectTree.prettyPrinted())
    }

    func testParserHandlesWhitespaceAndEscapes() throws {
        XCTAssertEqual(try ResultPanelJSONValue.parse("  [ 1 , 2 ] "), .array([.number("1"), .number("2")]))
        XCTAssertEqual(try ResultPanelJSONValue.parse("\"a\\u0001b\""), .string("a\u{01}b"))
    }

    func testParserRejectsMalformedInput() {
        XCTAssertThrowsError(try ResultPanelJSONValue.parse("{bad}"))
        XCTAssertThrowsError(try ResultPanelJSONValue.parse("[1,2"))
        XCTAssertThrowsError(try ResultPanelJSONValue.parse("\"unterminated"))
    }
}

// MARK: - Adapter: outcome → projection

@MainActor
final class ResultProjectionTests: XCTestCase {
    func testSuccessProducesResultVariantWithCopyText() {
        let value = ResultPanelJSONValue.object([JSONMember(key: "ok", value: .bool(true))])
        let projection = ResultProjectionBuilder.build(
            from: ResultPanelInput(title: "Response", outcome: .success(value))
        )
        XCTAssertEqual(projection.variant, .result)
        XCTAssertTrue(projection.hasData)
        XCTAssertEqual(projection.prettyJSON, value.prettyPrinted())
        XCTAssertEqual(projection.copyText, value.prettyPrinted())
        XCTAssertEqual(projection.title, "Response")
    }

    func testFailureProducesErrorVariantWithoutCopy() {
        let projection = ResultProjectionBuilder.build(
            from: ResultPanelInput(title: "Response", outcome: .failure(message: "boom"))
        )
        XCTAssertEqual(projection.variant, .error)
        XCTAssertEqual(projection.errorMessage, "boom")
        XCTAssertFalse(projection.hasData)
        XCTAssertNil(projection.copyText)
    }

    func testIdlePassesThroughCallerMessage() {
        let projection = ResultProjectionBuilder.build(
            from: ResultPanelInput(title: "Response", outcome: .idle(message: "Nothing yet"))
        )
        XCTAssertEqual(projection.variant, .idle)
        XCTAssertEqual(projection.idleMessage, "Nothing yet")
        XCTAssertNil(projection.copyText)
    }

    func testRunningProducesLoadingVariant() {
        let projection = ResultProjectionBuilder.build(
            from: ResultPanelInput(title: "Response", outcome: .running)
        )
        XCTAssertEqual(projection.variant, .loading)
    }

    func testRawJSONConvenienceParsesAndFallsBack() {
        let parsed = ResultProjectionBuilder.build(
            from: ResultPanelInput(title: "T", outcome: .success(rawJSON: "{\"a\":1}"))
        )
        XCTAssertEqual(parsed.prettyJSON, "{\n  \"a\": 1\n}")

        let fallback = ResultProjectionBuilder.build(
            from: ResultPanelInput(title: "T", outcome: .success(rawJSON: "not json"))
        )
        XCTAssertEqual(fallback.prettyJSON, "\"not json\"")
    }
}

// MARK: - State holder: phases + telemetry + copy seam

@MainActor
final class ResultPanelModelTests: XCTestCase {
    private func makeModel(
        _ update: ResultPanelUpdate,
        telemetry: any ResultPanelTelemetry = OSLogResultPanelTelemetry(),
        clipboard: any ResultPanelClipboard = SystemResultPanelClipboard()
    ) -> (ResultPanelModel, InMemoryResultPanelSource) {
        let source = InMemoryResultPanelSource(initial: update)
        let model = ResultPanelModel(
            source: source,
            telemetry: telemetry,
            clipboard: clipboard,
            initialTitle: update.input.title
        )
        return (model, source)
    }

    private func input(_ outcome: ResultOutcome) -> ResultPanelInput {
        ResultPanelInput(title: "Response", outcome: outcome)
    }

    func testRunningOutcomeShowsLoading() {
        let (model, _) = makeModel(ResultPanelUpdate(input: input(.running)))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testIdleOutcomeShowsEmpty() {
        let (model, _) = makeModel(ResultPanelUpdate(input: input(.idle(message: nil))))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailureShowsError() {
        let (model, _) = makeModel(ResultPanelUpdate(input: input(.failure(message: "net"))))
        model.start()
        XCTAssertEqual(model.phase, .error("net"))
    }

    func testSuccessShowsContent() {
        let value = ResultPanelJSONValue.object([JSONMember(key: "ok", value: .bool(true))])
        let (model, _) = makeModel(ResultPanelUpdate(input: input(.success(value))))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.projection.hasData)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyResultPanelTelemetry()
        let (model, source) = makeModel(ResultPanelUpdate(input: input(.running)), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [ResultPanelView.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(ResultPanelUpdate(input: input(.failure(message: "x"))))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testCopyResultWritesPrettyJSONToClipboard() {
        let spy = SpyResultPanelClipboard()
        let value = ResultPanelJSONValue.object([JSONMember(key: "a", value: .number("1"))])
        let (model, _) = makeModel(ResultPanelUpdate(input: input(.success(value))), clipboard: spy)
        model.start()
        XCTAssertTrue(model.copyResult())
        XCTAssertEqual(spy.copied, [value.prettyPrinted()])
    }

    func testCopyResultWithoutDataReturnsFalse() {
        let spy = SpyResultPanelClipboard()
        let (model, _) = makeModel(ResultPanelUpdate(input: input(.idle(message: nil))), clipboard: spy)
        model.start()
        XCTAssertFalse(model.copyResult())
        XCTAssertTrue(spy.copied.isEmpty)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(ResultPanelUpdate(input: input(.running)))
        model.start()
        let value = ResultPanelJSONValue.string("done")
        source.push(ResultPanelUpdate(
            input: input(.success(value)),
            connection: .offline,
            updatedAt: Date()
        ))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.prettyJSON, "\"done\"")
    }
}

// MARK: - Accessibility label content

@MainActor
final class ResultPanelAccessibilityTests: XCTestCase {
    func testPanelLabelForResultIncludesTitle() {
        let projection = ResultProjectionBuilder.build(
            from: ResultPanelInput(title: "Response", outcome: .success(.bool(true)))
        )
        let label = ResultPanelAccessibility.panelLabel(for: projection)
        XCTAssertTrue(label.contains("Response"))
        XCTAssertTrue(label.contains("result"))
    }

    func testPanelLabelForErrorIncludesMessage() {
        let projection = ResultProjectionBuilder.build(
            from: ResultPanelInput(title: "Response", outcome: .failure(message: "HTTP 500"))
        )
        let label = ResultPanelAccessibility.panelLabel(for: projection)
        XCTAssertTrue(label.contains("error"))
        XCTAssertTrue(label.contains("HTTP 500"))
    }

    func testPanelLabelForIdleUsesCallerMessage() {
        let projection = ResultProjectionBuilder.build(
            from: ResultPanelInput(title: "Response", outcome: .idle(message: "Nothing yet"))
        )
        XCTAssertEqual(ResultPanelAccessibility.panelLabel(for: projection), "Response: Nothing yet")
    }

    func testCopyLabelTogglesWithState() {
        XCTAssertEqual(ResultPanelAccessibility.copyLabel(copied: false), "Copy")
        XCTAssertEqual(ResultPanelAccessibility.copyLabel(copied: true), "Copied")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyResultPanelTelemetry: ResultPanelTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

/// Records copied payloads so the clipboard contract can be asserted.
@MainActor
private final class SpyResultPanelClipboard: ResultPanelClipboard {
    private(set) var copied: [String] = []
    func copy(_ text: String) {
        copied.append(text)
    }
}
