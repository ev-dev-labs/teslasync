//
//  Base64Tool.Tests.swift
//  TeslaSync — P4 feature view · 0011 · Base64Tool (Apple)
//
//  Unit coverage for the Base64Tool surface:
//    • Adapter (input → result) — `Base64Codec` parity with the web `btoa` /
//      `atob` + `try/catch` fallback, plus `Base64Result` flags.
//    • State holder — `Base64ToolModel` result derivation across encode / decode /
//      empty / invalid, mode switching, and the P1/S11 `view.opened` telemetry.
//    • Accessibility — the VoiceOver summary content for each state.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  bundle: the adapter + model are pure, driven directly.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: input → result (port parity with btoa / atob)

final class Base64CodecTests: XCTestCase {
    func testEmptyInputIsEmptyForBothModes() {
        XCTAssertEqual(Base64Codec.transform("", mode: .encode), .empty)
        XCTAssertEqual(Base64Codec.transform("", mode: .decode), .empty)
    }

    func testEncodeAsciiMatchesBtoa() {
        XCTAssertEqual(Base64Codec.transform("Hello World", mode: .encode), .encoded("SGVsbG8gV29ybGQ="))
    }

    func testDecodeValidMatchesAtob() {
        XCTAssertEqual(Base64Codec.transform("SGVsbG8gV29ybGQ=", mode: .decode), .decoded("Hello World"))
    }

    func testEncodeDecodeRoundTrip() {
        let original = "TeslaSync/admin devtools:42 #base64!"
        guard case let .encoded(b64) = Base64Codec.transform(original, mode: .encode) else {
            return XCTFail("expected encode to succeed")
        }
        XCTAssertEqual(Base64Codec.transform(b64, mode: .decode), .decoded(original))
    }

    func testEncodeRejectsNonLatin1LikeBtoa() {
        // The fox emoji is above U+00FF, outside the btoa domain (web throws).
        XCTAssertEqual(Base64Codec.transform("fox \u{1F98A}", mode: .encode), .invalid)
    }

    func testDecodeRejectsMalformedLikeAtob() {
        XCTAssertEqual(Base64Codec.transform("!!! not base64 !!!", mode: .decode), .invalid)
        XCTAssertEqual(Base64Codec.transform("abc", mode: .decode), .invalid)
    }

    func testResultValueAndFlags() {
        XCTAssertEqual(Base64Result.encoded("AAAA").value, "AAAA")
        XCTAssertTrue(Base64Result.decoded("hi").hasOutput)
        XCTAssertNil(Base64Result.empty.value)
        XCTAssertFalse(Base64Result.empty.hasOutput)
        XCTAssertNil(Base64Result.invalid.value)
        XCTAssertTrue(Base64Result.invalid.isInvalid)
        XCTAssertFalse(Base64Result.encoded("x").isInvalid)
    }

    func testModeExampleStrings() {
        XCTAssertEqual(Base64Mode.encode.example, "Hello World")
        XCTAssertEqual(Base64Mode.decode.example, "SGVsbG8gV29ybGQ=")
    }
}

// MARK: - State holder: Base64ToolModel

@MainActor
final class Base64ToolModelTests: XCTestCase {
    func testResultFollowsInputAndMode() {
        let model = Base64ToolModel(mode: .encode, input: "Hello World", telemetry: SpyBase64Telemetry())
        XCTAssertEqual(model.result, .encoded("SGVsbG8gV29ybGQ="))
        model.input = ""
        XCTAssertEqual(model.result, .empty)
    }

    func testSelectSwitchesModeAndRederives() {
        let model = Base64ToolModel(input: "SGVsbG8gV29ybGQ=", telemetry: SpyBase64Telemetry())
        XCTAssertEqual(model.mode, .encode)
        model.select(.decode)
        XCTAssertEqual(model.mode, .decode)
        XCTAssertEqual(model.result, .decoded("Hello World"))
    }

    func testInvalidDecodeSurfacesInvalidResult() {
        let model = Base64ToolModel(mode: .decode, input: "%%%", telemetry: SpyBase64Telemetry())
        XCTAssertEqual(model.result, .invalid)
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpyBase64Telemetry()
        let model = Base64ToolModel(telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [Base64Surface.slug])
        XCTAssertEqual(Base64Surface.slug, "Base64Tool")
    }

    func testExampleFollowsMode() {
        let model = Base64ToolModel(mode: .encode, telemetry: SpyBase64Telemetry())
        XCTAssertEqual(model.example, "Hello World")
        model.select(.decode)
        XCTAssertEqual(model.example, "SGVsbG8gV29ybGQ=")
    }
}

// MARK: - Accessibility: VoiceOver summary

final class Base64AccessibilityTests: XCTestCase {
    /// English-fallback localizer (bundle-free).
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testSummaryIncludesEncodedValue() {
        let summary = Base64Accessibility.summary(mode: .encode, result: .encoded("QUJD"), localize: echo)
        XCTAssertTrue(summary.contains("QUJD"))
        XCTAssertTrue(summary.contains("Output"))
    }

    func testSummaryIncludesDecodedValue() {
        let summary = Base64Accessibility.summary(mode: .decode, result: .decoded("Hi there"), localize: echo)
        XCTAssertTrue(summary.contains("Hi there"))
    }

    func testSummaryInvalid() {
        let summary = Base64Accessibility.summary(mode: .decode, result: .invalid, localize: echo)
        XCTAssertEqual(summary, "Invalid Input")
    }

    func testSummaryEmptyPerMode() {
        XCTAssertEqual(
            Base64Accessibility.summary(mode: .encode, result: .empty, localize: echo),
            "Enter text to Base64-encode"
        )
        XCTAssertEqual(
            Base64Accessibility.summary(mode: .decode, result: .empty, localize: echo),
            "Enter Base64 to decode"
        )
    }
}

// MARK: - Telemetry spy

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpyBase64Telemetry: Base64ToolTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
