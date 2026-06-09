//
//  DriveHighlightSlide.Tests.swift
//  TeslaSync — P4 feature view · 0062 · DriveHighlightSlide (Apple)
//
//  Unit coverage for the DriveHighlightSlide surface:
//    • Adapter (cached → projection) — `DriveHighlightSlideProjector` value parity with the web slide's
//      arithmetic: distance = round(convertDistanceFromSI(km*1000, unit)) ungrouped, the hours/minutes
//      duration split, the Wh/mi vs Wh/km efficiency (with the `<= 0 → '—'` guard), the address `|| '—'`
//      fallback, and the verbatim date.
//    • State holder — `DriveHighlightSlideModel` phase resolution across loading / empty / error /
//      content (one assertion per state), the P1/S11 `view.opened` telemetry, refresh + stale
//      auto-refresh wiring, label/emoji propagation, and cached-value survival behind a failure.
//    • i18n — the source keys + the native efficiency-unit / connector keys resolve to their fallbacks.
//    • Accessibility — the VoiceOver summary content (the card's combined a11y label).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the model
//  is driven by `InMemoryDriveHighlightSlideSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum DriveHighlightFixture {
    /// A long road-trip highlight: 412.5 km over 4h 47m at 168 Wh/km.
    static let roadTrip = DriveHighlightReviewDTO(
        date: "July 15, 2024",
        distanceKm: 412.5,
        durationMin: 287,
        startAddress: "San Francisco, CA",
        endAddress: "Los Angeles, CA",
        efficiencyWhKm: 168
    )

    static let label = "Longest Drive"

    static func project(
        _ drive: DriveHighlightReviewDTO,
        unit: DriveHighlightSlideDistanceUnit,
        label: String = label
    ) -> DriveHighlightSlideProjection {
        DriveHighlightSlideProjector.project(
            drive: drive,
            units: DriveHighlightSlideUnitPrefs(distance: unit),
            label: label
        )
    }
}

// MARK: - Adapter: cached DTO → projection (port parity with the web slide)

@MainActor final class DriveHighlightSlideAdapterTests: XCTestCase {
    /// Kilometres: 412.5 km → round(412.5) = 413; efficiency stays Wh/km at the raw rounded value.
    func testProjectionKilometers() {
        let projection = DriveHighlightFixture.project(DriveHighlightFixture.roadTrip, unit: .kilometers)
        XCTAssertEqual(projection.distanceValue, "413")
        XCTAssertEqual(projection.distanceUnit, "km")
        XCTAssertEqual(projection.durationText, "4h 47m")
        XCTAssertEqual(projection.efficiencyValue, "168")
        XCTAssertEqual(projection.efficiencyUnit, "Wh/km")
        XCTAssertEqual(projection.startAddress, "San Francisco, CA")
        XCTAssertEqual(projection.endAddress, "Los Angeles, CA")
        XCTAssertEqual(projection.date, "July 15, 2024")
    }

    /// Miles: 412.5 km → round(412500 / 1609.344) = 256; efficiency 168 Wh/km × 1.609344 → round = 270,
    /// labeled Wh/mi (the web `distanceUnit === 'mi'` branch).
    func testProjectionMiles() {
        let projection = DriveHighlightFixture.project(DriveHighlightFixture.roadTrip, unit: .miles)
        XCTAssertEqual(projection.distanceValue, "256")
        XCTAssertEqual(projection.distanceUnit, "mi")
        XCTAssertEqual(projection.efficiencyValue, "270")
        XCTAssertEqual(projection.efficiencyUnit, "Wh/mi")
        XCTAssertEqual(projection.durationText, "4h 47m")
    }

    /// Feet keep Wh/km efficiency (only miles flips the efficiency unit): 412500 m / 0.3048 → 1353346.
    func testProjectionFeetKeepsMetricEfficiency() {
        let projection = DriveHighlightFixture.project(DriveHighlightFixture.roadTrip, unit: .feet)
        XCTAssertEqual(projection.distanceValue, "1353346")
        XCTAssertEqual(projection.distanceUnit, "ft")
        XCTAssertEqual(projection.efficiencyValue, "168")
        XCTAssertEqual(projection.efficiencyUnit, "Wh/km")
    }

    /// The distance figure is plainly stringified (web `Math.round` → React interpolation), NOT
    /// locale-grouped: 1234 km → "1234", never "1,234".
    func testDistanceIsNotGrouped() {
        let drive = DriveHighlightReviewDTO(distanceKm: 1234, durationMin: 30, efficiencyWhKm: 150)
        let projection = DriveHighlightFixture.project(drive, unit: .kilometers)
        XCTAssertEqual(projection.distanceValue, "1234")
    }

    /// Duration split parity: hours = floor(min/60), mins = min % 60, then the `${h}h ${m}m` / `${m}m`
    /// shape across the boundaries.
    func testDurationFormatting() {
        XCTAssertEqual(DriveHighlightSlideProjector.duration(minutes: 45), "45m")
        XCTAssertEqual(DriveHighlightSlideProjector.duration(minutes: 60), "1h 0m")
        XCTAssertEqual(DriveHighlightSlideProjector.duration(minutes: 125), "2h 5m")
        XCTAssertEqual(DriveHighlightSlideProjector.duration(minutes: 0), "0m")
        XCTAssertEqual(DriveHighlightSlideProjector.duration(minutes: 287), "4h 47m")
    }

    /// Non-positive efficiency renders the em-dash fallback (web `efficiency_wh_km > 0 ? … : '—'`),
    /// while the unit label still shows.
    func testEfficiencyEmDashWhenNonPositive() {
        let zero = DriveHighlightReviewDTO(distanceKm: 10, durationMin: 12, efficiencyWhKm: 0)
        XCTAssertEqual(DriveHighlightFixture.project(zero, unit: .kilometers).efficiencyValue, "—")
        XCTAssertEqual(DriveHighlightFixture.project(zero, unit: .miles).efficiencyValue, "—")
        XCTAssertEqual(DriveHighlightFixture.project(zero, unit: .miles).efficiencyUnit, "Wh/mi")

        let negative = DriveHighlightReviewDTO(distanceKm: 10, durationMin: 12, efficiencyWhKm: -5)
        XCTAssertEqual(DriveHighlightFixture.project(negative, unit: .kilometers).efficiencyValue, "—")
    }

    /// A blank address collapses to the em-dash fallback (web `start_address || '—'`).
    func testAddressEmDashWhenEmpty() {
        let drive = DriveHighlightReviewDTO(
            distanceKm: 10,
            durationMin: 12,
            startAddress: "",
            endAddress: "Home",
            efficiencyWhKm: 150
        )
        let projection = DriveHighlightFixture.project(drive, unit: .kilometers)
        XCTAssertEqual(projection.startAddress, "—")
        XCTAssertEqual(projection.endAddress, "Home")
    }

    /// `Math.round` half-up boundary parity via the shared helper (2.5 → 3, 2.4 → 2).
    func testJSRoundHalfUp() {
        XCTAssertEqual(driveHighlightJSRound(2.5), 3)
        XCTAssertEqual(driveHighlightJSRound(2.4), 2)
        XCTAssertEqual(driveHighlightJSRound(0.5), 1)
    }

    /// Non-finite distance collapses to 0 via `safeNumber`, so the slide never shows NaN.
    func testNonFiniteDistanceCollapsesToZero() {
        let drive = DriveHighlightReviewDTO(distanceKm: .infinity, durationMin: 30, efficiencyWhKm: 150)
        let projection = DriveHighlightFixture.project(drive, unit: .kilometers)
        XCTAssertEqual(projection.distanceValue, "0")
    }
}

// MARK: - State holder: phase resolution per state

@MainActor final class DriveHighlightSlidePhaseTests: XCTestCase {
    func testResolvePhaseMatrix() {
        typealias Phase = DriveHighlightSlideModel.Phase
        let resolve = DriveHighlightSlideModel.resolvePhase
        XCTAssertEqual(resolve(.loading, false), Phase.loading)
        XCTAssertEqual(resolve(.loading, true), Phase.content)
        XCTAssertEqual(resolve(.empty, false), Phase.empty)
        XCTAssertEqual(resolve(.empty, true), Phase.empty)
        XCTAssertEqual(resolve(.loaded, false), Phase.empty)
        XCTAssertEqual(resolve(.loaded, true), Phase.content)
        XCTAssertEqual(resolve(.failed("x"), false), Phase.error("x"))
        XCTAssertEqual(resolve(.failed("x"), true), Phase.content)
    }
}

// MARK: - State holder: model wiring + telemetry

@MainActor final class DriveHighlightSlideModelTests: XCTestCase {
    private func makeModel(
        _ update: DriveHighlightSlideUpdate,
        telemetry: DriveHighlightSlideTelemetry = OSLogDriveHighlightSlideTelemetry()
    ) -> (DriveHighlightSlideModel, InMemoryDriveHighlightSlideSource) {
        let source = InMemoryDriveHighlightSlideSource(initial: update)
        let model = DriveHighlightSlideModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingStateWithoutData() {
        let (model, _) = makeModel(DriveHighlightSlideUpdate(status: .loading, drive: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertNil(model.projection)
    }

    func testEmptyStateWhenLoadedWithoutData() {
        let (model, _) = makeModel(
            DriveHighlightSlideUpdate(status: .loaded, drive: nil, label: "Longest", emoji: "🏆")
        )
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.emoji, "🏆")
        XCTAssertEqual(model.label, "Longest")
    }

    func testErrorStateWithoutCache() {
        let (model, _) = makeModel(DriveHighlightSlideUpdate(status: .failed("boom"), drive: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testContentStateProjectsValue() {
        let (model, _) = makeModel(
            DriveHighlightSlideUpdate(
                status: .loaded,
                drive: DriveHighlightFixture.roadTrip,
                label: DriveHighlightFixture.label,
                units: DriveHighlightSlideUnitPrefs(distance: .kilometers)
            )
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.distanceValue, "413")
        XCTAssertEqual(model.projection?.efficiencyUnit, "Wh/km")
    }

    func testCachedValueSurvivesFailure() {
        let (model, _) = makeModel(
            DriveHighlightSlideUpdate(status: .failed("net"), drive: DriveHighlightFixture.roadTrip)
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.durationText, "4h 47m")
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyDriveHighlightSlideTelemetry()
        let (model, source) = makeModel(DriveHighlightSlideUpdate(status: .loading, drive: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [DriveHighlightSlide.surfaceSlug])
        XCTAssertEqual(spy.surfaces, ["DriveHighlightSlide"])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(DriveHighlightSlideUpdate(status: .loaded, drive: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testAutoRefreshOnlyWhenStaleAndNotFetching() {
        let drive = DriveHighlightFixture.roadTrip
        let (model, source) = makeModel(DriveHighlightSlideUpdate(status: .loaded, drive: drive))
        model.start()

        model.autoRefreshIfStale() // live → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(DriveHighlightSlideUpdate(status: .loaded, connection: .stale, isFetching: true, drive: drive))
        model.autoRefreshIfStale() // stale but fetching → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(DriveHighlightSlideUpdate(status: .loaded, connection: .stale, isFetching: false, drive: drive))
        model.autoRefreshIfStale() // stale + idle → refresh
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testConnectionAndUpdatedAtTrackUpdates() {
        let (model, source) = makeModel(DriveHighlightSlideUpdate(status: .loading, drive: nil))
        model.start()
        let stamp = Date()
        source.push(
            DriveHighlightSlideUpdate(
                status: .loaded,
                connection: .offline,
                drive: DriveHighlightFixture.roadTrip,
                label: "Most Efficient",
                emoji: "🌱",
                updatedAt: stamp
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.updatedAt, stamp)
        XCTAssertEqual(model.emoji, "🌱")
        XCTAssertEqual(model.label, "Most Efficient")
    }
}

// MARK: - i18n: source + native chrome keys

@MainActor final class DriveHighlightSlideStringsTests: XCTestCase {
    func testSourceKeyFallbacksResolve() {
        XCTAssertEqual(
            DriveHighlightSlideStrings.string("yearReview.noDriveData", "No drive data for this year"),
            "No drive data for this year"
        )
        XCTAssertEqual(DriveHighlightSlideStrings.string("yearReview.duration", "duration"), "duration")
    }

    func testEfficiencyUnitKeysResolve() {
        XCTAssertEqual(DriveHighlightSlideProjector.efficiencyUnit(for: .miles), "Wh/mi")
        XCTAssertEqual(DriveHighlightSlideProjector.efficiencyUnit(for: .kilometers), "Wh/km")
        XCTAssertEqual(DriveHighlightSlideProjector.efficiencyUnit(for: .feet), "Wh/km")
    }
}

// MARK: - Accessibility summary content

@MainActor final class DriveHighlightSlideAccessibilityTests: XCTestCase {
    func testSummaryCombinesLabelRouteStatsAndDate() {
        let summary = DriveHighlightFixture
            .project(DriveHighlightFixture.roadTrip, unit: .kilometers)
            .accessibilityLabel
        XCTAssertTrue(summary.contains("Longest Drive"))
        XCTAssertTrue(summary.contains("San Francisco, CA to Los Angeles, CA"))
        XCTAssertTrue(summary.contains("413 km"))
        XCTAssertTrue(summary.contains("4h 47m"))
        XCTAssertTrue(summary.contains("168 Wh/km"))
        XCTAssertTrue(summary.contains("July 15, 2024"))
    }

    func testSummaryUsesEmDashForMissingPieces() {
        let drive = DriveHighlightReviewDTO(
            date: "",
            distanceKm: 10,
            durationMin: 30,
            startAddress: "",
            endAddress: "",
            efficiencyWhKm: 0
        )
        let summary = DriveHighlightFixture.project(drive, unit: .kilometers, label: "Shortest Drive")
            .accessibilityLabel
        XCTAssertTrue(summary.contains("Shortest Drive"))
        XCTAssertTrue(summary.contains("— to —"))
        XCTAssertTrue(summary.contains("— Wh/km"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyDriveHighlightSlideTelemetry: DriveHighlightSlideTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
