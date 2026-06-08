//
//  PatternsSlide.Tests.swift
//  TeslaSync — P4 feature view · 0064 · PatternsSlide (Apple)
//
//  Unit coverage for the PatternsSlide surface:
//    • Adapter (cached → projection) — `PatternsProjector` value parity with the web slide's numeric
//      pipeline (km → display unit, Wh/km → Wh/mi efficiency, Math.round, fmtNumber, peak-hour label).
//    • State holder — `PatternsSlideModel` phase resolution across loading / empty / error / content,
//      plus the P1/S11 `view.opened` telemetry and refresh + stale auto-refresh wiring.
//    • Accessibility — the VoiceOver summary content (every source i18n key).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryPatternsReviewSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached DTO → projection (port parity with the web slide)

final class PatternsAdapterTests: XCTestCase {
    private let sample = PatternsReviewDTO(
        avgDistancePerDriveKm: 42,
        avgEfficiencyWhKm: 175,
        mostActiveHour: 18,
        mostActiveDayOfWeek: "Saturday",
        avgDrivesPerWeek: 9.4
    )

    /// Pins the exact display strings the web slide produces for the km preference:
    /// convertDistanceFromSI(42 * 1000, 'km') = 42; efficiency stays Wh/km; fmtNumber(9.4, 1) = "9.4".
    func testProjectionKilometers() {
        let projection = PatternsProjector.project(
            stats: sample,
            units: PatternsUnitPrefs(distance: .kilometers)
        )
        XCTAssertEqual(projection.favoriteDay, "Saturday")
        XCTAssertEqual(projection.peakHour, "6 PM")
        XCTAssertEqual(projection.drivesPerWeek, "9.4")
        XCTAssertEqual(projection.distancePerDrive, "42")
        XCTAssertEqual(projection.distanceSymbol, "km")
        XCTAssertEqual(projection.efficiency, "175")
        XCTAssertEqual(projection.efficiencySymbol, "Wh/km")
    }

    /// Pins the mile branch: convertDistanceFromSI(42000, 'mi') = 26.0976 → 26;
    /// efficiency 175 * 1.609344 = 281.6352 → 282; unit symbols flip to mi / Wh/mi.
    func testProjectionMiles() {
        let projection = PatternsProjector.project(
            stats: sample,
            units: PatternsUnitPrefs(distance: .miles)
        )
        XCTAssertEqual(projection.distancePerDrive, "26")
        XCTAssertEqual(projection.distanceSymbol, "mi")
        XCTAssertEqual(projection.efficiency, "282")
        XCTAssertEqual(projection.efficiencySymbol, "Wh/mi")
        XCTAssertEqual(projection.peakHour, "6 PM")
    }

    func testEmptyStatsProjectToZeroesAndDash() {
        let projection = PatternsProjector.project(
            stats: PatternsReviewDTO(),
            units: PatternsUnitPrefs(distance: .kilometers)
        )
        XCTAssertEqual(projection.favoriteDay, "—")
        XCTAssertEqual(projection.peakHour, "12 AM")
        XCTAssertEqual(projection.drivesPerWeek, "0.0")
        XCTAssertEqual(projection.distancePerDrive, "0")
        XCTAssertEqual(projection.efficiency, "0")
    }

    func testEmptyDayStringResolvesToDash() {
        let dto = PatternsReviewDTO(mostActiveDayOfWeek: "")
        let projection = PatternsProjector.project(stats: dto, units: PatternsUnitPrefs())
        XCTAssertEqual(projection.favoriteDay, "—")
    }

    func testNilDayResolvesToDash() {
        let dto = PatternsReviewDTO(mostActiveDayOfWeek: nil)
        let projection = PatternsProjector.project(stats: dto, units: PatternsUnitPrefs())
        XCTAssertEqual(projection.favoriteDay, "—")
    }

    func testPeakHourLabelEdges() {
        XCTAssertEqual(PatternsHour.label(0), "12 AM")
        XCTAssertEqual(PatternsHour.label(1), "1 AM")
        XCTAssertEqual(PatternsHour.label(9), "9 AM")
        XCTAssertEqual(PatternsHour.label(11), "11 AM")
        XCTAssertEqual(PatternsHour.label(12), "12 PM")
        XCTAssertEqual(PatternsHour.label(13), "1 PM")
        XCTAssertEqual(PatternsHour.label(18), "6 PM")
        XCTAssertEqual(PatternsHour.label(23), "11 PM")
    }

    /// `Math.round` parity: halves go toward +∞, non-finite collapses to 0.
    func testRoundedIntMatchesJSMathRound() {
        XCTAssertEqual(patternsRoundedInt(2.5), 3)
        XCTAssertEqual(patternsRoundedInt(-2.5), -2)
        XCTAssertEqual(patternsRoundedInt(0.4999), 0)
        XCTAssertEqual(patternsRoundedInt(2.4), 2)
        XCTAssertEqual(patternsRoundedInt(.nan), 0)
        XCTAssertEqual(patternsRoundedInt(.infinity), 0)
    }

    func testNumberFormattingRoundsHalfAwayFromZero() {
        XCTAssertEqual(PatternsFormat.number(9.4, decimals: 1), "9.4")
        XCTAssertEqual(PatternsFormat.number(1234.5, decimals: 0), "1,235")
        XCTAssertEqual(PatternsFormat.number(1234.4, decimals: 0), "1,234")
        XCTAssertEqual(PatternsFormat.number(0, decimals: 1), "0.0")
        XCTAssertEqual(PatternsFormat.number(-5, decimals: 0), "-5")
    }

    func testNonFiniteInputsCollapseToZero() {
        XCTAssertEqual(convertPatternsDistanceFromSI(.nan, to: .kilometers), 0)
        XCTAssertEqual(PatternsFormat.number(.infinity, decimals: 1), "0.0")
    }

    func testDistanceConversionFactors() {
        XCTAssertEqual(convertPatternsDistanceFromSI(1000, to: .kilometers), 1, accuracy: 1e-9)
        XCTAssertEqual(convertPatternsDistanceFromSI(1609.344, to: .miles), 1, accuracy: 1e-9)
        XCTAssertEqual(convertPatternsDistanceFromSI(0.3048, to: .feet), 1, accuracy: 1e-9)
    }

    func testEfficiencySymbolFollowsDistancePreference() {
        XCTAssertEqual(PatternsDistanceUnit.kilometers.efficiencySymbol, "Wh/km")
        XCTAssertEqual(PatternsDistanceUnit.miles.efficiencySymbol, "Wh/mi")
        XCTAssertEqual(PatternsDistanceUnit.feet.efficiencySymbol, "Wh/km")
    }
}

// MARK: - State holder: phases + telemetry + source wiring

final class PatternsPhaseTests: XCTestCase {
    func testResolvePhaseMatrix() {
        XCTAssertEqual(PatternsSlideModel.resolvePhase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(PatternsSlideModel.resolvePhase(status: .loading, hasData: true), .content)
        XCTAssertEqual(PatternsSlideModel.resolvePhase(status: .empty, hasData: false), .empty)
        XCTAssertEqual(PatternsSlideModel.resolvePhase(status: .empty, hasData: true), .empty)
        XCTAssertEqual(PatternsSlideModel.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(PatternsSlideModel.resolvePhase(status: .loaded, hasData: true), .content)
        XCTAssertEqual(PatternsSlideModel.resolvePhase(status: .failed("x"), hasData: false), .error("x"))
        XCTAssertEqual(PatternsSlideModel.resolvePhase(status: .failed("x"), hasData: true), .content)
    }
}

@MainActor
final class PatternsModelTests: XCTestCase {
    private func makeModel(
        _ update: PatternsUpdate,
        telemetry: PatternsTelemetry = OSLogPatternsTelemetry()
    ) -> (PatternsSlideModel, InMemoryPatternsReviewSource) {
        let source = InMemoryPatternsReviewSource(initial: update)
        let model = PatternsSlideModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(PatternsUpdate(status: .loading, stats: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(PatternsUpdate(status: .loaded, stats: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(PatternsUpdate(status: .failed("boom"), stats: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsContentEvenWhileFailed() {
        let stats = PatternsReviewDTO(avgDistancePerDriveKm: 30, mostActiveDayOfWeek: "Monday")
        let (model, _) = makeModel(PatternsUpdate(status: .failed("net"), stats: stats))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.favoriteDay, "Monday")
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyPatternsTelemetry()
        let (model, source) = makeModel(PatternsUpdate(status: .loading, stats: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [PatternsSlide.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(PatternsUpdate(status: .loaded, stats: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testAutoRefreshOnlyWhenStaleAndNotFetching() {
        let stats = PatternsReviewDTO(avgDrivesPerWeek: 1)
        let (model, source) = makeModel(PatternsUpdate(status: .loaded, stats: stats))
        model.start()

        model.autoRefreshIfStale() // live → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(PatternsUpdate(status: .loaded, connection: .stale, isFetching: true, stats: stats))
        model.autoRefreshIfStale() // stale but fetching → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(PatternsUpdate(status: .loaded, connection: .stale, isFetching: false, stats: stats))
        model.autoRefreshIfStale() // stale + idle → refresh
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testConnectionUnitsAndProjectionTrackUpdates() {
        let (model, source) = makeModel(PatternsUpdate(status: .loading, stats: nil))
        model.start()
        source.push(
            PatternsUpdate(
                status: .loaded,
                connection: .offline,
                stats: PatternsReviewDTO(avgEfficiencyWhKm: 175, mostActiveDayOfWeek: "Friday"),
                units: PatternsUnitPrefs(distance: .miles),
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.units.distance, .miles)
        XCTAssertEqual(model.projection?.efficiencySymbol, "Wh/mi")
        XCTAssertEqual(model.projection?.efficiency, "282")
    }
}

// MARK: - Accessibility summary content

final class PatternsAccessibilityTests: XCTestCase {
    private let projection = PatternsProjector.project(
        stats: PatternsReviewDTO(
            avgDistancePerDriveKm: 42,
            avgEfficiencyWhKm: 175,
            mostActiveHour: 18,
            mostActiveDayOfWeek: "Saturday",
            avgDrivesPerWeek: 9.4
        ),
        units: PatternsUnitPrefs(distance: .kilometers)
    )

    func testSummaryIncludesEverySourceFragment() {
        let summary = PatternsAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Your driving patterns"))
        XCTAssertTrue(summary.contains("Favorite driving day Saturday"))
        XCTAssertTrue(summary.contains("Peak driving hour 6 PM"))
        XCTAssertTrue(summary.contains("9.4 drives/week"))
        XCTAssertTrue(summary.contains("42 km/drive avg"))
        XCTAssertTrue(summary.contains("175 Wh/km avg"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyPatternsTelemetry: PatternsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
