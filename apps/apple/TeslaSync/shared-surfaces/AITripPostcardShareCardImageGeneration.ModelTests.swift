//
//  AITripPostcardShareCardImageGeneration.ModelTests.swift
//  TeslaSync — P4 shared surface · 0056 · AITripPostcardShareCardImageGeneration (Apple)
//
//  State-holder coverage for `AIPostcardModel` plus its seams: the P1/S11 `view.opened` telemetry
//  (once + idempotent), the `withAiFeature` gate (off → gatedOff), the phase transitions across every
//  state (loading / idle / thinking / draft / error), the `generate()` drive + its `canStart` /
//  in-flight guards, the trip + style-hint body it POSTs, `cancel()` / `stop()` wiring, the connection
//  axis (live / stale / offline) with the one-shot stale auto-refresh (re-armed on return to live),
//  offline keeping the cached draft, and the production stream driver's request builder. Driven
//  through the in-memory seams — no network.
//

import XCTest
@testable import TeslaSync

// MARK: - Model (state-holder)

@MainActor
final class AIPostcardModelTests: XCTestCase {
    private struct Harness {
        let model: AIPostcardModel
        let source: InMemoryAIPostcardSource
        let driver: InMemoryAIPostcardStreamDriver
    }

    private func makeHarness(
        _ input: AIPostcardInput,
        telemetry: AIPostcardTelemetry = OSLogAIPostcardTelemetry()
    ) -> Harness {
        let source = InMemoryAIPostcardSource(initial: input)
        let driver = InMemoryAIPostcardStreamDriver()
        let model = AIPostcardModel(source: source, streamDriver: driver, telemetry: telemetry)
        return Harness(model: model, source: source, driver: driver)
    }

    func testStartEmitsTelemetryOnceAndAppliesContext() {
        let spy = SpyAIPostcardTelemetry()
        let env = makeHarness(AIPostcardInput(tripID: 42), telemetry: spy)
        env.model.start()
        env.model.start()
        XCTAssertEqual(env.model.phase, .idle)
        XCTAssertEqual(spy.surfaces, [AITripPostcardShareCardImageGeneration.surfaceSlug])
        XCTAssertEqual(env.source.startCount, 1)
    }

    func testGatedOffWhenFeatureDisabled() {
        let env = makeHarness(AIPostcardInput(featureEnabled: false, tripID: 42))
        env.model.start()
        XCTAssertEqual(env.model.phase, .gatedOff)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let env = makeHarness(AIPostcardInput(tripID: 42, isLoading: true))
        env.model.start()
        XCTAssertEqual(env.model.phase, .loading)
    }

    func testGenerateDrivesStreamWithStaticPathAndTripBody() throws {
        let env = makeHarness(AIPostcardInput(tripID: 42))
        env.model.start()
        env.model.generate()
        XCTAssertEqual(env.driver.startCount, 1)
        XCTAssertEqual(env.driver.lastPath, "/ai/share-cards/trip-image/draft")
        XCTAssertEqual(env.model.phase, .thinking)
        let body = try XCTUnwrap(env.driver.lastBody)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(object["trip_id"] as? Int, 42)
        XCTAssertNil(object["style_hint"])
    }

    func testGenerateIncludesTrimmedStyleHintInBody() throws {
        let env = makeHarness(AIPostcardInput(tripID: 7, styleHint: "  vintage  "))
        env.model.start()
        env.model.generate()
        let body = try XCTUnwrap(env.driver.lastBody)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(object["trip_id"] as? Int, 7)
        XCTAssertEqual(object["style_hint"] as? String, "vintage")
    }

    func testGenerateIsNoOpWithoutTrip() {
        let env = makeHarness(AIPostcardInput(tripID: nil))
        env.model.start()
        env.model.generate()
        XCTAssertEqual(env.driver.startCount, 0)
        XCTAssertEqual(env.model.phase, .idle)
    }

    func testGenerateIsNoOpWithNonPositiveTrip() {
        let env = makeHarness(AIPostcardInput(tripID: 0))
        env.model.start()
        env.model.generate()
        XCTAssertEqual(env.driver.startCount, 0)
    }

    func testGenerateIsNoOpWhileStreaming() {
        let env = makeHarness(AIPostcardInput(tripID: 42))
        env.model.start()
        env.model.generate()
        env.model.generate()
        XCTAssertEqual(env.driver.startCount, 1)
    }

    func testGenerateIsNoOpWhenOffline() {
        let env = makeHarness(AIPostcardInput(tripID: 42, connection: .offline))
        env.model.start()
        env.model.generate()
        XCTAssertEqual(env.driver.startCount, 0)
    }

    func testStreamSnapshotsDriveThinkingThenDraft() {
        let env = makeHarness(AIPostcardInput(tripID: 42))
        env.model.start()
        env.model.generate()
        XCTAssertEqual(env.model.phase, .thinking)
        env.driver.push(AIPostcardStreamSnapshot(lifecycle: .streaming, text: "Coast"))
        XCTAssertEqual(env.model.phase, .draft("Coast"))
        env.driver.push(AIPostcardStreamSnapshot(lifecycle: .done, text: "Coast Run"))
        XCTAssertEqual(env.model.phase, .draft("Coast Run"))
    }

    func testStreamErrorProjectsErrorPhase() {
        let env = makeHarness(AIPostcardInput(tripID: 42))
        env.model.start()
        env.driver.push(AIPostcardStreamSnapshot(lifecycle: .error, error: "stream_http_429"))
        XCTAssertEqual(env.model.phase, .error("stream_http_429"))
    }

    func testRetryReRunsTheStream() {
        let env = makeHarness(AIPostcardInput(tripID: 42))
        env.model.start()
        env.driver.push(AIPostcardStreamSnapshot(lifecycle: .error, error: "boom"))
        XCTAssertEqual(env.model.phase, .error("boom"))
        env.model.retry()
        XCTAssertEqual(env.driver.startCount, 1)
        XCTAssertEqual(env.model.phase, .thinking)
    }

    func testCancelDelegatesToDriver() {
        let env = makeHarness(AIPostcardInput(tripID: 42))
        env.model.start()
        env.model.cancel()
        XCTAssertEqual(env.driver.cancelCount, 1)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let env = makeHarness(AIPostcardInput(tripID: 42))
        env.model.start()
        XCTAssertEqual(env.model.connection, .live)
        XCTAssertEqual(env.source.refreshCount, 0)

        env.source.push(AIPostcardInput(tripID: 42, connection: .stale))
        XCTAssertEqual(env.model.connection, .stale)
        XCTAssertEqual(env.source.refreshCount, 1)

        env.source.push(AIPostcardInput(tripID: 42, connection: .stale))
        XCTAssertEqual(env.source.refreshCount, 1)
    }

    func testStaleAutoRefreshReArmsAfterReturningToLive() {
        let env = makeHarness(AIPostcardInput(tripID: 42))
        env.model.start()
        env.source.push(AIPostcardInput(tripID: 42, connection: .stale))
        XCTAssertEqual(env.source.refreshCount, 1)
        env.source.push(AIPostcardInput(tripID: 42, connection: .live))
        XCTAssertEqual(env.model.connection, .live)
        env.source.push(AIPostcardInput(tripID: 42, connection: .stale))
        XCTAssertEqual(env.source.refreshCount, 2)
    }

    func testOfflineKeepsCachedDraftAndDoesNotAutoRefresh() {
        let env = makeHarness(AIPostcardInput(tripID: 42))
        env.model.start()
        env.driver.push(AIPostcardStreamSnapshot(lifecycle: .done, text: "Coast Run"))
        env.source.push(AIPostcardInput(tripID: 42, connection: .offline))
        XCTAssertEqual(env.model.connection, .offline)
        XCTAssertEqual(env.model.phase, .draft("Coast Run"))
        XCTAssertEqual(env.source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let env = makeHarness(AIPostcardInput(tripID: 42))
        env.model.start()
        env.model.refresh()
        XCTAssertEqual(env.source.refreshCount, 1)
    }

    func testStopCancelsStreamAndReArms() {
        let env = makeHarness(AIPostcardInput(tripID: 42))
        env.model.start()
        env.model.stop()
        XCTAssertEqual(env.source.stopCount, 1)
        XCTAssertGreaterThanOrEqual(env.driver.cancelCount, 1)
        env.model.start()
        XCTAssertEqual(env.source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(
            AITripPostcardShareCardImageGeneration.surfaceSlug,
            "AITripPostcardShareCardImageGeneration"
        )
    }
}

// MARK: - Live stream driver request builder (production transport)

@MainActor
final class LiveAIPostcardStreamDriverTests: XCTestCase {
    func testMakeRequestBuildsSsePostWithBody() throws {
        let base = try XCTUnwrap(URL(string: "http://localhost:8080"))
        let body = AIPostcardEndpoint.encodedDraftBody(
            AIPostcardEndpoint.draftBody(tripID: 42, styleHint: "vintage")
        )
        let request = try XCTUnwrap(LiveAIPostcardStreamDriver.makeRequest(
            baseURL: base, path: "/ai/share-cards/trip-image/draft", body: body
        ))
        XCTAssertEqual(
            request.url?.absoluteString,
            "http://localhost:8080/api/v1/ai/share-cards/trip-image/draft"
        )
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Accept"), "text/event-stream")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertEqual(request.httpBody, body)
    }

    func testMakeRequestStripsTrailingSlashFromBase() throws {
        let base = try XCTUnwrap(URL(string: "http://localhost:8080/"))
        let request = try XCTUnwrap(LiveAIPostcardStreamDriver.makeRequest(
            baseURL: base, path: "ai/share-cards/trip-image/draft", body: Data("{}".utf8)
        ))
        XCTAssertEqual(
            request.url?.absoluteString,
            "http://localhost:8080/api/v1/ai/share-cards/trip-image/draft"
        )
    }
}

// MARK: - In-memory stream driver (preview/test double)

@MainActor
final class InMemoryAIPostcardStreamDriverTests: XCTestCase {
    func testStartEmitsStartedThenScriptAndRecordsBody() {
        let driver = InMemoryAIPostcardStreamDriver(script: [
            AIPostcardStreamSnapshot(lifecycle: .done, text: "Coast Run")
        ])
        var snapshots: [AIPostcardStreamSnapshot] = []
        driver.onUpdate = { snapshots.append($0) }
        let body = Data("{\"trip_id\":42}".utf8)
        driver.start(path: "/ai/share-cards/trip-image/draft", body: body)
        XCTAssertEqual(driver.lastPath, "/ai/share-cards/trip-image/draft")
        XCTAssertEqual(driver.lastBody, body)
        XCTAssertEqual(snapshots.first, AIPostcardStreamSnapshot.started)
        XCTAssertEqual(snapshots.last?.text, "Coast Run")
    }

    func testCancelCounts() {
        let driver = InMemoryAIPostcardStreamDriver()
        driver.cancel()
        XCTAssertEqual(driver.cancelCount, 1)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyAIPostcardTelemetry: AIPostcardTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var surfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    func viewOpened(surface: String) {
        lock.lock()
        storage.append(surface)
        lock.unlock()
    }
}
