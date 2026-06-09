//
//  JsonFormatter.Tests.swift
//  TeslaSync — P4 feature view · 0017 · JsonFormatter (Apple)
//
//  Unit coverage for the JsonFormatter surface:
//    • Adapter (input → result) — `JsonPrettyPrinter` parity with the web
//      `JSON.stringify(JSON.parse(x), null, 2)` (key order, indentation, escapes,
//      number canonicalization, empty containers) + the `catch` error branch.
//    • Number canonicalization — `JsonNumber` parity with ECMAScript Number→String.
//    • State holder — `JsonFormatterModel` result derivation and the P1/S11
//      `view.opened` telemetry.
//    • Accessibility — the VoiceOver summary content for each state.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  bundle: the adapter + model are pure, driven directly.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: input → result (parity with JSON.stringify(_, null, 2))

@MainActor final class JsonPrettyPrinterTests: XCTestCase {
    /// Bundle-free English-fallback localizer.
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testWhitespaceOnlyAndBlankAreEmpty() {
        XCTAssertEqual(JsonPrettyPrinter.format(""), .empty)
        XCTAssertEqual(JsonPrettyPrinter.format("   \n\t "), .empty)
    }

    func testSimpleObjectMatchesStringify() {
        XCTAssertEqual(
            JsonPrettyPrinter.format("{\"key\":\"value\"}"),
            .formatted("{\n  \"key\": \"value\"\n}")
        )
    }

    func testObjectKeyOrderIsPreserved() {
        let formatted = JsonPrettyPrinter.format("{\"b\":1,\"a\":2,\"c\":3}").formatted
        XCTAssertEqual(formatted, "{\n  \"b\": 1,\n  \"a\": 2,\n  \"c\": 3\n}")
    }

    func testNestedAndEmptyContainers() {
        let input = "{\"a\":{\"y\":null},\"arr\":[{\"k\":true}],\"o\":{},\"e\":[]}"
        let expected = """
        {
          "a": {
            "y": null
          },
          "arr": [
            {
              "k": true
            }
          ],
          "o": {},
          "e": []
        }
        """
        XCTAssertEqual(JsonPrettyPrinter.format(input).formatted, expected)
    }

    func testTopLevelScalars() {
        XCTAssertEqual(JsonPrettyPrinter.format("42").formatted, "42")
        XCTAssertEqual(JsonPrettyPrinter.format("\"hi\"").formatted, "\"hi\"")
        XCTAssertEqual(JsonPrettyPrinter.format("true").formatted, "true")
        XCTAssertEqual(JsonPrettyPrinter.format("null").formatted, "null")
    }

    func testStringEscapesAreCanonicalized() {
        // \u0041 -> A, \u00e9 -> é (raw), `/` stays unescaped, control chars use short forms.
        let formatted = JsonPrettyPrinter.format("{\"s\":\"a\\\"b\\\\c\\n\\t\\u0041\\u00e9/\"}").formatted
        XCTAssertEqual(formatted, "{\n  \"s\": \"a\\\"b\\\\c\\n\\tAé/\"\n}")
    }

    func testSurrogatePairDecodesToEmoji() {
        XCTAssertEqual(JsonPrettyPrinter.format("\"\\uD83D\\uDE00\"").formatted, "\"😀\"")
    }

    func testNumbersAreCanonicalizedLikeStringify() {
        let formatted = JsonPrettyPrinter.format("[1, 1.0, -0, 1e2, 0.1, 2.5e-3, 1e20, 1e21]").formatted
        XCTAssertEqual(
            formatted,
            "[\n  1,\n  1,\n  0,\n  100,\n  0.1,\n  0.0025,\n  100000000000000000000,\n  1e+21\n]"
        )
    }

    func testDuplicateKeyKeepsFirstPositionLastValue() {
        XCTAssertEqual(JsonPrettyPrinter.format("{\"a\":1,\"a\":2}").formatted, "{\n  \"a\": 2\n}")
    }

    func testResultFlags() {
        XCTAssertTrue(JsonPrettyPrinter.format("{}").hasOutput)
        XCTAssertFalse(JsonPrettyPrinter.format("").hasOutput)
        XCTAssertTrue(JsonPrettyPrinter.format("{").isInvalid)
        XCTAssertNil(JsonPrettyPrinter.format("").formatted)
        XCTAssertNil(JsonPrettyPrinter.format("{}").error)
    }

    // MARK: Error branch (web `catch (e)`)

    func testInvalidValueReportsUnexpectedCharacter() {
        guard case let .invalid(error) = JsonPrettyPrinter.format("{\"key\": value}") else {
            return XCTFail("expected invalid")
        }
        XCTAssertEqual(error.offset, 8)
        XCTAssertEqual(error.reason, .unexpectedCharacter("v"))
        XCTAssertTrue(error.message(localize: echo).contains("position 8"))
        XCTAssertTrue(error.message(localize: echo).contains("'v'"))
    }

    func testUnterminatedInputReportsEndOfInput() {
        guard case let .invalid(error) = JsonPrettyPrinter.format("{\"a\":") else {
            return XCTFail("expected invalid")
        }
        XCTAssertEqual(error.reason, .unexpectedEndOfInput)
        XCTAssertEqual(error.message(localize: echo), "Unexpected end of JSON input")
    }

    func testTrailingCharactersAreRejected() {
        guard case let .invalid(error) = JsonPrettyPrinter.format("{} junk") else {
            return XCTFail("expected invalid")
        }
        XCTAssertEqual(error.offset, 3)
        XCTAssertEqual(error.reason, .trailingCharacters)
    }

    func testLeadingZeroNumberIsRejected() {
        XCTAssertTrue(JsonPrettyPrinter.format("[01]").isInvalid)
    }

    func testRawControlCharacterInStringIsRejected() {
        XCTAssertTrue(JsonPrettyPrinter.format("\"a\u{01}b\"").isInvalid)
    }

    func testInvalidEscapeIsRejected() {
        guard case let .invalid(error) = JsonPrettyPrinter.format("\"\\x\"") else {
            return XCTFail("expected invalid")
        }
        XCTAssertEqual(error.reason, .invalidStringEscape)
    }
}

// MARK: - Number canonicalization

@MainActor final class JsonNumberTests: XCTestCase {
    func testIntegerFormatting() {
        XCTAssertEqual(JsonNumber.canonical(1), "1")
        XCTAssertEqual(JsonNumber.canonical(1.0), "1")
        XCTAssertEqual(JsonNumber.canonical(-5), "-5")
        XCTAssertEqual(JsonNumber.canonical(100), "100")
        XCTAssertEqual(JsonNumber.canonical(-0.0), "0")
        XCTAssertEqual(JsonNumber.canonical(1e20), "100000000000000000000")
    }

    func testDecimalFormatting() {
        XCTAssertEqual(JsonNumber.canonical(0.1), "0.1")
        XCTAssertEqual(JsonNumber.canonical(1.5), "1.5")
        XCTAssertEqual(JsonNumber.canonical(2.5e-3), "0.0025")
    }

    func testExponentNormalization() {
        XCTAssertEqual(JsonNumber.canonical(1e21), "1e+21")
        XCTAssertEqual(JsonNumber.canonical(1e-7), "1e-7")
    }
}

// MARK: - State holder: JsonFormatterModel

@MainActor final class JsonFormatterModelTests: XCTestCase {
    func testResultFollowsInput() {
        let model = JsonFormatterModel(input: "{\"a\":1}", telemetry: SpyJsonFormatterTelemetry())
        XCTAssertEqual(model.result, .formatted("{\n  \"a\": 1\n}"))
        model.input = ""
        XCTAssertEqual(model.result, .empty)
        model.input = "{"
        XCTAssertTrue(model.result.isInvalid)
    }

    func testMessageForErrorResolvesText() {
        let model = JsonFormatterModel(input: "{", telemetry: SpyJsonFormatterTelemetry())
        guard case let .invalid(error) = model.result else { return XCTFail("expected invalid") }
        XCTAssertFalse(model.message(for: error).isEmpty)
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpyJsonFormatterTelemetry()
        let model = JsonFormatterModel(telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [JsonFormatterSurface.slug])
        XCTAssertEqual(JsonFormatterSurface.slug, "JsonFormatter")
    }
}

// MARK: - Accessibility: VoiceOver summary

@MainActor final class JsonFormatterAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testSummaryEmpty() {
        XCTAssertEqual(
            JsonFormatterAccessibility.summary(result: .empty, localize: echo),
            "Enter JSON to format"
        )
    }

    func testSummaryFormattedIncludesOutput() {
        let summary = JsonFormatterAccessibility.summary(
            result: .formatted("{\n  \"a\": 1\n}"),
            localize: echo
        )
        XCTAssertTrue(summary.contains("Formatted JSON"))
        XCTAssertTrue(summary.contains("\"a\": 1"))
    }

    func testSummaryInvalidIsTheParseMessage() {
        let error = JsonSyntaxError(offset: 5, reason: .invalidNumber)
        let summary = JsonFormatterAccessibility.summary(result: .invalid(error), localize: echo)
        XCTAssertEqual(summary, error.message(localize: echo))
        XCTAssertTrue(summary.contains("position 5"))
    }
}

// MARK: - Telemetry spy

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpyJsonFormatterTelemetry: JsonFormatterTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
