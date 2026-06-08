//
//  MileageStatsWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0064 · MileageStatsWidget (Apple)
//
//  Unit coverage for the MileageStatsWidget surface:
//    • Adapter (cached → projection) — `MileageStatsBuilder` parity with the
//      web MileageStatsWidget.tsx derive block + `convertDistanceFromSI`.
//    • State holder — `MileageStatsModel` phase resolution across loading /
//      empty / error / content, plus the P1/S11 `view.opened` telemetry +
//      source wiring and the compact threshold.
//    • Registry — canonical `mileage-stats` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemoryMileageStatsSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached DTO → projection (port parity with the web derive block)

@MainActor final class MileageStatsAdapterTests: XCTestCase {
    func testProjectReturnsNilWithoutInput() {
        XCTAssertNil(MileageStatsBuilder.project(nil, unit: .kilometers))
    }

    func testKilometresProjection() throws {
        let input = MileageStatsInput(lifetimeKm: 1000, last30dKm: 300)
        let projection = try XCTUnwrap(MileageStatsBuilder.project(input, unit: .kilometers))
        XCTAssertEqual(projection.totalDisplay, 1000, accuracy: 1e-6)
        XCTAssertEqual(projection.dailyAvgDisplay, 10, accuracy: 1e-6)
        XCTAssertEqual(projection.weeklyAvgDisplay, 70, accuracy: 1e-6)
        XCTAssertEqual(projection.monthlyAvgDisplay, 300, accuracy: 1e-6)
        XCTAssertEqual(projection.milestone, 10000, accuracy: 1e-6)
        XCTAssertEqual(projection.remaining, 9000, accuracy: 1e-6)
        XCTAssertEqual(projection.monthsToMilestone, 30)
    }

    func testMilesConversionUsesExactFactor() throws {
        let input = MileageStatsInput(lifetimeKm: 1609.344, last30dKm: 1609.344)
        let projection = try XCTUnwrap(MileageStatsBuilder.project(input, unit: .miles))
        XCTAssertEqual(projection.totalDisplay, 1000, accuracy: 1e-6)
        XCTAssertEqual(projection.dailyAvgDisplay, 1000.0 / 30.0, accuracy: 1e-6)
        XCTAssertEqual(projection.milestone, 10000, accuracy: 1e-6)
    }

    func testFeetConversionUsesExactFactor() throws {
        let input = MileageStatsInput(lifetimeKm: 0.3048, last30dKm: 0)
        let projection = try XCTUnwrap(MileageStatsBuilder.project(input, unit: .feet))
        XCTAssertEqual(projection.totalDisplay, 1000, accuracy: 1e-6)
        XCTAssertEqual(projection.dailyAvgDisplay, 0, accuracy: 1e-9)
        XCTAssertEqual(projection.monthsToMilestone, 0)
    }

    func testNextMilestoneRoundsUpAndPushesExactMultiples() {
        XCTAssertEqual(MileageStatsBuilder.nextMilestone(0), 10000, accuracy: 1e-6)
        XCTAssertEqual(MileageStatsBuilder.nextMilestone(9999), 10000, accuracy: 1e-6)
        XCTAssertEqual(MileageStatsBuilder.nextMilestone(10000), 20000, accuracy: 1e-6)
        XCTAssertEqual(MileageStatsBuilder.nextMilestone(15000), 20000, accuracy: 1e-6)
    }

    func testMonthsToMilestone() {
        XCTAssertEqual(MileageStatsBuilder.monthsToMilestone(remaining: 9000, dailyAvgDisplay: 10), 30)
        XCTAssertEqual(MileageStatsBuilder.monthsToMilestone(remaining: 100, dailyAvgDisplay: 10), 1)
        XCTAssertEqual(MileageStatsBuilder.monthsToMilestone(remaining: 9000, dailyAvgDisplay: 0), 0)
    }

    func testConvertDistanceFromSI() {
        XCTAssertEqual(MileageStatsBuilder.convertDistanceFromSI(1000, to: .kilometers), 1, accuracy: 1e-9)
        XCTAssertEqual(MileageStatsBuilder.convertDistanceFromSI(1609.344, to: .miles), 1, accuracy: 1e-9)
        XCTAssertEqual(MileageStatsBuilder.convertDistanceFromSI(0.3048, to: .feet), 1, accuracy: 1e-9)
    }

    func testUnitLabelParsing() {
        XCTAssertEqual(MileageDistanceUnit.fromLabel("mi"), .miles)
        XCTAssertEqual(MileageDistanceUnit.fromLabel("KM"), .kilometers)
        XCTAssertEqual(MileageDistanceUnit.fromLabel("ft"), .feet)
        XCTAssertEqual(MileageDistanceUnit.fromLabel(nil), .kilometers)
        XCTAssertEqual(MileageDistanceUnit.fromLabel("parsecs"), .kilometers)
    }

    func testNumberFormatGroupsAndRounds() {
        XCTAssertEqual(MileageNumberFormat.integer(10000), "10,000")
        XCTAssertEqual(MileageNumberFormat.decimal(12.34, fractionDigits: 1), "12.3")
        XCTAssertEqual(MileageNumberFormat.decimal(12.35, fractionDigits: 1), "12.4")
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class MileageStatsModelTests: XCTestCase {
    private func makeModel(
        _ update: MileageStatsUpdate,
        telemetry: MileageStatsTelemetry = OSLogMileageStatsTelemetry()
    ) -> (MileageStatsModel, InMemoryMileageStatsSource) {
        let source = InMemoryMileageStatsSource(initial: update)
        let model = MileageStatsModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(MileageStatsUpdate(status: .loading, input: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(MileageStatsUpdate(status: .loaded, input: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(MileageStatsUpdate(status: .failed("boom"), input: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsContentEvenWhileFetchingOrFailed() {
        let input = MileageStatsInput(lifetimeKm: 1000, last30dKm: 300)
        let (loading, _) = makeModel(MileageStatsUpdate(status: .loading, input: input))
        loading.start()
        XCTAssertEqual(loading.phase, .content)

        let (failed, _) = makeModel(MileageStatsUpdate(status: .failed("net"), input: input))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyMileageStatsTelemetry()
        let (model, source) = makeModel(MileageStatsUpdate(status: .loading, input: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [MileageStatsWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(MileageStatsUpdate(status: .loaded, input: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionUnitAndProjectionTrackUpdates() {
        let (model, source) = makeModel(MileageStatsUpdate(status: .loading, input: nil))
        model.start()
        source.push(
            MileageStatsUpdate(
                status: .loaded,
                connection: .offline,
                vehicle: MileageVehicleRef(id: 3, displayName: "Cybertruck"),
                input: MileageStatsInput(lifetimeKm: 1609.344, last30dKm: 0),
                unitLabel: "mi",
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.unit, .miles)
        XCTAssertEqual(model.projection?.totalDisplay ?? 0, 1000, accuracy: 1e-6)
    }

    func testCompactThreshold() {
        XCTAssertTrue(MileageStatsModel.isCompact(for: DashboardWidgetSize(cols: 1, rows: 2)))
        XCTAssertFalse(MileageStatsModel.isCompact(for: DashboardWidgetSize(cols: 2, rows: 2)))
    }
}

// MARK: - Registry parity

@MainActor final class MileageStatsRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = MileageStatsWidget.registration
        XCTAssertEqual(registration.id, "mileage-stats")
        XCTAssertEqual(registration.category, "analytics")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 2))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = MileageStatsWidget.registration
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)),
            DashboardWidgetSize(cols: 1, rows: 2)
        )
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

@MainActor final class MileageStatsAccessibilityTests: XCTestCase {
    func testSummaryIncludesEveryStatLabelAndProjection() throws {
        let input = MileageStatsInput(lifetimeKm: 1000, last30dKm: 300)
        let projection = try XCTUnwrap(MileageStatsBuilder.project(input, unit: .kilometers))
        let summary = MileageStatsAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Daily Avg"))
        XCTAssertTrue(summary.contains("Weekly Avg"))
        XCTAssertTrue(summary.contains("Monthly Avg"))
        XCTAssertTrue(summary.contains("Next Milestone"))
        XCTAssertTrue(summary.contains("10,000 km"))
        XCTAssertTrue(summary.contains("mo"))
    }

    func testSummaryOmitsMonthsWhenPaceIsZero() throws {
        let input = MileageStatsInput(lifetimeKm: 1000, last30dKm: 0)
        let projection = try XCTUnwrap(MileageStatsBuilder.project(input, unit: .kilometers))
        let summary = MileageStatsAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Next Milestone"))
        XCTAssertFalse(summary.contains("mo"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyMileageStatsTelemetry: MileageStatsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
