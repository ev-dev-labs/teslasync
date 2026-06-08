//
//  WeeklyDigestWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0116 · WeeklyDigestWidget (Apple)
//
//  Unit coverage for the WeeklyDigestWidget surface:
//    • Adapter (cached → projection) — `WeeklyDigestProjector` value parity with the web widget's
//      numeric + delta pipeline (km→mi pre-scale + convertDistanceFromSI, Wh·km→Wh·mi +
//      toEfficiencyDisplay, fmtNumber/fmtInt, the `Delta` percent / arrow / tone, `—` fallback).
//    • State holder — `WeeklyDigestModel` phase resolution (web `WidgetShell` loading → error → body
//      precedence), plus the P1/S11 `view.opened` telemetry, refresh + stale auto-refresh wiring.
//    • Registry — canonical `weekly-digest` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryWeeklyDigestSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum WeeklyDigestFixture {
    /// Distance up (100 vs 80 km = +25%), drives up (12 vs 10 = +20%), energy flat (45.6 vs 45.6),
    /// efficiency present with NO prior period (0 → the web `Delta` em-dash branch).
    static let sample = WeeklyDigestDTO(
        drives: 12,
        distanceKm: 100,
        energyKwh: 45.6,
        efficiency: 250,
        prevDrives: 10,
        prevDistanceKm: 80,
        prevEnergyKwh: 45.6,
        prevEfficiency: 0
    )

    static func metric(_ projection: WeeklyDigestProjection, _ kind: WeeklyDigestMetricKind) -> WeeklyDigestMetricRow {
        projection.metrics.first { $0.kind == kind }!
    }
}

// MARK: - Adapter: cached DTO → projection (port parity with the web widget)

@MainActor
final class WeeklyDigestAdapterTests: XCTestCase {
    func testMilesProjectionMatchesWeb() {
        let units = WeeklyDigestUnitPrefs(distance: .miles, localeIdentifier: "en_US")
        let projection = WeeklyDigestProjector.project(data: WeeklyDigestFixture.sample, units: units, copy: .fallback)

        XCTAssertEqual(projection.metrics.count, 4)
        XCTAssertEqual(projection.metrics.map(\.kind), [.distance, .drives, .energy, .efficiency])

        // distMi = 100 * 0.621371 = 62.1371; dist = 62.1371 / 1609.344 = 0.0386 → "0.0"; +25%.
        let distance = WeeklyDigestFixture.metric(projection, .distance)
        XCTAssertEqual(distance.valueText, "0.0")
        XCTAssertEqual(distance.unit, "mi")
        XCTAssertEqual(distance.valueWithUnit, "0.0 mi")
        XCTAssertEqual(distance.deltaText, "25.0%")
        XCTAssertEqual(distance.deltaDirection, .up)
        XCTAssertEqual(distance.deltaTone, .positive)

        // drives: fmtInt(12) = "12", no unit; (12-10)/10 = +20%.
        let drives = WeeklyDigestFixture.metric(projection, .drives)
        XCTAssertEqual(drives.valueText, "12")
        XCTAssertNil(drives.unit)
        XCTAssertEqual(drives.deltaText, "20.0%")
        XCTAssertEqual(drives.deltaDirection, .up)
        XCTAssertEqual(drives.deltaTone, .positive)

        // energy: 45.6 kWh, flat vs prev → "0.0%", muted.
        let energy = WeeklyDigestFixture.metric(projection, .energy)
        XCTAssertEqual(energy.valueText, "45.6")
        XCTAssertEqual(energy.unit, "kWh")
        XCTAssertEqual(energy.deltaText, "0.0%")
        XCTAssertEqual(energy.deltaDirection, .flat)
        XCTAssertEqual(energy.deltaTone, .neutral)

        // efficiency: (250*1.60934)*1.609344 = 647.5 → "647" Wh/mi; prev 0 → "—"; lower-is-better + ↑ = bad.
        let efficiency = WeeklyDigestFixture.metric(projection, .efficiency)
        XCTAssertEqual(efficiency.valueText, "647")
        XCTAssertEqual(efficiency.unit, "Wh/mi")
        XCTAssertEqual(efficiency.deltaText, "—")
        XCTAssertEqual(efficiency.deltaDirection, .up)
        XCTAssertEqual(efficiency.deltaTone, .negative)
    }

    func testKilometersProjectionMatchesWeb() {
        let units = WeeklyDigestUnitPrefs(distance: .kilometers, localeIdentifier: "en_US")
        let projection = WeeklyDigestProjector.project(data: WeeklyDigestFixture.sample, units: units, copy: .fallback)

        // distMi = 62.1371; dist = 62.1371 / 1000 = 0.0621 → "0.1" km.
        let distance = WeeklyDigestFixture.metric(projection, .distance)
        XCTAssertEqual(distance.valueText, "0.1")
        XCTAssertEqual(distance.unit, "km")
        XCTAssertEqual(distance.deltaText, "25.0%")

        // efficiency (metric): 250 * 1.60934 = 402.335 → "402" Wh/km.
        let efficiency = WeeklyDigestFixture.metric(projection, .efficiency)
        XCTAssertEqual(efficiency.valueText, "402")
        XCTAssertEqual(efficiency.unit, "Wh/km")
        XCTAssertEqual(efficiency.deltaText, "—")
    }

    func testDownDeltaAndGrouping() {
        let data = WeeklyDigestDTO(
            drives: 1234,
            distanceKm: 50,
            energyKwh: 30,
            efficiency: 200,
            prevDrives: 1500,
            prevDistanceKm: 50,
            prevEnergyKwh: 30,
            prevEfficiency: 200
        )
        let units = WeeklyDigestUnitPrefs(distance: .kilometers, localeIdentifier: "en_US")
        let projection = WeeklyDigestProjector.project(data: data, units: units, copy: .fallback)

        // drives: fmtInt(1234) groups → "1,234"; (1234-1500)/1500 = -17.733% → "17.7%" ↓; higher-better + ↓ = bad.
        let drives = WeeklyDigestFixture.metric(projection, .drives)
        XCTAssertEqual(drives.valueText, "1,234")
        XCTAssertEqual(drives.deltaText, "17.7%")
        XCTAssertEqual(drives.deltaDirection, .down)
        XCTAssertEqual(drives.deltaTone, .negative)

        // energy unchanged → "0.0%" flat neutral; "30.0" kWh.
        let energy = WeeklyDigestFixture.metric(projection, .energy)
        XCTAssertEqual(energy.valueText, "30.0")
        XCTAssertEqual(energy.deltaDirection, .flat)
        XCTAssertEqual(energy.deltaTone, .neutral)
    }

    func testNilDataYieldsEmptyProjection() {
        let projection = WeeklyDigestProjector.project(data: nil, units: WeeklyDigestUnitPrefs(), copy: .fallback)
        XCTAssertTrue(projection.isEmpty)
        XCTAssertEqual(projection.metrics.count, 0)
    }

    func testCompactSliceKeepsFirstTwoMetrics() {
        let units = WeeklyDigestUnitPrefs(distance: .miles)
        let projection = WeeklyDigestProjector.project(data: WeeklyDigestFixture.sample, units: units, copy: .fallback)
        let compact = projection.visibleMetrics(compact: true)
        XCTAssertEqual(compact.map(\.kind), [.distance, .drives])
        XCTAssertEqual(projection.visibleMetrics(compact: false).count, 4)
    }

    func testMissingFieldsFallBackToZeroLikeWeb() {
        // All nil → every value 0; deltas: previous 0 → "—".
        let projection = WeeklyDigestProjector.project(
            data: WeeklyDigestDTO(),
            units: WeeklyDigestUnitPrefs(),
            copy: .fallback
        )
        let distance = WeeklyDigestFixture.metric(projection, .distance)
        XCTAssertEqual(distance.valueText, "0.0")
        XCTAssertEqual(distance.deltaText, "—")
        XCTAssertEqual(distance.deltaDirection, .flat)
        XCTAssertEqual(distance.deltaTone, .neutral)
    }

    func testDeltaMissingInputGuard() {
        let result = WeeklyDigestProjector.delta(
            current: .nan,
            previous: 5,
            higherIsBetter: true,
            copy: .fallback,
            locale: "en_US"
        )
        XCTAssertEqual(result.text, "—")
        XCTAssertEqual(result.direction, .flat)
        XCTAssertEqual(result.tone, .neutral)
    }

    func testDeltaZeroPreviousKeepsArrowAndTone() {
        // previous 0 → percent undefined ("—") but the arrow + tone still derive from the sign.
        let lowerBetter = WeeklyDigestProjector.delta(
            current: 10,
            previous: 0,
            higherIsBetter: false,
            copy: .fallback,
            locale: "en_US"
        )
        XCTAssertEqual(lowerBetter.text, "—")
        XCTAssertEqual(lowerBetter.direction, .up)
        XCTAssertEqual(lowerBetter.tone, .negative)

        let higherBetter = WeeklyDigestProjector.delta(
            current: 10,
            previous: 0,
            higherIsBetter: true,
            copy: .fallback,
            locale: "en_US"
        )
        XCTAssertEqual(higherBetter.tone, .positive)
    }

    func testNonFiniteDistanceCollapsesToZero() {
        XCTAssertEqual(convertWeeklyDigestDistanceFromSI(.nan, to: .kilometers), 0)
        XCTAssertEqual(convertWeeklyDigestDistanceFromSI(.infinity, to: .miles), 0)
        XCTAssertEqual(WeeklyDigestFormat.number(.infinity, decimals: 1), "0.0")
    }

    func testCopyIsLocalizableViaInjection() {
        let copy = WeeklyDigestCopy(
            distanceLabel: "Distancia",
            drivesLabel: "Viajes",
            energyLabel: "Energía",
            efficiencyLabel: "Eficiencia",
            emDash: "n/d"
        )
        let projection = WeeklyDigestProjector.project(
            data: WeeklyDigestDTO(efficiency: 100, prevEfficiency: 0),
            units: WeeklyDigestUnitPrefs(distance: .miles),
            copy: copy
        )
        XCTAssertEqual(WeeklyDigestFixture.metric(projection, .distance).label, "Distancia")
        XCTAssertEqual(WeeklyDigestFixture.metric(projection, .efficiency).label, "Eficiencia")
        // prev efficiency 0 → injected em-dash glyph.
        XCTAssertEqual(WeeklyDigestFixture.metric(projection, .efficiency).deltaText, "n/d")
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor
final class WeeklyDigestPhaseTests: XCTestCase {
    func testResolvePhaseMatrix() {
        // Web `WidgetShell`: loading and error short-circuit BEFORE the body (error wins over cache).
        XCTAssertEqual(WeeklyDigestModel.resolvePhase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(WeeklyDigestModel.resolvePhase(status: .loading, hasData: true), .loading)
        XCTAssertEqual(WeeklyDigestModel.resolvePhase(status: .failed("x"), hasData: false), .error("x"))
        XCTAssertEqual(WeeklyDigestModel.resolvePhase(status: .failed("x"), hasData: true), .error("x"))
        XCTAssertEqual(WeeklyDigestModel.resolvePhase(status: .empty, hasData: false), .empty)
        XCTAssertEqual(WeeklyDigestModel.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(WeeklyDigestModel.resolvePhase(status: .loaded, hasData: true), .content)
    }
}

@MainActor
final class WeeklyDigestModelTests: XCTestCase {
    private func makeModel(
        _ update: WeeklyDigestUpdate,
        telemetry: WeeklyDigestTelemetry = OSLogWeeklyDigestTelemetry()
    ) -> (WeeklyDigestModel, InMemoryWeeklyDigestSource) {
        let source = InMemoryWeeklyDigestSource(initial: update)
        let model = WeeklyDigestModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(WeeklyDigestUpdate(status: .loading, data: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithDataShowsContent() {
        let (model, _) = makeModel(WeeklyDigestUpdate(status: .loaded, data: WeeklyDigestFixture.sample))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.metrics.count, 4)
    }

    func testLoadedWithNilDataShowsEmpty() {
        let (model, _) = makeModel(WeeklyDigestUpdate(status: .loaded, data: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.projection.isEmpty)
    }

    func testFailedShowsErrorEvenWithCachedData() {
        let (model, _) = makeModel(WeeklyDigestUpdate(status: .failed("boom"), data: WeeklyDigestFixture.sample))
        model.start()
        // Web shell renders QueryError before the body, even though cached metrics exist.
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyWeeklyDigestTelemetry()
        let (model, source) = makeModel(WeeklyDigestUpdate(status: .loading, data: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [WeeklyDigestWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(WeeklyDigestUpdate(status: .loaded, data: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testAutoRefreshOnlyWhenStaleAndNotFetching() {
        let (model, source) = makeModel(WeeklyDigestUpdate(status: .loaded, data: WeeklyDigestFixture.sample))
        model.start()

        model.autoRefreshIfStale() // live → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(WeeklyDigestUpdate(
            status: .loaded,
            connection: .stale,
            isFetching: true,
            data: WeeklyDigestFixture.sample
        ))
        model.autoRefreshIfStale() // stale but fetching → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(WeeklyDigestUpdate(
            status: .loaded,
            connection: .stale,
            isFetching: false,
            data: WeeklyDigestFixture.sample
        ))
        model.autoRefreshIfStale() // stale + idle → refresh
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(WeeklyDigestUpdate(status: .loading, data: nil))
        model.start()
        source.push(
            WeeklyDigestUpdate(
                status: .loaded,
                connection: .offline,
                data: WeeklyDigestFixture.sample,
                units: WeeklyDigestUnitPrefs(distance: .miles),
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.units.distance, .miles)
        XCTAssertEqual(model.projection.metrics.count, 4)
    }
}

// MARK: - Registry parity

@MainActor
final class WeeklyDigestRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = WeeklyDigestWidget.registration
        XCTAssertEqual(registration.id, "weekly-digest")
        XCTAssertEqual(registration.category, "analytics")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
        XCTAssertEqual(WeeklyDigestWidget.surfaceSlug, "WeeklyDigestWidget")
    }

    func testClampHonorsMinAndMax() {
        let registration = WeeklyDigestWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)), DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 2, rows: 10)),
            DashboardWidgetSize(cols: 2, rows: 10)
        )
    }
}

// MARK: - Accessibility summary content

@MainActor
final class WeeklyDigestAccessibilityTests: XCTestCase {
    func testSummaryIncludesTitleAndEveryRow() {
        let units = WeeklyDigestUnitPrefs(distance: .miles, localeIdentifier: "en_US")
        let projection = WeeklyDigestProjector.project(data: WeeklyDigestFixture.sample, units: units, copy: .fallback)
        let summary = WeeklyDigestAccessibility.summary(for: projection, title: "This Week")
        XCTAssertTrue(summary.hasPrefix("This Week"))
        XCTAssertTrue(summary.contains("Distance, 0.0 mi, trending up 25.0%"))
        XCTAssertTrue(summary.contains("Energy, 45.6 kWh, no change"))
        XCTAssertTrue(summary.contains("Efficiency, 647 Wh/mi, no prior data"))
    }

    func testCompactSummaryOnlyTwoRows() {
        let units = WeeklyDigestUnitPrefs(distance: .miles, localeIdentifier: "en_US")
        let projection = WeeklyDigestProjector.project(data: WeeklyDigestFixture.sample, units: units, copy: .fallback)
        let summary = WeeklyDigestAccessibility.summary(for: projection, title: "This Week", compact: true)
        XCTAssertTrue(summary.contains("Distance"))
        XCTAssertTrue(summary.contains("Drives"))
        XCTAssertFalse(summary.contains("Energy"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyWeeklyDigestTelemetry: WeeklyDigestTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
