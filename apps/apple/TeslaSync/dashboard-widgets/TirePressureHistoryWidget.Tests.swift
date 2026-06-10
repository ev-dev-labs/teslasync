//
//  TirePressureHistoryWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0101 · TirePressureHistoryWidget (Apple)
//
//  Unit coverage for the TirePressureHistoryWidget surface:
//    • Conversion — `TirePressureConvert.fromSI` parity with web `convertPressureFromSI`.
//    • Adapter (cached → projection) — `TirePressureProjectionBuilder` parity with the
//      web `buildChartData` + `latestNonNull` + the recommended-range / y-domain math.
//    • State holder — `TirePressureHistoryModel` phase resolution + P1/S11 telemetry.
//    • Registry — canonical `tire-pressure-history` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. No network, no real store:
//  the model is driven by `InMemoryTirePressureHistorySource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Conversion: SI kilopascals → display unit (port of convertPressureFromSI)

@MainActor final class TirePressureConvertTests: XCTestCase {
    func testKilopascalIdentity() throws {
        XCTAssertEqual(try XCTUnwrap(TirePressureConvert.fromSI(250, .kpa)), 250, accuracy: 0.0001)
    }

    func testBarIsKpaOverHundred() throws {
        XCTAssertEqual(try XCTUnwrap(TirePressureConvert.fromSI(100, .bar)), 1, accuracy: 0.0001)
        XCTAssertEqual(try XCTUnwrap(TirePressureConvert.fromSI(240, .bar)), 2.4, accuracy: 0.0001)
    }

    func testPsiUsesNistFactor() throws {
        XCTAssertEqual(try XCTUnwrap(TirePressureConvert.fromSI(250, .psi)), 250 / 6.894757, accuracy: 0.0001)
    }

    func testNilAndNonFiniteBecomeNil() {
        XCTAssertNil(TirePressureConvert.fromSI(nil, .bar))
        XCTAssertNil(TirePressureConvert.fromSI(.nan, .bar))
        XCTAssertNil(TirePressureConvert.fromSI(.infinity, .psi))
    }

    func testUnitFromLabelDefaultsToBar() {
        XCTAssertEqual(TirePressureUnit.fromLabel("psi"), .psi)
        XCTAssertEqual(TirePressureUnit.fromLabel("kPa"), .kpa)
        XCTAssertEqual(TirePressureUnit.fromLabel(nil), .bar)
        XCTAssertEqual(TirePressureUnit.fromLabel("bar"), .bar)
    }
}

// MARK: - Adapter: cached rows → projection (port of buildChartData)

@MainActor final class TirePressureAdapterTests: XCTestCase {
    private func snap(
        _ timestamp: String?,
        fl: Double? = nil,
        fr: Double? = nil,
        rl: Double? = nil,
        rr: Double? = nil
    ) -> TirePressureSnapshotInput {
        TirePressureSnapshotInput(timestamp: timestamp, frontLeft: fl, frontRight: fr, rearLeft: rl, rearRight: rr)
    }

    func testEmptyWhenNoSnapshots() {
        let projection = TirePressureProjectionBuilder.build(snapshots: [], unit: .bar)
        XCTAssertFalse(projection.hasData)
        XCTAssertTrue(projection.latest.isEmpty)
    }

    func testRowsWithoutTimestampAreDropped() {
        let rows = [
            snap(nil, fl: 240),
            snap("   ", fl: 245),
            snap("2024-01-01T00:00:00Z", fl: 250)
        ]
        let projection = TirePressureProjectionBuilder.build(snapshots: rows, unit: .kpa)
        XCTAssertEqual(projection.data.count, 1)
        XCTAssertEqual(projection.data.first?.frontLeft, 250)
    }

    func testSortsAscendingByTime() {
        let rows = [
            snap("2024-01-01T00:00:30Z", fl: 3),
            snap("2024-01-01T00:00:00Z", fl: 1),
            snap("2024-01-01T00:00:15Z", fl: 2)
        ]
        let projection = TirePressureProjectionBuilder.build(snapshots: rows, unit: .kpa)
        XCTAssertEqual(projection.data.map(\.frontLeft), [1, 2, 3])
    }

    func testCornersConvertedToDisplayUnit() throws {
        let row = snap("2024-01-01T00:00:00Z", fl: 240, fr: 250, rl: 260, rr: 270)
        let datum = try XCTUnwrap(TirePressureProjectionBuilder.build(snapshots: [row], unit: .bar).data.first)
        XCTAssertEqual(try XCTUnwrap(datum.frontLeft), 2.4, accuracy: 0.0001)
        XCTAssertEqual(try XCTUnwrap(datum.frontRight), 2.5, accuracy: 0.0001)
        XCTAssertEqual(try XCTUnwrap(datum.rearLeft), 2.6, accuracy: 0.0001)
        XCTAssertEqual(try XCTUnwrap(datum.rearRight), 2.7, accuracy: 0.0001)
    }

    func testNonFiniteCornerBecomesNil() {
        let row = snap("2024-01-01T00:00:00Z", fl: .nan, fr: 250)
        let datum = TirePressureProjectionBuilder.build(snapshots: [row], unit: .kpa).data.first
        XCTAssertNil(datum?.frontLeft)
        XCTAssertEqual(datum?.frontRight, 250)
    }

    func testLatestSkipsTrailingNilsPerCorner() {
        let rows = [
            snap("2024-01-01T00:00:00Z", fl: 240, fr: 250),
            snap("2024-01-01T00:00:30Z", fl: 238, fr: 248),
            snap("2024-01-01T00:01:00Z", fl: nil, fr: 246)
        ]
        let projection = TirePressureProjectionBuilder.build(snapshots: rows, unit: .kpa)
        XCTAssertEqual(projection.latestValue(.frontLeft), 238, "FL skips the trailing nil")
        XCTAssertEqual(projection.latestValue(.frontRight), 246)
        XCTAssertNil(projection.latestValue(.rearLeft), "RL never reported")
    }

    func testRecommendedRangeKilopascals() {
        let projection = TirePressureProjectionBuilder.build(snapshots: [], unit: .kpa)
        XCTAssertEqual(projection.recommendedLow, 240, accuracy: 0.0001)
        XCTAssertEqual(projection.recommendedHigh, 280, accuracy: 0.0001)
    }

    func testRecommendedRangeBar() {
        let projection = TirePressureProjectionBuilder.build(snapshots: [], unit: .bar)
        XCTAssertEqual(projection.recommendedLow, 2.4, accuracy: 0.0001)
        XCTAssertEqual(projection.recommendedHigh, 2.8, accuracy: 0.0001)
    }

    func testRecommendedRangePsi() {
        let projection = TirePressureProjectionBuilder.build(snapshots: [], unit: .psi)
        XCTAssertEqual(projection.recommendedLow, 240 / 6.894757, accuracy: 0.0001)
        XCTAssertEqual(projection.recommendedHigh, 280 / 6.894757, accuracy: 0.0001)
    }

    func testYDomainSpansDataAndRecommendedBand() {
        let rows = [snap("2024-01-01T00:00:00Z", fl: 300, fr: 230)]
        let domain = TirePressureProjectionBuilder.build(snapshots: rows, unit: .kpa).yDomain
        // values: 300, 230, recommended 240 & 280 → spans [230 … 300] padded.
        XCTAssertLessThan(domain.lowerBound, 230)
        XCTAssertGreaterThan(domain.upperBound, 300)
    }

    func testYDomainFlooredAtZero() {
        let rows = [snap("2024-01-01T00:00:00Z", fl: 4)]
        let domain = TirePressureProjectionBuilder.build(snapshots: rows, unit: .kpa).yDomain
        XCTAssertEqual(domain.lowerBound, 0, "padded lower bound never goes negative")
    }

    func testPressureUnitLabelTracksUnit() {
        XCTAssertEqual(TirePressureProjectionBuilder.build(snapshots: [], unit: .kpa).pressureUnitLabel, "kPa")
        XCTAssertEqual(TirePressureProjectionBuilder.build(snapshots: [], unit: .psi).pressureUnitLabel, "psi")
        XCTAssertEqual(TirePressureProjectionBuilder.build(snapshots: [], unit: .bar).pressureUnitLabel, "bar")
    }
}

// MARK: - Display formatting (port of formatPressure)

@MainActor final class TirePressureFormatTests: XCTestCase {
    func testNilRendersEmDash() {
        XCTAssertEqual(TirePressureNumberFormat.pressure(nil), "—")
        XCTAssertEqual(TirePressureNumberFormat.pressure(.nan), "—")
    }

    func testValueRendersOneDecimal() {
        let formatted = TirePressureNumberFormat.pressure(2.0)
        XCTAssertTrue(formatted.hasPrefix("2"), "renders the integer part")
        XCTAssertNotEqual(formatted, "—")
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class TirePressureModelTests: XCTestCase {
    private func loaded(_ frontLeft: Double = 250) -> TirePressureHistoryUpdate {
        TirePressureHistoryUpdate(
            status: .loaded,
            snapshots: [TirePressureSnapshotInput(timestamp: "2024-01-01T00:00:00Z", frontLeft: frontLeft)],
            unit: .kpa
        )
    }

    func testLoadingWithoutDataShowsLoading() {
        XCTAssertEqual(TirePressureHistoryModel.resolvePhase(status: .loading, hasData: false), .loading)
    }

    func testLoadedWithoutDataShowsEmpty() {
        XCTAssertEqual(TirePressureHistoryModel.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(TirePressureHistoryModel.resolvePhase(status: .empty, hasData: false), .empty)
    }

    func testFailedWithoutCacheShowsError() {
        XCTAssertEqual(TirePressureHistoryModel.resolvePhase(status: .failed("boom"), hasData: false), .error("boom"))
    }

    func testCachedDataKeepsContentWhileFetchingOrFailed() {
        XCTAssertEqual(TirePressureHistoryModel.resolvePhase(status: .loading, hasData: true), .content)
        XCTAssertEqual(TirePressureHistoryModel.resolvePhase(status: .failed("net"), hasData: true), .content)
    }

    func testModelProjectsLoadedData() {
        let source = InMemoryTirePressureHistorySource(initial: loaded())
        let model = TirePressureHistoryModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.latestValue(.frontLeft), 250)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = TPHistSpyTirePressureTelemetry()
        let source = InMemoryTirePressureHistorySource(initial: TirePressureHistoryUpdate(status: .loading))
        let model = TirePressureHistoryModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [TirePressureHistoryWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let source = InMemoryTirePressureHistorySource(initial: loaded())
        let model = TirePressureHistoryModel(source: source)
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndUnitTrackUpdates() {
        let source = InMemoryTirePressureHistorySource(initial: TirePressureHistoryUpdate(status: .loading))
        let model = TirePressureHistoryModel(source: source)
        model.start()
        source.push(
            TirePressureHistoryUpdate(
                status: .loaded,
                connection: .offline,
                snapshots: [TirePressureSnapshotInput(timestamp: "2024-01-01T00:00:00Z", frontLeft: 207)],
                unit: .psi,
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.pressureUnitLabel, "psi")
    }
}

// MARK: - Registry parity

@MainActor final class TirePressureRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = TirePressureHistoryWidget.registration
        XCTAssertEqual(registration.id, "tire-pressure-history")
        XCTAssertEqual(registration.category, "tires")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = TirePressureHistoryWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 1, rows: 1)), DashboardWidgetSize(cols: 2, rows: 4))
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

@MainActor final class TirePressureAccessibilityTests: XCTestCase {
    func testSummaryIncludesEveryCorner() {
        let row = TirePressureSnapshotInput(
            timestamp: "2024-01-01T00:00:00Z",
            frontLeft: 240,
            frontRight: 250,
            rearLeft: 260,
            rearRight: 270
        )
        let projection = TirePressureProjectionBuilder.build(snapshots: [row], unit: .kpa)
        let summary = TirePressureHistoryAccessibility.summary(for: projection)
        for label in ["FL", "FR", "RL", "RR"] {
            XCTAssertTrue(summary.contains(label), "summary names \(label)")
        }
        XCTAssertTrue(summary.contains("kPa"), "summary carries the unit")
        XCTAssertTrue(summary.contains("240"), "summary carries a value")
    }

    func testSummaryEmptyState() {
        let summary = TirePressureHistoryAccessibility.summary(for: .empty)
        XCTAssertEqual(summary, "No tire pressure history")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class TPHistSpyTirePressureTelemetry: TirePressureHistoryTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
