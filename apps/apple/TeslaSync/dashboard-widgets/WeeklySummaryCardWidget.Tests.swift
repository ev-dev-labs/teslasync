//
//  WeeklySummaryCardWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0117 · WeeklySummaryCardWidget (Apple)
//
//  Unit coverage for the WeeklySummaryCardWidget surface:
//    • Adapter (cached → projection) — `WeeklySummaryBuilder` value parity with
//      the web widget's numeric pipeline (km → mi quirk, efficiency Wh/km → Wh/mi,
//      fmtNumber / fmtPercent / formatCurrency) and the `trendOf` port.
//    • State holder — `WeeklySummaryModel` phase resolution across loading /
//      empty / error / content, plus the P1/S11 `view.opened` telemetry, refresh
//      + stale auto-refresh wiring.
//    • Registry — canonical `weekly-summary-card` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content incl. trend phrasing.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemoryWeeklySummarySource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Sample fixtures

private enum WeeklySummaryFixture {
    /// A digest with clean week-over-week ratios so the trend percentages are
    /// exact: distance +25%, energy −20%, cost +25%, efficiency −10%.
    static let digest = WeeklySummaryCardWidgetDigestDTO(
        drives: 8,
        distanceKm: 5000,
        energyKwh: 20,
        cost: 12.5,
        efficiency: 180,
        prevDrives: 6,
        prevDistanceKm: 4000,
        prevEnergyKwh: 25,
        prevCost: 10,
        prevEfficiency: 200
    )

    static func units(_ distance: WeeklyDistanceUnit) -> WeeklyUnitPrefs {
        WeeklyUnitPrefs(distance: distance, currencySymbol: "$", precision: 2, localeIdentifier: "en_US")
    }
}

// MARK: - Adapter: cached DTO → projection (port parity with the web widget)

@MainActor
final class WeeklySummaryAdapterTests: XCTestCase {
    func testProjectReturnsNilWithoutDigest() {
        XCTAssertNil(WeeklySummaryBuilder.project(nil, units: WeeklySummaryFixture.units(.kilometers)))
    }

    /// Pins the exact display strings + trend chips the web widget produces for
    /// the km preference. Distance reproduces the source verbatim:
    /// distanceKm * KM_TO_MI, then convertDistanceFromSI(value, 'km') = value / 1000.
    func testKilometresProjection() throws {
        let projection = try XCTUnwrap(
            WeeklySummaryBuilder.project(WeeklySummaryFixture.digest, units: WeeklySummaryFixture.units(.kilometers))
        )

        XCTAssertEqual(projection.distanceValue, "3.1")
        XCTAssertEqual(projection.distanceCompactValue, "3")
        XCTAssertEqual(projection.distanceUnit, "km")
        XCTAssertEqual(projection.distanceTrend, WeeklyTrend(direction: .up, value: "25%", positive: true))

        XCTAssertEqual(projection.energyValue, "20.0")
        XCTAssertEqual(projection.energyTrend, WeeklyTrend(direction: .down, value: "20%", positive: false))

        XCTAssertEqual(projection.costValue, "$12.50")
        // Cost rose, but lower is better → up arrow, not positive (red).
        XCTAssertEqual(projection.costTrend, WeeklyTrend(direction: .up, value: "25%", positive: false))

        XCTAssertEqual(projection.efficiencyValue, "290")
        XCTAssertEqual(projection.efficiencyUnit, "Wh/km")
        // Efficiency fell, lower Wh is better → down arrow, positive (green).
        XCTAssertEqual(projection.efficiencyTrend, WeeklyTrend(direction: .down, value: "10%", positive: true))
    }

    /// Pins the mile branch: distance uses /1609.344 and efficiency multiplies the
    /// Wh/km basis by the exact 1.609344 metre factor, with the `Wh/mi` label.
    func testMilesProjection() throws {
        let projection = try XCTUnwrap(
            WeeklySummaryBuilder.project(WeeklySummaryFixture.digest, units: WeeklySummaryFixture.units(.miles))
        )

        XCTAssertEqual(projection.distanceValue, "1.9")
        XCTAssertEqual(projection.distanceCompactValue, "2")
        XCTAssertEqual(projection.distanceUnit, "mi")

        XCTAssertEqual(projection.efficiencyValue, "466")
        XCTAssertEqual(projection.efficiencyUnit, "Wh/mi")

        // Trends are unit-invariant ratios, so they match the km projection.
        XCTAssertEqual(projection.distanceTrend, WeeklyTrend(direction: .up, value: "25%", positive: true))
        XCTAssertEqual(projection.efficiencyTrend, WeeklyTrend(direction: .down, value: "10%", positive: true))
    }

    func testProjectionHonorsCurrencySymbolAndPrecision() throws {
        let units = WeeklyUnitPrefs(distance: .kilometers, currencySymbol: "€", precision: 0)
        let projection = try XCTUnwrap(WeeklySummaryBuilder.project(WeeklySummaryFixture.digest, units: units))
        XCTAssertEqual(projection.costValue, "€13")
    }

    func testEmptyDigestProjectsToZeroesAndFlatTrends() throws {
        let projection = try XCTUnwrap(
            WeeklySummaryBuilder.project(WeeklySummaryCardWidgetDigestDTO(), units: WeeklySummaryFixture.units(.kilometers))
        )
        XCTAssertEqual(projection.distanceValue, "0.0")
        XCTAssertEqual(projection.energyValue, "0.0")
        XCTAssertEqual(projection.costValue, "$0.00")
        XCTAssertEqual(projection.efficiencyValue, "0")
        // previous == 0 for every metric → flat "—" trend with no semantic colour.
        XCTAssertEqual(projection.distanceTrend, WeeklyTrend(direction: .flat, value: "—", positive: nil))
        XCTAssertEqual(projection.costTrend, WeeklyTrend(direction: .flat, value: "—", positive: nil))
    }

    func testMetricsCarryDrivesForParity() {
        let metrics = WeeklySummaryBuilder.metrics(
            from: WeeklySummaryFixture.digest,
            units: WeeklySummaryFixture.units(.kilometers)
        )
        XCTAssertEqual(metrics.drives, 8)
        XCTAssertEqual(metrics.prevDrives, 6)
        XCTAssertEqual(metrics.energy, 20, accuracy: 1e-9)
    }

    func testConvertDistanceFromSIFactors() {
        XCTAssertEqual(convertWeeklyDistanceFromSI(1000, to: .kilometers), 1, accuracy: 1e-9)
        XCTAssertEqual(convertWeeklyDistanceFromSI(1609.344, to: .miles), 1, accuracy: 1e-9)
        XCTAssertEqual(convertWeeklyDistanceFromSI(0.3048, to: .feet), 1, accuracy: 1e-9)
        XCTAssertEqual(convertWeeklyDistanceFromSI(.nan, to: .kilometers), 0)
    }

    func testNumberFormatting() {
        XCTAssertEqual(WeeklyNumberFormat.number(10000, fractionDigits: 0), "10,000")
        XCTAssertEqual(WeeklyNumberFormat.number(1234.5, fractionDigits: 0), "1,235")
        XCTAssertEqual(WeeklyNumberFormat.number(1234.4, fractionDigits: 0), "1,234")
        XCTAssertEqual(WeeklyNumberFormat.percent(25), "25%")
        XCTAssertEqual(WeeklyNumberFormat.currency(12.5, symbol: "$", precision: 2), "$12.50")
        XCTAssertEqual(WeeklyNumberFormat.number(.infinity, fractionDigits: 1), "0.0")
    }

    func testUnitLabelParsing() {
        XCTAssertEqual(WeeklyDistanceUnit.fromLabel("mi"), .miles)
        XCTAssertEqual(WeeklyDistanceUnit.fromLabel("KM"), .kilometers)
        XCTAssertEqual(WeeklyDistanceUnit.fromLabel("ft"), .feet)
        XCTAssertEqual(WeeklyDistanceUnit.fromLabel(nil), .kilometers)
        XCTAssertEqual(WeeklyDistanceUnit.fromLabel("parsecs"), .kilometers)
        XCTAssertEqual(WeeklyDistanceUnit.kilometers.efficiencyLabel, "Wh/km")
        XCTAssertEqual(WeeklyDistanceUnit.miles.efficiencyLabel, "Wh/mi")
    }
}

// MARK: - Trend (port parity with the web `trendOf`)

@MainActor
final class WeeklySummaryTrendTests: XCTestCase {
    func testZeroPreviousIsFlatDash() {
        XCTAssertEqual(
            WeeklySummaryBuilder.trend(current: 5, previous: 0),
            WeeklyTrend(direction: .flat, value: "—", positive: nil)
        )
    }

    func testSubOnePercentIsFlatApprox() {
        XCTAssertEqual(
            WeeklySummaryBuilder.trend(current: 100.5, previous: 100),
            WeeklyTrend(direction: .flat, value: "~0%", positive: nil)
        )
        XCTAssertEqual(
            WeeklySummaryBuilder.trend(current: 100, previous: 100),
            WeeklyTrend(direction: .flat, value: "~0%", positive: nil)
        )
    }

    func testHigherIsPositiveByDefault() {
        XCTAssertEqual(
            WeeklySummaryBuilder.trend(current: 125, previous: 100),
            WeeklyTrend(direction: .up, value: "25%", positive: true)
        )
        XCTAssertEqual(
            WeeklySummaryBuilder.trend(current: 80, previous: 100),
            WeeklyTrend(direction: .down, value: "20%", positive: false)
        )
    }

    func testLowerIsPositiveInverts() {
        // Decrease with lowerIsPositive → down arrow but positive (green).
        XCTAssertEqual(
            WeeklySummaryBuilder.trend(current: 80, previous: 100, lowerIsPositive: true),
            WeeklyTrend(direction: .down, value: "20%", positive: true)
        )
        // Increase with lowerIsPositive → up arrow but not positive (red).
        XCTAssertEqual(
            WeeklySummaryBuilder.trend(current: 120, previous: 100, lowerIsPositive: true),
            WeeklyTrend(direction: .up, value: "20%", positive: false)
        )
    }
}

// MARK: - State holder: phases

@MainActor
final class WeeklySummaryPhaseTests: XCTestCase {
    func testResolvePhaseMatrix() {
        XCTAssertEqual(WeeklySummaryModel.resolvePhase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(WeeklySummaryModel.resolvePhase(status: .loading, hasData: true), .content)
        XCTAssertEqual(WeeklySummaryModel.resolvePhase(status: .empty, hasData: false), .empty)
        XCTAssertEqual(WeeklySummaryModel.resolvePhase(status: .empty, hasData: true), .empty)
        XCTAssertEqual(WeeklySummaryModel.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(WeeklySummaryModel.resolvePhase(status: .loaded, hasData: true), .content)
        XCTAssertEqual(WeeklySummaryModel.resolvePhase(status: .failed("x"), hasData: false), .error("x"))
        XCTAssertEqual(WeeklySummaryModel.resolvePhase(status: .failed("x"), hasData: true), .content)
    }
}

@MainActor
final class WeeklySummaryModelTests: XCTestCase {
    private func makeModel(
        _ update: WeeklySummaryUpdate,
        telemetry: WeeklySummaryTelemetry = OSLogWeeklySummaryTelemetry()
    ) -> (WeeklySummaryModel, InMemoryWeeklySummarySource) {
        let source = InMemoryWeeklySummarySource(initial: update)
        let model = WeeklySummaryModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(WeeklySummaryUpdate(status: .loading, digest: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(WeeklySummaryUpdate(status: .loaded, digest: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(WeeklySummaryUpdate(status: .failed("boom"), digest: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsContentEvenWhileFailed() {
        let (model, _) = makeModel(WeeklySummaryUpdate(status: .failed("net"), digest: WeeklySummaryFixture.digest))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertNotNil(model.projection)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyWeeklySummaryTelemetry()
        let (model, source) = makeModel(WeeklySummaryUpdate(status: .loading, digest: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [WeeklySummaryCardWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(WeeklySummaryUpdate(status: .loaded, digest: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testAutoRefreshOnlyWhenStaleAndNotFetching() {
        let digest = WeeklySummaryFixture.digest
        let (model, source) = makeModel(WeeklySummaryUpdate(status: .loaded, digest: digest))
        model.start()

        model.autoRefreshIfStale() // live → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(WeeklySummaryUpdate(status: .loaded, connection: .stale, isFetching: true, digest: digest))
        model.autoRefreshIfStale() // stale but fetching → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(WeeklySummaryUpdate(status: .loaded, connection: .stale, isFetching: false, digest: digest))
        model.autoRefreshIfStale() // stale + idle → refresh
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testConnectionUnitsAndProjectionTrackUpdates() {
        let (model, source) = makeModel(WeeklySummaryUpdate(status: .loading, digest: nil))
        model.start()
        source.push(
            WeeklySummaryUpdate(
                status: .loaded,
                connection: .offline,
                digest: WeeklySummaryFixture.digest,
                units: WeeklySummaryFixture.units(.miles),
                vehicle: WeeklyVehicleRef(id: 3, displayName: "Cybertruck"),
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.units.distance, .miles)
        XCTAssertEqual(model.vehicle?.id, 3)
        XCTAssertEqual(model.projection?.distanceUnit, "mi")
    }
}

// MARK: - Registry parity

@MainActor
final class WeeklySummaryRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = WeeklySummaryCardWidget.registration
        XCTAssertEqual(registration.id, "weekly-summary-card")
        XCTAssertEqual(registration.category, "analytics")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 2))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
        XCTAssertEqual(WeeklySummaryCardWidget.surfaceSlug, "WeeklySummaryCardWidget")
    }

    func testClampHonorsMinAndMax() {
        let registration = WeeklySummaryCardWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)), DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 3, rows: 12)),
            DashboardWidgetSize(cols: 3, rows: 12)
        )
    }
}

// MARK: - Accessibility summary content

@MainActor
final class WeeklySummaryAccessibilityTests: XCTestCase {
    func testSummaryIncludesEveryStatAndTrendPhrase() throws {
        let projection = try XCTUnwrap(
            WeeklySummaryBuilder.project(WeeklySummaryFixture.digest, units: WeeklySummaryFixture.units(.kilometers))
        )
        let summary = WeeklySummaryAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Weekly Summary"))
        XCTAssertTrue(summary.contains("Distance 3.1 km up 25%"))
        XCTAssertTrue(summary.contains("Energy 20.0 kWh down 20%"))
        XCTAssertTrue(summary.contains("Cost $12.50 up 25%"))
        XCTAssertTrue(summary.contains("Efficiency 290 Wh/km down 10%"))
    }

    func testSummaryOmitsTrendPhraseForFlatDash() throws {
        let projection = try XCTUnwrap(
            WeeklySummaryBuilder.project(
                WeeklySummaryCardWidgetDigestDTO(distanceKm: 100),
                units: WeeklySummaryFixture.units(.kilometers)
            )
        )
        let summary = WeeklySummaryAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Distance"))
        XCTAssertFalse(summary.contains("up"))
        XCTAssertFalse(summary.contains("down"))
    }

    func testTrendPhraseForFlatApproxIsNoChange() {
        let flat = WeeklyTrend(direction: .flat, value: "~0%", positive: nil)
        XCTAssertEqual(WeeklySummaryAccessibility.trendPhrase(flat), "no change")
        let dash = WeeklyTrend(direction: .flat, value: "—", positive: nil)
        XCTAssertNil(WeeklySummaryAccessibility.trendPhrase(dash))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyWeeklySummaryTelemetry: WeeklySummaryTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
