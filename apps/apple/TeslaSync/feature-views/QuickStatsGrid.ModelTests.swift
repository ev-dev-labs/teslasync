//
//  QuickStatsGrid.ModelTests.swift
//  TeslaSync — P4 feature view · 0295 · QuickStatsGrid (Apple)
//
//  State-holder coverage for the QuickStatsGrid surface: the `QuickStatsModel` wiring, the
//  P1/S11 `view.opened` telemetry (emitted once), the stale → one-shot auto-refresh
//  transition (re-armed after returning live), the offline no-refresh rule, and the
//  start / stop / refresh delegation. The model is driven by `InMemoryQuickStatsSource`;
//  there is no network and no real store.
//

import XCTest
@testable import TeslaSync

private func metricEN() -> UnitPreferences {
    var prefs = UnitPreferences.metric
    prefs.locale = "en_US"
    return prefs
}

private let sampleState = QuickStatsVehicleState(
    batteryLevel: 82,
    ratedRange: 386_000,
    odometer: 32_500_000,
    speed: 27.78,
    insideTemp: 21.5,
    outsideTemp: 14,
    power: 42
)

// MARK: - State holder: wiring, telemetry, freshness

@MainActor
final class QuickStatsModelTests: XCTestCase {
    private func makeModel(
        _ input: QuickStatsInput,
        telemetry: QuickStatsTelemetry = OSLogQuickStatsTelemetry()
    ) -> (QuickStatsModel, InMemoryQuickStatsSource) {
        let source = InMemoryQuickStatsSource(initial: input)
        let model = QuickStatsModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private var dataInput: QuickStatsInput {
        QuickStatsInput(state: sampleState, status: "driving", units: metricEN())
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyQuickStatsTelemetry()
        let (model, source) = makeModel(dataInput, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.tiles.count, 8)
        XCTAssertEqual(model.status, "driving")
        XCTAssertEqual(spy.surfaces, [QuickStatsGrid.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(QuickStatsInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertTrue(model.tiles.isEmpty)
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(QuickStatsInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(dataInput)
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.tiles.count, 8)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(dataInput)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(QuickStatsInput(state: sampleState, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        // Staying stale must not re-trigger the one-shot auto-refresh.
        source.push(QuickStatsInput(state: sampleState, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleReArmsAfterReturningLive() {
        let (model, source) = makeModel(dataInput)
        model.start()
        source.push(QuickStatsInput(state: sampleState, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(QuickStatsInput(state: sampleState, connection: .live))
        source.push(QuickStatsInput(state: sampleState, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
        _ = model
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(dataInput)
        model.start()
        source.push(QuickStatsInput(state: sampleState, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(dataInput)
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(dataInput)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(QuickStatsGrid.surfaceSlug, "QuickStatsGrid")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyQuickStatsTelemetry: QuickStatsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
