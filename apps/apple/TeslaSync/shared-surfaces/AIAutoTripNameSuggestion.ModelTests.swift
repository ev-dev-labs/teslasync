//
//  AIAutoTripNameSuggestion.ModelTests.swift
//  TeslaSync — P4 shared surface · 0007 · AIAutoTripNameSuggestion (Apple)
//
//  State-holder coverage for `AITripNameModel` plus its seams: the P1/S11 `view.opened` telemetry
//  (once + idempotent), the `withAiFeature` gate (off → gatedOff), the phase transitions across
//  every state (loading / idle / thinking / suggestion / error), the `generate()` drive + its
//  `canStart` / in-flight guards, `cancel()` / `stop()` wiring, the connection axis (live / stale /
//  offline) with the one-shot stale auto-refresh (re-armed on return to live), offline keeping the
//  cached suggestion, and the production stream driver's request builder. Driven through the
//  in-memory seams — no network.
//

import XCTest
@testable import TeslaSync

// MARK: - Model (state-holder)

@MainActor
final class AITripNameModelTests: XCTestCase {
    private struct Harness {
        let model: AITripNameModel
        let source: InMemoryAITripNameSource
        let driver: InMemoryAITripNameStreamDriver
    }

    private func makeHarness(
        _ input: AITripNameInput,
        telemetry: AITripNameTelemetry = OSLogAITripNameTelemetry()
    ) -> Harness {
        let source = InMemoryAITripNameSource(initial: input)
        let driver = InMemoryAITripNameStreamDriver()
        let model = AITripNameModel(source: source, streamDriver: driver, telemetry: telemetry)
        return Harness(model: model, source: source, driver: driver)
    }

    func testStartEmitsTelemetryOnceAndAppliesContext() {
        let spy = SpyAITripNameTelemetry()
        let env = makeHarness(AITripNameInput(tripID: "42"), telemetry: spy)
        env.model.start()
        env.model.start()
        XCTAssertEqual(env.model.phase, .idle)
        XCTAssertEqual(spy.surfaces, [AIAutoTripNameSuggestion.surfaceSlug])
        XCTAssertEqual(env.source.startCount, 1)
    }

    func testGatedOffWhenFeatureDisabled() {
        let env = makeHarness(AITripNameInput(featureEnabled: false, tripID: "42"))
        env.model.start()
        XCTAssertEqual(env.model.phase, .gatedOff)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let env = makeHarness(AITripNameInput(tripID: "42", isLoading: true))
        env.model.start()
        XCTAssertEqual(env.model.phase, .loading)
    }

    func testGenerateDrivesStreamWithEncodedPath() {
        let env = makeHarness(AITripNameInput(tripID: "42"))
        env.model.start()
        env.model.generate()
        XCTAssertEqual(env.driver.startCount, 1)
        XCTAssertEqual(env.driver.lastPath, "/ai/trips/42/name/draft")
        XCTAssertEqual(env.model.phase, .thinking)
    }

    func testGenerateIsNoOpWithoutTrip() {
        let env = makeHarness(AITripNameInput(tripID: nil))
        env.model.start()
        env.model.generate()
        XCTAssertEqual(env.driver.startCount, 0)
        XCTAssertEqual(env.model.phase, .idle)
    }

    func testGenerateIsNoOpWhileStreaming() {
        let env = makeHarness(AITripNameInput(tripID: "42"))
        env.model.start()
        env.model.generate()
        env.model.generate()
        XCTAssertEqual(env.driver.startCount, 1)
    }

    func testGenerateIsNoOpWhenOffline() {
        let env = makeHarness(AITripNameInput(tripID: "42", connection: .offline))
        env.model.start()
        env.model.generate()
        XCTAssertEqual(env.driver.startCount, 0)
    }

    func testStreamSnapshotsDriveThinkingThenSuggestion() {
        let env = makeHarness(AITripNameInput(tripID: "42"))
        env.model.start()
        env.model.generate()
        XCTAssertEqual(env.model.phase, .thinking)
        env.driver.push(AiStreamSnapshot(lifecycle: .streaming, text: "Coast"))
        XCTAssertEqual(env.model.phase, .suggestion("Coast"))
        env.driver.push(AiStreamSnapshot(lifecycle: .done, text: "Coast Run"))
        XCTAssertEqual(env.model.phase, .suggestion("Coast Run"))
    }

    func testStreamErrorProjectsErrorPhase() {
        let env = makeHarness(AITripNameInput(tripID: "42"))
        env.model.start()
        env.driver.push(AiStreamSnapshot(lifecycle: .error, error: "stream_http_429"))
        XCTAssertEqual(env.model.phase, .error("stream_http_429"))
    }

    func testRetryReRunsTheStream() {
        let env = makeHarness(AITripNameInput(tripID: "42"))
        env.model.start()
        env.driver.push(AiStreamSnapshot(lifecycle: .error, error: "boom"))
        XCTAssertEqual(env.model.phase, .error("boom"))
        env.model.retry()
        XCTAssertEqual(env.driver.startCount, 1)
        XCTAssertEqual(env.model.phase, .thinking)
    }

    func testCancelDelegatesToDriver() {
        let env = makeHarness(AITripNameInput(tripID: "42"))
        env.model.start()
        env.model.cancel()
        XCTAssertEqual(env.driver.cancelCount, 1)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let env = makeHarness(AITripNameInput(tripID: "42"))
        env.model.start()
        XCTAssertEqual(env.model.connection, .live)
        XCTAssertEqual(env.source.refreshCount, 0)

        env.source.push(AITripNameInput(tripID: "42", connection: .stale))
        XCTAssertEqual(env.model.connection, .stale)
        XCTAssertEqual(env.source.refreshCount, 1)

        env.source.push(AITripNameInput(tripID: "42", connection: .stale))
        XCTAssertEqual(env.source.refreshCount, 1)
    }

    func testStaleAutoRefreshReArmsAfterReturningToLive() {
        let env = makeHarness(AITripNameInput(tripID: "42"))
        env.model.start()
        env.source.push(AITripNameInput(tripID: "42", connection: .stale))
        XCTAssertEqual(env.source.refreshCount, 1)
        env.source.push(AITripNameInput(tripID: "42", connection: .live))
        XCTAssertEqual(env.model.connection, .live)
        env.source.push(AITripNameInput(tripID: "42", connection: .stale))
        XCTAssertEqual(env.source.refreshCount, 2)
    }

    func testOfflineKeepsCachedSuggestionAndDoesNotAutoRefresh() {
        let env = makeHarness(AITripNameInput(tripID: "42"))
        env.model.start()
        env.driver.push(AiStreamSnapshot(lifecycle: .done, text: "Coast Run"))
        env.source.push(AITripNameInput(tripID: "42", connection: .offline))
        XCTAssertEqual(env.model.connection, .offline)
        XCTAssertEqual(env.model.phase, .suggestion("Coast Run"))
        XCTAssertEqual(env.source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let env = makeHarness(AITripNameInput(tripID: "42"))
        env.model.start()
        env.model.refresh()
        XCTAssertEqual(env.source.refreshCount, 1)
    }

    func testStopCancelsStreamAndReArms() {
        let env = makeHarness(AITripNameInput(tripID: "42"))
        env.model.start()
        env.model.stop()
        XCTAssertEqual(env.source.stopCount, 1)
        XCTAssertGreaterThanOrEqual(env.driver.cancelCount, 1)
        env.model.start()
        XCTAssertEqual(env.source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(AIAutoTripNameSuggestion.surfaceSlug, "AIAutoTripNameSuggestion")
    }
}

// MARK: - Live stream driver request builder (production transport)

@MainActor
final class LiveAITripNameStreamDriverTests: XCTestCase {
    func testMakeRequestBuildsSsePost() throws {
        let base = try XCTUnwrap(URL(string: "http://localhost:8080"))
        let request = try XCTUnwrap(LiveAITripNameStreamDriver.makeRequest(
            baseURL: base, path: "/ai/trips/42/name/draft"
        ))
        XCTAssertEqual(request.url?.absoluteString, "http://localhost:8080/api/v1/ai/trips/42/name/draft")
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Accept"), "text/event-stream")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertEqual(request.httpBody, Data("{}".utf8))
    }

    func testMakeRequestStripsTrailingSlashFromBase() throws {
        let base = try XCTUnwrap(URL(string: "http://localhost:8080/"))
        let request = try XCTUnwrap(LiveAITripNameStreamDriver.makeRequest(
            baseURL: base, path: "ai/trips/0/name/draft"
        ))
        XCTAssertEqual(request.url?.absoluteString, "http://localhost:8080/api/v1/ai/trips/0/name/draft")
    }
}

// MARK: - In-memory stream driver (preview/test double)

@MainActor
final class InMemoryAITripNameStreamDriverTests: XCTestCase {
    func testStartEmitsStartedThenScript() {
        let driver = InMemoryAITripNameStreamDriver(script: [
            AiStreamSnapshot(lifecycle: .done, text: "Coast Run")
        ])
        var snapshots: [AiStreamSnapshot] = []
        driver.onUpdate = { snapshots.append($0) }
        driver.start(path: "/ai/trips/42/name/draft")
        XCTAssertEqual(driver.lastPath, "/ai/trips/42/name/draft")
        XCTAssertEqual(snapshots.first, AiStreamSnapshot.started)
        XCTAssertEqual(snapshots.last?.text, "Coast Run")
    }

    func testCancelCounts() {
        let driver = InMemoryAITripNameStreamDriver()
        driver.cancel()
        XCTAssertEqual(driver.cancelCount, 1)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyAITripNameTelemetry: AITripNameTelemetry, @unchecked Sendable {
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
