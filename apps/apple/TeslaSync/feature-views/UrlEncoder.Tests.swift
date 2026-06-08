//
//  UrlEncoder.Tests.swift
//  TeslaSync — P4 feature view · 0023 · UrlEncoder (Apple)
//
//  Unit coverage for the UrlEncoder surface:
//    • Codec (input → projection) — `UrlEncoderCodec` parity with the web
//      `encodeURIComponent` / `decodeURIComponent` (unreserved set, %20/%26/%3D,
//      UTF-8 triples, malformed → invalid, empty sentinel).
//    • State holder — `UrlEncoderModel` result derivation across encode / decode /
//      invalid / empty, the per-mode example, plus the P1/S11 `view.opened`
//      telemetry firing exactly once.
//    • Accessibility — the VoiceOver output summary content per state.
//    • i18n facade — `UrlEncoderStrings` resolves keys to their web fallback.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is constructed directly.
//

import XCTest
@testable import TeslaSync

// MARK: - Codec: parity with encodeURIComponent / decodeURIComponent

@MainActor
final class UrlEncoderCodecTests: XCTestCase {
    func testEncodeMatchesEncodeURIComponentForExample() {
        // The exact web example pair: "hello world&foo=bar" → "hello%20world%26foo%3Dbar".
        XCTAssertEqual(UrlEncoderCodec.encode("hello world&foo=bar"), "hello%20world%26foo%3Dbar")
    }

    func testEncodePreservesUnreservedSet() {
        let unreserved = "ABCabc123-_.!~*'()"
        XCTAssertEqual(UrlEncoderCodec.encode(unreserved), unreserved)
    }

    func testEncodeReservedDelimiters() {
        XCTAssertEqual(UrlEncoderCodec.encode("a+b/c?d#e"), "a%2Bb%2Fc%3Fd%23e")
    }

    func testEncodeNonASCIIAsUTF8Triples() {
        XCTAssertEqual(UrlEncoderCodec.encode("café"), "caf%C3%A9")
        XCTAssertEqual(UrlEncoderCodec.encode("世"), "%E4%B8%96")
    }

    func testDecodeRoundTripsTheEncodedExample() {
        XCTAssertEqual(UrlEncoderCodec.decode("hello%20world%26foo%3Dbar"), "hello world&foo=bar")
        XCTAssertEqual(UrlEncoderCodec.decode("caf%C3%A9"), "café")
    }

    func testDecodeReturnsNilForMalformedEscapes() {
        XCTAssertNil(UrlEncoderCodec.decode("%"))
        XCTAssertNil(UrlEncoderCodec.decode("%2"))
        XCTAssertNil(UrlEncoderCodec.decode("%zz"))
        XCTAssertNil(UrlEncoderCodec.decode("%FF"))
    }

    func testTransformEmptyInputIsEmptySentinel() {
        XCTAssertEqual(UrlEncoderCodec.transform("", mode: .encode), .empty)
        XCTAssertEqual(UrlEncoderCodec.transform("", mode: .decode), .empty)
    }

    func testTransformEncodeProducesValue() {
        XCTAssertEqual(
            UrlEncoderCodec.transform("a b", mode: .encode),
            .value("a%20b")
        )
    }

    func testTransformDecodeValidProducesValue() {
        XCTAssertEqual(
            UrlEncoderCodec.transform("a%20b", mode: .decode),
            .value("a b")
        )
    }

    func testTransformDecodeMalformedIsInvalid() {
        XCTAssertEqual(UrlEncoderCodec.transform("%zz%", mode: .decode), .invalid)
    }

    func testEncodeOfWhitespaceOnlyInputIsTreatedAsValue() {
        // " " is truthy in the web `if (!inputVal)` guard → encodes, not empty.
        XCTAssertEqual(UrlEncoderCodec.transform(" ", mode: .encode), .value("%20"))
    }
}

// MARK: - State holder: result derivation + example + telemetry

@MainActor
final class UrlEncoderModelTests: XCTestCase {
    func testDefaultsToEncodeModeAndEmptyResult() {
        let model = UrlEncoderModel()
        XCTAssertEqual(model.mode, .encode)
        XCTAssertEqual(model.result, .empty)
    }

    func testTypingInputEncodes() {
        let model = UrlEncoderModel()
        model.input = "hello world&foo=bar"
        XCTAssertEqual(model.result, .value("hello%20world%26foo%3Dbar"))
    }

    func testSwitchingModeRecomputesResult() {
        let model = UrlEncoderModel(mode: .encode, input: "hello%20world%26foo%3Dbar")
        XCTAssertEqual(model.result, .value("hello%2520world%2526foo%253Dbar"))
        model.select(.decode)
        XCTAssertEqual(model.mode, .decode)
        XCTAssertEqual(model.result, .value("hello world&foo=bar"))
    }

    func testInvalidDecodeYieldsInvalidResult() {
        let model = UrlEncoderModel(mode: .decode, input: "%zz%")
        XCTAssertEqual(model.result, .invalid)
    }

    func testExampleInputTracksMode() {
        let model = UrlEncoderModel(mode: .encode)
        XCTAssertEqual(model.exampleInput, "hello world&foo=bar")
        model.select(.decode)
        XCTAssertEqual(model.exampleInput, "hello%20world%26foo%3Dbar")
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyUrlEncoderTelemetry()
        let model = UrlEncoderModel(telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [UrlEncoderView.surfaceSlug])
    }
}

// MARK: - Accessibility summary content

@MainActor
final class UrlEncoderAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }
    private let keyTap: (String, String) -> String = { key, _ in "L:\(key)" }

    func testEmptySummaryUsesEmptyTitleKey() {
        XCTAssertEqual(
            UrlEncoderAccessibility.outputSummary(for: .empty, localize: keyTap),
            "L:urlEncoder.emptyTitle"
        )
    }

    func testValueSummaryCombinesOutputLabelAndValue() {
        let summary = UrlEncoderAccessibility.outputSummary(for: .value("a%20b"), localize: echo)
        XCTAssertEqual(summary, "Output Label: a%20b")
    }

    func testInvalidSummaryUsesInvalidInputKey() {
        XCTAssertEqual(
            UrlEncoderAccessibility.outputSummary(for: .invalid, localize: keyTap),
            "L:Invalid Input"
        )
    }
}

// MARK: - i18n facade

@MainActor
final class UrlEncoderStringsTests: XCTestCase {
    func testFacadeResolvesToWebFallbackWhenKeyAbsent() {
        // The per-surface table is folded into the catalog at integration time; in
        // isolation the facade returns the web `t(key, default)` English fallback.
        XCTAssertEqual(UrlEncoderStrings.string("Encode", "Encode"), "Encode")
        XCTAssertEqual(UrlEncoderStrings.string("Decode", "Decode"), "Decode")
        XCTAssertEqual(UrlEncoderStrings.string("Invalid Input", "Invalid Input"), "Invalid Input")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyUrlEncoderTelemetry: UrlEncoderTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
