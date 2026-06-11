//
//  TripReplayCharts.Tests.swift
//  TeslaSync — P4 feature view · 0273 · TripReplayCharts (Apple)
//
//  State-holder + per-state coverage for the TripReplayCharts surface (the pure adapter /
//  formatting / accessibility coverage + the shared fixtures live in
//  TripReplayCharts.ModelTests.swift; split to honor the file-length budget):
//    • State holder (`TripReplayChartsModel`) — phase across loading / loaded / empty /
//      failed, the P1/S11 `view.opened` telemetry (once), the seek callback (web
//      `onSeekToIndex` reporting the origin index, de-duplicated), the controller-driven
//      playhead (moves without re-seeking), the clamp on data change, the stale
//      auto-refresh (exactly once), and offline keeping the cached trace.
//    • Per-state — the phase that selects each render branch resolves for every prompt
//      state (loading / empty / error / content / stale / offline), and the public
//      surface init holds across them.
//
//  These run in the TeslaSync(/-macOS) XCTest targets, driven through an in-memory source.
//

import XCTest
@testable import TeslaSync

// MARK: - State holder: TripReplayChartsModel

@MainActor final class TripReplayChartsModelTests: XCTestCase {
    private let posix = Locale(identifier: "en_US_POSIX")

    private func makeModel(
        initial: TripReplayChartsUpdate?,
        telemetry: TripReplayChartsTelemetry = SpyTripReplayChartsTelemetry()
    ) -> (TripReplayChartsModel, InMemoryTripReplayChartsSource) {
        let source = InMemoryTripReplayChartsSource(initial: initial)
        let model = TripReplayChartsModel(source: source, telemetry: telemetry, locale: posix)
        return (model, source)
    }

    private func contentUpdate(
        currentIndex: Int = 0,
        connection: TripReplayConnection = .live
    ) -> TripReplayChartsUpdate {
        TripReplayChartsUpdate(
            status: .loaded,
            points: TripReplayFixture.points,
            speedUnit: "mph",
            currentIndex: currentIndex,
            connection: connection
        )
    }

    func testLoadedContentProjectsSamples() {
        let (model, source) = makeModel(initial: contentUpdate())
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.samples.count, 4)
        XCTAssertEqual(model.speedUnit, "mph")
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadedEmptyResolvesEmptyPhase() {
        let (model, _) = makeModel(initial: TripReplayChartsUpdate(status: .loaded, points: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.samples.isEmpty)
    }

    func testLoadingPhaseBeforeData() {
        let (model, _) = makeModel(initial: TripReplayChartsUpdate(status: .loading, points: []))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testFailedPhaseCarriesMessage() {
        let (model, _) = makeModel(initial: TripReplayChartsUpdate(status: .failed("timeout"), points: []))
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpyTripReplayChartsTelemetry()
        let (model, _) = makeModel(initial: nil, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [TripReplaySurface.slug])
    }

    func testScrubSeeksNearestSampleAndReportsOriginIndex() {
        let (model, _) = makeModel(initial: contentUpdate(currentIndex: 0))
        model.start()
        var seeked: [Int] = []
        model.onSeek = { seeked.append($0) }
        model.scrub(toTime: 2.1)
        XCTAssertEqual(model.currentIndex, 2)
        XCTAssertEqual(model.cursorTime, 2)
        XCTAssertEqual(seeked, [25], "seek reports the sample's origin index, not its plot position")
    }

    func testScrubDeduplicatesRepeatedResolutions() {
        let (model, _) = makeModel(initial: contentUpdate(currentIndex: 0))
        model.start()
        var seeked: [Int] = []
        model.onSeek = { seeked.append($0) }
        model.scrub(toTime: 1.9)
        model.scrub(toTime: 2.1)
        XCTAssertEqual(seeked, [25], "resolving to the same sample must forward the seek only once")
    }

    func testSeekToPositionClampsAndReports() {
        let (model, _) = makeModel(initial: contentUpdate(currentIndex: 0))
        model.start()
        var seeked: [Int] = []
        model.onSeek = { seeked.append($0) }
        model.seek(toPosition: 99)
        XCTAssertEqual(model.currentIndex, 3)
        XCTAssertEqual(seeked, [35])
    }

    func testControllerPlayheadMovesWithoutReseeking() {
        let (model, source) = makeModel(initial: contentUpdate(currentIndex: 0))
        model.start()
        var seeked: [Int] = []
        model.onSeek = { seeked.append($0) }
        source.push(contentUpdate(currentIndex: 2))
        XCTAssertEqual(model.currentIndex, 2)
        XCTAssertEqual(model.cursorTime, 2)
        XCTAssertTrue(seeked.isEmpty, "the controller advancing the playhead must not fire the seek callback")
    }

    func testPlayheadClampsWhenTraceShrinks() {
        let (model, source) = makeModel(initial: contentUpdate(currentIndex: 3))
        model.start()
        XCTAssertEqual(model.currentIndex, 3)
        source.push(
            TripReplayChartsUpdate(
                status: .loaded,
                points: Array(TripReplayFixture.points.prefix(2)),
                speedUnit: "mph",
                currentIndex: 5
            )
        )
        XCTAssertEqual(model.currentIndex, 1, "an out-of-range playhead clamps to the last sample")
    }

    func testStaleConnectionAutoRefreshesExactlyOnce() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(contentUpdate(connection: .stale))
        source.push(contentUpdate(connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1, "stale should trigger exactly one guarded auto-refresh")
    }

    func testReturningToLiveReArmsStaleAutoRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(contentUpdate(connection: .stale))
        source.push(contentUpdate(connection: .live))
        source.push(contentUpdate(connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
        _ = model
    }

    func testOfflineKeepsCachedTraceWithoutRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(contentUpdate(connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.samples.count, 4)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testRetryRefreshesSource() {
        let (model, source) = makeModel(initial: TripReplayChartsUpdate(status: .failed("x"), points: []))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopStopsSource() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}

// MARK: - Per-state coverage (the phase that selects each render branch)

@MainActor final class TripReplayChartsStateTests: XCTestCase {
    private func phase(for update: TripReplayChartsUpdate) -> TripReplayPhase {
        let source = InMemoryTripReplayChartsSource(initial: update)
        let model = TripReplayChartsModel(source: source, telemetry: SpyTripReplayChartsTelemetry())
        model.start()
        // Construct the surface for the state to prove the public init holds across phases.
        _ = TripReplayCharts(model: model)
        return model.phase
    }

    func testEveryPromptStateResolvesItsRenderBranch() {
        XCTAssertEqual(phase(for: TripReplayChartsUpdate(status: .loading)), .loading)
        XCTAssertEqual(phase(for: TripReplayChartsUpdate(status: .loaded, points: [])), .empty)
        XCTAssertEqual(phase(for: TripReplayChartsUpdate(status: .failed("nope"))), .error("nope"))
        let content = TripReplayChartsUpdate(status: .loaded, points: TripReplayFixture.points)
        XCTAssertEqual(phase(for: content), .content)
    }

    func testFreshnessVariantsKeepContentVisible() {
        let stale = TripReplayChartsUpdate(status: .loaded, points: TripReplayFixture.points, connection: .stale)
        let offline = TripReplayChartsUpdate(status: .loaded, points: TripReplayFixture.points, connection: .offline)
        XCTAssertEqual(phase(for: stale), .content)
        XCTAssertEqual(phase(for: offline), .content)
    }
}
