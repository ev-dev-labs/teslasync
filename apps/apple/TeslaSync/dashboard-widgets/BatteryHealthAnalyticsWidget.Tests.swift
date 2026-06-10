//
//  BatteryHealthAnalyticsWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0014 · BatteryHealthAnalyticsWidget (Apple)
//
//  Unit coverage for the BatteryHealthAnalyticsWidget surface:
//    • Adapter (cached → projection) — `BatteryHealthAnalyticsWidgetProjector` value parity with the
//      web widget's colour-banding + numeric pipeline (scoreColor thresholds, fmtNumber/fmtInt grouped
//      readouts, gauge `fmtNumber(clamped, d)`, `?? 0` fallbacks, stat order + units).
//    • State holder — `BatteryHealthAnalyticsWidgetModel` phase resolution across loading / empty /
//      error / content, plus the P1/S11 `view.opened` telemetry, refresh + stale auto-refresh wiring.
//    • Registry — canonical `battery-health-analytics` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `BatteryHealthAnalyticsWidgetInMemorySource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum BatteryHealthFixture {
    static let good = BatteryHealthAnalyticsWidgetDTO(
        currentSoh: 92,
        totalCycles: 412,
        fullChargePct: 78,
        avgDepthOfDischarge: 46,
        fastChargePct: 23,
        tempExposureScore: 88,
        chargeHabitsScore: 81
    )

    static let zeroed = BatteryHealthAnalyticsWidgetDTO(
        currentSoh: 0,
        totalCycles: 0,
        fullChargePct: 0,
        avgDepthOfDischarge: 0,
        fastChargePct: 0,
        tempExposureScore: 0,
        chargeHabitsScore: 0
    )
}

// MARK: - Score bands (web `scoreColor` thresholds)

final class BatteryHealthScoreBandTests: XCTestCase {
    func testThresholdBoundaries() {
        XCTAssertEqual(BatteryHealthScoreBand.classify(100), .good)
        XCTAssertEqual(BatteryHealthScoreBand.classify(80), .good)
        XCTAssertEqual(BatteryHealthScoreBand.classify(79.999), .fair)
        XCTAssertEqual(BatteryHealthScoreBand.classify(50), .fair)
        XCTAssertEqual(BatteryHealthScoreBand.classify(49.999), .poor)
        XCTAssertEqual(BatteryHealthScoreBand.classify(0), .poor)
    }

    func testNonFiniteCollapsesToPoor() {
        XCTAssertEqual(BatteryHealthScoreBand.classify(.nan), .poor)
        XCTAssertEqual(BatteryHealthScoreBand.classify(-10), .poor)
    }
}

// MARK: - Number formatting (grouped fmtInt + gauge fmtNumber)

final class BatteryHealthAnalyticsWidgetFormatTests: XCTestCase {
    func testIntegerGroupsThousands() {
        XCTAssertEqual(BatteryHealthAnalyticsWidgetFormat.integer(1287, localeIdentifier: "en_US"), "1,287")
        XCTAssertEqual(BatteryHealthAnalyticsWidgetFormat.integer(412, localeIdentifier: "en_US"), "412")
    }

    func testIntegerNonFiniteCollapsesToZero() {
        XCTAssertEqual(BatteryHealthAnalyticsWidgetFormat.integer(.nan, localeIdentifier: "en_US"), "0")
        XCTAssertEqual(BatteryHealthAnalyticsWidgetFormat.integer(.infinity, localeIdentifier: "en_US"), "0")
    }

    func testGaugeValueIntegerUsesZeroDecimals() {
        XCTAssertEqual(
            BatteryHealthAnalyticsWidgetFormat.gaugeValue(92, max: 100, precision: 2, localeIdentifier: "en_US"),
            "92"
        )
    }

    func testGaugeValueFractionUsesPrecision() {
        XCTAssertEqual(
            BatteryHealthAnalyticsWidgetFormat.gaugeValue(88.5, max: 100, precision: 2, localeIdentifier: "en_US"),
            "88.50"
        )
    }

    func testGaugeValueClampsIntoRange() {
        XCTAssertEqual(
            BatteryHealthAnalyticsWidgetFormat.gaugeValue(120, max: 100, precision: 2, localeIdentifier: "en_US"),
            "100"
        )
        XCTAssertEqual(
            BatteryHealthAnalyticsWidgetFormat.gaugeValue(-5, max: 100, precision: 2, localeIdentifier: "en_US"),
            "0"
        )
    }

    func testGaugeValueNonFiniteCollapsesToZero() {
        XCTAssertEqual(
            BatteryHealthAnalyticsWidgetFormat.gaugeValue(.infinity, max: 100, precision: 2, localeIdentifier: "en_US"),
            "0"
        )
    }
}

// MARK: - Adapter: cached DTO → projection (port parity with the web widget)

final class BatteryHealthAnalyticsWidgetAdapterTests: XCTestCase {
    private func project(_ dto: BatteryHealthAnalyticsWidgetDTO) -> BatteryHealthAnalyticsWidgetProjection {
        BatteryHealthAnalyticsWidgetProjector.project(
            data: dto,
            format: BatteryHealthAnalyticsWidgetFormatPrefs(localeIdentifier: "en_US", precision: 2),
            copy: .fallback
        )
    }

    func testProjectsGaugeFromCurrentSoh() {
        let gauge = project(BatteryHealthFixture.good).gauge
        XCTAssertEqual(gauge.valueText, "92")
        XCTAssertEqual(gauge.unit, "health")
        XCTAssertEqual(gauge.scoreLabel, "92")
        XCTAssertEqual(gauge.band, .good)
        XCTAssertEqual(gauge.fraction, 0.92, accuracy: 0.0001)
        XCTAssertEqual(gauge.accessibilityLabel, "Battery health 92 out of 100")
    }

    func testProjectsSixStatsInWebOrder() {
        let stats = project(BatteryHealthFixture.good).stats
        XCTAssertEqual(
            stats.map(\.id),
            ["totalCycles", "avgChargeDepth", "avgDischargeDepth", "dcFastRatio", "tempExposure", "chargeHabits"]
        )
        XCTAssertEqual(
            stats.map(\.label),
            ["Cycles", "Charge Depth", "Discharge", "DC Fast", "Temp Score", "Habits"]
        )
        XCTAssertEqual(stats.map(\.valueText), ["412", "78", "46", "23", "88", "81"])
    }

    func testProjectsStatUnitsMatchingWebLiterals() {
        let stats = project(BatteryHealthFixture.good).stats
        XCTAssertEqual(stats.map(\.unit), ["", "%", "%", "%", "/ 100", "/ 100"])
    }

    func testStatAccessibilityLabelsSpeakLabelValueUnit() {
        let stats = project(BatteryHealthFixture.good).stats
        XCTAssertEqual(stats[0].accessibilityLabel, "Cycles 412")
        XCTAssertEqual(stats[1].accessibilityLabel, "Charge Depth 78 %")
        XCTAssertEqual(stats[4].accessibilityLabel, "Temp Score 88 / 100")
        XCTAssertEqual(stats[5].accessibilityLabel, "Habits 81 / 100")
    }

    func testGroupsLargeCycleCounts() {
        let dto = BatteryHealthAnalyticsWidgetDTO(currentSoh: 70, totalCycles: 12840)
        XCTAssertEqual(project(dto).stats[0].valueText, "12,840")
    }

    func testNilFieldsFallBackToZeroLikeWeb() {
        let projection = project(BatteryHealthAnalyticsWidgetDTO())
        XCTAssertEqual(projection.gauge.valueText, "0")
        XCTAssertEqual(projection.gauge.scoreLabel, "0")
        XCTAssertEqual(projection.gauge.fraction, 0, accuracy: 0.0001)
        XCTAssertEqual(projection.gauge.band, .poor)
        XCTAssertEqual(projection.stats.map(\.valueText), ["0", "0", "0", "0", "0", "0"])
    }

    func testZeroedDataRendersGaugeNotEmpty() {
        // A fully-zeroed analytics object is still a rendered gauge (poor band), not the empty state;
        // empty is reserved for the query yielding no analytics object at all.
        let projection = project(BatteryHealthFixture.zeroed)
        XCTAssertEqual(projection.gauge.valueText, "0")
        XCTAssertEqual(projection.gauge.band, .poor)
        XCTAssertEqual(projection.stats.count, 6)
    }

    func testBandTracksCurrentSoh() {
        XCTAssertEqual(project(BatteryHealthAnalyticsWidgetDTO(currentSoh: 85)).gauge.band, .good)
        XCTAssertEqual(project(BatteryHealthAnalyticsWidgetDTO(currentSoh: 64)).gauge.band, .fair)
        XCTAssertEqual(project(BatteryHealthAnalyticsWidgetDTO(currentSoh: 30)).gauge.band, .poor)
    }

    func testCopyIsLocalizableViaInjection() {
        let copy = BatteryHealthAnalyticsCopy(
            scoreUnit: "salud",
            totalCycles: "Ciclos",
            avgChargeDepth: "Profundidad de carga",
            avgDischargeDepth: "Descarga",
            dcFastRatio: "Carga rápida",
            tempExposure: "Puntuación de temp.",
            chargeHabits: "Hábitos",
            percentUnit: "%",
            outOfHundredUnit: "/ 100",
            gaugeA11y: "Salud de la batería %1$@ de 100"
        )
        let projection = BatteryHealthAnalyticsWidgetProjector.project(
            data: BatteryHealthAnalyticsWidgetDTO(currentSoh: 70, totalCycles: 100),
            format: BatteryHealthAnalyticsWidgetFormatPrefs(localeIdentifier: "en_US", precision: 2),
            copy: copy
        )
        XCTAssertEqual(projection.gauge.unit, "salud")
        XCTAssertEqual(projection.gauge.accessibilityLabel, "Salud de la batería 70 de 100")
        XCTAssertEqual(projection.stats[0].label, "Ciclos")
        XCTAssertEqual(projection.stats[0].accessibilityLabel, "Ciclos 100")
    }
}

// MARK: - State holder: phases + telemetry + source wiring

final class BatteryHealthAnalyticsWidgetPhaseTests: XCTestCase {
    private typealias Model = BatteryHealthAnalyticsWidgetModel

    func testResolvePhaseMatrix() {
        XCTAssertEqual(Model.resolvePhase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(Model.resolvePhase(status: .loading, hasData: true), .content)
        XCTAssertEqual(Model.resolvePhase(status: .empty, hasData: false), .empty)
        XCTAssertEqual(Model.resolvePhase(status: .empty, hasData: true), .empty)
        XCTAssertEqual(Model.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(Model.resolvePhase(status: .loaded, hasData: true), .content)
        XCTAssertEqual(Model.resolvePhase(status: .failed("x"), hasData: false), .error("x"))
        XCTAssertEqual(Model.resolvePhase(status: .failed("x"), hasData: true), .content)
    }
}

@MainActor
final class BatteryHealthAnalyticsWidgetModelTests: XCTestCase {
    private func makeModel(
        _ update: BatteryHealthAnalyticsWidgetUpdate,
        telemetry: BatteryHealthAnalyticsWidgetTelemetry = BatteryHealthAnalyticsWidgetOSLogTelemetry()
    ) -> (BatteryHealthAnalyticsWidgetModel, BatteryHealthAnalyticsWidgetInMemorySource) {
        let source = BatteryHealthAnalyticsWidgetInMemorySource(initial: update)
        let model = BatteryHealthAnalyticsWidgetModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(BatteryHealthAnalyticsWidgetUpdate(status: .loading, data: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertNil(model.projection)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(BatteryHealthAnalyticsWidgetUpdate(status: .loaded, data: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(BatteryHealthAnalyticsWidgetUpdate(status: .failed("boom"), data: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsContentEvenWhileFailed() {
        let (model, _) = makeModel(
            BatteryHealthAnalyticsWidgetUpdate(status: .failed("net"), data: BatteryHealthFixture.good)
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.gauge.valueText, "92")
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = BHASpyBatteryHealthTelemetry()
        let (model, source) = makeModel(
            BatteryHealthAnalyticsWidgetUpdate(status: .loading, data: nil),
            telemetry: spy
        )
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [BatteryHealthAnalyticsWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(BatteryHealthAnalyticsWidgetUpdate(status: .loaded, data: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testAutoRefreshOnlyWhenStaleAndNotFetching() {
        let (model, source) = makeModel(
            BatteryHealthAnalyticsWidgetUpdate(status: .loaded, data: BatteryHealthFixture.good)
        )
        model.start()

        model.autoRefreshIfStale() // live → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(
            BatteryHealthAnalyticsWidgetUpdate(
                status: .loaded,
                connection: .stale,
                isFetching: true,
                data: BatteryHealthFixture.good
            )
        )
        model.autoRefreshIfStale() // stale but fetching → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(
            BatteryHealthAnalyticsWidgetUpdate(
                status: .loaded,
                connection: .stale,
                isFetching: false,
                data: BatteryHealthFixture.good
            )
        )
        model.autoRefreshIfStale() // stale + idle → refresh
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(BatteryHealthAnalyticsWidgetUpdate(status: .loading, data: nil))
        model.start()
        source.push(
            BatteryHealthAnalyticsWidgetUpdate(
                status: .loaded,
                connection: .offline,
                data: BatteryHealthFixture.good,
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.stats.count, 6)
    }
}

// MARK: - Registry parity

final class BatteryHealthAnalyticsWidgetRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = BatteryHealthAnalyticsWidget.registration
        XCTAssertEqual(registration.id, "battery-health-analytics")
        XCTAssertEqual(registration.category, "battery")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
        XCTAssertEqual(BatteryHealthAnalyticsWidget.surfaceSlug, "BatteryHealthAnalyticsWidget")
    }

    func testClampHonorsMinAndMax() {
        let registration = BatteryHealthAnalyticsWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 1, rows: 1)), DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 2, rows: 6)),
            DashboardWidgetSize(cols: 2, rows: 6)
        )
    }
}

// MARK: - Accessibility summary content

final class BatteryHealthAnalyticsWidgetAccessibilityTests: XCTestCase {
    func testSummaryIncludesTitleGaugeAndEveryStat() {
        let projection = BatteryHealthAnalyticsWidgetProjector.project(
            data: BatteryHealthFixture.good,
            format: BatteryHealthAnalyticsWidgetFormatPrefs(localeIdentifier: "en_US", precision: 2),
            copy: .fallback
        )
        let summary = BatteryHealthAnalyticsWidgetAccessibility.summary(
            for: projection,
            title: "Battery Analytics"
        )
        XCTAssertTrue(summary.hasPrefix("Battery Analytics"))
        XCTAssertTrue(summary.contains("Battery health 92 out of 100"))
        XCTAssertTrue(summary.contains("Cycles 412"))
        XCTAssertTrue(summary.contains("Charge Depth 78 %"))
        XCTAssertTrue(summary.contains("Temp Score 88 / 100"))
        XCTAssertTrue(summary.contains("Habits 81 / 100"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class BHASpyBatteryHealthTelemetry: BatteryHealthAnalyticsWidgetTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
