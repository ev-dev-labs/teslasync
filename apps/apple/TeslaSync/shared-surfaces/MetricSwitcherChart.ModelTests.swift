//
//  MetricSwitcherChart.ModelTests.swift
//  TeslaSync — P4 shared surface · 0072 · MetricSwitcherChart (Apple)
//
//  Adapter + telemetry + model coverage split out of `…Tests.swift` (one concern per file):
//    • Adapter — the "cached → projection" mapping of the shared-core ``LoadableState`` (P1/S8) into
//      the pure ``MetricSwitcherInput``: a cached value survives behind the freshness axis (stale /
//      offline), a failure with no cache becomes the error chrome, an in-flight load with no cache
//      becomes the loading chrome.
//    • Diagnostics — the P1/S11 `view.opened` emission seam (emitted exactly once on first appearance;
//      never double-counted) and the stable diagnostics slug.
//    • Model — the controlled selection (`select` fires the host callback only on a real change,
//      ignores unknown keys), the retry passthrough, and the selection re-resolution on `update`.
//
//  Driven by spies; no network, no real store.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter (LoadableState → MetricSwitcherInput)

final class MetricSwitcherInputAdapterTests: XCTestCase {
    private var dataset: MetricSwitcherDataset {
        MetricSwitcherChartTestData.dataset
    }

    func testFromIdleIsLoading() {
        let input = MetricSwitcherInput.from(.idle, activeID: "drives")
        XCTAssertEqual(input.availability, .loading)
        XCTAssertEqual(input.connection, .live)
        XCTAssertEqual(input.activeID, "drives")
    }

    func testFromLoadingWithoutCacheIsLoading() {
        let input = MetricSwitcherInput.from(.loading(cached: nil, stale: false), activeID: "drives")
        XCTAssertEqual(input.availability, .loading)
    }

    func testFromLoadingWithCacheShowsCachedBehindFreshness() {
        let input = MetricSwitcherInput.from(.loading(cached: dataset, stale: true), activeID: "drives")
        XCTAssertEqual(input.availability, .resolved(dataset))
        XCTAssertEqual(input.connection, .stale)
    }

    func testFromLoadedTracksStaleFlag() {
        XCTAssertEqual(MetricSwitcherInput.from(.loaded(dataset, stale: false), activeID: "x").connection, .live)
        XCTAssertEqual(MetricSwitcherInput.from(.loaded(dataset, stale: true), activeID: "x").connection, .stale)
    }

    func testFromEmptyResolvesEmptyDataset() {
        let input = MetricSwitcherInput.from(.empty(stale: false), activeID: "x")
        XCTAssertEqual(input.availability, .resolved(.empty))
    }

    func testFromFailedWithoutCacheIsRetryableError() {
        let input = MetricSwitcherInput.from(.failed(.offline, cached: nil, stale: false), activeID: "x")
        guard case let .failed(retryable) = input.availability else {
            return XCTFail("expected a failed availability")
        }
        XCTAssertTrue(retryable, ".offline is retryable")
    }

    func testFromFailedWithoutCacheNonRetryable() {
        let input = MetricSwitcherInput.from(
            .failed(.api(status: 400, code: nil, body: nil), cached: nil, stale: false),
            activeID: "x"
        )
        guard case let .failed(retryable) = input.availability else {
            return XCTFail("expected a failed availability")
        }
        XCTAssertFalse(retryable, "a 400 is not retryable")
    }

    func testFromFailedWithCacheConnectivityIsOffline() {
        let input = MetricSwitcherInput.from(.failed(.offline, cached: dataset, stale: false), activeID: "x")
        XCTAssertEqual(input.availability, .resolved(dataset))
        XCTAssertEqual(input.connection, .offline)
    }

    func testFromFailedWithCacheNetworkIsOffline() {
        let input = MetricSwitcherInput.from(
            .failed(.network(message: "x"), cached: dataset, stale: false),
            activeID: "x"
        )
        XCTAssertEqual(input.connection, .offline)
    }

    func testFromFailedWithCacheNonConnectivityKeepsStaleAxis() {
        let live = MetricSwitcherInput.from(
            .failed(.api(status: 500, code: nil, body: nil), cached: dataset, stale: false),
            activeID: "x"
        )
        let stale = MetricSwitcherInput.from(
            .failed(.api(status: 500, code: nil, body: nil), cached: dataset, stale: true),
            activeID: "x"
        )
        XCTAssertEqual(live.connection, .live)
        XCTAssertEqual(stale.connection, .stale)
    }

    func testEndToEndCachedOfflineRendersChartWithOfflineChip() {
        let input = MetricSwitcherInput.from(.failed(.offline, cached: dataset, stale: false), activeID: "drives")
        let resolved = MetricSwitcherProjection.resolve(
            input,
            title: .verbatim("Activity"),
            strings: MetricSwitcherChartTestData.identity
        )
        XCTAssertEqual(resolved.freshness?.isOffline, true)
        guard case .chart = resolved.body else {
            return XCTFail("a cached offline value should still render its chart")
        }
    }
}

// MARK: - Diagnostics emission seam (P1/S11 view.opened)

@MainActor
final class MetricSwitcherChartDiagnosticsTests: XCTestCase {
    func testOpenIfNeededEmitsOnce() {
        let spy = SpyMetricSwitcherChartTelemetry()
        let emitted = MetricSwitcherChartDiagnostics.openIfNeeded(alreadyEmitted: false, telemetry: spy)
        XCTAssertTrue(emitted)
        XCTAssertEqual(spy.surfaces, [MetricSwitcherChartMeta.surfaceSlug])
    }

    func testOpenIfNeededDoesNotDoubleEmit() {
        let spy = SpyMetricSwitcherChartTelemetry()
        var emitted = MetricSwitcherChartDiagnostics.openIfNeeded(alreadyEmitted: false, telemetry: spy)
        emitted = MetricSwitcherChartDiagnostics.openIfNeeded(alreadyEmitted: emitted, telemetry: spy)
        XCTAssertTrue(emitted)
        XCTAssertEqual(spy.surfaces, [MetricSwitcherChartMeta.surfaceSlug])
    }

    func testModelMarkAppearedEmitsOnceAcrossRepeatedAppearances() {
        let spy = SpyMetricSwitcherChartTelemetry()
        let model = makeModel(telemetry: spy)
        model.markAppeared()
        model.markAppeared()
        model.markAppeared()
        XCTAssertEqual(spy.surfaces, [MetricSwitcherChartMeta.surfaceSlug])
    }

    func testSlugIsStable() {
        XCTAssertEqual(MetricSwitcherChartMeta.surfaceSlug, "MetricSwitcherChart")
        XCTAssertEqual(MetricSwitcherChart.surfaceSlug, "MetricSwitcherChart")
    }

    func testOSLogTelemetryIsInvokable() {
        OSLogMetricSwitcherChartTelemetry().viewOpened(surface: MetricSwitcherChartMeta.surfaceSlug)
    }
}

// MARK: - Model (controlled selection + retry)

@MainActor
final class MetricSwitcherChartModelTests: XCTestCase {
    func testInitResolvesEmptyActiveKeyToFirstMetric() {
        XCTAssertEqual(makeModel(activeMetric: "").selectedID, "drives")
    }

    func testInitKeepsUnknownActiveKeyRaw() {
        XCTAssertEqual(makeModel(activeMetric: "nope").selectedID, "nope")
    }

    func testSelectChangesSelectionAndInvokesCallback() {
        let spy = ChangeSpy()
        let model = makeModel(onMetricChange: { spy.changes.append($0) })
        model.select("distance")
        XCTAssertEqual(model.selectedID, "distance")
        XCTAssertEqual(spy.changes, ["distance"])
    }

    func testSelectIgnoresNoOpReselect() {
        let spy = ChangeSpy()
        let model = makeModel(activeMetric: "drives", onMetricChange: { spy.changes.append($0) })
        model.select("drives")
        XCTAssertTrue(spy.changes.isEmpty)
    }

    func testSelectIgnoresUnknownKey() {
        let spy = ChangeSpy()
        let model = makeModel(onMetricChange: { spy.changes.append($0) })
        model.select("ghost")
        XCTAssertEqual(model.selectedID, "drives")
        XCTAssertTrue(spy.changes.isEmpty)
    }

    func testCanRetryReflectsHandlerPresence() {
        XCTAssertFalse(makeModel().canRetry)
        XCTAssertTrue(makeModel(onRetry: {}).canRetry)
    }

    func testRetryInvokesHandler() {
        let spy = RetrySpy()
        let model = makeModel(onRetry: { spy.count += 1 })
        model.retry()
        XCTAssertEqual(spy.count, 1)
    }

    func testUpdateReResolvesSelectionWhenKeyMissing() {
        let model = makeModel()
        model.select("distance")
        XCTAssertEqual(model.selectedID, "distance")
        let onlyDrives = MetricSwitcherDataset(
            metrics: [MetricSwitcherChartTestData.metrics[0]],
            series: ["drives": []]
        )
        model.update(state: .loaded(onlyDrives, stale: false))
        XCTAssertEqual(model.selectedID, "drives")
    }

    func testResolvedReflectsLoadedChart() {
        guard case .chart = makeModel().resolved.body else {
            return XCTFail("a loaded dataset should resolve to a chart body")
        }
    }
}

// MARK: - Helpers + test doubles

@MainActor
private func makeModel(
    activeMetric: String = "drives",
    onMetricChange: (@MainActor (String) -> Void)? = nil,
    onRetry: (@MainActor () -> Void)? = nil,
    telemetry: any MetricSwitcherChartTelemetry = OSLogMetricSwitcherChartTelemetry()
) -> MetricSwitcherChartModel {
    MetricSwitcherChartModel(
        title: .verbatim("Activity"),
        state: .loaded(MetricSwitcherChartTestData.dataset, stale: false),
        activeMetric: activeMetric,
        onMetricChange: onMetricChange,
        onRetry: onRetry,
        telemetry: telemetry
    )
}

@MainActor
private final class ChangeSpy {
    var changes: [String] = []
}

@MainActor
private final class RetrySpy {
    var count = 0
}

/// Records `view.opened` surfaces so the telemetry contract can be asserted.
private final class SpyMetricSwitcherChartTelemetry: MetricSwitcherChartTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
