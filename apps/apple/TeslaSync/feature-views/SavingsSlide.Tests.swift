//
//  SavingsSlide.Tests.swift
//  TeslaSync — P4 feature view · 0065 · SavingsSlide (Apple)
//
//  Unit coverage for the SavingsSlide surface:
//    • Adapter (cached → projection) — snake-case decode, the gas-equivalent
//      math, the grouped hero vs. un-grouped bar labels, the electric bar
//      fraction, and the cups-of-coffee note.
//    • Presentation resolver — every state (loading / empty / offline / error /
//      stale / content), keeping cached savings visible.
//    • Web-prop mapping — `data` (+ loading) → load state.
//    • Telemetry — `view.opened` event + buffered sink.
//    • Accessibility — the combined VoiceOver summary content.
//    • Model — preview/web-prop binding + source start/refresh/stop delegation.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. No network, no real store:
//  the model is driven by `InMemorySavingsSlideSource`.
//

import XCTest
@testable import TeslaSync

@MainActor final class SavingsSlideAdapterTests: XCTestCase {
    private let locale = Locale(identifier: "en_US")

    // MARK: Decode

    func testDecodeParsesSnakeCaseAndIgnoresExtraFields() {
        let json = #"""
        {"year":2025,"total_drives":182,"gas_savings":1850.0,"total_charging_cost":412.0,
         "co2_offset_kg":920.5}
        """#
        let savings = YearReviewSavings.decode(fromJSONString: json)
        XCTAssertEqual(savings?.gasSavings, 1850)
        XCTAssertEqual(savings?.totalChargingCost, 412)
    }

    func testDecodePartialDefaultsToZeroAndGarbageIsNil() {
        let partial = YearReviewSavings.decode(fromJSONString: #"{"gas_savings":500}"#)
        XCTAssertEqual(partial?.gasSavings, 500)
        XCTAssertEqual(partial?.totalChargingCost, 0)
        XCTAssertNil(YearReviewSavings.decode(fromJSONString: "not json"))
    }

    // MARK: Projection math (web render math)

    func testProjectionReproducesWebMath() {
        let projection = SavingsSlideProjection.make(
            from: YearReviewSavings(gasSavings: 1850, totalChargingCost: 412),
            locale: locale
        )
        XCTAssertEqual(projection.savingsText, "$1,850")
        XCTAssertEqual(projection.savingsValue, 1850)
        XCTAssertEqual(projection.gasCostText, "$2262")
        XCTAssertEqual(projection.electricCostText, "$412")
        XCTAssertEqual(projection.electricFraction, 0.18, accuracy: 1e-9)
        XCTAssertEqual(projection.cupsOfCoffee, 370)
        XCTAssertTrue(projection.coffeeNote.contains("370"))
    }

    func testHeroIsGroupedButBarLabelsAreNot() {
        let projection = SavingsSlideProjection.make(
            from: YearReviewSavings(gasSavings: 12345, totalChargingCost: 0),
            locale: locale
        )
        XCTAssertEqual(projection.savingsText, "$12,345")
        XCTAssertTrue(projection.savingsText.contains(","))
        XCTAssertEqual(projection.gasCostText, "$12345")
        XCTAssertFalse(projection.gasCostText.contains(","))
    }

    func testZeroSavingsGuardsTheElectricFraction() {
        let projection = SavingsSlideProjection.make(
            from: YearReviewSavings(gasSavings: 0, totalChargingCost: 0),
            locale: locale
        )
        XCTAssertEqual(projection.savingsText, "$0")
        XCTAssertEqual(projection.gasCostText, "$0")
        XCTAssertEqual(projection.electricCostText, "$0")
        XCTAssertEqual(projection.electricFraction, 0, accuracy: 1e-9)
        XCTAssertEqual(projection.cupsOfCoffee, 0)
    }

    // MARK: Accessibility

    func testSummaryReadsTheKeyAmounts() {
        let projection = SavingsSlideProjection.make(
            from: YearReviewSavings(gasSavings: 1850, totalChargingCost: 412),
            locale: locale
        )
        let summary = SavingsSlideAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains(projection.savingsText))
        XCTAssertTrue(summary.contains(projection.gasCostText))
        XCTAssertTrue(summary.contains(projection.electricCostText))
        XCTAssertTrue(summary.contains(projection.coffeeNote))
    }
}

// MARK: - Presentation resolver (every state)

@MainActor final class SavingsSlidePresentationTests: XCTestCase {
    private let locale = Locale(identifier: "en_US")
    private let savings = YearReviewSavings(gasSavings: 1850, totalChargingCost: 412)

    private func resolve(_ state: SavingsSlideLoadState<YearReviewSavings>) -> SavingsSlidePresentation {
        SavingsSlidePresentation.resolve(state: state, locale: locale)
    }

    private func expected(_ value: YearReviewSavings) -> SavingsSlideProjection {
        SavingsSlideProjection.make(from: value, locale: locale)
    }

    func testLoadingStates() {
        XCTAssertEqual(resolve(.idle), .loading)
        XCTAssertEqual(resolve(.loading(cached: nil, stale: false)), .loading)
        XCTAssertEqual(
            resolve(.loading(cached: savings, stale: true)),
            .content(expected(savings), freshness: .stale, refreshing: true)
        )
    }

    func testLoadedAndEmpty() {
        XCTAssertEqual(
            resolve(.loaded(savings, stale: false)),
            .content(expected(savings), freshness: .live, refreshing: false)
        )
        XCTAssertEqual(
            resolve(.loaded(savings, stale: true)),
            .content(expected(savings), freshness: .stale, refreshing: false)
        )
        XCTAssertEqual(resolve(.empty(stale: false)), .empty)
    }

    func testOfflineStates() {
        XCTAssertEqual(resolve(.failed(.offline, cached: nil, stale: false)), .offlineNoData)
        XCTAssertEqual(
            resolve(.failed(.offline, cached: savings, stale: true)),
            .content(expected(savings), freshness: .offline, refreshing: false)
        )
    }

    func testErrorRetryabilityAndCache() {
        XCTAssertEqual(resolve(.failed(.network(message: "x"), cached: nil, stale: false)), .error(retryable: true))
        XCTAssertEqual(resolve(.failed(.decode(message: "x"), cached: nil, stale: false)), .error(retryable: false))
        XCTAssertEqual(
            resolve(.failed(.api(status: 500, code: nil, body: nil), cached: nil, stale: false)),
            .error(retryable: true)
        )
        XCTAssertEqual(
            resolve(.failed(.network(message: "x"), cached: savings, stale: false)),
            .content(expected(savings), freshness: .live, refreshing: false)
        )
    }

    // MARK: Web-prop mapping (data + loading → load state)

    func testWebPropMapping() {
        XCTAssertEqual(
            SavingsSlideModel.loadState(data: savings, loading: false),
            .loaded(savings, stale: false)
        )
        XCTAssertEqual(
            SavingsSlideModel.loadState(data: savings, loading: true),
            .loading(cached: savings, stale: false)
        )
        XCTAssertEqual(
            resolve(SavingsSlideModel.loadState(data: savings, loading: false)),
            .content(expected(savings), freshness: .live, refreshing: false)
        )
        XCTAssertEqual(
            resolve(SavingsSlideModel.loadState(data: savings, loading: true)),
            .content(expected(savings), freshness: .live, refreshing: true)
        )
    }
}

// MARK: - Telemetry + model

@MainActor final class SavingsSlideModelTests: XCTestCase {
    private let savings = YearReviewSavings(gasSavings: 1850, totalChargingCost: 412)

    func testViewOpenedEventCarriesSurfaceSlug() {
        XCTAssertEqual(SavingsSlide.surfaceSlug, "SavingsSlide")
        XCTAssertEqual(
            SavingsSlide.viewOpenedEvent,
            DashboardWidgetTelemetryEvent(name: "view.opened", surface: "SavingsSlide")
        )
    }

    @MainActor
    func testBufferedTelemetryRecordsEvent() {
        let sink = BufferedDashboardWidgetTelemetry()
        sink.record(SavingsSlide.viewOpenedEvent)
        XCTAssertEqual(
            sink.events,
            [DashboardWidgetTelemetryEvent(name: "view.opened", surface: "SavingsSlide")]
        )
    }

    @MainActor
    func testPreviewAndWebPropModels() {
        let preview = SavingsSlideModel(previewState: .loaded(savings, stale: false))
        XCTAssertEqual(preview.state, .loaded(savings, stale: false))

        let webProp = SavingsSlideModel(data: savings)
        XCTAssertEqual(webProp.state, .loaded(savings, stale: false))

        let loading = SavingsSlideModel(data: savings, loading: true)
        XCTAssertEqual(loading.state, .loading(cached: savings, stale: false))
    }

    @MainActor
    func testSourceBackedModelStartsOnceRefreshesAndPushes() {
        let source = InMemorySavingsSlideSource(initial: .loaded(savings, stale: false))
        let model = SavingsSlideModel(source: source)
        model.start()
        model.start()
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(model.state, .loaded(savings, stale: false))
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
        source.push(.empty(stale: false))
        XCTAssertEqual(model.state, .empty(stale: false))
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}
