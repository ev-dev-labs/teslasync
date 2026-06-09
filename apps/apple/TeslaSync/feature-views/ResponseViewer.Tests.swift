//
//  ResponseViewer.Tests.swift
//  TeslaSync — P4 feature view · 0041 · ResponseViewer (Apple)
//
//  Host-free unit coverage for the `ResponseViewer` surface. The web source is
//  presentational, so the meaningful surface area is the pure adapters: the
//  cached-response → projection mapping, the status / method / byte helpers, the
//  `generateSnippet` parity, the per-state derivation, the accessibility labels,
//  and the `view.opened` telemetry slug. No rendering / no KMP runtime required.
//

import XCTest
@testable import TeslaSync

@MainActor final class ResponseViewerTests: XCTestCase {
    // MARK: - State derivation (per-state "snapshot" without a host)

    func testStateIsLoadingWhenLoadingRegardlessOfResponse() {
        XCTAssertEqual(ResponseViewerState(response: nil, loading: true), .loading)
        XCTAssertEqual(ResponseViewerState(response: Self.okResponse, loading: true), .loading)
    }

    func testStateIsEmptyWhenNotLoadingAndNoResponse() {
        XCTAssertEqual(ResponseViewerState(response: nil, loading: false), .empty)
    }

    func testStateIsLoadedWhenResponsePresent() {
        let state = ResponseViewerState(response: Self.okResponse, loading: false)
        guard case let .loaded(projection) = state else {
            return XCTFail("expected .loaded, got \(state)")
        }
        XCTAssertEqual(projection.statusCode, 200)
    }

    // MARK: - Response projection (adapter: cached → projection)

    func testProjectionStatusLineTrimsReasonPhrase() {
        XCTAssertEqual(ResponseProjection.statusLine(code: 200, text: "OK"), "200 OK")
        XCTAssertEqual(ResponseProjection.statusLine(code: 204, text: ""), "204")
        XCTAssertEqual(ResponseProjection.statusLine(code: 204, text: "  "), "204")
    }

    func testProjectionMetaLineMatchesWebFormat() {
        XCTAssertEqual(ResponseProjection.metaLine(durationMs: 128, size: 2048), "128ms · 2.0 KB")
    }

    func testProjectionSortsHeadersCaseInsensitively() {
        let items = ResponseProjection.headerItems(from: [
            "X-Request-Id": "1",
            "content-type": "application/json",
            "Cache-Control": "no-store"
        ])
        XCTAssertEqual(items.map(\.name), ["Cache-Control", "content-type", "X-Request-Id"])
    }

    func testProjectionMakeBindsEveryField() {
        let projection = ResponseProjection.make(from: Self.okResponse)
        XCTAssertEqual(projection.statusLine, "200 OK")
        XCTAssertEqual(projection.statusClass, .success)
        XCTAssertEqual(projection.metaLine, "128ms · 2.0 KB")
        XCTAssertEqual(projection.headerCount, 2)
        XCTAssertTrue(projection.hasHeaders)
    }

    // MARK: - Display body (web json-pretty vs raw)

    func testDisplayBodyPrettyPrintsJSONObject() throws {
        let pretty = try XCTUnwrap(ResponseProjection.prettyJSON("{\"a\":1}"))
        XCTAssertTrue(pretty.contains("\n"), "pretty JSON should be multi-line")
        let reparsed = try JSONSerialization.jsonObject(with: Data(pretty.utf8)) as? [String: Int]
        XCTAssertEqual(reparsed, ["a": 1])
    }

    func testDisplayBodyPrettyPrintsJSONArray() throws {
        let pretty = try XCTUnwrap(ResponseProjection.prettyJSON("[1,2,3]"))
        XCTAssertTrue(pretty.hasPrefix("["))
        XCTAssertTrue(pretty.contains("\n"))
    }

    func testDisplayBodyReturnsNilForNonStructuredJSON() {
        XCTAssertNil(ResponseProjection.prettyJSON("\"just a string\""))
        XCTAssertNil(ResponseProjection.prettyJSON("not json at all"))
        XCTAssertNil(ResponseProjection.prettyJSON(""))
    }

    func testDisplayBodyUsesRawTextForNonJSONContentType() {
        let raw = "plain text body"
        XCTAssertEqual(ResponseProjection.displayBody(contentType: "text/plain", bodyText: raw), raw)
    }

    func testDisplayBodyFallsBackToRawWhenJSONUnparseable() {
        let raw = "{not valid json"
        XCTAssertEqual(ResponseProjection.displayBody(contentType: "application/json", bodyText: raw), raw)
    }

    // MARK: - Status classification (web statusColor / statusBg thresholds)

    func testStatusClassThresholds() {
        XCTAssertEqual(ResponseStatusClass(status: 200), .success)
        XCTAssertEqual(ResponseStatusClass(status: 299), .success)
        XCTAssertEqual(ResponseStatusClass(status: 300), .redirect)
        XCTAssertEqual(ResponseStatusClass(status: 399), .redirect)
        XCTAssertEqual(ResponseStatusClass(status: 400), .error)
        XCTAssertEqual(ResponseStatusClass(status: 500), .error)
    }

    func testStatusClassOpacitiesMatchWebScale() {
        XCTAssertEqual(ResponseStatusClass.backgroundOpacity, 0.10, accuracy: 0.0001)
        XCTAssertEqual(ResponseStatusClass.borderOpacity, 0.20, accuracy: 0.0001)
    }

    // MARK: - Method palette (web chip colours)

    func testMethodToneBucketsAreCaseInsensitive() {
        XCTAssertEqual(HTTPMethodTone(method: "GET"), .get)
        XCTAssertEqual(HTTPMethodTone(method: "post"), .post)
        XCTAssertEqual(HTTPMethodTone(method: "Delete"), .delete)
        XCTAssertEqual(HTTPMethodTone(method: "PATCH"), .other)
    }

    // MARK: - Byte formatting (web formatBytes)

    func testByteFormattingMatchesWeb() {
        XCTAssertEqual(ResponseByteFormat.string(512), "512 B")
        XCTAssertEqual(ResponseByteFormat.string(1024), "1.0 KB")
        XCTAssertEqual(ResponseByteFormat.string(1536), "1.5 KB")
        XCTAssertEqual(ResponseByteFormat.string(1_048_576), "1.0 MB")
        XCTAssertEqual(ResponseByteFormat.string(2_621_440), "2.5 MB")
    }

    // MARK: - History projection + accessibility label

    func testHistoryProjectionAccessibilityLabelMirrorsWebTitle() {
        let entry = HistoryEntry(method: "GET", path: "/api/v1/vehicles", status: 200, durationMs: 128, timestamp: "")
        let projection = HistoryEntryProjection.make(from: entry)
        XCTAssertEqual(projection.accessibilityLabel, "GET /api/v1/vehicles → 200 (128ms)")
        XCTAssertEqual(projection.durationLabel, "128ms")
        XCTAssertEqual(projection.methodTone, .get)
        XCTAssertEqual(projection.statusClass, .success)
    }

    // MARK: - Snippet generator (web generateSnippet parity)

    func testSnippetHasBodyRequiresNonEmptyBodyAndNonGET() {
        XCTAssertTrue(ResponseSnippet.hasBody("{}", method: "POST"))
        XCTAssertFalse(ResponseSnippet.hasBody("{}", method: "GET"))
        XCTAssertFalse(ResponseSnippet.hasBody("", method: "POST"))
        XCTAssertFalse(ResponseSnippet.hasBody(nil, method: "POST"))
    }

    func testCurlSnippetGET() {
        let snippet = ResponseSnippet.generate(method: "GET", url: "https://h/p", format: .curl, body: nil)
        let expected = "# Add auth: -H \"X-API-Key: YOUR_KEY\" or use session cookies\n"
            + "curl -X GET 'https://h/p'"
        XCTAssertEqual(snippet, expected)
    }

    func testCurlSnippetPOSTWithBody() {
        let snippet = ResponseSnippet.generate(method: "POST", url: "https://h/p", format: .curl, body: "{\"x\":1}")
        let expected = "# Add auth: -H \"X-API-Key: YOUR_KEY\" or use session cookies\n"
            + "curl -X POST 'https://h/p' \\\n"
            + "  -H 'Content-Type: application/json' \\\n"
            + "  -d '{\"x\":1}'"
        XCTAssertEqual(snippet, expected)
    }

    func testJavaScriptSnippetPOSTWithBody() {
        let snippet = ResponseSnippet.generate(
            method: "POST",
            url: "https://h/p",
            format: .javascript,
            body: "{\"x\":1}"
        )
        let expected = [
            "// Auth: include credentials or X-API-Key header",
            "const response = await fetch('https://h/p', {",
            "  method: 'POST',",
            "  headers: { 'Content-Type': 'application/json' },",
            "  body: JSON.stringify({\"x\":1}),",
            "});",
            "const data = await response.json();"
        ].joined(separator: "\n")
        XCTAssertEqual(snippet, expected)
    }

    func testJavaScriptSnippetGETOmitsBody() {
        let snippet = ResponseSnippet.generate(method: "GET", url: "https://h/p", format: .javascript, body: nil)
        XCTAssertFalse(snippet.contains("JSON.stringify"))
        XCTAssertTrue(snippet.contains("method: 'GET',"))
    }

    func testPythonSnippetGET() {
        let snippet = ResponseSnippet.generate(method: "GET", url: "https://h/p", format: .python, body: nil)
        let expected = [
            "# Auth: pass headers={\"X-API-Key\": \"YOUR_KEY\"}",
            "import requests",
            "",
            "response = requests.get('https://h/p')",
            "data = response.json()"
        ].joined(separator: "\n")
        XCTAssertEqual(snippet, expected)
    }

    func testPythonSnippetPOSTIncludesJSONArg() {
        let snippet = ResponseSnippet.generate(method: "POST", url: "https://h/p", format: .python, body: "{\"x\":1}")
        XCTAssertTrue(snippet.contains("response = requests.post('https://h/p', json={\"x\":1})"))
    }

    func testGoSnippetGET() {
        let snippet = ResponseSnippet.generate(method: "GET", url: "https://h/p", format: .go, body: nil)
        let expected = [
            "// Auth: add X-API-Key header to the request",
            "resp, err := http.Get(\"https://h/p\")",
            "if err != nil { log.Fatal(err) }",
            "defer resp.Body.Close()"
        ].joined(separator: "\n")
        XCTAssertEqual(snippet, expected)
    }

    func testGoSnippetPOSTFallsBackToEmptyObjectBody() {
        let snippet = ResponseSnippet.generate(method: "POST", url: "https://h/p", format: .go, body: nil)
        XCTAssertTrue(snippet.contains("body := strings.NewReader(`{}`)"))
        XCTAssertTrue(snippet.contains("http.NewRequest(\"POST\", \"https://h/p\", body)"))
    }

    func testSnippetFormatLabels() {
        XCTAssertEqual(SnippetFormat.allCases.map(\.label), ["cURL", "JavaScript", "Python", "Go"])
    }

    // MARK: - Localization facade

    func testStringsFacadeReturnsFallbackForUnknownKey() {
        XCTAssertEqual(ResponseViewerStrings.table, "ResponseViewer")
        let resolved = ResponseViewerStrings.string("responseViewer.__missing__", "Fallback Value")
        XCTAssertEqual(resolved, "Fallback Value")
    }

    // MARK: - Telemetry (P1/S11 view.opened)

    func testSurfaceSlugIsStable() {
        XCTAssertEqual(ResponseViewerSurface.slug, "ResponseViewer")
    }

    func testReportOpenEmitsSurfaceSlug() {
        let spy = SpyResponseViewerTelemetry()
        ResponseViewerSurface.reportOpen(to: spy)
        ResponseViewerSurface.reportOpen(to: spy)
        XCTAssertEqual(spy.openedSurfaces, ["ResponseViewer", "ResponseViewer"])
    }

    // MARK: - Fixtures

    private static let okResponse = ApiResponse(
        status: 200,
        statusText: "OK",
        headers: ["Content-Type": "application/json", "X-Request-Id": "abc"],
        bodyText: "{\"ok\":true}",
        durationMs: 128,
        size: 2048,
        contentType: "application/json"
    )
}

// MARK: - Test doubles

/// Records opened surfaces so the `view.opened` contract can be asserted without
/// an `os_log` round-trip. Single-threaded test usage only.
private final class SpyResponseViewerTelemetry: ResponseViewerTelemetry, @unchecked Sendable {
    private(set) var openedSurfaces: [String] = []

    func viewOpened(surface: String) {
        openedSurfaces.append(surface)
    }
}
