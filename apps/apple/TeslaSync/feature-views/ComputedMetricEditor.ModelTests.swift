//
//  ComputedMetricEditor.ModelTests.swift
//  TeslaSync — P4 feature view · 0182 · ComputedMetricEditor (Apple)
//
//  State-holder + telemetry coverage for the ComputedMetricEditor surface (split from
//  the adapter/projection coverage in `ComputedMetricEditor.Tests.swift` to keep each
//  file within the file-length budget):
//    • Registry model — the web-prop → load-state mapping, start/stop/refresh wiring,
//      and the known-list retention across a refetch.
//    • Preview model — phase transitions (idle / computing / success / failure), the
//      cached-behind-offline contract, freshness (stale) via an injected clock, the
//      re-entrancy guard, and `clear()`.
//    • Telemetry — the P1/S11 `view.opened` reporter emits the surface slug.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the models are driven by the in-memory source + runner doubles.
//

import Foundation
import XCTest

// MARK: - State holder: web-prop mapping + wiring

@MainActor final class ComputedMetricRegistryModelTests: XCTestCase {
    private let one = [ComputedMetricSummary(id: "c", label: "C", unit: "kwh", windows: ["7d"], ops: [.lessThan])]

    func testLoadStateMapping() {
        XCTAssertEqual(
            ComputedMetricRegistryModel.loadState(metrics: [], loading: true),
            .loading(cached: nil, stale: false)
        )
        XCTAssertEqual(
            ComputedMetricRegistryModel.loadState(metrics: one, loading: true),
            .loading(cached: one, stale: false)
        )
        XCTAssertEqual(ComputedMetricRegistryModel.loadState(metrics: [], loading: false), .empty(stale: false))
        XCTAssertEqual(ComputedMetricRegistryModel.loadState(metrics: one, loading: false), .loaded(one, stale: false))
    }

    func testStartAppliesInitialOnceAndExposesMetrics() {
        let source = InMemoryComputedMetricRegistrySource(initial: .loaded(one, stale: false))
        let model = ComputedMetricRegistryModel(source: source)
        model.start()
        model.start()
        XCTAssertEqual(model.state, .loaded(one, stale: false))
        XCTAssertEqual(model.presentation, .content(one, .live, refreshing: false))
        XCTAssertEqual(model.metrics, one)
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshAndStopDelegate() {
        let source = InMemoryComputedMetricRegistrySource(initial: .empty(stale: false))
        let model = ComputedMetricRegistryModel(source: source)
        model.start()
        model.refresh()
        model.refresh()
        model.stop()
        XCTAssertEqual(source.refreshCount, 2)
        XCTAssertEqual(source.stopCount, 1)
    }

    func testListRetainedAcrossRefetch() {
        let source = InMemoryComputedMetricRegistrySource(initial: .loaded(one, stale: false))
        let model = ComputedMetricRegistryModel(source: source)
        model.start()
        XCTAssertEqual(model.metrics, one)
        // A background refetch with nothing cached must not blank the known list.
        source.push(.loading(cached: nil, stale: false))
        XCTAssertEqual(model.metrics, one)
        // An offline failure that carries the cache keeps it.
        source.push(.failed(.offline, cached: one, stale: true))
        XCTAssertEqual(model.metrics, one)
    }

    func testWebPropInit() {
        let model = ComputedMetricRegistryModel(metrics: one, loading: false)
        XCTAssertEqual(model.state, .loaded(one, stale: false))
        XCTAssertEqual(model.metrics, one)
    }
}

// MARK: - Preview holder: lifecycle + freshness

@MainActor final class ComputedMetricPreviewModelTests: XCTestCase {
    private let request = ComputedMetricPreviewRequest(
        metricID: "cost",
        metricWindow: "7d",
        metricOp: .greaterThan,
        metricThreshold: 200,
        vehicleID: nil
    )

    func testSuccessLifecycle() {
        let runner = InMemoryComputedMetricPreviewRunner(autoResponds: false)
        let model = ComputedMetricPreviewModel(runner: runner)
        model.requestPreview(request)
        XCTAssertEqual(model.phase, .computing)
        XCTAssertEqual(runner.lastRequest, request)
        runner.push(.success(ComputedMetricPreviewResult(value: 12.5, wouldTrigger: true)))
        XCTAssertEqual(model.phase, .success)
        XCTAssertEqual(model.result, ComputedMetricPreviewResult(value: 12.5, wouldTrigger: true))
        XCTAssertNil(model.errorMessage)
        XCTAssertEqual(model.connection, .live)
    }

    func testFailureLifecycle() {
        let runner = InMemoryComputedMetricPreviewRunner(autoResponds: false)
        let model = ComputedMetricPreviewModel(runner: runner)
        model.requestPreview(request)
        runner.push(.failure(message: "boom"))
        XCTAssertEqual(model.phase, .failure)
        XCTAssertEqual(model.errorMessage, "boom")
        XCTAssertFalse(model.isOffline)
    }

    func testOfflineKeepsCachedValue() {
        let runner = InMemoryComputedMetricPreviewRunner(autoResponds: false)
        let model = ComputedMetricPreviewModel(runner: runner)
        model.requestPreview(request)
        runner.push(.success(ComputedMetricPreviewResult(value: 9, wouldTrigger: false)))
        runner.push(.offline(message: "offline"))
        XCTAssertEqual(model.phase, .success)
        XCTAssertEqual(model.result?.value, 9)
        XCTAssertTrue(model.isOffline)
        XCTAssertEqual(model.connection, .offline)
    }

    func testOfflineWithoutCacheFails() {
        let runner = InMemoryComputedMetricPreviewRunner(autoResponds: false)
        let model = ComputedMetricPreviewModel(runner: runner)
        model.requestPreview(request)
        runner.push(.offline(message: "no signal"))
        XCTAssertEqual(model.phase, .failure)
        XCTAssertEqual(model.errorMessage, "no signal")
        XCTAssertTrue(model.isOffline)
    }

    func testStalenessUsesInjectedClock() {
        let clock = TestClock(now: Date(timeIntervalSince1970: 1000))
        let runner = InMemoryComputedMetricPreviewRunner(autoResponds: false)
        let model = ComputedMetricPreviewModel(runner: runner, now: { clock.read() }, stalenessWindow: 30)
        model.requestPreview(request)
        runner.push(.success(ComputedMetricPreviewResult(value: 1, wouldTrigger: false)))
        XCTAssertEqual(model.connection, .live)
        clock.advance(by: 31)
        XCTAssertTrue(model.isStale)
        XCTAssertEqual(model.connection, .stale)
    }

    func testReentrancyGuard() {
        let runner = InMemoryComputedMetricPreviewRunner(autoResponds: false)
        let model = ComputedMetricPreviewModel(runner: runner)
        model.requestPreview(request)
        model.requestPreview(request)
        XCTAssertEqual(runner.runCount, 1)
    }

    func testClearResets() {
        let runner = InMemoryComputedMetricPreviewRunner(autoResponds: false)
        let model = ComputedMetricPreviewModel(runner: runner)
        model.requestPreview(request)
        runner.push(.success(ComputedMetricPreviewResult(value: 3, wouldTrigger: true)))
        model.clear()
        XCTAssertEqual(model.phase, .idle)
        XCTAssertNil(model.result)
        XCTAssertNil(model.errorMessage)
        XCTAssertFalse(model.isOffline)
        XCTAssertEqual(runner.cancelCount, 1)
    }
}

// MARK: - Telemetry: P1/S11 view.opened

@MainActor final class ComputedMetricEditorTelemetryTests: XCTestCase {
    func testReporterEmitsSurfaceSlug() {
        let spy = SpyComputedMetricEditorTelemetry()
        ComputedMetricEditorOpenReporter.report(using: spy)
        XCTAssertEqual(spy.surfaces, ["ComputedMetricEditor"])
        XCTAssertEqual(ComputedMetricEditorDiagnostics.surface, "ComputedMetricEditor")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyComputedMetricEditorTelemetry: ComputedMetricEditorTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

/// A mutable monotonic clock for staleness tests.
private final class TestClock: @unchecked Sendable {
    private var current: Date
    init(now: Date) {
        current = now
    }

    func read() -> Date {
        current
    }

    func advance(by seconds: TimeInterval) {
        current = current.addingTimeInterval(seconds)
    }
}

@testable import TeslaSync
