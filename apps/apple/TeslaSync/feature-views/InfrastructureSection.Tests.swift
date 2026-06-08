//
//  InfrastructureSection.Tests.swift
//  TeslaSync — P4 feature view · 0006 · InfrastructureSection (Apple)
//
//  Unit coverage for the InfrastructureSection surface:
//    • Adapter (cached → projection) — `InfraJSONValue` decode + deterministic
//      pretty-print, and `InfraResultProjection` parity with the web
//      `data.error ? failure : success(JSON.stringify(data, null, 2))` branch.
//    • State holder — `InfrastructureModel` phase (loading → ready), per-tool run
//      lifecycle, offline gating, freshness/stale, cached restore, plus the
//      P1/S11 `view.opened` telemetry wiring.
//    • Catalog — the five-tool grid order / kinds / methods (web JSX parity).
//    • Accessibility — the composed VoiceOver label builders.
//
//  These run in the TeslaSync(/-macOS) XCTest scope. They have no network and no
//  real store: the model is driven by `InMemoryInfrastructureSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: decode + pretty-print + projection (web parity)

@MainActor
final class InfrastructureAdapterTests: XCTestCase {
    func testDecodeSortsObjectKeysDeterministically() throws {
        let value = try InfraJSONValue.decode("{\"b\":2,\"a\":1}")
        guard case let .object(members) = value else { return XCTFail("expected object") }
        XCTAssertEqual(members.map(\.key), ["a", "b"])
    }

    func testPrettyPrintMatchesTwoSpaceStringify() throws {
        let value = try InfraJSONValue.decode("{\"b\":2,\"a\":1}")
        XCTAssertEqual(value.prettyPrinted(), "{\n  \"a\": 1,\n  \"b\": 2\n}")
    }

    func testPrettyPrintNestedArraysAndObjects() throws {
        let value = try InfraJSONValue.decode("{\"arr\":[1,2],\"nested\":{\"x\":true}}")
        let expected = "{\n  \"arr\": [\n    1,\n    2\n  ],\n  \"nested\": {\n    \"x\": true\n  }\n}"
        XCTAssertEqual(value.prettyPrinted(), expected)
    }

    func testPrettyPrintEmptyContainers() throws {
        XCTAssertEqual(try InfraJSONValue.decode("{}").prettyPrinted(), "{}")
        XCTAssertEqual(try InfraJSONValue.decode("[]").prettyPrinted(), "[]")
    }

    func testIntegersAndBooleansRenderWithoutDrift() throws {
        let value = try InfraJSONValue.decode("{\"count\":3,\"flag\":true,\"ratio\":1.5}")
        XCTAssertEqual(value.prettyPrinted(), "{\n  \"count\": 3,\n  \"flag\": true,\n  \"ratio\": 1.5\n}")
    }

    func testStringEscaping() throws {
        let value = try InfraJSONValue.decode("{\"q\":\"a\\\"b\\nc\"}")
        XCTAssertEqual(value.prettyPrinted(), "{\n  \"q\": \"a\\\"b\\nc\"\n}")
    }

    func testTruthinessMirrorsJavaScript() {
        XCTAssertFalse(InfraJSONValue.string("").isJSTruthy)
        XCTAssertTrue(InfraJSONValue.string("x").isJSTruthy)
        XCTAssertFalse(InfraJSONValue.integer(0).isJSTruthy)
        XCTAssertTrue(InfraJSONValue.integer(1).isJSTruthy)
        XCTAssertFalse(InfraJSONValue.number(0).isJSTruthy)
        XCTAssertFalse(InfraJSONValue.bool(false).isJSTruthy)
        XCTAssertFalse(InfraJSONValue.null.isJSTruthy)
        XCTAssertTrue(InfraJSONValue.object([]).isJSTruthy)
        XCTAssertTrue(InfraJSONValue.array([]).isJSTruthy)
    }

    func testProjectSuccessCarriesPrettyJSON() throws {
        let value = try InfraJSONValue.decode("{\"tables\":64,\"database\":\"teslasync\"}")
        let result = InfraResultProjection.project(value)
        XCTAssertTrue(result.didSucceed)
        XCTAssertEqual(result, .success(json: "{\n  \"database\": \"teslasync\",\n  \"tables\": 64\n}"))
    }

    func testProjectStringErrorBecomesFailureWithMessage() throws {
        let value = try InfraJSONValue.decode("{\"error\":\"boom\"}")
        XCTAssertEqual(InfraResultProjection.project(value), .failure(message: "boom"))
    }

    func testProjectTruthyNonStringErrorBecomesFailureWithoutMessage() throws {
        let value = try InfraJSONValue.decode("{\"error\":true}")
        XCTAssertEqual(InfraResultProjection.project(value), .failure(message: nil))
    }

    func testProjectFalsyErrorIsSuccess() throws {
        let value = try InfraJSONValue.decode("{\"error\":\"\",\"ok\":true}")
        XCTAssertTrue(InfraResultProjection.project(value).didSucceed)
    }

    func testProjectMalformedBytesBecomesFailureWithFallbackMessage() {
        let malformed = Data("{{".utf8)
        let result = InfraResultProjection.project(data: malformed, decodeErrorMessage: "Request failed")
        XCTAssertEqual(result, .failure(message: "Request failed"))
    }

    func testDecodeThrowsOnMalformedJSON() {
        XCTAssertThrowsError(try InfraJSONValue.decode("not json"))
    }
}

// MARK: - State holder: phase, run lifecycle, offline, freshness, telemetry

@MainActor
final class InfrastructureModelTests: XCTestCase {
    private func makeModel(
        source: InMemoryInfrastructureSource,
        telemetry: InfrastructureTelemetry = OSLogInfrastructureTelemetry(),
        now: @escaping @MainActor () -> Date = { Date() }
    ) -> InfrastructureModel {
        InfrastructureModel(source: source, telemetry: telemetry, now: now)
    }

    func testPhaseStartsLoadingUntilConnectivityArrives() {
        let source = InMemoryInfrastructureSource(initial: nil)
        let model = makeModel(source: source)
        XCTAssertEqual(model.phase, .loading)
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(InfraConnectivityUpdate(connection: .online, updatedAt: Date()))
        XCTAssertEqual(model.phase, .ready)
    }

    func testToolsSeededIdleFromCatalog() {
        let model = makeModel(source: InMemoryInfrastructureSource())
        XCTAssertEqual(model.tools.count, InfraToolCatalog.all.count)
        XCTAssertTrue(model.tools.allSatisfy { $0.phase == .idle })
    }

    func testPerformRunTransitionsToCompletedSuccess() async {
        let json = "{\n  \"ok\": true\n}"
        let source = InMemoryInfrastructureSource(results: ["db-stats": .success(json: json)])
        let model = makeModel(source: source)
        model.start()
        let result = await model.performRun(toolID: "db-stats")
        XCTAssertEqual(result, .success(json: json))
        XCTAssertEqual(source.runCount, 1)
        let state = model.tools.first { $0.id == "db-stats" }
        XCTAssertEqual(state?.result, .success(json: json))
    }

    func testPerformRunForMqttForwardsInputs() async {
        let source = InMemoryInfrastructureSource()
        let model = makeModel(source: source)
        model.start()
        await model.performRun(toolID: "mqtt-test", inputs: InfraToolInputs(topic: "t/topic", message: "hi"))
        XCTAssertEqual(source.lastInputs, InfraToolInputs(topic: "t/topic", message: "hi"))
    }

    func testPerformRunSkippedWhenOffline() async {
        let source = InMemoryInfrastructureSource(initial: InfraConnectivityUpdate(connection: .offline))
        let model = makeModel(source: source)
        model.start()
        let result = await model.performRun(toolID: "db-stats")
        XCTAssertNil(result)
        XCTAssertEqual(source.runCount, 0)
        XCTAssertEqual(model.tools.first { $0.id == "db-stats" }?.phase, .idle)
    }

    func testRestoreSeedsCompletedResults() {
        let model = makeModel(source: InMemoryInfrastructureSource())
        model.start()
        model.restore(["runtime-info": .success(json: "{}")], at: Date())
        XCTAssertEqual(model.tools.first { $0.id == "runtime-info" }?.result, .success(json: "{}"))
    }

    func testIsStaleUsesInjectedNow() throws {
        let fixed = Date(timeIntervalSince1970: 1_000_000)
        let model = makeModel(source: InMemoryInfrastructureSource(), now: { fixed })
        model.start()
        model.restore(["db-stats": .success(json: "{}")], at: fixed.addingTimeInterval(-120))
        let stale = try XCTUnwrap(model.tools.first { $0.id == "db-stats" })
        XCTAssertTrue(model.isStale(stale))
        model.restore(["db-stats": .success(json: "{}")], at: fixed.addingTimeInterval(-5))
        let fresh = try XCTUnwrap(model.tools.first { $0.id == "db-stats" })
        XCTAssertFalse(model.isStale(fresh))
    }

    func testConnectivityUpdatesPropagate() {
        let source = InMemoryInfrastructureSource(initial: InfraConnectivityUpdate(connection: .online))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.connection, .online)
        XCTAssertFalse(model.isOffline)
        source.push(InfraConnectivityUpdate(connection: .offline))
        XCTAssertTrue(model.isOffline)
        source.push(InfraConnectivityUpdate(connection: .stale))
        XCTAssertEqual(model.connection, .stale)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyInfrastructureTelemetry()
        let model = makeModel(source: InMemoryInfrastructureSource(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.opened, ["InfrastructureSection"])
        XCTAssertEqual(InfrastructureSection.surfaceSlug, "InfrastructureSection")
    }

    func testFreshnessHelperWindow() {
        let now = Date()
        XCTAssertFalse(InfraFreshness.isStale(ranAt: nil, now: now))
        XCTAssertFalse(InfraFreshness.isStale(ranAt: now, now: now))
        XCTAssertTrue(InfraFreshness.isStale(ranAt: now.addingTimeInterval(-120), now: now))
    }
}

// MARK: - Catalog: web JSX grid parity

@MainActor
final class InfrastructureCatalogTests: XCTestCase {
    func testCatalogOrderMatchesWebJSX() {
        XCTAssertEqual(
            InfraToolCatalog.all.map(\.id),
            ["db-stats", "migration-status", "mqtt-test", "env-check", "runtime-info"]
        )
    }

    func testCatalogKindsAndMethods() {
        let mqtt = InfraToolCatalog.all.first { $0.id == "mqtt-test" }
        XCTAssertEqual(mqtt?.kind, .mqtt)
        XCTAssertEqual(mqtt?.method, .post)
        XCTAssertEqual(InfraToolCatalog.all.count(where: { $0.kind == .backend }), 4)
        XCTAssertTrue(InfraToolCatalog.all.filter { $0.id != "mqtt-test" }.allSatisfy { $0.method == .get })
    }

    func testCatalogEntriesAreFullyPopulated() {
        for tool in InfraToolCatalog.all {
            XCTAssertFalse(tool.titleKey.isEmpty)
            XCTAssertFalse(tool.titleFallback.isEmpty)
            XCTAssertFalse(tool.descriptionKey.isEmpty)
            XCTAssertFalse(tool.descriptionFallback.isEmpty)
            XCTAssertFalse(tool.systemImage.isEmpty)
        }
    }
}

// MARK: - Accessibility: composed VoiceOver labels

@MainActor
final class InfrastructureAccessibilityTests: XCTestCase {
    /// English-fallback localizer (bundle-free).
    private let echo: (String, String) -> String = { _, fallback in fallback }
    /// Key-revealing localizer so tests can assert the exact i18n key used.
    private let keyTap: (String, String) -> String = { key, _ in "L:\(key)" }

    func testRunLabelComposesActionAndTitle() throws {
        let tool = try XCTUnwrap(InfraToolCatalog.all.first { $0.id == "db-stats" })
        XCTAssertEqual(InfraAccessibility.runLabel(tool: tool, localize: echo), "Run Db Stats")
        XCTAssertEqual(InfraAccessibility.runLabel(tool: tool, localize: keyTap), "L:Run L:Db Stats")
    }

    func testSendAndFreshnessAndStatusLabels() {
        XCTAssertEqual(InfraAccessibility.sendLabel(localize: echo), "Send Test")
        XCTAssertEqual(InfraAccessibility.freshnessLabel(.online, localize: echo), "Online")
        XCTAssertEqual(InfraAccessibility.freshnessLabel(.stale, localize: echo), "Stale")
        XCTAssertEqual(InfraAccessibility.freshnessLabel(.offline, localize: echo), "Offline")
        XCTAssertEqual(InfraAccessibility.statusLabel(.success(json: "{}"), localize: echo), "Success")
        XCTAssertEqual(InfraAccessibility.statusLabel(.failure(message: nil), localize: echo), "Failed")
    }

    func testStringsFacadeFallsBackForUnknownKeys() {
        XCTAssertEqual(InfrastructureStrings.string("Infra Missing Key", "fallback-value"), "fallback-value")
    }
}

// MARK: - Test doubles

/// Records the surface slugs reported to the telemetry seam.
private final class SpyInfrastructureTelemetry: InfrastructureTelemetry, @unchecked Sendable {
    private(set) var opened: [String] = []
    func viewOpened(surface: String) {
        opened.append(surface)
    }
}
