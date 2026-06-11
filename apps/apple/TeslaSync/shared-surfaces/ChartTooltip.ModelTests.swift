//
//  ChartTooltip.ModelTests.swift
//  TeslaSync — P4 shared surface · 0070 · ChartTooltip (Apple)
//
//  State-holder coverage for `ChartTooltipModel` plus its seams: the P1/S11 `view.opened`
//  telemetry (once + idempotent), the phase transitions across every state
//  (loading / empty / error / data), the connection axis (live / stale / offline) with the
//  one-shot stale auto-refresh (re-armed on return to live), offline keeping the cached readout,
//  the manual refresh / stop-and-restart wiring, and the live source's selection re-emit. Driven
//  through the in-memory seams — no network.
//

import XCTest
@testable import TeslaSync

private func series(_ id: String, _ name: String, _ value: Double) -> ChartTooltipSeries {
    ChartTooltipSeries(id: id, name: name, value: .number(value), unit: "%", colorIndex: 0)
}

// MARK: - Model (state-holder)

@MainActor
final class ChartTooltipModelTests: XCTestCase {
    private let active = ChartTooltipInput(
        isActive: true,
        label: .text("2026-04-04T14:30:00Z"),
        series: [series("soc", "Battery", 72.4), series("spd", "Speed", 96)]
    )

    private func makeModel(
        _ input: ChartTooltipInput,
        telemetry: ChartTooltipTelemetry = OSLogChartTooltipTelemetry()
    ) -> (ChartTooltipModel, InMemoryChartTooltipSource) {
        let source = InMemoryChartTooltipSource(initial: input)
        let model = ChartTooltipModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyChartTooltipTelemetry()
        let (model, source) = makeModel(active, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.series.count, 2)
        XCTAssertEqual(spy.surfaces, [ChartTooltip.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(ChartTooltipInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testInactiveProjectsEmpty() {
        let (model, _) = makeModel(ChartTooltipInput(isActive: false, series: [series("soc", "Battery", 1)]))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testErrorInputProjectsErrorPhase() {
        let (model, _) = makeModel(ChartTooltipInput(errorMessage: "boom"))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testPushUpdatesProjectionFromLoadingToData() {
        let (model, source) = makeModel(ChartTooltipInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(active)
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.resolved.series.count, 2)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(active)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(ChartTooltipInput(
            isActive: true, label: active.label, series: active.series, connection: .stale
        ))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        // Staying stale must not re-trigger the one-shot auto-refresh.
        source.push(ChartTooltipInput(
            isActive: true, label: active.label, series: active.series, connection: .stale
        ))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleAutoRefreshReArmsAfterReturningToLive() {
        let (model, source) = makeModel(active)
        model.start()
        source.push(ChartTooltipInput(
            isActive: true, label: active.label, series: active.series, connection: .stale
        ))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(ChartTooltipInput(
            isActive: true, label: active.label, series: active.series, connection: .live
        ))
        XCTAssertEqual(model.connection, .live)
        source.push(ChartTooltipInput(
            isActive: true, label: active.label, series: active.series, connection: .stale
        ))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsCachedReadoutAndDoesNotAutoRefresh() {
        let (model, source) = makeModel(active)
        model.start()
        source.push(ChartTooltipInput(
            isActive: true, label: active.label, series: active.series, connection: .offline
        ))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(active)
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(active)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(ChartTooltip.surfaceSlug, "ChartTooltip")
    }
}

// MARK: - Live source (production selection bridge)

@MainActor
final class LiveChartTooltipSourceTests: XCTestCase {
    func testStartEmitsInitialSelection() {
        let source = LiveChartTooltipSource()
        var snapshots: [ChartTooltipInput] = []
        source.onUpdate = { snapshots.append($0) }
        source.start()
        XCTAssertEqual(snapshots.last?.isActive, false)
        XCTAssertEqual(snapshots.last?.connection, .live)
    }

    func testUpdateReEmitsTheNewSelection() {
        let source = LiveChartTooltipSource()
        var latest: ChartTooltipInput?
        source.onUpdate = { latest = $0 }
        source.start()
        source.update(ChartTooltipInput(
            isActive: true,
            label: .text("2026-04-04T14:30:00Z"),
            series: [series("soc", "Battery", 72.4)]
        ))
        XCTAssertEqual(latest?.isActive, true)
        XCTAssertEqual(latest?.series.count, 1)
    }

    func testRefreshReEmitsCurrentSelection() {
        let selection = ChartTooltipInput(isActive: true, series: [series("soc", "Battery", 50)])
        let source = LiveChartTooltipSource(selection: selection)
        var count = 0
        source.onUpdate = { _ in count += 1 }
        source.start()
        source.refresh()
        XCTAssertEqual(count, 2)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyChartTooltipTelemetry: ChartTooltipTelemetry, @unchecked Sendable {
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
