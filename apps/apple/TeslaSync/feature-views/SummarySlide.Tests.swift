//
//  SummarySlide.Tests.swift
//  TeslaSync — P4 feature view · 0069 · SummarySlide (Apple)
//
//  Unit coverage for the SummarySlide surface:
//    • Adapter — snake-case decode (incl. nested vehicle), partial/garbage payloads,
//      the `convertDistanceFromSI` SI→display pins, and the zero-activity `isEmpty`.
//    • Projection — stat order + formatting (drives / distance km↔mi / energy /
//      charges / CO₂), the conditional savings line + template, header formatting.
//    • Presentation resolver — every state (loading / empty / offline / error /
//      stale / content), keeping the cached review visible.
//    • Web-prop mapping — `data` + `loading` → load state.
//    • Telemetry — `view.opened` event + buffered sink.
//    • Accessibility — the card VoiceOver summary content.
//    • Model — preview/web-prop binding + source start/refresh/stop delegation.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. No network, no real store:
//  the model is driven by `InMemoryYearReviewSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum SummaryFixture {
    static let locale = Locale(identifier: "en_US")

    static func populated(savings: Double = 2310, distanceKm: Double = 10000) -> YearReviewSummary {
        YearReviewSummary(
            year: 2025,
            vehicle: YearReviewVehicle(id: 1, displayName: "Aurora", model: "Model 3 Performance"),
            totalDrives: 342,
            totalDistanceKm: distanceKm,
            totalEnergyKwh: 3120,
            totalChargeSessions: 88,
            co2OffsetKg: 1420,
            gasSavings: savings
        )
    }

    static func empty() -> YearReviewSummary {
        YearReviewSummary(year: 2025, vehicle: YearReviewVehicle(id: 1))
    }
}

// MARK: - Adapter

@MainActor final class SummarySlideAdapterTests: XCTestCase {
    func testDecodeParsesSnakeCase() {
        let json = #"""
        {"year":2025,"vehicle":{"id":7,"display_name":"Aurora","model":"model3"},
         "total_drives":342,"total_distance_km":15234.5,"total_energy_kwh":3120.0,
         "total_charge_sessions":88,"total_driving_minutes":12000,"total_charging_cost":410.0,
         "gas_savings":2310.0,"co2_offset_kg":1420.0}
        """#
        let summary = YearReviewSummary.decode(fromJSONString: json)
        XCTAssertEqual(summary?.year, 2025)
        XCTAssertEqual(summary?.vehicle.id, 7)
        XCTAssertEqual(summary?.vehicle.displayName, "Aurora")
        XCTAssertEqual(summary?.vehicle.model, "model3")
        XCTAssertEqual(summary?.totalDrives, 342)
        XCTAssertEqual(summary?.totalDistanceKm ?? 0, 15234.5, accuracy: 1e-6)
        XCTAssertEqual(summary?.totalEnergyKwh ?? 0, 3120, accuracy: 1e-6)
        XCTAssertEqual(summary?.totalChargeSessions, 88)
        XCTAssertEqual(summary?.co2OffsetKg ?? 0, 1420, accuracy: 1e-6)
        XCTAssertEqual(summary?.gasSavings ?? 0, 2310, accuracy: 1e-6)
    }

    func testDecodePartialAndGarbage() {
        XCTAssertNil(YearReviewSummary.decode(fromJSONString: "not json"))
        let partial = YearReviewSummary.decode(fromJSONString: #"{"year":2024}"#)
        XCTAssertEqual(partial?.year, 2024)
        XCTAssertEqual(partial?.totalDrives, 0)
        XCTAssertEqual(partial?.vehicle.id, 0)
        XCTAssertTrue(partial?.isEmpty ?? false)
    }

    func testConvertDistanceFromSIPins() {
        XCTAssertEqual(SummaryUnitMath.convertDistanceFromSI(1000, to: .kilometers), 1, accuracy: 1e-9)
        XCTAssertEqual(SummaryUnitMath.convertDistanceFromSI(1609.344, to: .miles), 1, accuracy: 1e-9)
        XCTAssertEqual(SummaryUnitMath.convertDistanceFromSI(0.3048, to: .feet), 1, accuracy: 1e-9)
    }

    func testDistanceUnitFromLabel() {
        XCTAssertEqual(DistanceDisplayUnit(label: "km"), .kilometers)
        XCTAssertEqual(DistanceDisplayUnit(label: "mi"), .miles)
        XCTAssertEqual(DistanceDisplayUnit(label: "ft"), .feet)
        XCTAssertEqual(DistanceDisplayUnit(label: "parsecs"), .kilometers)
        XCTAssertEqual(DistanceDisplayUnit.miles.label, "mi")
    }

    func testIsEmpty() {
        XCTAssertTrue(SummaryFixture.empty().isEmpty)
        XCTAssertFalse(SummaryFixture.populated().isEmpty)
        XCTAssertFalse(YearReviewSummary(year: 2025, vehicle: YearReviewVehicle(id: 1), totalDrives: 1).isEmpty)
    }
}

// MARK: - Projection

@MainActor final class SummarySlideProjectionTests: XCTestCase {
    private func project(
        _ summary: YearReviewSummary,
        unit: DistanceDisplayUnit
    ) -> SummaryProjection {
        SummaryProjection.make(from: summary, distanceUnit: unit, locale: SummaryFixture.locale)
    }

    func testStatOrderAndMetricValues() {
        let projection = project(SummaryFixture.populated(), unit: .kilometers)
        XCTAssertEqual(projection.stats.map(\.kind), [.drives, .distance, .energy, .charges, .co2])
        XCTAssertEqual(projection.stats.map(\.id), ["drives", "distance", "energy", "charges", "co2"])
        XCTAssertEqual(projection.stats[0].formattedValue, "342")
        XCTAssertEqual(projection.stats[1].formattedValue, "10,000")
        XCTAssertEqual(projection.stats[2].formattedValue, "3,120")
        XCTAssertEqual(projection.stats[3].formattedValue, "88")
        XCTAssertEqual(projection.stats[4].formattedValue, "1,420")
    }

    func testDistanceConvertsToImperialWithUnitLabel() {
        let metric = project(SummaryFixture.populated(), unit: .kilometers).stats[1]
        let imperial = project(SummaryFixture.populated(), unit: .miles).stats[1]
        XCTAssertEqual(metric.label, "km")
        XCTAssertEqual(metric.formattedValue, "10,000")
        XCTAssertEqual(imperial.label, "mi")
        XCTAssertEqual(imperial.formattedValue, "6,214")
    }

    func testStatLabelsResolveWebFallbacks() {
        let stats = project(SummaryFixture.populated(), unit: .kilometers).stats
        XCTAssertEqual(stats[0].label, "Drives")
        XCTAssertEqual(stats[2].label, "kWh")
        XCTAssertEqual(stats[3].label, "Charges")
        XCTAssertEqual(stats[4].label, "kg CO₂ saved")
    }

    func testSavingsPresentWhenPositive() {
        let savings = project(SummaryFixture.populated(savings: 2310), unit: .kilometers).savings
        XCTAssertEqual(savings?.amount, 2310)
        XCTAssertEqual(savings?.text, "Saved $2,310 vs. gas")
    }

    func testSavingsAbsentWhenNotPositive() {
        XCTAssertNil(project(SummaryFixture.populated(savings: 0), unit: .kilometers).savings)
        XCTAssertNil(project(SummaryFixture.populated(savings: -5), unit: .kilometers).savings)
    }

    func testHeaderFormatting() {
        let header = project(SummaryFixture.populated(), unit: .kilometers).header
        XCTAssertEqual(header.yearText, "2025")
        XCTAssertEqual(header.titleText, "Year in Review")
        XCTAssertEqual(header.vehicleName, "Aurora")
        XCTAssertEqual(header.vehicleModel, "Model 3 Performance")

        let blank = project(SummaryFixture.empty(), unit: .kilometers).header
        XCTAssertEqual(blank.vehicleName, "—")
        XCTAssertEqual(blank.vehicleModel, "—")
    }

    func testBrandAndScreenshotCaptions() {
        let projection = project(SummaryFixture.populated(), unit: .kilometers)
        XCTAssertEqual(projection.brandLine, "TeslaSync • Year in Review")
        XCTAssertEqual(projection.screenshotHint, "📸 Screenshot to share your year!")
    }
}

// MARK: - Presentation resolver (every state)

@MainActor final class SummarySlidePresentationTests: XCTestCase {
    private func resolve(
        _ state: SummarySlideLoadState<YearReviewSummary>,
        unit: DistanceDisplayUnit = .kilometers
    ) -> SummarySlidePresentation {
        SummarySlidePresentation.resolve(state: state, distanceUnit: unit, locale: SummaryFixture.locale)
    }

    private func expected(_ summary: YearReviewSummary, unit: DistanceDisplayUnit = .kilometers) -> SummaryProjection {
        SummaryProjection.make(from: summary, distanceUnit: unit, locale: SummaryFixture.locale)
    }

    func testLoadingStates() {
        XCTAssertEqual(resolve(.idle), .loading)
        XCTAssertEqual(resolve(.loading(cached: nil, stale: false)), .loading)
        XCTAssertEqual(resolve(.loading(cached: SummaryFixture.empty(), stale: false)), .loading)
        XCTAssertEqual(
            resolve(.loading(cached: SummaryFixture.populated(), stale: true)),
            .content(expected(SummaryFixture.populated()), freshness: .stale, refreshing: true)
        )
    }

    func testLoadedContentAndEmpty() {
        XCTAssertEqual(
            resolve(.loaded(SummaryFixture.populated(), stale: false)),
            .content(expected(SummaryFixture.populated()), freshness: .live, refreshing: false)
        )
        XCTAssertEqual(resolve(.loaded(SummaryFixture.empty(), stale: false)), .empty)
        XCTAssertEqual(resolve(.empty(stale: false)), .empty)
    }

    func testOfflineStates() {
        XCTAssertEqual(resolve(.failed(.offline, cached: nil, stale: false)), .offlineNoData)
        XCTAssertEqual(resolve(.failed(.offline, cached: SummaryFixture.empty(), stale: false)), .offlineNoData)
        XCTAssertEqual(
            resolve(.failed(.offline, cached: SummaryFixture.populated(), stale: true)),
            .content(expected(SummaryFixture.populated()), freshness: .offline, refreshing: false)
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
            resolve(.failed(.network(message: "x"), cached: SummaryFixture.populated(), stale: false)),
            .content(expected(SummaryFixture.populated()), freshness: .live, refreshing: false)
        )
    }

    func testWebPropMapping() {
        XCTAssertEqual(
            SummarySlideModel.loadState(data: SummaryFixture.empty(), loading: true),
            .loading(cached: nil, stale: false)
        )
        XCTAssertEqual(
            SummarySlideModel.loadState(data: SummaryFixture.populated(), loading: true),
            .loading(cached: SummaryFixture.populated(), stale: false)
        )
        XCTAssertEqual(
            SummarySlideModel.loadState(data: SummaryFixture.empty(), loading: false),
            .empty(stale: false)
        )
        XCTAssertEqual(
            SummarySlideModel.loadState(data: SummaryFixture.populated(), loading: false),
            .loaded(SummaryFixture.populated(), stale: false)
        )

        XCTAssertEqual(resolve(SummarySlideModel.loadState(data: SummaryFixture.empty(), loading: false)), .empty)
        XCTAssertEqual(
            resolve(SummarySlideModel.loadState(data: SummaryFixture.populated(), loading: false)),
            .content(expected(SummaryFixture.populated()), freshness: .live, refreshing: false)
        )
    }
}

// MARK: - Telemetry + model

@MainActor final class SummarySlideModelTests: XCTestCase {
    func testViewOpenedEventCarriesSurfaceSlug() {
        XCTAssertEqual(SummarySlide.surfaceSlug, "SummarySlide")
        XCTAssertEqual(
            SummarySlide.viewOpenedEvent,
            DashboardWidgetTelemetryEvent(name: "view.opened", surface: "SummarySlide")
        )
    }

    @MainActor
    func testBufferedTelemetryRecordsEvent() {
        let sink = BufferedDashboardWidgetTelemetry()
        sink.record(SummarySlide.viewOpenedEvent)
        XCTAssertEqual(
            sink.events,
            [DashboardWidgetTelemetryEvent(name: "view.opened", surface: "SummarySlide")]
        )
    }

    @MainActor
    func testPreviewModelExposesInjectedState() {
        let model = SummarySlideModel(
            previewState: .loaded(SummaryFixture.populated(), stale: false),
            distanceUnit: .miles
        )
        XCTAssertEqual(model.state, .loaded(SummaryFixture.populated(), stale: false))
        XCTAssertEqual(model.distanceUnit, .miles)
    }

    @MainActor
    func testWebPropConvenienceInit() {
        let loaded = SummarySlideModel(data: SummaryFixture.populated(), loading: false)
        XCTAssertEqual(loaded.state, .loaded(SummaryFixture.populated(), stale: false))

        let empty = SummarySlideModel(data: SummaryFixture.empty(), loading: false)
        XCTAssertEqual(empty.state, .empty(stale: false))

        let loading = SummarySlideModel(data: SummaryFixture.populated(), loading: true)
        XCTAssertEqual(loading.state, .loading(cached: SummaryFixture.populated(), stale: false))
    }

    @MainActor
    func testSourceBackedModelLifecycle() {
        let source = InMemoryYearReviewSource(initial: .loaded(SummaryFixture.populated(), stale: false))
        let model = SummarySlideModel(source: source, distanceUnit: .kilometers)
        model.start()
        model.start()
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(model.state, .loaded(SummaryFixture.populated(), stale: false))
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

@MainActor final class SummarySlideAccessibilityTests: XCTestCase {
    func testCardSummaryReadsHeaderStatsAndSavings() {
        let projection = SummaryProjection.make(
            from: SummaryFixture.populated(),
            distanceUnit: .kilometers,
            locale: SummaryFixture.locale
        )
        let summary = SummarySlideAccessibility.cardSummary(for: projection)
        XCTAssertTrue(summary.contains("Year in Review 2025"))
        XCTAssertTrue(summary.contains("Aurora"))
        XCTAssertTrue(summary.contains("342 Drives"))
        XCTAssertTrue(summary.contains("Saved $2,310 vs. gas"))
    }

    func testCardSummaryOmitsSavingsWhenAbsent() {
        let projection = SummaryProjection.make(
            from: SummaryFixture.populated(savings: 0),
            distanceUnit: .kilometers,
            locale: SummaryFixture.locale
        )
        let summary = SummarySlideAccessibility.cardSummary(for: projection)
        XCTAssertFalse(summary.contains("Saved $"))
    }
}
