//
//  StatHeroSlide.Tests.swift
//  TeslaSync — P4 feature view · 0068 · StatHeroSlide (Apple)
//
//  Unit coverage for the StatHeroSlide surface:
//    • Adapter (cached → config) — `StatHeroSlideProjector` value parity with the web `getStatConfig`
//      numeric pipeline (km → display unit, fmtNumber, earth-lap comparison, energy days, the 📊
//      zero slide, and the composed VoiceOver label).
//    • State holder — `StatHeroSlideModel` phase resolution across loading / empty / error / content,
//      plus the P1/S11 `view.opened` telemetry, refresh + stale auto-refresh wiring.
//    • Surface — diagnostics slug.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryStatHeroSlideSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached stats → config (port parity with the web slide)

@MainActor final class StatHeroSlideAdapterTests: XCTestCase {
    private let sample = StatHeroSlideStats(totalDistanceKm: 18540, totalEnergyKwh: 3120.6)

    /// Web `case 'distance'` (km): convertDistanceFromSI(total_distance_km * 1000, 'km') = km value,
    /// fmtNumber(value, 0), unit symbol, and the Earth-lap comparison (earthLaps = km / 40075 ≥ 0.01).
    func testDistanceKilometers() {
        let config = StatHeroSlideProjector.project(
            stats: sample,
            units: StatHeroSlideUnitPrefs(distance: .kilometers),
            field: .distance
        )
        XCTAssertEqual(config.emoji, "🛣️")
        XCTAssertEqual(config.value, "18,540")
        XCTAssertEqual(config.unit, "km")
        XCTAssertEqual(config.comparison, "That's 46.3% around the Earth!")
        XCTAssertEqual(config.field, "distance")
    }

    /// Web `case 'distance'` (mi): convertDistanceFromSI(18,540,000 m, 'mi') = 18540000 / 1609.344.
    func testDistanceMiles() {
        let config = StatHeroSlideProjector.project(
            stats: sample,
            units: StatHeroSlideUnitPrefs(distance: .miles),
            field: .distance
        )
        XCTAssertEqual(config.value, "11,520")
        XCTAssertEqual(config.unit, "mi")
        // The Earth-lap percent is computed from total_distance_km, so it is unit-independent.
        XCTAssertEqual(config.comparison, "That's 46.3% around the Earth!")
    }

    /// Web `case 'distance'` (ft): convertDistanceFromSI(18,540,000 m, 'ft') = 18540000 / 0.3048.
    func testDistanceFeet() {
        let config = StatHeroSlideProjector.project(
            stats: sample,
            units: StatHeroSlideUnitPrefs(distance: .feet),
            field: .distance
        )
        XCTAssertEqual(config.value, "60,826,772")
        XCTAssertEqual(config.unit, "ft")
    }

    /// Web `earthLaps < 0.01` branch: below ~400.75 km the slide shows the "every kilometer" line.
    func testDistanceSmallComparison() {
        let config = StatHeroSlideProjector.project(
            stats: StatHeroSlideStats(totalDistanceKm: 200),
            units: StatHeroSlideUnitPrefs(distance: .kilometers),
            field: .distance
        )
        XCTAssertEqual(config.value, "200")
        XCTAssertEqual(config.comparison, "Every kilometer counts!")
    }

    /// Web `case 'energy'`: raw kWh at 0 decimals, "kWh charged" unit, days = round(kWh / 30).
    func testEnergy() {
        let config = StatHeroSlideProjector.project(
            stats: sample,
            units: StatHeroSlideUnitPrefs(distance: .kilometers),
            field: .energy
        )
        XCTAssertEqual(config.emoji, "⚡")
        XCTAssertEqual(config.value, "3,121")
        XCTAssertEqual(config.unit, "kWh charged")
        XCTAssertEqual(config.comparison, "Enough to power a home for 104 days")
        XCTAssertEqual(config.field, "energy")
    }

    /// The energy day count rounds half away from zero (web `Math.round`): 45 / 30 = 1.5 → 2.
    func testEnergyComparisonRoundsHalfAwayFromZero() {
        let config = StatHeroSlideProjector.project(
            stats: StatHeroSlideStats(totalEnergyKwh: 45),
            units: StatHeroSlideUnitPrefs(distance: .kilometers),
            field: .energy
        )
        XCTAssertEqual(config.value, "45")
        XCTAssertEqual(config.comparison, "Enough to power a home for 2 days")
    }

    /// Web `default`: an unrecognised field renders the 📊 zero slide (value 0, no unit/comparison).
    func testOtherFieldZeroSlide() {
        let config = StatHeroSlideProjector.project(
            stats: sample,
            units: StatHeroSlideUnitPrefs(distance: .kilometers),
            field: .other("achievements")
        )
        XCTAssertEqual(config.emoji, "📊")
        XCTAssertEqual(config.value, "0")
        XCTAssertEqual(config.unit, "")
        XCTAssertEqual(config.comparison, "")
        XCTAssertEqual(config.field, "achievements")
    }

    /// The VoiceOver label reads "value unit. comparison" for a full slide and just the value for the
    /// bare zero slide.
    func testAccessibilityLabelComposition() {
        let distance = StatHeroSlideProjector.project(
            stats: sample,
            units: StatHeroSlideUnitPrefs(distance: .kilometers),
            field: .distance
        )
        XCTAssertEqual(distance.accessibilityLabel, "18,540 km. That's 46.3% around the Earth!")

        let other = StatHeroSlideProjector.project(
            stats: sample,
            units: StatHeroSlideUnitPrefs(distance: .kilometers),
            field: .other("x")
        )
        XCTAssertEqual(other.accessibilityLabel, "0")
    }

    func testDistanceConversionFactors() {
        XCTAssertEqual(convertStatHeroDistanceFromSI(1000, to: .kilometers), 1, accuracy: 1e-9)
        XCTAssertEqual(convertStatHeroDistanceFromSI(1609.344, to: .miles), 1, accuracy: 1e-9)
        XCTAssertEqual(convertStatHeroDistanceFromSI(0.3048, to: .feet), 1, accuracy: 1e-9)
    }

    func testNonFiniteInputsCollapseToZero() {
        XCTAssertEqual(convertStatHeroDistanceFromSI(.nan, to: .miles), 0)
        XCTAssertEqual(StatHeroSlideFormat.number(.infinity, decimals: 1), "0.0")
        XCTAssertEqual(StatHeroSlideFormat.safeNumber(.nan), 0)
    }

    func testNumberFormattingRoundsHalfAwayFromZero() {
        XCTAssertEqual(StatHeroSlideFormat.number(1000, decimals: 0), "1,000")
        XCTAssertEqual(StatHeroSlideFormat.number(1234.5, decimals: 0), "1,235")
        XCTAssertEqual(StatHeroSlideFormat.number(1234.4, decimals: 0), "1,234")
        XCTAssertEqual(StatHeroSlideFormat.number(-5, decimals: 0), "-5")
    }

    func testDistanceUnitFromLabel() {
        XCTAssertEqual(StatHeroSlideDistanceUnit.from(label: "mi"), .miles)
        XCTAssertEqual(StatHeroSlideDistanceUnit.from(label: "ft"), .feet)
        XCTAssertEqual(StatHeroSlideDistanceUnit.from(label: "km"), .kilometers)
        XCTAssertEqual(StatHeroSlideDistanceUnit.from(label: "parsecs"), .kilometers)
    }

    func testFieldRawValueRoundTrip() {
        XCTAssertEqual(StatHeroSlideField(rawValue: "distance"), .distance)
        XCTAssertEqual(StatHeroSlideField(rawValue: "energy"), .energy)
        XCTAssertEqual(StatHeroSlideField(rawValue: "streaks"), .other("streaks"))
        XCTAssertEqual(StatHeroSlideField.distance.rawValue, "distance")
        XCTAssertEqual(StatHeroSlideField.energy.rawValue, "energy")
        XCTAssertEqual(StatHeroSlideField.other("streaks").rawValue, "streaks")
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class StatHeroSlidePhaseTests: XCTestCase {
    func testResolvePhaseMatrix() {
        XCTAssertEqual(StatHeroSlideModel.resolvePhase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(StatHeroSlideModel.resolvePhase(status: .loading, hasData: true), .content)
        XCTAssertEqual(StatHeroSlideModel.resolvePhase(status: .empty, hasData: false), .empty)
        XCTAssertEqual(StatHeroSlideModel.resolvePhase(status: .empty, hasData: true), .empty)
        XCTAssertEqual(StatHeroSlideModel.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(StatHeroSlideModel.resolvePhase(status: .loaded, hasData: true), .content)
        XCTAssertEqual(StatHeroSlideModel.resolvePhase(status: .failed("x"), hasData: false), .error("x"))
        XCTAssertEqual(StatHeroSlideModel.resolvePhase(status: .failed("x"), hasData: true), .content)
    }
}

@MainActor final class StatHeroSlideModelTests: XCTestCase {
    private func makeModel(
        _ update: StatHeroSlideUpdate,
        telemetry: StatHeroSlideTelemetry = OSLogStatHeroSlideTelemetry()
    ) -> (StatHeroSlideModel, InMemoryStatHeroSlideSource) {
        let source = InMemoryStatHeroSlideSource(initial: update)
        let model = StatHeroSlideModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(StatHeroSlideUpdate(status: .loading, stats: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertNil(model.config)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(StatHeroSlideUpdate(status: .loaded, stats: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(StatHeroSlideUpdate(status: .failed("boom"), stats: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsContentEvenWhileFailed() {
        let stats = StatHeroSlideStats(totalDistanceKm: 1000)
        let (model, _) = makeModel(StatHeroSlideUpdate(status: .failed("net"), stats: stats, field: .distance))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertNotNil(model.config)
        XCTAssertEqual(model.config?.field, "distance")
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyStatHeroSlideTelemetry()
        let (model, source) = makeModel(StatHeroSlideUpdate(status: .loading, stats: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [StatHeroSlide.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(StatHeroSlideUpdate(status: .loaded, stats: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testAutoRefreshOnlyWhenStaleAndNotFetching() {
        let stats = StatHeroSlideStats(totalDistanceKm: 100)
        let (model, source) = makeModel(StatHeroSlideUpdate(status: .loaded, stats: stats))
        model.start()

        model.autoRefreshIfStale() // live → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(StatHeroSlideUpdate(status: .loaded, connection: .stale, isFetching: true, stats: stats))
        model.autoRefreshIfStale() // stale but fetching → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(StatHeroSlideUpdate(status: .loaded, connection: .stale, isFetching: false, stats: stats))
        model.autoRefreshIfStale() // stale + idle → refresh
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testFieldConnectionAndConfigTrackUpdates() {
        let (model, source) = makeModel(StatHeroSlideUpdate(status: .loading, stats: nil))
        model.start()
        source.push(
            StatHeroSlideUpdate(
                status: .loaded,
                connection: .offline,
                stats: StatHeroSlideStats(totalDistanceKm: 1000, totalEnergyKwh: 600),
                units: StatHeroSlideUnitPrefs(distance: .miles),
                field: .energy,
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.field, .energy)
        XCTAssertEqual(model.config?.emoji, "⚡")
    }
}

// MARK: - Surface metadata

@MainActor final class StatHeroSlideSurfaceTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(StatHeroSlideSurface.slug, "StatHeroSlide")
        XCTAssertEqual(StatHeroSlide.surfaceSlug, "StatHeroSlide")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyStatHeroSlideTelemetry: StatHeroSlideTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
