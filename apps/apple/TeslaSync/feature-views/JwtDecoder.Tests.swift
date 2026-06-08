//
//  JwtDecoder.Tests.swift
//  TeslaSync — P4 feature view · 0018 · JwtDecoder (Apple)
//
//  Unit coverage for the JwtDecoder surface:
//    • Adapter — the decode pipeline (idle / invalid / decoded) and the JSON
//      formatter, pinned to the exact strings the web source produces
//      (parity with features/admin/components/devtools/tools/JwtDecoder.tsx).
//    • State holder — `JwtDecoderModel` input → result, plus the P1/S11
//      `view.opened` telemetry emitted once.
//    • i18n facade — `JwtDecoderStrings` resolves the web fallbacks.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the decode is a pure local computation.
//

import XCTest
@testable import TeslaSync

// MARK: - Sample token (canonical jwt.io example)

private enum JwtDecoderSample {
    static let token =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
            + ".eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ"
            + ".SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"

    static let expectedHeader = """
    {
      "alg": "HS256",
      "typ": "JWT"
    }
    """

    static let expectedPayload = """
    {
      "iat": 1516239022,
      "name": "John Doe",
      "sub": "1234567890"
    }
    """
}

// MARK: - Adapter: decode pipeline

@MainActor final class JwtDecoderAdapterTests: XCTestCase {
    func testEmptyOrWhitespaceInputIsIdle() {
        XCTAssertEqual(JwtDecoderAdapter.decode(""), .idle)
        XCTAssertEqual(JwtDecoderAdapter.decode("    "), .idle)
        XCTAssertEqual(JwtDecoderAdapter.decode("\n\t "), .idle)
    }

    func testFewerThanTwoSegmentsIsInvalid() {
        // No "." → one segment → the web's `parts.length < 2` error.
        XCTAssertEqual(JwtDecoderAdapter.decode("abc"), .invalid)
        XCTAssertEqual(JwtDecoderAdapter.decode("singleSegment"), .invalid)
    }

    func testUndecodableSegmentsAreInvalid() {
        // Valid shape but a segment is not Base64-encoded JSON → the web `catch`.
        XCTAssertEqual(JwtDecoderAdapter.decode("a.b"), .invalid)
        // "hello"."hello" — valid base64, but not JSON.
        XCTAssertEqual(JwtDecoderAdapter.decode("aGVsbG8=.aGVsbG8="), .invalid)
    }

    func testDecodesHeaderAndPayloadToExactJSON() {
        guard case let .decoded(header, payload) = JwtDecoderAdapter.decode(JwtDecoderSample.token) else {
            return XCTFail("expected the sample token to decode")
        }
        XCTAssertEqual(header, JwtDecoderSample.expectedHeader)
        XCTAssertEqual(payload, JwtDecoderSample.expectedPayload)
    }

    func testDecodeIgnoresSurroundingWhitespace() {
        let padded = "  \(JwtDecoderSample.token)\n"
        guard case let .decoded(header, _) = JwtDecoderAdapter.decode(padded) else {
            return XCTFail("expected the padded token to decode")
        }
        XCTAssertEqual(header, JwtDecoderSample.expectedHeader)
    }

    // MARK: Base64 — URL-safe superset of `atob`

    func testBase64SegmentAcceptsURLSafeAlphabet() {
        // The URL-safe segment must decode to the same bytes as its standard form.
        let urlSafe = JwtDecoderAdapter.decodeBase64Segment("--__")
        let standard = Data(base64Encoded: "++//")
        XCTAssertNotNil(urlSafe)
        XCTAssertEqual(urlSafe, standard)
    }

    func testBase64SegmentToleratesMissingPadding() {
        // {"a":1} → standard base64 "eyJhIjoxfQ==" ; the unpadded form must work.
        let unpadded = JwtDecoderAdapter.decodeBase64Segment("eyJhIjoxfQ")
        XCTAssertEqual(unpadded.flatMap { String(data: $0, encoding: .utf8) }, #"{"a":1}"#)
    }
}

// MARK: - JSON formatter (parity with JSON.stringify(_, null, 2))

@MainActor final class JwtDecoderFormatterTests: XCTestCase {
    private func format(_ json: String) throws -> String {
        let object = try JSONSerialization.jsonObject(with: Data(json.utf8), options: [.fragmentsAllowed])
        return JwtJSONFormatter.format(object)
    }

    func testRendersTypesLikeJSStringify() throws {
        let output = try format(#"{"b":true,"a":false,"n":null,"num":3.14,"int":42,"arr":[1,2,3]}"#)
        let expected = """
        {
          "a": false,
          "arr": [
            1,
            2,
            3
          ],
          "b": true,
          "int": 42,
          "n": null,
          "num": 3.14
        }
        """
        XCTAssertEqual(output, expected)
    }

    func testLeavesSlashesAndUnicodeUnescaped() throws {
        let output = try format(#"{"url":"https://a/b","t":"café→"}"#)
        XCTAssertTrue(output.contains("https://a/b"), "forward slashes must not be escaped")
        XCTAssertTrue(output.contains("café→"), "non-ASCII must be preserved")
    }

    func testEscapesControlCharactersAndQuotes() throws {
        let output = try format(#"{"k":"line1\nq\"end"}"#)
        XCTAssertTrue(output.contains(#"\n"#))
        XCTAssertTrue(output.contains(#"\""#))
    }

    func testIntegralDoublesDropTrailingZero() throws {
        // JSON 2.0 parses to a double; JSON.stringify renders it as "2".
        XCTAssertEqual(try format("2.0"), "2")
    }

    func testEmptyContainers() throws {
        XCTAssertEqual(try format("{}"), "{}")
        XCTAssertEqual(try format("[]"), "[]")
    }
}

// MARK: - State holder: input → result + telemetry

@MainActor final class JwtDecoderModelTests: XCTestCase {
    func testEmptyInputIsIdle() {
        let model = JwtDecoderModel()
        XCTAssertEqual(model.result, .idle)
    }

    func testInputDrivesDecodedResult() {
        let model = JwtDecoderModel(input: JwtDecoderSample.token)
        guard case let .decoded(header, payload) = model.result else {
            return XCTFail("expected decoded result")
        }
        XCTAssertEqual(header, JwtDecoderSample.expectedHeader)
        XCTAssertEqual(payload, JwtDecoderSample.expectedPayload)
    }

    func testMutatingInputRecomputesResult() {
        let model = JwtDecoderModel()
        XCTAssertEqual(model.result, .idle)
        model.input = "nope"
        XCTAssertEqual(model.result, .invalid)
        model.input = JwtDecoderSample.token
        if case .decoded = model.result {} else {
            XCTFail("expected decoded result after setting a valid token")
        }
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyJwtDecoderTelemetry()
        let model = JwtDecoderModel(telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [JwtDecoderView.surfaceSlug])
        XCTAssertEqual(JwtDecoderView.surfaceSlug, "JwtDecoder")
        XCTAssertEqual(JwtDecoderSurface.slug, "JwtDecoder")
    }
}

// MARK: - i18n facade

@MainActor final class JwtDecoderStringsTests: XCTestCase {
    func testFacadeResolvesWebFallbacks() {
        // The per-surface table is folded in at integration; in the test bundle
        // the facade returns the web English fallback for each source key.
        XCTAssertEqual(JwtDecoderStrings.string("Jwt Decoder", "JWT Decoder"), "JWT Decoder")
        XCTAssertEqual(JwtDecoderStrings.string("Jwt Header", "Header"), "Header")
        XCTAssertEqual(JwtDecoderStrings.string("Jwt Payload", "Payload"), "Payload")
        XCTAssertEqual(JwtDecoderStrings.string("Invalid Jwt", "Invalid JWT"), "Invalid JWT")
        XCTAssertEqual(JwtDecoderStrings.string("Jwt Input", "JWT"), "JWT")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyJwtDecoderTelemetry: JwtDecoderTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
