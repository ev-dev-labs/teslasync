//
//  ElevationProfile.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0071 · ElevationProfile (Apple)
//
//  Adapter + telemetry + model coverage split out of `…Tests.swift` (one concern per file):
//    • Adapter — the "cached → projection" mapping of the shared-core ``LoadableState`` (P1/S8) into
//      the pure ``ElevationProfileInput``: a cached value survives behind the freshness axis (stale /
//      offline), a failure with no cache becomes the error chrome, an in-flight load with no cache
//      becomes the loading chrome, and the controlled cursor passes through.
//    • Diagnostics — the P1/S11 `view.opened` emission seam (emitted exactly once on first appearance;
//      never double-counted) and the stable diagnostics slug.
//    • Model — the click → index callback (web `onClickIndex(data[idx].index)`; fires the host with the
//      tapped sample's `.index` field, no-ops without a handler), the retry passthrough, the series
//      re-feed, and the cursor move.
//
//  Driven by spies; no network, no real store.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter (LoadableState → ElevationProfileInput)

final class ElevationProfileInputAdapterTests: XCTestCase {
    private var data: [ElevationProfileSample] {
        ElevationProfileTestData.data
    }

    func testFromIdleIsLoading() {
        let input = ElevationProfileInput.from(.idle, currentIndex: nil)
        XCTAssertEqual(input.availability, .loading)
        XCTAssertEqual(input.connection, .live)
    }

    func testFromLoadingWithoutCacheIsLoading() {
        let input = ElevationProfileInput.from(.loading(cached: nil, stale: false), currentIndex: nil)
        XCTAssertEqual(input.availability, .loading)
    }

    func testFromLoadingWithCacheShowsCachedBehindFreshness() {
        let input = ElevationProfileInput.from(.loading(cached: data, stale: true), currentIndex: nil)
        XCTAssertEqual(input.availability, .resolved(data))
        XCTAssertEqual(input.connection, .stale)
    }

    func testFromLoadedTracksStaleFlag() {
        XCTAssertEqual(ElevationProfileInput.from(.loaded(data, stale: false), currentIndex: nil).connection, .live)
        XCTAssertEqual(ElevationProfileInput.from(.loaded(data, stale: true), currentIndex: nil).connection, .stale)
    }

    func testFromEmptyResolvesEmptySeries() {
        let input = ElevationProfileInput.from(.empty(stale: false), currentIndex: nil)
        XCTAssertEqual(input.availability, .resolved([]))
    }

    func testFromFailedWithoutCacheIsRetryableError() {
        let input = ElevationProfileInput.from(.failed(.offline, cached: nil, stale: false), currentIndex: nil)
        guard case let .failed(retryable) = input.availability else {
            return XCTFail("expected a failed availability")
        }
        XCTAssertTrue(retryable, ".offline is retryable")
    }

    func testFromFailedWithoutCacheNonRetryable() {
        let input = ElevationProfileInput.from(
            .failed(.api(status: 400, code: nil, body: nil), cached: nil, stale: false),
            currentIndex: nil
        )
        guard case let .failed(retryable) = input.availability else {
            return XCTFail("expected a failed availability")
        }
        XCTAssertFalse(retryable, "a 400 is not retryable")
    }

    func testFromFailedWithCacheConnectivityIsOffline() {
        let input = ElevationProfileInput.from(.failed(.offline, cached: data, stale: false), currentIndex: nil)
        XCTAssertEqual(input.availability, .resolved(data))
        XCTAssertEqual(input.connection, .offline)
    }

    func testFromFailedWithCacheNetworkIsOffline() {
        let input = ElevationProfileInput.from(
            .failed(.network(message: "x"), cached: data, stale: false),
            currentIndex: nil
        )
        XCTAssertEqual(input.connection, .offline)
    }

    func testFromFailedWithCacheNonConnectivityKeepsStaleAxis() {
        let live = ElevationProfileInput.from(
            .failed(.api(status: 500, code: nil, body: nil), cached: data, stale: false),
            currentIndex: nil
        )
        let stale = ElevationProfileInput.from(
            .failed(.api(status: 500, code: nil, body: nil), cached: data, stale: true),
            currentIndex: nil
        )
        XCTAssertEqual(live.connection, .live)
        XCTAssertEqual(stale.connection, .stale)
    }

    func testCurrentIndexPassesThrough() {
        XCTAssertEqual(ElevationProfileInput.from(.loaded(data, stale: false), currentIndex: 3).currentIndex, 3)
    }

    func testEndToEndCachedOfflineRendersChartWithOfflineChip() {
        let input = ElevationProfileInput.from(.failed(.offline, cached: data, stale: false), currentIndex: nil)
        let resolved = ElevationProfileProjection.resolve(
            input,
            locale: ElevationProfileTestData.locale,
            strings: ElevationProfileTestData.identity
        )
        XCTAssertEqual(resolved.freshness?.isOffline, true)
        guard case .chart = resolved.body else {
            return XCTFail("a cached offline value should still render its chart")
        }
    }
}

// MARK: - Diagnostics emission seam (P1/S11 view.opened)

@MainActor
final class ElevationProfileDiagnosticsTests: XCTestCase {
    func testOpenIfNeededEmitsOnce() {
        let spy = SpyElevationProfileTelemetry()
        let emitted = ElevationProfileDiagnostics.openIfNeeded(alreadyEmitted: false, telemetry: spy)
        XCTAssertTrue(emitted)
        XCTAssertEqual(spy.surfaces, [ElevationProfileMeta.surfaceSlug])
    }

    func testOpenIfNeededDoesNotDoubleEmit() {
        let spy = SpyElevationProfileTelemetry()
        var emitted = ElevationProfileDiagnostics.openIfNeeded(alreadyEmitted: false, telemetry: spy)
        emitted = ElevationProfileDiagnostics.openIfNeeded(alreadyEmitted: emitted, telemetry: spy)
        XCTAssertTrue(emitted)
        XCTAssertEqual(spy.surfaces, [ElevationProfileMeta.surfaceSlug])
    }

    func testModelMarkAppearedEmitsOnceAcrossRepeatedAppearances() {
        let spy = SpyElevationProfileTelemetry()
        let model = makeModel(telemetry: spy)
        model.markAppeared()
        model.markAppeared()
        model.markAppeared()
        XCTAssertEqual(spy.surfaces, [ElevationProfileMeta.surfaceSlug])
    }

    func testSlugIsStable() {
        XCTAssertEqual(ElevationProfileMeta.surfaceSlug, "ElevationProfile")
        XCTAssertEqual(ElevationProfile.surfaceSlug, "ElevationProfile")
    }

    func testOSLogTelemetryIsInvokable() {
        OSLogElevationProfileTelemetry().viewOpened(surface: ElevationProfileMeta.surfaceSlug)
    }
}

// MARK: - Model (click → index, retry, re-feed, cursor)

@MainActor
final class ElevationProfileModelTests: XCTestCase {
    private var samples: [ElevationProfileSample] {
        // index fields (10,20,30) differ from array positions; distances 0,5,10.
        [
            ElevationProfileSample(index: 10, distance: 0, elevation: 100),
            ElevationProfileSample(index: 20, distance: 5, elevation: 110),
            ElevationProfileSample(index: 30, distance: 10, elevation: 120)
        ]
    }

    func testSelectEmitsTappedSampleIndexField() {
        let spy = ChangeSpy()
        let model = makeModel(state: .loaded(samples, stale: false), onClickIndex: { spy.indices.append($0) })
        model.select(distance: 6) // nearest sample → array position 1 → .index 20 (web onClickIndex)
        XCTAssertEqual(spy.indices, [20])
    }

    func testSelectClampsToNearestEndpoint() {
        let spy = ChangeSpy()
        let model = makeModel(state: .loaded(samples, stale: false), onClickIndex: { spy.indices.append($0) })
        model.select(distance: 100)
        XCTAssertEqual(spy.indices, [30])
    }

    func testSelectNoOpsWithoutHandler() {
        let model = makeModel(state: .loaded(samples, stale: false))
        model.select(distance: 5) // must not crash
    }

    func testSelectNoOpsWithoutSamples() {
        let spy = ChangeSpy()
        let model = makeModel(state: .loaded([], stale: false), onClickIndex: { spy.indices.append($0) })
        model.select(distance: 5)
        XCTAssertTrue(spy.indices.isEmpty)
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

    func testUpdateReFeedsState() {
        let model = makeModel(state: .loading(cached: nil, stale: false))
        guard case .loading = model.resolved(locale: ElevationProfileTestData.locale).body else {
            return XCTFail("expected the loading body")
        }
        model.update(state: .loaded(samples, stale: false))
        guard case .chart = model.resolved(locale: ElevationProfileTestData.locale).body else {
            return XCTFail("expected the chart body after the re-feed")
        }
    }

    func testUpdateCursorMovesReferenceLine() {
        let model = makeModel(state: .loaded(samples, stale: false))
        model.updateCursor(currentIndex: 2)
        XCTAssertEqual(model.currentIndex, 2)
        XCTAssertEqual(model.resolved(locale: ElevationProfileTestData.locale).plotted?.cursorDistance, 10)
    }

    func testResolvedReflectsLoadedChart() {
        guard case .chart = makeModel(state: .loaded(samples, stale: false))
            .resolved(locale: ElevationProfileTestData.locale).body
        else {
            return XCTFail("a loaded series should resolve to a chart body")
        }
    }
}

// MARK: - Helpers + test doubles

@MainActor
private func makeModel(
    state: LoadableState<[ElevationProfileSample]> = .loaded(ElevationProfileTestData.data, stale: false),
    currentIndex: Int? = nil,
    onClickIndex: (@MainActor (Int) -> Void)? = nil,
    onRetry: (@MainActor () -> Void)? = nil,
    telemetry: any ElevationProfileTelemetry = OSLogElevationProfileTelemetry()
) -> ElevationProfileModel {
    ElevationProfileModel(
        state: state,
        currentIndex: currentIndex,
        onClickIndex: onClickIndex,
        onRetry: onRetry,
        telemetry: telemetry
    )
}

@MainActor
private final class ChangeSpy {
    var indices: [Int] = []
}

@MainActor
private final class RetrySpy {
    var count = 0
}

/// Records `view.opened` surfaces so the telemetry contract can be asserted.
private final class SpyElevationProfileTelemetry: ElevationProfileTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
