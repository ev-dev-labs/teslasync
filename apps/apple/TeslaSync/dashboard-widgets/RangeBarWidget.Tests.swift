//
//  RangeBarWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0076 · RangeBarWidget (Apple)
//
//  Unit coverage for the RangeBarWidget surface:
//    • Adapter (cached → projection) — `RangeBarProjector` value parity with the web widget's
//      numeric pipeline: convertDistanceFromSI(meters, unit) → fmtNumber(_, 0); bar fractions
//      (value / max(rated, ideal, 1)); the EPA-variance readout; the `hasData` guard.
//    • State holder — `RangeBarModel` phase resolution across loading / empty / error / content
//      (including the web `(rated > 0 || ideal > 0)` empty branch), plus the P1/S11
//      `view.opened` telemetry, refresh + stale auto-refresh wiring.
//    • Registry — canonical `range-bar` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content + the bar percent value.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store:
//  the model is driven by `InMemoryRangeBarSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached DTO → projection (port parity with the web widget)

@MainActor final class RangeBarAdapterTests: XCTestCase {
    private let sample = RangeBarStateDTO(ratedRangeMeters: 405_000, idealRangeMeters: 450_000)

    /// Pins the exact display strings + bar fractions the web widget produces for the km
    /// preference: convertDistanceFromSI(meters, 'km') = meters / 1000, then fmtNumber(_, 0);
    /// fractions are value / max(rated, ideal, 1).
    func testProjectionKilometers() {
        let projection = RangeBarProjector.project(state: sample, units: RangeBarUnitPrefs(distance: .kilometers))
        XCTAssertEqual(projection.rated.valueText, "405")
        XCTAssertEqual(projection.rated.unit, "km")
        XCTAssertEqual(projection.rated.sublabel, "405 km")
        XCTAssertEqual(projection.rated.tone, .rated)
        XCTAssertEqual(projection.rated.fraction, 0.9, accuracy: 1e-9)
        XCTAssertEqual(projection.ideal.valueText, "450")
        XCTAssertEqual(projection.ideal.sublabel, "450 km")
        XCTAssertEqual(projection.ideal.tone, .ideal)
        XCTAssertEqual(projection.ideal.fraction, 1.0, accuracy: 1e-9)
        XCTAssertEqual(projection.compactValueText, "405")
        XCTAssertEqual(projection.distanceSymbol, "km")
        XCTAssertEqual(projection.metrics.map(\.id), ["rated-range", "ideal-range"])
    }

    /// Pins the mile branch: convertDistanceFromSI(meters, 'mi') = meters / 1609.344.
    func testProjectionMiles() {
        let projection = RangeBarProjector.project(state: sample, units: RangeBarUnitPrefs(distance: .miles))
        XCTAssertEqual(projection.rated.valueText, "252")
        XCTAssertEqual(projection.rated.sublabel, "252 mi")
        XCTAssertEqual(projection.ideal.valueText, "280")
        XCTAssertEqual(projection.ideal.sublabel, "280 mi")
        XCTAssertEqual(projection.distanceSymbol, "mi")
    }

    /// Pins the foot branch (meters / 0.3048) — exercises grouped-thousands formatting.
    func testProjectionFeetGroupsThousands() {
        let projection = RangeBarProjector.project(state: sample, units: RangeBarUnitPrefs(distance: .feet))
        XCTAssertEqual(projection.rated.valueText, "1,328,740")
        XCTAssertEqual(projection.ideal.valueText, "1,476,378")
        XCTAssertEqual(projection.rated.sublabel, "1,328,740 ft")
    }

    /// EPA variance is unit-independent (a ratio) and prefixed '+' when ideal >= rated:
    /// ((450000 - 405000) / 405000) * 100 = 11.111… → "+11.1%".
    func testVariancePositive() {
        let projection = RangeBarProjector.project(state: sample, units: RangeBarUnitPrefs(distance: .kilometers))
        XCTAssertEqual(projection.variance?.percentText, "+11.1%")
        XCTAssertEqual(projection.variance?.isPositive, true)
    }

    /// When ideal < rated the sign comes from the formatter (no '+' prefix): -10.0%.
    func testVarianceNegative() {
        let projection = RangeBarProjector.project(
            state: RangeBarStateDTO(ratedRangeMeters: 450_000, idealRangeMeters: 405_000),
            units: RangeBarUnitPrefs(distance: .kilometers)
        )
        XCTAssertEqual(projection.variance?.percentText, "-10.0%")
        XCTAssertEqual(projection.variance?.isPositive, false)
    }

    /// web `rated > 0 && ideal > 0` — variance is omitted when either side is zero, while the
    /// present side still projects its bar (fraction 1.0) and the other reads 0.
    func testVarianceOmittedWhenOnlyOneSidePositive() {
        let ratedOnly = RangeBarProjector.project(
            state: RangeBarStateDTO(ratedRangeMeters: 405_000, idealRangeMeters: 0),
            units: RangeBarUnitPrefs(distance: .kilometers)
        )
        XCTAssertNil(ratedOnly.variance)
        XCTAssertEqual(ratedOnly.rated.fraction, 1.0, accuracy: 1e-9)
        XCTAssertEqual(ratedOnly.ideal.fraction, 0.0, accuracy: 1e-9)

        let idealOnly = RangeBarProjector.project(
            state: RangeBarStateDTO(ratedRangeMeters: nil, idealRangeMeters: 450_000),
            units: RangeBarUnitPrefs(distance: .kilometers)
        )
        XCTAssertNil(idealOnly.variance)
        XCTAssertEqual(idealOnly.rated.fraction, 0.0, accuracy: 1e-9)
        XCTAssertEqual(idealOnly.ideal.fraction, 1.0, accuracy: 1e-9)
    }

    /// web `hasData = state != null && (rated > 0 || ideal > 0)`.
    func testHasDataGuard() {
        XCTAssertTrue(RangeBarProjector.hasData(state: RangeBarStateDTO(ratedRangeMeters: 405_000)))
        XCTAssertTrue(RangeBarProjector.hasData(state: RangeBarStateDTO(idealRangeMeters: 450_000)))
        XCTAssertFalse(RangeBarProjector.hasData(state: RangeBarStateDTO()))
        XCTAssertFalse(RangeBarProjector.hasData(state: RangeBarStateDTO(ratedRangeMeters: 0, idealRangeMeters: 0)))
    }

    func testLabelsResolveToWebFallback() {
        let projection = RangeBarProjector.project(state: sample, units: RangeBarUnitPrefs(distance: .kilometers))
        XCTAssertEqual(projection.rated.label, "Rated Range")
        XCTAssertEqual(projection.ideal.label, "Ideal Range")
    }

    func testNumberFormattingRoundsHalfAwayFromZero() {
        XCTAssertEqual(RangeBarFormat.number(1000, decimals: 0), "1,000")
        XCTAssertEqual(RangeBarFormat.number(1234.5, decimals: 0), "1,235")
        XCTAssertEqual(RangeBarFormat.number(1234.4, decimals: 0), "1,234")
        XCTAssertEqual(RangeBarFormat.number(-5, decimals: 0), "-5")
        XCTAssertEqual(RangeBarFormat.number(11.1111, decimals: 1), "11.1")
    }

    func testNonFiniteInputsCollapseToZero() {
        XCTAssertEqual(convertRangeBarDistanceFromSI(.nan, to: .kilometers), 0)
        XCTAssertEqual(convertRangeBarDistanceFromSI(.infinity, to: .miles), 0)
        XCTAssertEqual(RangeBarFormat.number(.infinity, decimals: 0), "0")
    }

    func testDistanceConversionFactors() {
        XCTAssertEqual(convertRangeBarDistanceFromSI(1000, to: .kilometers), 1, accuracy: 1e-9)
        XCTAssertEqual(convertRangeBarDistanceFromSI(1609.344, to: .miles), 1, accuracy: 1e-9)
        XCTAssertEqual(convertRangeBarDistanceFromSI(0.3048, to: .feet), 1, accuracy: 1e-9)
    }
}

// MARK: - Layout rule (web `isCompact`)

@MainActor final class RangeBarLayoutTests: XCTestCase {
    func testIsCompactRequiresOneByOne() {
        XCTAssertTrue(RangeBarLayout.isCompact(cols: 1, rows: 1))
        XCTAssertFalse(RangeBarLayout.isCompact(cols: 1, rows: 2))
        XCTAssertFalse(RangeBarLayout.isCompact(cols: 2, rows: 1))
        XCTAssertFalse(RangeBarLayout.isCompact(cols: 2, rows: 2))
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class RangeBarPhaseTests: XCTestCase {
    func testResolvePhaseMatrix() {
        XCTAssertEqual(RangeBarModel.resolvePhase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(RangeBarModel.resolvePhase(status: .loading, hasData: true), .content)
        XCTAssertEqual(RangeBarModel.resolvePhase(status: .empty, hasData: false), .empty)
        XCTAssertEqual(RangeBarModel.resolvePhase(status: .empty, hasData: true), .empty)
        XCTAssertEqual(RangeBarModel.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(RangeBarModel.resolvePhase(status: .loaded, hasData: true), .content)
        XCTAssertEqual(RangeBarModel.resolvePhase(status: .failed("x"), hasData: false), .error("x"))
        XCTAssertEqual(RangeBarModel.resolvePhase(status: .failed("x"), hasData: true), .content)
    }
}

@MainActor final class RangeBarModelTests: XCTestCase {
    private func makeModel(
        _ update: RangeBarUpdate,
        telemetry: RangeBarTelemetry = OSLogRangeBarTelemetry()
    ) -> (RangeBarModel, InMemoryRangeBarSource) {
        let source = InMemoryRangeBarSource(initial: update)
        let model = RangeBarModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(RangeBarUpdate(status: .loading, state: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertNil(model.projection)
    }

    func testLoadedWithoutStateShowsEmpty() {
        let (model, _) = makeModel(RangeBarUpdate(status: .loaded, state: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    /// RangeBar-specific: state present but no positive range → empty (web `hasData`).
    func testLoadedWithZeroRangesShowsEmpty() {
        let zero = RangeBarStateDTO(ratedRangeMeters: 0, idealRangeMeters: 0)
        let (model, _) = makeModel(RangeBarUpdate(status: .loaded, state: zero))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.projection)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(RangeBarUpdate(status: .failed("boom"), state: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testStatePresentShowsContentEvenWhileFailed() {
        let state = RangeBarStateDTO(ratedRangeMeters: 405_000, idealRangeMeters: 450_000)
        let (model, _) = makeModel(RangeBarUpdate(status: .failed("net"), state: state))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.rated.valueText, "405")
        XCTAssertEqual(model.projection?.variance?.percentText, "+11.1%")
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyRangeBarTelemetry()
        let (model, source) = makeModel(RangeBarUpdate(status: .loading, state: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [RangeBarWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(RangeBarUpdate(status: .loaded, state: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testAutoRefreshOnlyWhenStaleAndNotFetching() {
        let state = RangeBarStateDTO(ratedRangeMeters: 405_000)
        let (model, source) = makeModel(RangeBarUpdate(status: .loaded, state: state))
        model.start()

        model.autoRefreshIfStale() // live → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(RangeBarUpdate(status: .loaded, connection: .stale, isFetching: true, state: state))
        model.autoRefreshIfStale() // stale but fetching → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(RangeBarUpdate(status: .loaded, connection: .stale, isFetching: false, state: state))
        model.autoRefreshIfStale() // stale + idle → refresh
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testConnectionAndUnitsTrackUpdates() {
        let (model, source) = makeModel(RangeBarUpdate(status: .loading, state: nil))
        model.start()
        source.push(
            RangeBarUpdate(
                status: .loaded,
                connection: .offline,
                state: RangeBarStateDTO(ratedRangeMeters: 161_000, idealRangeMeters: 161_000),
                units: RangeBarUnitPrefs(distance: .miles),
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

@MainActor final class RangeBarRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = RangeBarWidget.registration
        XCTAssertEqual(registration.id, "range-bar")
        XCTAssertEqual(registration.category, "battery")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 2))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
        XCTAssertEqual(RangeBarWidget.surfaceSlug, "RangeBarWidget")
    }

    func testClampHonorsMinAndMax() {
        let registration = RangeBarWidget.registration
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 1, rows: 1)),
            DashboardWidgetSize(cols: 1, rows: 2)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 3, rows: 10)),
            DashboardWidgetSize(cols: 3, rows: 10)
        )
    }
}

// MARK: - Accessibility summary content

@MainActor final class RangeBarAccessibilityTests: XCTestCase {
    func testSummaryIncludesEveryBarAndVariance() {
        let projection = RangeBarProjector.project(
            state: RangeBarStateDTO(ratedRangeMeters: 405_000, idealRangeMeters: 450_000),
            units: RangeBarUnitPrefs(distance: .kilometers)
        )
        let summary = RangeBarAccessibility.summary(for: projection)
        XCTAssertEqual(summary, "Range. Rated Range 405 km. Ideal Range 450 km. EPA variance +11.1%")
    }

    func testBarPercentValueRounds() {
        XCTAssertEqual(RangeBarMeterPercent.value(0.9), "90%")
        XCTAssertEqual(RangeBarMeterPercent.value(1.0), "100%")
        XCTAssertEqual(RangeBarMeterPercent.value(0.0), "0%")
        XCTAssertEqual(RangeBarMeterPercent.value(1.5), "100%")
        XCTAssertEqual(RangeBarMeterPercent.value(-0.2), "0%")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyRangeBarTelemetry: RangeBarTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
