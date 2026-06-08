//
//  BackendStatusSection.ModelTests.swift
//  TeslaSync — P4 feature view · 0239 · BackendStatusSection (Apple)
//
//  State-holder coverage for `BackendStatusModel`: phase across loading / loaded /
//  empty / failed, the row + pool + runtime projection, the P1/S11 `view.opened`
//  telemetry (once), the silent error retry, the one-shot stale auto-refresh
//  (re-armed on live), and offline keeping the cached snapshot. Driven through
//  in-memory sources; no network, no bundle. Fixtures live in `.Tests`.
//

import XCTest
@testable import TeslaSync

@MainActor final class BackendStatusModelTests: XCTestCase {
    private func makeModel(
        initial: BackendStatusUpdate?,
        telemetry: BackendStatusTelemetry = SpyBackendStatusTelemetry()
    ) -> (BackendStatusModel, InMemoryBackendStatusSource) {
        let source = InMemoryBackendStatusSource(initial: initial)
        let model = BackendStatusModel(source: source, telemetry: telemetry, locale: Locale(identifier: "en_US"))
        return (model, source)
    }

    func testLoadedContentProjectsRowsPoolRuntimeAndPhase() {
        let (model, source) = makeModel(initial: BackendStatusFixture.loaded())
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.componentRows.count, 4)
        XCTAssertEqual(model.componentCount, 4)
        XCTAssertEqual(model.okCount, 2)
        XCTAssertEqual(model.poolStats?.count, 5)
        XCTAssertEqual(model.runtimeRows?.count, 4)
        XCTAssertTrue(model.hasPool)
        XCTAssertTrue(model.hasRuntime)
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadedWithComponentsOnlyHasNoPoolOrRuntime() {
        let update = BackendStatusUpdate(
            status: .loaded,
            health: BackendHealthDTO(status: "ok", components: BackendStatusFixture.components, system: nil),
            pool: nil,
            version: nil
        )
        let (model, _) = makeModel(initial: update)
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertNil(model.poolStats)
        XCTAssertNil(model.runtimeRows)
        XCTAssertFalse(model.hasPool)
        XCTAssertFalse(model.hasRuntime)
    }

    func testLoadedWithNothingResolvesEmpty() {
        let (model, _) = makeModel(initial: BackendStatusUpdate(status: .loaded))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.componentRows.isEmpty)
        XCTAssertNil(model.poolStats)
        XCTAssertNil(model.runtimeRows)
    }

    func testPoolOnlyRendersContent() {
        let (model, _) = makeModel(initial: BackendStatusUpdate(status: .loaded, pool: BackendStatusFixture.pool))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.poolStats?.count, 5)
    }

    func testLoadingPhaseBeforeData() {
        let (model, _) = makeModel(initial: BackendStatusUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testFailedPhaseCarriesMessage() {
        let (model, _) = makeModel(initial: BackendStatusUpdate(status: .failed("timeout")))
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpyBackendStatusTelemetry()
        let (model, _) = makeModel(initial: nil, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [BackendStatusSurface.slug])
    }

    func testRetryIsSilentRefresh() {
        let (model, source) = makeModel(initial: BackendStatusUpdate(status: .failed("x")))
        model.start()
        model.retry()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleConnectionAutoRefreshesExactlyOnce() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(BackendStatusFixture.loaded(connection: .stale))
        source.push(BackendStatusFixture.loaded(connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1, "stale should trigger exactly one guarded auto-refresh")
    }

    func testReturningToLiveReArmsStaleAutoRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(BackendStatusFixture.loaded(connection: .stale))
        source.push(BackendStatusFixture.loaded(connection: .live))
        source.push(BackendStatusFixture.loaded(connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
        _ = model
    }

    func testOfflineKeepsCachedSnapshotWithoutRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(BackendStatusFixture.loaded(connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.componentRows.count, 4)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testAccessibilitySummaryReflectsTally() {
        let (model, _) = makeModel(initial: BackendStatusFixture.loaded())
        model.start()
        XCTAssertEqual(model.accessibilitySummary, "Backend Status: 2/4 healthy")
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
final class SpyBackendStatusTelemetry: BackendStatusTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
