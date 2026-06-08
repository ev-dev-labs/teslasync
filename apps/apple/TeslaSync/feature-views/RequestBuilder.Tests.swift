//
//  RequestBuilder.Tests.swift
//  TeslaSync — P4 feature view · 0040 · RequestBuilder (Apple)
//
//  Unit coverage for the RequestBuilder surface:
//    • Adapter — `buildUrl` path/query assembly + `encodeURIComponent`, the
//      `JSON.stringify(_, null, 2)` body printer, the body seed, default seeding,
//      header assembly, field prompts, and the method flags.
//    • State holder — `RequestBuilderModel` seeding, the destructive confirm gate, the
//      send payload, the endpoint re-seed, and the P1/S11 `view.opened` telemetry.
//    • Accessibility — the VoiceOver summaries.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  bundle: the adapter + model are pure, driven directly.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: URL assembly (buildUrl + encodeURIComponent)

final class RequestURLBuilderTests: XCTestCase {
    private func endpoint(_ method: HTTPMethod, _ path: String, _ params: [EndpointParameter]) -> ParsedEndpoint {
        ParsedEndpoint(method: method, path: path, parameters: params)
    }

    func testPathParamSubstituted() {
        let endpoint = endpoint(.get, "/vehicles/{vehicleID}/state", [
            EndpointParameter(name: "vehicleID", location: .path, required: true, type: "string")
        ])
        let url = RequestBuilderAdapter.relativeURL(endpoint: endpoint, params: ["vehicleID": "42"])
        XCTAssertEqual(url, "/vehicles/42/state")
    }

    func testEmptyPathParamKeepsToken() {
        let endpoint = endpoint(.get, "/vehicles/{vehicleID}/state", [
            EndpointParameter(name: "vehicleID", location: .path, required: true, type: "string")
        ])
        XCTAssertEqual(
            RequestBuilderAdapter.relativeURL(endpoint: endpoint, params: [:]),
            "/vehicles/{vehicleID}/state"
        )
    }

    func testQueryAppendedEncodedAndEmptySkipped() {
        let endpoint = endpoint(.get, "/drives", [
            EndpointParameter(name: "limit", location: .query, required: false, type: "integer"),
            EndpointParameter(name: "q", location: .query, required: false, type: "string"),
            EndpointParameter(name: "unused", location: .query, required: false, type: "string")
        ])
        let url = RequestBuilderAdapter.relativeURL(
            endpoint: endpoint,
            params: ["limit": "50", "q": "a b/c", "unused": ""]
        )
        XCTAssertEqual(url, "/drives?limit=50&q=a%20b%2Fc")
    }

    func testNoQueryMeansNoQuestionMark() {
        let endpoint = endpoint(.get, "/drives", [
            EndpointParameter(name: "limit", location: .query, required: false, type: "integer")
        ])
        XCTAssertEqual(RequestBuilderAdapter.relativeURL(endpoint: endpoint, params: [:]), "/drives")
    }

    func testDisplayURLPrefixesApiV1() {
        let endpoint = endpoint(.get, "/system/version", [])
        XCTAssertEqual(
            RequestBuilderAdapter.displayURL(endpoint: endpoint, params: [:]),
            "/api/v1/system/version"
        )
    }

    func testEncodeComponentMatchesJS() {
        XCTAssertEqual(RequestBuilderAdapter.encodeComponent("a b"), "a%20b")
        XCTAssertEqual(RequestBuilderAdapter.encodeComponent("/?=&"), "%2F%3F%3D%26")
        // encodeURIComponent leaves these un-escaped.
        XCTAssertEqual(RequestBuilderAdapter.encodeComponent("-_.!~*'()"), "-_.!~*'()")
    }
}

// MARK: - Adapter: JSON pretty printer (JSON.stringify(_, null, 2))

final class RequestJSONFormatterTests: XCTestCase {
    func testObjectIndentedAndOrdered() {
        let value = RequestJSON.object([
            RequestJSONMember("name", .string("Low battery")),
            RequestJSONMember("threshold", .number("20")),
            RequestJSONMember("enabled", .bool(true))
        ])
        let expected = [
            "{",
            "  \"name\": \"Low battery\",",
            "  \"threshold\": 20,",
            "  \"enabled\": true",
            "}"
        ].joined(separator: "\n")
        XCTAssertEqual(RequestJSONFormatter.pretty(value), expected)
    }

    func testNestedObjectAndArray() {
        let value = RequestJSON.object([
            RequestJSONMember("a", .string("x")),
            RequestJSONMember("b", .array([.number("1"), .number("2")])),
            RequestJSONMember("c", .object([RequestJSONMember("d", .bool(false))]))
        ])
        let expected = [
            "{",
            "  \"a\": \"x\",",
            "  \"b\": [",
            "    1,",
            "    2",
            "  ],",
            "  \"c\": {",
            "    \"d\": false",
            "  }",
            "}"
        ].joined(separator: "\n")
        XCTAssertEqual(RequestJSONFormatter.pretty(value), expected)
    }

    func testEmptyCollectionsCollapse() {
        XCTAssertEqual(RequestJSONFormatter.pretty(.object([])), "{}")
        XCTAssertEqual(RequestJSONFormatter.pretty(.array([])), "[]")
    }

    func testScalarSerialization() {
        XCTAssertEqual(RequestJSONFormatter.pretty(.number("42")), "42")
        XCTAssertEqual(RequestJSONFormatter.pretty(.number("3.14")), "3.14")
        XCTAssertEqual(RequestJSONFormatter.pretty(.bool(false)), "false")
        XCTAssertEqual(RequestJSONFormatter.pretty(.null), "null")
    }

    func testStringEscaping() {
        let value = RequestJSON.string("he said \"hi\"\n\tend")
        XCTAssertEqual(RequestJSONFormatter.pretty(value), "\"he said \\\"hi\\\"\\n\\tend\"")
    }

    func testControlCharacterEscaping() {
        XCTAssertEqual(RequestJSONFormatter.pretty(.string("\u{01}")), "\"\\u0001\"")
    }
}

// MARK: - Adapter: seed / defaults / headers / prompts / method

final class RequestBuilderAdapterTests: XCTestCase {
    func testSeedBodyFromExample() {
        let body = RequestBody(
            contentType: "application/json",
            example: .object([RequestJSONMember("ok", .bool(true))])
        )
        XCTAssertEqual(RequestBuilderAdapter.seedBody(for: body), "{\n  \"ok\": true\n}")
    }

    func testSeedBodyRequiredWithoutExample() {
        XCTAssertEqual(RequestBuilderAdapter.seedBody(for: RequestBody(contentType: "application/json")), "{\n  \n}")
    }

    func testSeedBodyAbsent() {
        XCTAssertEqual(RequestBuilderAdapter.seedBody(for: nil), "")
    }

    func testDefaultParameters() {
        let endpoint = ParsedEndpoint(method: .get, path: "/x", parameters: [
            EndpointParameter(name: "limit", location: .query, required: false, type: "integer", defaultValue: "50"),
            EndpointParameter(name: "q", location: .query, required: false, type: "string")
        ])
        XCTAssertEqual(RequestBuilderAdapter.defaultParameters(for: endpoint), ["limit": "50"])
    }

    func testHeadersFromApiKey() {
        XCTAssertEqual(RequestBuilderAdapter.headers(apiKey: "   "), [:])
        XCTAssertEqual(RequestBuilderAdapter.headers(apiKey: "  secret  "), ["X-API-Key": "secret"])
    }

    func testPathPrompt() {
        let described = EndpointParameter(
            name: "id",
            location: .path,
            required: true,
            type: "string",
            description: "Vehicle id"
        )
        let bare = EndpointParameter(name: "id", location: .path, required: true, type: "string")
        XCTAssertEqual(RequestBuilderAdapter.pathPrompt(described), "Vehicle id")
        XCTAssertEqual(RequestBuilderAdapter.pathPrompt(bare), "string")
    }

    func testQueryPrompt() {
        let withDefault = EndpointParameter(
            name: "limit",
            location: .query,
            required: false,
            type: "integer",
            defaultValue: "50"
        )
        let described = EndpointParameter(
            name: "q",
            location: .query,
            required: false,
            type: "string",
            description: "Search text"
        )
        let bare = EndpointParameter(name: "q", location: .query, required: false, type: "string")
        XCTAssertEqual(RequestBuilderAdapter.queryPrompt(withDefault), "integer (default: 50)")
        XCTAssertEqual(RequestBuilderAdapter.queryPrompt(described), "Search text")
        XCTAssertEqual(RequestBuilderAdapter.queryPrompt(bare), "string")
    }

    func testMethodFlagsAndParse() {
        XCTAssertFalse(HTTPMethod.get.isDestructive)
        XCTAssertTrue(HTTPMethod.post.isDestructive)
        XCTAssertTrue(HTTPMethod.delete.isDestructive)
        XCTAssertEqual(HTTPMethod.get.accentRole, .success)
        XCTAssertEqual(HTTPMethod.delete.accentRole, .danger)
        XCTAssertEqual(HTTPMethod.parse("patch"), .patch)
        XCTAssertNil(HTTPMethod.parse("TRACE"))
    }
}

// MARK: - State holder: RequestBuilderModel

@MainActor
final class RequestBuilderModelTests: XCTestCase {
    private func getEndpoint() -> ParsedEndpoint {
        ParsedEndpoint(method: .get, path: "/vehicles/{vehicleID}/state", parameters: [
            EndpointParameter(name: "vehicleID", location: .path, required: true, type: "string"),
            EndpointParameter(name: "limit", location: .query, required: false, type: "integer", defaultValue: "50")
        ])
    }

    private func postEndpoint() -> ParsedEndpoint {
        ParsedEndpoint(
            method: .post,
            path: "/alerts/rules",
            requestBody: RequestBody(
                contentType: "application/json",
                example: .object([RequestJSONMember("name", .string("x"))])
            )
        )
    }

    func testInitSeedsDefaultsAndBody() {
        let model = RequestBuilderModel(endpoint: postEndpoint(), telemetry: SpyRequestBuilderTelemetry())
        XCTAssertEqual(model.body, "{\n  \"name\": \"x\"\n}")
        let getModel = RequestBuilderModel(endpoint: getEndpoint(), telemetry: SpyRequestBuilderTelemetry())
        XCTAssertEqual(getModel.params["limit"], "50")
        XCTAssertEqual(getModel.body, "")
    }

    func testGetSendsImmediately() {
        let spy = SendSpy()
        let model = RequestBuilderModel(
            endpoint: getEndpoint(),
            telemetry: SpyRequestBuilderTelemetry(),
            onSend: { spy.capture($0) }
        )
        model.params["vehicleID"] = "7"
        model.send()
        XCTAssertFalse(model.confirmOpen)
        XCTAssertEqual(spy.payloads.count, 1)
        XCTAssertEqual(spy.payloads.first?.url, "/vehicles/7/state?limit=50")
        XCTAssertEqual(spy.payloads.first?.method, .get)
        XCTAssertNil(spy.payloads.first?.body)
    }

    func testDestructiveSendRequiresConfirm() {
        let spy = SendSpy()
        let model = RequestBuilderModel(
            endpoint: postEndpoint(),
            telemetry: SpyRequestBuilderTelemetry(),
            onSend: { spy.capture($0) }
        )
        model.send()
        XCTAssertTrue(model.confirmOpen)
        XCTAssertTrue(spy.payloads.isEmpty)
        model.send()
        XCTAssertFalse(model.confirmOpen)
        XCTAssertEqual(spy.payloads.count, 1)
        XCTAssertEqual(spy.payloads.first?.method, .post)
        XCTAssertEqual(spy.payloads.first?.body, "{\n  \"name\": \"x\"\n}")
    }

    func testApiKeyBecomesHeader() {
        let spy = SendSpy()
        let model = RequestBuilderModel(
            endpoint: getEndpoint(),
            telemetry: SpyRequestBuilderTelemetry(),
            onSend: { spy.capture($0) }
        )
        model.apiKey = "  k123  "
        model.send()
        XCTAssertEqual(spy.payloads.first?.headers, ["X-API-Key": "k123"])
    }

    func testCancelClosesConfirm() {
        let model = RequestBuilderModel(endpoint: postEndpoint(), telemetry: SpyRequestBuilderTelemetry())
        model.send()
        XCTAssertTrue(model.confirmOpen)
        model.cancel()
        XCTAssertFalse(model.confirmOpen)
    }

    func testApplyReseedsButKeepsApiKey() {
        let model = RequestBuilderModel(endpoint: getEndpoint(), telemetry: SpyRequestBuilderTelemetry())
        model.apiKey = "keep"
        model.send() // GET is not destructive, confirm stays closed; set it via a post first
        let postModel = RequestBuilderModel(endpoint: postEndpoint(), telemetry: SpyRequestBuilderTelemetry())
        postModel.apiKey = "keep"
        postModel.send()
        XCTAssertTrue(postModel.confirmOpen)
        postModel.apply(endpoint: getEndpoint())
        XCTAssertFalse(postModel.confirmOpen)
        XCTAssertEqual(postModel.params["limit"], "50")
        XCTAssertEqual(postModel.body, "")
        XCTAssertEqual(postModel.apiKey, "keep")
        XCTAssertEqual(model.apiKey, "keep")
    }

    func testDisplayURLPrefix() {
        let model = RequestBuilderModel(endpoint: getEndpoint(), telemetry: SpyRequestBuilderTelemetry())
        model.params["vehicleID"] = "9"
        XCTAssertEqual(model.displayURL, "/api/v1/vehicles/9/state?limit=50")
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyRequestBuilderTelemetry()
        let model = RequestBuilderModel(endpoint: getEndpoint(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [RequestBuilderSurface.slug])
        XCTAssertEqual(RequestBuilderSurface.slug, "RequestBuilder")
    }
}

// MARK: - Accessibility: VoiceOver summaries

final class RequestBuilderAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testURLSummaryIncludesMethodAndURL() {
        let summary = RequestBuilderAccessibility.urlSummary(
            method: .get,
            displayURL: "/api/v1/vehicles",
            localize: echo
        )
        XCTAssertTrue(summary.contains("GET"))
        XCTAssertTrue(summary.contains("/api/v1/vehicles"))
    }

    func testConfirmSummaryInterpolatesMethod() {
        let summary = RequestBuilderAccessibility.confirmSummary(method: .delete, localize: echo)
        XCTAssertEqual(summary, "This is a DELETE request. Are you sure you want to send it?")
    }
}

// MARK: - Spies

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpyRequestBuilderTelemetry: RequestBuilderTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

/// Captures the payloads handed to `onSend`. Single-threaded test use only.
final class SendSpy: @unchecked Sendable {
    private(set) var payloads: [SendRequest] = []

    func capture(_ payload: SendRequest) {
        payloads.append(payload)
    }
}
