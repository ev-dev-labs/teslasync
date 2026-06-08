//
//  RangeEstimateWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0077 · RangeEstimateWidget (Apple)
//
//  Unit coverage for the RangeEstimateWidget surface:
//    • Adapter (cached → projection) — `RangeEstimateProjector` value parity with the web
//      widget's numeric pipeline (convertDistanceFromSI(meters, unit) then fmtNumber(_, 0)).
//    • State holder — `RangeEstimateModel` phase resolution across loading / empty / error /
//      content, plus the P1/S11 `view.opened` telemetry, refresh + stale auto-refresh wiring.
//    • Registry — canonical `range-estimate` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store:
//  the model is driven by `InMemoryRangeEstimateSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached DTO → projection (port parity with the web widget)

@MainActor
final class RangeEstimateAdapterTests: XCTestCase {
    private let sample = RangeStateDTO(ratedRangeMeters: 405_000, idealRangeMeters: 450_000)

    /// Pins the exact display strings the web widget produces for the km preference:
    /// convertDistanceFromSI(meters, 'km') = meters / 1000, then fmtNumber(_, 0).
    func testProjectionKilometers() {
        let projection = RangeEstimateProjector.project(
            state: sample,
            units: RangeUnitPrefs(distance: .kilometers)
        )
        XCTAssertEqual(projection.rated.value, "405")
        XCTAssertEqual(projection.rated.unit, "km")
        XCTAssertTrue(projection.rated.emphasized)
        XCTAssertEqual(projection.ideal.value, "450")
        XCTAssertEqual(projection.ideal.unit, "km")
        XCTAssertFalse(projection.ideal.emphasized)
        XCTAssertEqual(projection.distanceSymbol, "km")
        XCTAssertEqual(projection.metrics.map(\.id), ["rated-range", "ideal-range"])
    }

    /// Pins the mile branch: convertDistanceFromSI(meters, 'mi') = meters / 1609.344.
    func testProjectionMiles() {
        let projection = RangeEstimateProjector.project(
            state: sample,
            units: RangeUnitPrefs(distance: .miles)
        )
        XCTAssertEqual(projection.rated.value, "252")
        XCTAssertEqual(projection.rated.unit, "mi")
        XCTAssertEqual(projection.ideal.value, "280")
        XCTAssertEqual(projection.ideal.unit, "mi")
        XCTAssertEqual(projection.distanceSymbol, "mi")
    }

    /// Pins the foot branch (meters / 0.3048) — exercises grouped-thousands formatting.
    func testProjectionFeetGroupsThousands() {
        let projection = RangeEstimateProjector.project(
            state: sample,
            units: RangeUnitPrefs(distance: .feet)
        )
        XCTAssertEqual(projection.rated.value, "1,328,740")
        XCTAssertEqual(projection.ideal.value, "1,476,378")
        XCTAssertEqual(projection.distanceSymbol, "ft")
    }

    /// Null inner ranges collapse to 0 (web `state.rated_range ?? 0`).
    func testNilInnerRangesProjectToZero() {
        let projection = RangeEstimateProjector.project(
            state: RangeStateDTO(),
            units: RangeUnitPrefs(distance: .kilometers)
        )
        XCTAssertEqual(projection.rated.value, "0")
        XCTAssertEqual(projection.ideal.value, "0")
    }

    func testLabelsResolveToWebFallback() {
        let projection = RangeEstimateProjector.project(
            state: sample,
            units: RangeUnitPrefs(distance: .kilometers)
        )
        XCTAssertEqual(projection.rated.label, "Rated Range")
        XCTAssertEqual(projection.ideal.label, "Ideal Range")
    }

    func testNumberFormattingRoundsHalfAwayFromZero() {
        XCTAssertEqual(RangeEstimateFormat.number(1000, decimals: 0), "1,000")
        XCTAssertEqual(RangeEstimateFormat.number(1234.5, decimals: 0), "1,235")
        XCTAssertEqual(RangeEstimateFormat.number(1234.4, decimals: 0), "1,234")
        XCTAssertEqual(RangeEstimateFormat.number(-5, decimals: 0), "-5")
    }

    func testNonFiniteInputsCollapseToZero() {
        XCTAssertEqual(convertRangeDistanceFromSI(.nan, to: .kilometers), 0)
        XCTAssertEqual(convertRangeDistanceFromSI(.infinity, to: .miles), 0)
        XCTAssertEqual(RangeEstimateFormat.number(.infinity, decimals: 0), "0")
    }

    func testDistanceConversionFactors() {
        XCTAssertEqual(convertRangeDistanceFromSI(1000, to: .kilometers), 1, accuracy: 1e-9)
        XCTAssertEqual(convertRangeDistanceFromSI(1609.344, to: .miles), 1, accuracy: 1e-9)
        XCTAssertEqual(convertRangeDistanceFromSI(0.3048, to: .feet), 1, accuracy: 1e-9)
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor
final class RangeEstimatePhaseTests: XCTestCase {
    func testResolvePhaseMatrix() {
        XCTAssertEqual(RangeEstimateModel.resolvePhase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(RangeEstimateModel.resolvePhase(status: .loading, hasData: true), .content)
        XCTAssertEqual(RangeEstimateModel.resolvePhase(status: .empty, hasData: false), .empty)
        XCTAssertEqual(RangeEstimateModel.resolvePhase(status: .empty, hasData: true), .empty)
        XCTAssertEqual(RangeEstimateModel.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(RangeEstimateModel.resolvePhase(status: .loaded, hasData: true), .content)
        XCTAssertEqual(RangeEstimateModel.resolvePhase(status: .failed("x"), hasData: false), .error("x"))
        XCTAssertEqual(RangeEstimateModel.resolvePhase(status: .failed("x"), hasData: true), .content)
    }
}

@MainActor
final class RangeEstimateModelTests: XCTestCase {
    private func makeModel(
        _ update: RangeEstimateUpdate,
        telemetry: RangeEstimateTelemetry = OSLogRangeEstimateTelemetry()
    ) -> (RangeEstimateModel, InMemoryRangeEstimateSource) {
        let source = InMemoryRangeEstimateSource(initial: update)
        let model = RangeEstimateModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(RangeEstimateUpdate(status: .loading, state: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutStateShowsEmpty() {
        let (model, _) = makeModel(RangeEstimateUpdate(status: .loaded, state: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(RangeEstimateUpdate(status: .failed("boom"), state: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testStatePresentShowsContentEvenWhileFailed() {
        let state = RangeStateDTO(ratedRangeMeters: 405_000, idealRangeMeters: 450_000)
        let (model, _) = makeModel(RangeEstimateUpdate(status: .failed("net"), state: state))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.rated.value, "405")
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyRangeEstimateTelemetry()
        let (model, source) = makeModel(RangeEstimateUpdate(status: .loading, state: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [RangeEstimateWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(RangeEstimateUpdate(status: .loaded, state: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testAutoRefreshOnlyWhenStaleAndNotFetching() {
        let state = RangeStateDTO(ratedRangeMeters: 405_000)
        let (model, source) = makeModel(RangeEstimateUpdate(status: .loaded, state: state))
        model.start()

        model.autoRefreshIfStale() // live → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(RangeEstimateUpdate(status: .loaded, connection: .stale, isFetching: true, state: state))
        model.autoRefreshIfStale() // stale but fetching → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(RangeEstimateUpdate(status: .loaded, connection: .stale, isFetching: false, state: state))
        model.autoRefreshIfStale() // stale + idle → refresh
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testConnectionAndUnitsTrackUpdates() {
        let (model, source) = makeModel(RangeEstimateUpdate(status: .loading, state: nil))
        model.start()
        source.push(
            RangeEstimateUpdate(
                status: .loaded,
                connection: .offline,
                state: RangeStateDTO(ratedRangeMeters: 161_000, idealRangeMeters: 161_000),
                units: RangeUnitPrefs(distance: .miles),
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.units.distance, .miles)
        XCTAssertEqual(model.projection?.rated.unit, "mi")
    }
}

// MARK: - Registry parity

@MainActor
final class RangeEstimateRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = RangeEstimateWidget.registration
        XCTAssertEqual(registration.id, "range-estimate")
        XCTAssertEqual(registration.category, "battery")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 2, rows: 40))
        XCTAssertEqual(RangeEstimateWidget.surfaceSlug, "RangeEstimateWidget")
    }

    func testClampHonorsMinAndMax() {
        let registration = RangeEstimateWidget.registration
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)),
            DashboardWidgetSize(cols: 1, rows: 2)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 2, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 2, rows: 10)),
            DashboardWidgetSize(cols: 2, rows: 10)
        )
    }
}

// MARK: - Accessibility summary content

@MainActor
final class RangeEstimateAccessibilityTests: XCTestCase {
    func testSummaryIncludesEveryMetric() {
        let projection = RangeEstimateProjector.project(
            state: RangeStateDTO(ratedRangeMeters: 405_000, idealRangeMeters: 450_000),
            units: RangeUnitPrefs(distance: .kilometers)
        )
        let summary = RangeEstimateAccessibility.summary(for: projection)
        XCTAssertEqual(summary, "Range Estimate. Rated Range 405 km. Ideal Range 450 km")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyRangeEstimateTelemetry: RangeEstimateTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
