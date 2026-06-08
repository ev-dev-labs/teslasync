//
//  OverviewTab.Tests.swift
//  TeslaSync — P4 feature view · 0059 · OverviewTab (Apple)
//
//  Unit coverage for the OverviewTab surface:
//    • Adapter (cached → projection) — `OverviewProjection` `safe()` guard, the SI-distance
//      conversion (km + mi) the "Distance by Vehicle" bar applies versus the raw day/month
//      values, the three row projections, the section phase resolution, the dual-axis overlay
//      scaling, the `QUICK_LINKS` parity, and the compact number formatting.
//    • State holder — `OverviewModel` phase resolution across loading / error / content, the
//      cached-stays-visible rule, the analytics-refresh delegation, the stale auto-refresh,
//      the unit flow into the bars, the Quick Links routing, and the P1/S11 `view.opened`
//      telemetry.
//    • Accessibility — the VoiceOver chart summaries.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store: the model is driven by `InMemoryOverviewSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: conversion / projection / phase (web parity)

@MainActor
final class OverviewAdapterTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testSafeCoercesMissingAndNonFinite() {
        XCTAssertEqual(OverviewProjection.safe(nil), 0)
        XCTAssertEqual(OverviewProjection.safe(.nan), 0)
        XCTAssertEqual(OverviewProjection.safe(.infinity), 0)
        XCTAssertEqual(OverviewProjection.safe(42.5), 42.5)
    }

    func testConvertDistanceFromSIKilometersAndMiles() {
        XCTAssertEqual(OverviewProjection.convertDistanceFromSI(meters: 1000, unit: "km"), 1, accuracy: 0.0001)
        XCTAssertEqual(OverviewProjection.convertDistanceFromSI(meters: 1609.344, unit: "mi"), 1, accuracy: 0.0001)
        XCTAssertEqual(
            OverviewProjection.convertDistanceFromSI(meters: 1000, unit: "mi"),
            0.621371,
            accuracy: 0.0001
        )
    }

    func testVehicleBarsConvertAndPreserveOrder() {
        let inputs = [
            OverviewVehicleInput(id: 7, name: "Model 3", distanceKm: 100),
            OverviewVehicleInput(id: 9, name: "Model Y", distanceKm: 200)
        ]
        let km = OverviewProjection.vehicleBars(from: inputs, distanceUnit: "km")
        XCTAssertEqual(km.map(\.name), ["Model 3", "Model Y"])
        XCTAssertEqual(km[0].id, "7")
        XCTAssertEqual(km[0].distance, 100, accuracy: 0.0001)

        let mi = OverviewProjection.vehicleBars(from: inputs, distanceUnit: "mi")
        XCTAssertEqual(mi[0].distance, 100 / OverviewProjection.kmPerMile, accuracy: 0.0001)
    }

    func testDayAndMonthDataProjectRawWithSafeGuard() {
        let days = OverviewProjection.dayData(from: [OverviewDayInput(day: "Mon", drives: .nan, avgDistance: 12)])
        XCTAssertEqual(days[0].day, "Mon")
        XCTAssertEqual(days[0].drives, 0)
        XCTAssertEqual(days[0].avgDistance, 12)

        let months = OverviewProjection.monthData(
            from: [OverviewMonthInput(month: "Jan", cost: 10, gasCost: 30, savings: .infinity)]
        )
        XCTAssertEqual(months[0].month, "Jan")
        XCTAssertEqual(months[0].cost, 10)
        XCTAssertEqual(months[0].gasCost, 30)
        XCTAssertEqual(months[0].savings, 0)
    }

    func testResolvePhaseMatrix() {
        XCTAssertEqual(OverviewProjection.resolvePhase(.loading, hasData: false), .loading)
        XCTAssertEqual(OverviewProjection.resolvePhase(.loading, hasData: true), .content)
        XCTAssertEqual(OverviewProjection.resolvePhase(.empty, hasData: false), .empty)
        XCTAssertEqual(OverviewProjection.resolvePhase(.empty, hasData: true), .content)
        XCTAssertEqual(OverviewProjection.resolvePhase(.loaded, hasData: false), .content)
        XCTAssertEqual(OverviewProjection.resolvePhase(.loaded, hasData: true), .content)
        XCTAssertEqual(OverviewProjection.resolvePhase(.failed("e"), hasData: false), .error("e"))
        XCTAssertEqual(OverviewProjection.resolvePhase(.failed("e"), hasData: true), .content)
    }

    func testHasAnyData() {
        XCTAssertFalse(OverviewProjection.hasAnyData(vehicles: [], days: [], months: []))
        XCTAssertTrue(
            OverviewProjection.hasAnyData(
                vehicles: [OverviewVehicleInput(id: 1, name: "A", distanceKm: 1)],
                days: [],
                months: []
            )
        )
    }

    func testDistanceUnitLabel() {
        XCTAssertEqual(OverviewProjection.distanceUnitLabel("mi"), "mi")
        XCTAssertEqual(OverviewProjection.distanceUnitLabel("km"), "km")
        XCTAssertEqual(OverviewProjection.distanceUnitLabel("furlong"), "km")
    }

    func testQuickLinksMatchWebTable() {
        let links = OverviewProjection.quickLinks
        XCTAssertEqual(
            links.map(\.route),
            ["/statistics", "/period-compare", "/weekly-digest", "/mileage", "/timeline"]
        )
        XCTAssertEqual(
            links.map(\.labelKey),
            [
                "analytics.links.statistics",
                "analytics.links.compare",
                "analytics.links.weeklyDigest",
                "analytics.links.mileage",
                "analytics.links.timeline"
            ]
        )
        XCTAssertTrue(links.allSatisfy { !$0.systemImage.isEmpty })
        XCTAssertEqual(links.map(\.id), links.map(\.route))
    }

    func testAxisScaleScalesAndUnscales() {
        let scale = OverviewAxisScale(primaryMax: 100, secondaryMax: 50)
        XCTAssertEqual(scale.factor, 2, accuracy: 0.0001)
        XCTAssertEqual(scale.scaleSecondary(50), 100, accuracy: 0.0001)
        XCTAssertEqual(scale.unscale(100), 50, accuracy: 0.0001)
    }

    func testAxisScaleGuardsZero() {
        let scale = OverviewAxisScale(primaryMax: 100, secondaryMax: 0)
        XCTAssertEqual(scale.factor, 1)
        XCTAssertEqual(scale.scaleSecondary(7), 7)
        XCTAssertEqual(scale.unscale(7), 7)
    }

    func testDayAndMonthAxisScalesUseMaxima() {
        let day = OverviewProjection.dayAxisScale([
            OverviewDayDatum(id: "Mon", day: "Mon", drives: 20, avgDistance: 40),
            OverviewDayDatum(id: "Tue", day: "Tue", drives: 10, avgDistance: 10)
        ])
        XCTAssertEqual(day.factor, 20.0 / 40.0, accuracy: 0.0001)

        let month = OverviewProjection.monthAxisScale([
            OverviewMonthDatum(id: "Jan", month: "Jan", cost: 30, gasCost: 90, savings: 45)
        ])
        XCTAssertEqual(month.factor, 90.0 / 45.0, accuracy: 0.0001)
    }

    func testAxisLabelFormatting() {
        XCTAssertEqual(OverviewFormat.axisLabel(42), "42")
        XCTAssertEqual(OverviewFormat.axisLabel(1500), "1.5k")
        XCTAssertEqual(OverviewFormat.axisLabel(2_000_000), "2.0M")
        XCTAssertEqual(OverviewFormat.axisLabel(.nan), "—")
        XCTAssertEqual(OverviewFormat.decimal(3.14159, fractionDigits: 1), "3.1")
    }
}

// MARK: - Accessibility summaries

@MainActor
final class OverviewAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testSeriesSummaryIncludesMinMaxLatest() {
        let summary = OverviewAccessibility.seriesSummary(name: "Drives", values: [3, 8, 5])
        XCTAssertTrue(summary.contains("Drives"))
        XCTAssertTrue(summary.contains("min"))
        XCTAssertTrue(summary.contains("max"))
        XCTAssertTrue(summary.contains("latest"))
    }

    func testSeriesSummaryEmpty() {
        XCTAssertEqual(OverviewAccessibility.seriesSummary(name: "Drives", values: []), "Drives: no data")
    }

    func testDistanceSummaryContentAndEmpty() {
        let bars = [OverviewVehicleBar(id: "1", name: "Model 3", distance: 1820.4)]
        let summary = OverviewAccessibility.distanceSummary(bars: bars, unitLabel: "km", localize: echo)
        XCTAssertTrue(summary.contains("Distance by Vehicle"))
        XCTAssertTrue(summary.contains("Model 3"))
        XCTAssertTrue(summary.contains("km"))

        let empty = OverviewAccessibility.distanceSummary(bars: [], unitLabel: "km", localize: echo)
        XCTAssertTrue(empty.contains("No vehicle data"))
    }

    func testDaySummaryNamesBothSeries() {
        let data = [OverviewDayDatum(id: "Mon", day: "Mon", drives: 4, avgDistance: 30)]
        let summary = OverviewAccessibility.daySummary(
            data: data,
            drivesName: "Drives",
            avgName: "Avg Distance",
            localize: echo
        )
        XCTAssertTrue(summary.contains("Day of Week Pattern"))
        XCTAssertTrue(summary.contains("Drives"))
        XCTAssertTrue(summary.contains("Avg Distance"))
    }

    func testMonthSummaryNamesAllSeriesAndEmpty() {
        let data = [OverviewMonthDatum(id: "Jan", month: "Jan", cost: 10, gasCost: 30, savings: 20)]
        let summary = OverviewAccessibility.monthSummary(
            data: data,
            electricName: "Electric Cost",
            gasName: "Gas Cost",
            savingsName: "Savings",
            localize: echo
        )
        XCTAssertTrue(summary.contains("Electric Cost"))
        XCTAssertTrue(summary.contains("Gas Cost"))
        XCTAssertTrue(summary.contains("Savings"))

        let empty = OverviewAccessibility.monthSummary(
            data: [],
            electricName: "Electric Cost",
            gasName: "Gas Cost",
            savingsName: "Savings",
            localize: echo
        )
        XCTAssertTrue(empty.contains("No monthly data"))
    }
}

// MARK: - State holder: phases + refresh + units + nav + telemetry

@MainActor
final class OverviewModelTests: XCTestCase {
    private func sampleUpdate(
        status: OverviewLoadStatus = .loaded,
        connection: OverviewConnection = .live,
        distanceUnit: String = "km",
        refreshing: Bool = false
    ) -> OverviewUpdate {
        OverviewUpdate(
            status: status,
            vehicles: [OverviewVehicleInput(id: 1, name: "Model 3", distanceKm: 1609.344)],
            days: [OverviewDayInput(day: "Mon", drives: 3, avgDistance: 10)],
            months: [OverviewMonthInput(month: "Jan", cost: 10, gasCost: 30, savings: 20)],
            distanceUnit: distanceUnit,
            connection: connection,
            refreshing: refreshing,
            updatedAt: nil
        )
    }

    private func makeModel(
        _ update: OverviewUpdate,
        telemetry: OverviewTelemetry = OSLogOverviewTelemetry(),
        navigator: OverviewNavigator = OSLogOverviewNavigator()
    ) -> (OverviewModel, InMemoryOverviewSource) {
        let source = InMemoryOverviewSource(initial: update)
        let model = OverviewModel(source: source, telemetry: telemetry, navigator: navigator)
        return (model, source)
    }

    func testInitialContentPhaseAndProjection() {
        let (model, _) = makeModel(sampleUpdate())
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.vehicleBars.count, 1)
        XCTAssertEqual(model.dayData.count, 1)
        XCTAssertEqual(model.monthData.count, 1)
    }

    func testLoadingAndErrorPhases() {
        let (loading, _) = makeModel(OverviewUpdate(status: .loading))
        loading.start()
        XCTAssertEqual(loading.phase, .loading)

        let (failed, _) = makeModel(OverviewUpdate(status: .failed("boom")))
        failed.start()
        XCTAssertEqual(failed.phase, .error("boom"))
    }

    func testCachedChartsStayContentWhileFailing() {
        let (model, source) = makeModel(sampleUpdate())
        model.start()
        source.push(sampleUpdate(status: .failed("net")))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.vehicleBars.count, 1)
    }

    func testRefreshDelegates() {
        let (model, source) = makeModel(sampleUpdate())
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStaleAutoRefreshFiresOncePerEpisode() {
        let (model, source) = makeModel(sampleUpdate())
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(sampleUpdate(connection: .stale))
        source.push(sampleUpdate(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(sampleUpdate(connection: .live))
        source.push(sampleUpdate(connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testDistanceUnitFlowsIntoBars() {
        let (model, source) = makeModel(sampleUpdate())
        model.start()
        XCTAssertEqual(model.vehicleBars[0].distance, 1609.344, accuracy: 0.01)
        source.push(sampleUpdate(distanceUnit: "mi"))
        XCTAssertEqual(model.distanceUnit, "mi")
        XCTAssertEqual(model.distanceUnitLabel, "mi")
        XCTAssertEqual(model.vehicleBars[0].distance, 1000, accuracy: 0.01)
    }

    func testConnectionAndRefreshingTrackUpdates() {
        let (model, source) = makeModel(OverviewUpdate(status: .loading))
        model.start()
        source.push(sampleUpdate(connection: .offline, refreshing: true))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertTrue(model.refreshing)
    }

    func testOpenQuickLinkDelegatesToNavigator() {
        let spy = SpyOverviewNavigator()
        let (model, _) = makeModel(sampleUpdate(), navigator: spy)
        model.start()
        model.openQuickLink(model.quickLinks[0])
        XCTAssertEqual(spy.routes, ["/statistics"])
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyOverviewTelemetry()
        let (model, source) = makeModel(OverviewUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [OverviewTab.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyOverviewTelemetry: OverviewTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

/// Records routed Quick Links destinations so the navigation contract can be asserted.
private final class SpyOverviewNavigator: OverviewNavigator, @unchecked Sendable {
    private(set) var routes: [String] = []
    func open(route: String) {
        routes.append(route)
    }
}
