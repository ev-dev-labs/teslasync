//
//  SOCRouteChart.ModelTests.swift
//  TeslaSync — P4 feature view · 0176 · SOCRouteChart (Apple)
//
//  State-holder coverage for the SOCRouteChart surface (`SOCRouteChartModel`): phase
//  across loading / loaded / empty / single-point / failed, the P1/S11 `view.opened`
//  telemetry (exactly once), the tooltip cursor (move + auto-clear on data change),
//  the stale auto-refresh (exactly once, re-armed on returning to live), offline
//  keeping the cached curve, and the retry / stop plumbing. Driven through an
//  in-memory source — no network, no bundle.
//

import XCTest
@testable import TeslaSync

@MainActor final class SOCRouteChartModelTests: XCTestCase {
    private let posix = Locale(identifier: "en_US_POSIX")

    private let curve: [SOCRoutePoint] = [
        SOCRoutePoint(distanceM: 0, soc: 90),
        SOCRoutePoint(distanceM: 80, soc: 58),
        SOCRoutePoint(distanceM: 120, soc: 22)
    ]

    private let stops: [SOCRouteChargeStop] = [
        SOCRouteChargeStop(chargeFromSoc: 22, name: "Harris Ranch")
    ]

    private func makeModel(
        initial: SOCRouteChartUpdate?,
        telemetry: SOCRouteChartTelemetry = SpySOCRouteChartTelemetry()
    ) -> (SOCRouteChartModel, InMemorySOCRouteChartSource) {
        let source = InMemorySOCRouteChartSource(initial: initial)
        let model = SOCRouteChartModel(source: source, telemetry: telemetry, locale: posix)
        return (model, source)
    }

    private func loadedUpdate(connection: SOCRouteChartConnection = .live) -> SOCRouteChartUpdate {
        SOCRouteChartUpdate(
            status: .loaded,
            socCurve: curve,
            chargeStops: stops,
            minArrivalSoc: 20,
            connection: connection
        )
    }

    func testLoadedContentProjectsSamplesMarkersAndMinArrival() {
        let (model, source) = makeModel(initial: loadedUpdate())
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.samples.count, 3)
        XCTAssertEqual(model.markers.count, 1)
        XCTAssertEqual(model.markers.first?.distance, 120)
        XCTAssertEqual(model.minArrivalSoc, 20)
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadedEmptyResolvesEmptyPhase() {
        let (model, _) = makeModel(initial: SOCRouteChartUpdate(status: .loaded, socCurve: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.samples.isEmpty)
        XCTAssertTrue(model.markers.isEmpty)
    }

    func testSingleSampleResolvesContentPhase() {
        // Web empty branch is `length === 0`, so a single point still renders.
        let (model, _) = makeModel(initial: SOCRouteChartUpdate(status: .loaded, socCurve: [curve[0]]))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.samples.count, 1)
    }

    func testLoadingPhaseBeforeData() {
        let (model, _) = makeModel(initial: SOCRouteChartUpdate(status: .loading, socCurve: []))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testFailedPhaseCarriesMessage() {
        let (model, _) = makeModel(initial: SOCRouteChartUpdate(status: .failed("timeout"), socCurve: []))
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpySOCRouteChartTelemetry()
        let (model, _) = makeModel(initial: nil, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [SOCRouteChartSurface.slug])
    }

    func testMoveCursorSetsAndClearsSelectedDistance() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(loadedUpdate())
        model.moveCursor(to: 80)
        XCTAssertEqual(model.selectedDistance, 80)
        model.moveCursor(to: nil)
        XCTAssertNil(model.selectedDistance)
    }

    func testCursorAutoClearsWhenSamplesRemovedOnDataChange() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(loadedUpdate())
        model.moveCursor(to: 80)
        XCTAssertEqual(model.selectedDistance, 80)
        // New data with no points → the lingering tooltip is dropped.
        source.push(SOCRouteChartUpdate(status: .loaded, socCurve: []))
        XCTAssertNil(model.selectedDistance)
    }

    func testStaleConnectionAutoRefreshesExactlyOnce() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(loadedUpdate(connection: .stale))
        source.push(loadedUpdate(connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1, "stale should trigger exactly one guarded auto-refresh")
    }

    func testReturningToLiveReArmsStaleAutoRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(loadedUpdate(connection: .stale))
        source.push(loadedUpdate(connection: .live))
        source.push(loadedUpdate(connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
        _ = model
    }

    func testOfflineKeepsCachedCurveWithoutRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(loadedUpdate(connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.samples.count, 3)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testRetryRefreshesSource() {
        let (model, source) = makeModel(initial: SOCRouteChartUpdate(status: .failed("x"), socCurve: []))
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

// MARK: - Telemetry spy

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpySOCRouteChartTelemetry: SOCRouteChartTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
