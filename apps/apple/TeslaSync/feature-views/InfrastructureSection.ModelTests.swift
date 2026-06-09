//
//  InfrastructureSection.ModelTests.swift
//  TeslaSync — P4 feature view · 0248 · InfrastructureSection (Apple)
//
//  State-holder coverage for `InfrastructureModel`: phase across loading / loaded /
//  empty / failed, the SSE + polling + pool projection, the P1/S11 `view.opened`
//  telemetry (once), the silent error retry, the one-shot stale auto-refresh (re-armed
//  on live), and offline keeping the cached snapshot. Driven through in-memory sources;
//  no network, no bundle. Fixtures live in `.Tests`.
//

import XCTest
@testable import TeslaSync

@MainActor final class InfrastructureModelTests: XCTestCase {
    private func makeModel(
        initial: InfraStatusUpdate?,
        telemetry: InfrastructureTelemetry = SpyInfrastructureTelemetry()
    ) -> (InfrastructureModel, InMemoryInfrastructureSource) {
        let source = InMemoryInfrastructureSource(initial: initial)
        let model = InfrastructureModel(source: source, telemetry: telemetry, locale: Locale(identifier: "en_US"))
        return (model, source)
    }

    func testLoadedContentProjectsInfoPoolAndPhase() {
        let (model, source) = makeModel(initial: InfrastructureFixture.loaded())
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.sseConnected)
        XCTAssertEqual(model.sse.endpoint, "wss://telemetry.teslasync.io/v1/stream")
        XCTAssertEqual(model.polling.mode, "streaming")
        XCTAssertEqual(model.poolStats?.count, 3)
        XCTAssertTrue(model.hasPool)
        XCTAssertTrue(model.hasContent)
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadedTelemetryOnlyHasNoPool() {
        let update = InfraStatusUpdate(status: .loaded, telemetry: InfrastructureFixture.streaming, pool: nil)
        let (model, _) = makeModel(initial: update)
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertNil(model.poolStats)
        XCTAssertFalse(model.hasPool)
    }

    func testLoadedPoolOnlyRendersContentWithDisconnectedSse() {
        let update = InfraStatusUpdate(status: .loaded, telemetry: nil, pool: InfrastructureFixture.pool)
        let (model, _) = makeModel(initial: update)
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertFalse(model.sseConnected)
        XCTAssertEqual(model.sse.endpoint, "—")
        XCTAssertEqual(model.polling.mode, "unknown")
        XCTAssertEqual(model.poolStats?.count, 3)
    }

    func testLoadedWithNothingResolvesEmpty() {
        let (model, _) = makeModel(initial: InfraStatusUpdate(status: .loaded))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.poolStats)
        XCTAssertFalse(model.hasContent)
    }

    func testLoadingPhaseBeforeData() {
        let (model, _) = makeModel(initial: InfraStatusUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testFailedPhaseCarriesMessage() {
        let (model, _) = makeModel(initial: InfraStatusUpdate(status: .failed("timeout")))
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpyInfrastructureTelemetry()
        let (model, _) = makeModel(initial: nil, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [InfrastructureSurface.slug])
    }

    func testRetryIsSilentRefresh() {
        let (model, source) = makeModel(initial: InfraStatusUpdate(status: .failed("x")))
        model.start()
        model.retry()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleConnectionAutoRefreshesExactlyOnce() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(InfrastructureFixture.loaded(connection: .stale))
        source.push(InfrastructureFixture.loaded(connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1, "stale should trigger exactly one guarded auto-refresh")
    }

    func testReturningToLiveReArmsStaleAutoRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(InfrastructureFixture.loaded(connection: .stale))
        source.push(InfrastructureFixture.loaded(connection: .live))
        source.push(InfrastructureFixture.loaded(connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
        _ = model
    }

    func testOfflineKeepsCachedSnapshotWithoutRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(InfrastructureFixture.loaded(connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.poolStats?.count, 3)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testAccessibilitySummaryReflectsConnectedState() {
        let (model, _) = makeModel(initial: InfrastructureFixture.loaded())
        model.start()
        XCTAssertEqual(model.accessibilitySummary, "Infrastructure: Connected")
    }

    func testStopStopsSource() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}

// MARK: - Test doubles

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpyInfrastructureTelemetry: InfrastructureTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
