//
//  ChargingBreakdownSlide.Tests.swift
//  TeslaSync — P4 feature view · 0061 · ChargingBreakdownSlide (Apple)
//
//  Unit coverage for the ChargingBreakdownSlide surface:
//    • Format (fmtNumber + Math.round port) — precision, grouping, non-finite→0,
//      integer, rounded percent.
//    • Adapter (cached → projection) — the `chartData` memo: three types filtered to
//      value > 0, colored by FILTERED index (incl. the color-shift when a leading
//      type is zero), the session count + the SOC caption.
//    • Presentation resolver — every state (loading / empty / offline / error /
//      stale / content), keeping cached recaps visible.
//    • Web-prop mapping — `data` → load state (loaded / empty / loading).
//    • Telemetry — `view.opened` event value + buffered sink.
//    • Accessibility — hero + donut share + legend VoiceOver content.
//    • Model — preview / web-prop / source binding + start/refresh/stop delegation.
//
//  These run in the TeslaSync(/-macOS) XCTest targets (and the SwiftPM host harness).
//  No network, no real store: the model is driven by
//  `InMemoryChargingBreakdownSlideSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Format

@MainActor final class ChargingBreakdownSlideFormatTests: XCTestCase {
    private let locale = "en_US"

    func testNumberPrecisionGroupingAndRounding() {
        XCTAssertEqual(ChargingBreakdownSlideFormat.number(1284, decimals: 0, localeIdentifier: locale), "1,284")
        XCTAssertEqual(ChargingBreakdownSlideFormat.number(24.7, decimals: 1, localeIdentifier: locale), "24.7")
        XCTAssertEqual(ChargingBreakdownSlideFormat.integer(184, localeIdentifier: locale), "184")
        XCTAssertEqual(ChargingBreakdownSlideFormat.integer(1284, localeIdentifier: locale), "1,284")
    }

    func testNonFiniteCollapsesToZero() {
        XCTAssertEqual(ChargingBreakdownSlideFormat.number(.infinity, decimals: 1, localeIdentifier: locale), "0.0")
        XCTAssertEqual(ChargingBreakdownSlideFormat.number(.nan, decimals: 0, localeIdentifier: locale), "0")
        XCTAssertEqual(ChargingBreakdownSlideFormat.safeNumber(.nan), 0)
        XCTAssertEqual(ChargingBreakdownSlideFormat.safeNumber(42), 42)
    }

    func testRoundedIntAndPercentMatchMathRound() {
        XCTAssertEqual(ChargingBreakdownSlideFormat.roundedInt(38), 38)
        XCTAssertEqual(ChargingBreakdownSlideFormat.roundedInt(17.4), 17)
        XCTAssertEqual(ChargingBreakdownSlideFormat.roundedInt(24.5), 25)
        XCTAssertEqual(ChargingBreakdownSlideFormat.roundedInt(0.6), 1)
        XCTAssertEqual(ChargingBreakdownSlideFormat.roundedInt(.nan), 0)
        XCTAssertEqual(ChargingBreakdownSlideFormat.percent(58), "58%")
        XCTAssertEqual(ChargingBreakdownSlideFormat.percent(17.4), "17%")
        XCTAssertEqual(ChargingBreakdownSlideFormat.percent(0.4), "0%")
    }
}

// MARK: - Projection (cached → projection)

@MainActor final class ChargingBreakdownSlideProjectionTests: XCTestCase {
    private let locale = Locale(identifier: "en_US")

    private func fullData() -> ChargingBreakdownSlideData {
        ChargingBreakdownSlideData(
            superchargerPct: 58,
            dcFastPct: 17,
            acOtherPct: 25,
            totalChargeSessions: 184,
            avgChargeStartSoc: 38
        )
    }

    func testProjectionMapsThreeSlicesInOrderWithPaletteIndex() {
        let projection = ChargingBreakdownSlideProjection.make(from: fullData(), locale: locale)
        XCTAssertEqual(projection.slices.map(\.name), ["Supercharger", "DC Fast", "AC / Other"])
        XCTAssertEqual(projection.slices.map(\.value), [58, 17, 25])
        XCTAssertEqual(projection.slices.map(\.colorIndex), [0, 1, 2])
        XCTAssertEqual(projection.slices.map(\.id), [0, 1, 2])
        XCTAssertEqual(projection.slices.map(\.percentText), ["58%", "17%", "25%"])
        XCTAssertTrue(projection.hasSlices)
    }

    func testZeroValuedSlicesAreFilteredAndColorsShift() {
        // Supercharger 0 → filtered out; DC Fast becomes index 0 (web COLORS[0]),
        // AC / Other index 1 — the web `filter` + `COLORS[i]` color-shift parity.
        let data = ChargingBreakdownSlideData(
            superchargerPct: 0,
            dcFastPct: 40,
            acOtherPct: 60,
            totalChargeSessions: 90,
            avgChargeStartSoc: 42
        )
        let projection = ChargingBreakdownSlideProjection.make(from: data, locale: locale)
        XCTAssertEqual(projection.slices.map(\.name), ["DC Fast", "AC / Other"])
        XCTAssertEqual(projection.slices.map(\.colorIndex), [0, 1])
        XCTAssertEqual(projection.slices.map(\.value), [40, 60])
    }

    func testProjectionFormatsSessionCountAndSocCaption() {
        let projection = ChargingBreakdownSlideProjection.make(from: fullData(), locale: locale)
        XCTAssertEqual(projection.totalChargeSessions, 184)
        XCTAssertEqual(projection.chargeSessionsText, "184")
        XCTAssertEqual(projection.avgStartSocText, "Average plug-in at 38% battery")
    }

    func testProjectionRoundsSocAndHandlesNoMix() {
        let data = ChargingBreakdownSlideData(totalChargeSessions: 3, avgChargeStartSoc: 41.6)
        let projection = ChargingBreakdownSlideProjection.make(from: data, locale: locale)
        XCTAssertTrue(projection.slices.isEmpty)
        XCTAssertFalse(projection.hasSlices)
        XCTAssertEqual(projection.chargeSessionsText, "3")
        XCTAssertEqual(projection.avgStartSocText, "Average plug-in at 42% battery")
    }

    func testDataEmptyAndMixDetection() {
        XCTAssertTrue(ChargingBreakdownSlideData().isEmpty)
        XCTAssertFalse(ChargingBreakdownSlideData().hasMix)
        XCTAssertFalse(ChargingBreakdownSlideData(totalChargeSessions: 5).isEmpty)
        XCTAssertFalse(ChargingBreakdownSlideData(superchargerPct: 50).isEmpty)
        XCTAssertTrue(ChargingBreakdownSlideData(superchargerPct: 50).hasMix)
        XCTAssertTrue(ChargingBreakdownSlideData(acOtherPct: 1).hasMix)
    }
}

// MARK: - Presentation resolver (every state)

@MainActor final class ChargingBreakdownSlidePresentationTests: XCTestCase {
    private let locale = Locale(identifier: "en_US")

    private func sample() -> ChargingBreakdownSlideData {
        ChargingBreakdownSlideData(
            superchargerPct: 60,
            dcFastPct: 10,
            acOtherPct: 30,
            totalChargeSessions: 42,
            avgChargeStartSoc: 35
        )
    }

    private func resolve(
        _ state: ChargingBreakdownSlideLoadState<ChargingBreakdownSlideData>
    ) -> ChargingBreakdownSlidePresentation {
        ChargingBreakdownSlidePresentation.resolve(state: state, locale: locale)
    }

    private func expected(_ data: ChargingBreakdownSlideData) -> ChargingBreakdownSlideProjection {
        ChargingBreakdownSlideProjection.make(from: data, locale: locale)
    }

    func testLoadingStates() {
        XCTAssertEqual(resolve(.idle), .loading)
        XCTAssertEqual(resolve(.loading(cached: nil, stale: false)), .loading)
        XCTAssertEqual(resolve(.loading(cached: ChargingBreakdownSlideData(), stale: false)), .loading)
        XCTAssertEqual(
            resolve(.loading(cached: sample(), stale: true)),
            .content(expected(sample()), freshness: .stale, refreshing: true)
        )
    }

    func testLoadedContentAndEmpty() {
        XCTAssertEqual(
            resolve(.loaded(sample(), stale: false)),
            .content(expected(sample()), freshness: .live, refreshing: false)
        )
        XCTAssertEqual(resolve(.loaded(ChargingBreakdownSlideData(), stale: false)), .empty)
        XCTAssertEqual(resolve(.empty(stale: false)), .empty)
    }

    func testStaleContent() {
        XCTAssertEqual(
            resolve(.loaded(sample(), stale: true)),
            .content(expected(sample()), freshness: .stale, refreshing: false)
        )
    }

    func testOfflineStates() {
        XCTAssertEqual(resolve(.failed(.offline, cached: nil, stale: false)), .offlineNoData)
        XCTAssertEqual(
            resolve(.failed(.offline, cached: ChargingBreakdownSlideData(), stale: false)),
            .offlineNoData
        )
        XCTAssertEqual(
            resolve(.failed(.offline, cached: sample(), stale: true)),
            .content(expected(sample()), freshness: .offline, refreshing: false)
        )
    }

    func testErrorRetryabilityAndCache() {
        XCTAssertEqual(
            resolve(.failed(.network(message: "x"), cached: nil, stale: false)),
            .error(retryable: true)
        )
        XCTAssertEqual(
            resolve(.failed(.decode(message: "x"), cached: nil, stale: false)),
            .error(retryable: false)
        )
        XCTAssertEqual(
            resolve(.failed(.api(status: 500, code: nil, body: nil), cached: nil, stale: false)),
            .error(retryable: true)
        )
        XCTAssertEqual(
            resolve(.failed(.network(message: "x"), cached: sample(), stale: false)),
            .content(expected(sample()), freshness: .live, refreshing: false)
        )
    }
}

// MARK: - Web-prop mapping + model + telemetry

@MainActor final class ChargingBreakdownSlideModelTests: XCTestCase {
    private func sample() -> ChargingBreakdownSlideData {
        ChargingBreakdownSlideData(
            superchargerPct: 60,
            dcFastPct: 10,
            acOtherPct: 30,
            totalChargeSessions: 42,
            avgChargeStartSoc: 35
        )
    }

    func testWebPropLoadStateMapping() {
        XCTAssertEqual(
            ChargingBreakdownSlideModel.loadState(data: ChargingBreakdownSlideData(), loading: true),
            .loading(cached: nil, stale: false)
        )
        XCTAssertEqual(
            ChargingBreakdownSlideModel.loadState(data: sample(), loading: true),
            .loading(cached: sample(), stale: false)
        )
        XCTAssertEqual(
            ChargingBreakdownSlideModel.loadState(data: ChargingBreakdownSlideData(), loading: false),
            .empty(stale: false)
        )
        XCTAssertEqual(
            ChargingBreakdownSlideModel.loadState(data: sample(), loading: false),
            .loaded(sample(), stale: false)
        )
    }

    func testViewOpenedEventCarriesSurfaceSlug() {
        XCTAssertEqual(ChargingBreakdownSlide.surfaceSlug, "ChargingBreakdownSlide")
        XCTAssertEqual(
            ChargingBreakdownSlide.viewOpenedEvent,
            DashboardWidgetTelemetryEvent(name: "view.opened", surface: "ChargingBreakdownSlide")
        )
    }

    func testBufferedTelemetryRecordsEvent() {
        let sink = BufferedDashboardWidgetTelemetry()
        sink.record(ChargingBreakdownSlide.viewOpenedEvent)
        XCTAssertEqual(
            sink.events,
            [DashboardWidgetTelemetryEvent(name: "view.opened", surface: "ChargingBreakdownSlide")]
        )
    }

    func testWebPropConvenienceInit() {
        let populated = ChargingBreakdownSlideModel(data: sample())
        XCTAssertEqual(populated.state, .loaded(sample(), stale: false))
        let empty = ChargingBreakdownSlideModel(data: ChargingBreakdownSlideData())
        XCTAssertEqual(empty.state, .empty(stale: false))
    }

    func testPreviewModelExposesInjectedState() {
        let model = ChargingBreakdownSlideModel(previewState: .loaded(sample(), stale: true))
        XCTAssertEqual(model.state, .loaded(sample(), stale: true))
    }

    func testSourceBackedModelStartsOnceRefreshesAndPushes() {
        let source = InMemoryChargingBreakdownSlideSource(initial: .loaded(sample(), stale: false))
        let model = ChargingBreakdownSlideModel(source: source)
        model.start()
        model.start()
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(model.state, .loaded(sample(), stale: false))
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
        source.push(.empty(stale: false))
        XCTAssertEqual(model.state, .empty(stale: false))
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}

// MARK: - Accessibility

@MainActor final class ChargingBreakdownSlideAccessibilityTests: XCTestCase {
    private let locale = Locale(identifier: "en_US")

    private func projection() -> ChargingBreakdownSlideProjection {
        ChargingBreakdownSlideProjection.make(
            from: ChargingBreakdownSlideData(
                superchargerPct: 58,
                dcFastPct: 17,
                acOtherPct: 25,
                totalChargeSessions: 1284,
                avgChargeStartSoc: 38
            ),
            locale: locale
        )
    }

    func testHeroSummaryReadsSessionsAndCaption() {
        let summary = ChargingBreakdownSlideAccessibility.heroSummary(for: projection())
        XCTAssertTrue(summary.contains("1,284"))
        XCTAssertTrue(summary.contains("charge sessions"))
        XCTAssertTrue(summary.contains("Average plug-in at 38% battery"))
    }

    func testChartSummaryReadsShareList() {
        let summary = ChargingBreakdownSlideAccessibility.chartSummary(for: projection().slices)
        XCTAssertEqual(summary, "Charging mix. Supercharger 58%, DC Fast 17%, AC / Other 25%")
    }

    func testChartSummaryEmptyFallsBackToTitle() {
        XCTAssertEqual(ChargingBreakdownSlideAccessibility.chartSummary(for: []), "Charging mix")
    }

    func testLegendLabelMatchesWebFormat() {
        let slice = ChargingBreakdownSlice(id: 0, name: "Supercharger", value: 58, percentText: "58%", colorIndex: 0)
        XCTAssertEqual(ChargingBreakdownSlideAccessibility.legendLabel(for: slice), "Supercharger (58%)")
    }
}
