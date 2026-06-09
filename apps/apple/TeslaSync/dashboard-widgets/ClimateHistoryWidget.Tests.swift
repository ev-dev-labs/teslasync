//
//  ClimateHistoryWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0027 · ClimateHistoryWidget (Apple)
//
//  Unit coverage for the ClimateHistoryWidget surface:
//    • Conversion — `ClimateTempConvert.fromSI` parity with web `convertTempFromSI`.
//    • Adapter (cached → projection) — `ClimateHistoryProjectionBuilder` parity with the
//      web `buildChartData` + the `latestInside` / `latestOutside` scans + the y-domain.
//    • State holder — `ClimateHistoryModel` phase resolution + P1/S11 telemetry.
//    • Registry — canonical `climate-history` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. No network, no real store:
//  the model is driven by `InMemoryClimateHistorySource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Conversion: SI Celsius → display unit (port of convertTempFromSI)

@MainActor final class ClimateTempConvertTests: XCTestCase {
    func testCelsiusIdentity() throws {
        XCTAssertEqual(try XCTUnwrap(ClimateTempConvert.fromSI(21, .celsius)), 21, accuracy: 0.0001)
        XCTAssertEqual(try XCTUnwrap(ClimateTempConvert.fromSI(-12.5, .celsius)), -12.5, accuracy: 0.0001)
    }

    func testFahrenheitUsesNineFifthsPlusThirtyTwo() throws {
        XCTAssertEqual(try XCTUnwrap(ClimateTempConvert.fromSI(0, .fahrenheit)), 32, accuracy: 0.0001)
        XCTAssertEqual(try XCTUnwrap(ClimateTempConvert.fromSI(100, .fahrenheit)), 212, accuracy: 0.0001)
        XCTAssertEqual(try XCTUnwrap(ClimateTempConvert.fromSI(37, .fahrenheit)), 98.6, accuracy: 0.0001)
    }

    func testFahrenheitNegativeCrossover() throws {
        XCTAssertEqual(try XCTUnwrap(ClimateTempConvert.fromSI(-40, .fahrenheit)), -40, accuracy: 0.0001)
    }

    func testNilAndNonFiniteBecomeNil() {
        XCTAssertNil(ClimateTempConvert.fromSI(nil, .celsius))
        XCTAssertNil(ClimateTempConvert.fromSI(.nan, .celsius))
        XCTAssertNil(ClimateTempConvert.fromSI(.infinity, .fahrenheit))
    }

    func testUnitFromLabelDefaultsToCelsius() {
        XCTAssertEqual(ClimateTemperatureUnit.fromLabel("°F"), .fahrenheit)
        XCTAssertEqual(ClimateTemperatureUnit.fromLabel("°C"), .celsius)
        XCTAssertEqual(ClimateTemperatureUnit.fromLabel(nil), .celsius)
        XCTAssertEqual(ClimateTemperatureUnit.fromLabel("garbage"), .celsius)
    }
}

// MARK: - Adapter: cached rows → projection (port of buildChartData)

@MainActor final class ClimateHistoryAdapterTests: XCTestCase {
    private func snap(
        createdAt: String? = nil,
        timestamp: String? = nil,
        inside: Double? = nil,
        outside: Double? = nil
    ) -> ClimateSnapshotInput {
        ClimateSnapshotInput(createdAt: createdAt, timestamp: timestamp, insideTemp: inside, outsideTemp: outside)
    }

    func testEmptyWhenNoSnapshots() {
        let projection = ClimateHistoryProjectionBuilder.build(snapshots: [], unit: .celsius)
        XCTAssertFalse(projection.hasData)
        XCTAssertTrue(projection.latest.isEmpty)
    }

    func testRowsWithoutTimestampAreDropped() {
        let rows = [
            snap(createdAt: nil, timestamp: nil, inside: 21),
            snap(createdAt: "   ", timestamp: "  ", inside: 22),
            snap(createdAt: "2024-01-01T00:00:00Z", inside: 23)
        ]
        let projection = ClimateHistoryProjectionBuilder.build(snapshots: rows, unit: .celsius)
        XCTAssertEqual(projection.data.count, 1)
        XCTAssertEqual(projection.data.first?.inside, 23)
    }

    func testFallsBackToTimestampWhenCreatedAtMissing() {
        let rows = [snap(createdAt: nil, timestamp: "2024-01-01T00:00:00Z", inside: 19)]
        let projection = ClimateHistoryProjectionBuilder.build(snapshots: rows, unit: .celsius)
        XCTAssertEqual(projection.data.count, 1)
        XCTAssertEqual(projection.data.first?.inside, 19)
    }

    func testPrefersCreatedAtOverTimestamp() {
        let rows = [
            snap(createdAt: "2024-01-01T00:00:30Z", timestamp: "1999-01-01T00:00:00Z", inside: 2),
            snap(createdAt: "2024-01-01T00:00:00Z", timestamp: "1999-01-01T00:00:00Z", inside: 1)
        ]
        let projection = ClimateHistoryProjectionBuilder.build(snapshots: rows, unit: .celsius)
        // Sorted by the created_at instant, not the ignored timestamp.
        XCTAssertEqual(projection.data.map(\.inside), [1, 2])
    }

    func testSortsAscendingByTime() {
        let rows = [
            snap(createdAt: "2024-01-01T00:00:30Z", inside: 3),
            snap(createdAt: "2024-01-01T00:00:00Z", inside: 1),
            snap(createdAt: "2024-01-01T00:00:15Z", inside: 2)
        ]
        let projection = ClimateHistoryProjectionBuilder.build(snapshots: rows, unit: .celsius)
        XCTAssertEqual(projection.data.map(\.inside), [1, 2, 3])
    }

    func testSeriesConvertedToDisplayUnit() throws {
        let row = snap(createdAt: "2024-01-01T00:00:00Z", inside: 0, outside: 100)
        let datum = try XCTUnwrap(
            ClimateHistoryProjectionBuilder.build(snapshots: [row], unit: .fahrenheit).data.first
        )
        XCTAssertEqual(try XCTUnwrap(datum.inside), 32, accuracy: 0.0001)
        XCTAssertEqual(try XCTUnwrap(datum.outside), 212, accuracy: 0.0001)
    }

    func testNonFiniteSeriesBecomesNil() {
        let row = snap(createdAt: "2024-01-01T00:00:00Z", inside: .nan, outside: 18)
        let datum = ClimateHistoryProjectionBuilder.build(snapshots: [row], unit: .celsius).data.first
        XCTAssertNil(datum?.inside)
        XCTAssertEqual(datum?.outside, 18)
    }

    func testLatestSkipsTrailingNilsPerSeries() {
        let rows = [
            snap(createdAt: "2024-01-01T00:00:00Z", inside: 21, outside: 10),
            snap(createdAt: "2024-01-01T00:00:30Z", inside: 22, outside: 11),
            snap(createdAt: "2024-01-01T00:01:00Z", inside: nil, outside: 12)
        ]
        let projection = ClimateHistoryProjectionBuilder.build(snapshots: rows, unit: .celsius)
        XCTAssertEqual(projection.latestValue(.cabin), 22, "Cabin skips the trailing nil")
        XCTAssertEqual(projection.latestValue(.outside), 12)
    }

    func testLatestNilWhenSeriesNeverReported() {
        let rows = [snap(createdAt: "2024-01-01T00:00:00Z", inside: 21)]
        let projection = ClimateHistoryProjectionBuilder.build(snapshots: rows, unit: .celsius)
        XCTAssertEqual(projection.latestValue(.cabin), 21)
        XCTAssertNil(projection.latestValue(.outside), "Outside never reported")
    }

    func testYDomainSpansEveryPlottedValue() {
        let rows = [snap(createdAt: "2024-01-01T00:00:00Z", inside: 24, outside: 8)]
        let domain = ClimateHistoryProjectionBuilder.build(snapshots: rows, unit: .celsius).yDomain
        XCTAssertLessThan(domain.lowerBound, 8)
        XCTAssertGreaterThan(domain.upperBound, 24)
    }

    func testYDomainAllowsNegativeTemperatures() {
        // Unlike pressure, temperature is not floored at 0 — sub-zero readings must show.
        let rows = [snap(createdAt: "2024-01-01T00:00:00Z", inside: 18, outside: -15)]
        let domain = ClimateHistoryProjectionBuilder.build(snapshots: rows, unit: .celsius).yDomain
        XCTAssertLessThan(domain.lowerBound, -15, "lower bound is padded below the coldest reading")
    }

    func testTemperatureUnitLabelTracksUnit() {
        let celsius = ClimateHistoryProjectionBuilder.build(snapshots: [], unit: .celsius)
        let fahrenheit = ClimateHistoryProjectionBuilder.build(snapshots: [], unit: .fahrenheit)
        XCTAssertEqual(celsius.temperatureUnitLabel, "°C")
        XCTAssertEqual(fahrenheit.temperatureUnitLabel, "°F")
    }
}

// MARK: - Display formatting (port of fmtInt)

@MainActor final class ClimateNumberFormatTests: XCTestCase {
    func testNilRendersEmDash() {
        XCTAssertEqual(ClimateNumberFormat.temperature(nil), "—")
        XCTAssertEqual(ClimateNumberFormat.temperature(.nan), "—")
    }

    func testValueRoundsToInteger() {
        XCTAssertEqual(ClimateNumberFormat.integer(21.6), "22")
        XCTAssertEqual(ClimateNumberFormat.integer(21.4), "21")
        let formatted = ClimateNumberFormat.temperature(8.0)
        XCTAssertTrue(formatted.hasPrefix("8"))
        XCTAssertNotEqual(formatted, "—")
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class ClimateHistoryModelTests: XCTestCase {
    private func loaded(_ inside: Double = 21) -> ClimateHistoryUpdate {
        ClimateHistoryUpdate(
            status: .loaded,
            snapshots: [ClimateSnapshotInput(createdAt: "2024-01-01T00:00:00Z", insideTemp: inside)],
            unit: .celsius
        )
    }

    func testLoadingWithoutDataShowsLoading() {
        XCTAssertEqual(ClimateHistoryModel.resolvePhase(status: .loading, hasData: false), .loading)
    }

    func testLoadedWithoutDataShowsEmpty() {
        XCTAssertEqual(ClimateHistoryModel.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(ClimateHistoryModel.resolvePhase(status: .empty, hasData: false), .empty)
    }

    func testFailedWithoutCacheShowsError() {
        XCTAssertEqual(ClimateHistoryModel.resolvePhase(status: .failed("boom"), hasData: false), .error("boom"))
    }

    func testCachedDataKeepsContentWhileFetchingOrFailed() {
        XCTAssertEqual(ClimateHistoryModel.resolvePhase(status: .loading, hasData: true), .content)
        XCTAssertEqual(ClimateHistoryModel.resolvePhase(status: .failed("net"), hasData: true), .content)
    }

    func testModelProjectsLoadedData() {
        let source = InMemoryClimateHistorySource(initial: loaded())
        let model = ClimateHistoryModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.latestValue(.cabin), 21)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyClimateHistoryTelemetry()
        let source = InMemoryClimateHistorySource(initial: ClimateHistoryUpdate(status: .loading))
        let model = ClimateHistoryModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [ClimateHistoryWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let source = InMemoryClimateHistorySource(initial: loaded())
        let model = ClimateHistoryModel(source: source)
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndUnitTrackUpdates() {
        let source = InMemoryClimateHistorySource(initial: ClimateHistoryUpdate(status: .loading))
        let model = ClimateHistoryModel(source: source)
        model.start()
        source.push(
            ClimateHistoryUpdate(
                status: .loaded,
                connection: .offline,
                snapshots: [ClimateSnapshotInput(createdAt: "2024-01-01T00:00:00Z", insideTemp: 0)],
                unit: .fahrenheit,
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.temperatureUnitLabel, "°F")
        XCTAssertEqual(model.projection.latestValue(.cabin), 32, "0 °C surfaces as 32 °F")
    }
}

// MARK: - Registry parity

@MainActor final class ClimateHistoryRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = ClimateHistoryWidget.registration
        XCTAssertEqual(registration.id, "climate-history")
        XCTAssertEqual(registration.category, "climate")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = ClimateHistoryWidget.registration
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

@MainActor final class ClimateHistoryAccessibilityTests: XCTestCase {
    func testSummaryIncludesEverySeries() {
        let row = ClimateSnapshotInput(
            createdAt: "2024-01-01T00:00:00Z",
            insideTemp: 22,
            outsideTemp: 9
        )
        let projection = ClimateHistoryProjectionBuilder.build(snapshots: [row], unit: .celsius)
        let summary = ClimateHistoryAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Cabin"), "summary names Cabin")
        XCTAssertTrue(summary.contains("Outside"), "summary names Outside")
        XCTAssertTrue(summary.contains("°C"), "summary carries the unit")
        XCTAssertTrue(summary.contains("22"), "summary carries the cabin value")
        XCTAssertTrue(summary.contains("9"), "summary carries the outside value")
    }

    func testSummaryEmptyState() {
        let summary = ClimateHistoryAccessibility.summary(for: .empty)
        XCTAssertEqual(summary, "No climate history")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyClimateHistoryTelemetry: ClimateHistoryTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
