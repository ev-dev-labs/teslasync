//
//  XRayHeader.Tests.swift
//  TeslaSync — P4 feature view · 0035 · XRayHeader (Apple)
//
//  Unit coverage for the XRayHeader surface:
//    • Adapter (cached summary + window → projection) — `XRayHeaderProjection`,
//      the locale-grouped integer (web `fmtInt`), the window-label echo (web
//      `WINDOW_LABEL`), and the VoiceOver summary builder.
//    • State holder — `XRayHeaderModel` phase resolution across loading / loaded /
//      empty / error, the cached-stays-visible rule, plus the P1/S11 `view.opened`
//      telemetry + source wiring (start/stop/refresh).
//    • Window enum — wire round-trip + the unrecognized-token default.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemoryXRayHeaderSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Window enum (web `IngestXRayWindow` + `WINDOW_LABEL`)

@MainActor
final class XRayHeaderWindowTests: XCTestCase {
    func testWireRoundTripForEveryCase() {
        for window in IngestXRayWindow.allCases {
            XCTAssertEqual(IngestXRayWindow.from(wire: window.wire), window)
        }
    }

    func testWireTokensMatchTheWebUnion() {
        XCTAssertEqual(IngestXRayWindow.allCases.map(\.wire), ["5m", "15m", "1h", "6h", "24h"])
    }

    func testUnrecognizedTokenDefaultsToFifteenMinutes() {
        XCTAssertEqual(IngestXRayWindow.from(wire: "90m"), .m15)
        XCTAssertEqual(IngestXRayWindow.from(wire: ""), .m15)
    }

    func testLabelFallbacksMatchTheWebWindowLabelMap() {
        XCTAssertEqual(IngestXRayWindow.m5.labelFallback, "5 minutes")
        XCTAssertEqual(IngestXRayWindow.m15.labelFallback, "15 minutes")
        XCTAssertEqual(IngestXRayWindow.h1.labelFallback, "1 hour")
        XCTAssertEqual(IngestXRayWindow.h6.labelFallback, "6 hours")
        XCTAssertEqual(IngestXRayWindow.h24.labelFallback, "24 hours")
    }

    func testLabelKeyNamespacesByWireToken() {
        XCTAssertEqual(IngestXRayWindow.h24.labelKey, "admin.xray.windowLabel.24h")
    }
}

// MARK: - Adapter: cached summary → projection (parity with the web header)

@MainActor
final class XRayHeaderAdapterTests: XCTestCase {
    /// English-fallback localizer (bundle-free) used by the projection tests.
    private let echo: (String, String) -> String = { _, fallback in fallback }
    /// Key-revealing localizer so a test can assert the exact i18n key used.
    private let keyTap: (String, String) -> String = { key, _ in "L:\(key)" }

    func testFmtIntIsZeroForZeroAndCarriesNoFraction() {
        XCTAssertEqual(XRayHeaderProjection.fmtInt(0), "0")
        XCTAssertFalse(XRayHeaderProjection.fmtInt(1_234_567).contains("."))
        XCTAssertEqual(
            XRayHeaderProjection.fmtInt(184_502),
            184_502.formatted(.number.precision(.fractionLength(0)))
        )
    }

    func testBuildReturnsTheThreeWebTilesInOrder() {
        let stats = XRayHeaderProjection.build(
            summary: IngestXRaySummary(totalSamples: 184_502, uniqueFields: 47),
            window: .h1,
            localize: echo
        )
        XCTAssertEqual(stats.map(\.kind), [.samples, .fields, .window])
    }

    func testSamplesAndFieldsTilesUseFmtIntOfTheSummary() {
        let stats = XRayHeaderProjection.build(
            summary: IngestXRaySummary(totalSamples: 184_502, uniqueFields: 47),
            window: .h1,
            localize: echo
        )
        XCTAssertEqual(stats[0].value, XRayHeaderProjection.fmtInt(184_502))
        XCTAssertEqual(stats[1].value, XRayHeaderProjection.fmtInt(47))
    }

    func testNilSummaryCoalescesToZero() {
        let stats = XRayHeaderProjection.build(summary: nil, window: .m5, localize: echo)
        XCTAssertEqual(stats[0].value, "0")
        XCTAssertEqual(stats[1].value, "0")
    }

    func testNilNumericFieldsCoalesceToZero() {
        let stats = XRayHeaderProjection.build(
            summary: IngestXRaySummary(totalSamples: nil, uniqueFields: nil),
            window: .m5,
            localize: echo
        )
        XCTAssertEqual(stats[0].value, "0")
        XCTAssertEqual(stats[1].value, "0")
    }

    func testWindowTileEchoesTheLocalizedWindowLabel() {
        let stats = XRayHeaderProjection.build(summary: nil, window: .h6, localize: echo)
        XCTAssertEqual(stats[2].value, "6 hours")
    }

    func testWindowTileResolvesThroughTheWindowLabelKey() {
        let stats = XRayHeaderProjection.build(summary: nil, window: .h6, localize: keyTap)
        XCTAssertEqual(stats[2].value, "L:admin.xray.windowLabel.6h")
    }

    func testTileLabelAndSublabelKeysMatchTheWebSource() {
        let stats = XRayHeaderProjection.build(summary: nil, window: .h1, localize: echo)
        XCTAssertEqual(stats[0].labelKey, "admin.xray.stats.samples")
        XCTAssertEqual(stats[0].labelFallback, "Total samples")
        XCTAssertEqual(stats[0].sublabelKey, "admin.xray.stats.samplesSub")
        XCTAssertEqual(stats[0].sublabelFallback, "within selected window")
        XCTAssertEqual(stats[1].labelKey, "admin.xray.stats.fields")
        XCTAssertEqual(stats[1].labelFallback, "Distinct fields")
        XCTAssertEqual(stats[1].sublabelFallback, "unique signal names")
        XCTAssertEqual(stats[2].labelKey, "admin.xray.stats.window")
        XCTAssertEqual(stats[2].sublabelFallback, "observation horizon")
    }

    func testNumericTilesAreFlaggedNumericAndWindowIsNot() {
        let stats = XRayHeaderProjection.build(summary: nil, window: .h1, localize: echo)
        XCTAssertTrue(stats[0].isNumeric)
        XCTAssertTrue(stats[1].isNumeric)
        XCTAssertFalse(stats[2].isNumeric)
    }

    func testAccessibilitySummaryReadsLabelValueSublabel() {
        let stats = XRayHeaderProjection.build(
            summary: IngestXRaySummary(totalSamples: 12, uniqueFields: 3),
            window: .h1,
            localize: echo
        )
        XCTAssertEqual(
            XRayHeaderAccessibility.statSummary(stat: stats[0], localize: echo),
            "Total samples, \(XRayHeaderProjection.fmtInt(12)), within selected window"
        )
    }
}

// MARK: - State holder: phase resolution + telemetry + source wiring

@MainActor
final class XRayHeaderModelTests: XCTestCase {
    /// Telemetry spy capturing each `view.opened` surface slug.
    private final class SpyTelemetry: XRayHeaderTelemetry, @unchecked Sendable {
        private(set) var surfaces: [String] = []
        func viewOpened(surface: String) {
            surfaces.append(surface)
        }
    }

    func testInitialFetchWithNoCacheIsLoading() {
        let phase = XRayHeaderModel.resolvePhase(XRayHeaderUpdate(status: .loading, summary: nil))
        XCTAssertEqual(phase, .loading)
    }

    func testLoadingWithCachedSummaryKeepsContentVisible() {
        let phase = XRayHeaderModel.resolvePhase(
            XRayHeaderUpdate(status: .loading, summary: IngestXRaySummary(totalSamples: 5, uniqueFields: 2))
        )
        XCTAssertEqual(phase, .content)
    }

    func testLoadedWithDataIsContent() {
        let phase = XRayHeaderModel.resolvePhase(
            XRayHeaderUpdate(status: .loaded, summary: IngestXRaySummary(totalSamples: 1, uniqueFields: 1))
        )
        XCTAssertEqual(phase, .content)
    }

    func testLoadedWithZeroSamplesAndFieldsIsEmpty() {
        let phase = XRayHeaderModel.resolvePhase(
            XRayHeaderUpdate(status: .loaded, summary: IngestXRaySummary(totalSamples: 0, uniqueFields: 0))
        )
        XCTAssertEqual(phase, .empty)
    }

    func testLoadedWithNoSummaryIsEmpty() {
        let phase = XRayHeaderModel.resolvePhase(XRayHeaderUpdate(status: .loaded, summary: nil))
        XCTAssertEqual(phase, .empty)
    }

    func testExplicitEmptyStatusIsEmpty() {
        let phase = XRayHeaderModel.resolvePhase(XRayHeaderUpdate(status: .empty, summary: nil))
        XCTAssertEqual(phase, .empty)
    }

    func testFailureAlwaysResolvesToError() {
        let phase = XRayHeaderModel.resolvePhase(
            XRayHeaderUpdate(
                status: .failed("boom"),
                summary: IngestXRaySummary(totalSamples: 9, uniqueFields: 9)
            )
        )
        XCTAssertEqual(phase, .error("boom"))
    }

    func testStartEmitsViewOpenedOnceWithTheSurfaceSlug() {
        let spy = SpyTelemetry()
        let model = XRayHeaderModel(source: InMemoryXRayHeaderSource(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [XRayHeader.surfaceSlug])
    }

    func testStartReplaysTheInitialSnapshotIntoTheModel() {
        let source = InMemoryXRayHeaderSource(
            initial: XRayHeaderUpdate(
                status: .loaded,
                connection: .stale,
                window: .h6,
                summary: IngestXRaySummary(totalSamples: 7, uniqueFields: 4),
                updatedAt: Date(timeIntervalSince1970: 1)
            )
        )
        let model = XRayHeaderModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(model.window, .h6)
        XCTAssertEqual(model.summary?.totalSamples, 7)
    }

    func testRefreshDelegatesToTheSource() {
        let source = InMemoryXRayHeaderSource()
        let model = XRayHeaderModel(source: source)
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStopDelegatesToTheSourceAndAllowsTelemetryAgain() {
        let spy = SpyTelemetry()
        let source = InMemoryXRayHeaderSource()
        let model = XRayHeaderModel(source: source, telemetry: spy)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(source.stopCount, 1)
        XCTAssertEqual(spy.surfaces.count, 2)
    }

    func testPushedSnapshotUpdatesPhaseAndFreshness() {
        let source = InMemoryXRayHeaderSource()
        let model = XRayHeaderModel(source: source)
        model.start()
        source.push(
            XRayHeaderUpdate(
                status: .loaded,
                connection: .offline,
                window: .h24,
                summary: IngestXRaySummary(totalSamples: 3, uniqueFields: 1)
            )
        )
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.window, .h24)
    }
}
