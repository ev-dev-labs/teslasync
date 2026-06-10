//
//  ClimateStatusWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0028 · ClimateStatusWidget (Apple)
//
//  State-holder / registry / accessibility coverage for the surface (the pure
//  adapter coverage lives in ClimateStatusWidget.AdapterTests.swift):
//    • State holder — `ClimateStatusModel` phase resolution + projection wiring +
//      P1/S11 telemetry.
//    • Registry — canonical `climate-status` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. No network, no real store:
//  the model is driven by `InMemoryClimateStatusSource`.
//

import XCTest
@testable import TeslaSync

/// A bundle-free localizer: returns the English fallback verbatim so the
/// accessibility summary asserts the web copy regardless of the host bundle.
private let passthrough: @Sendable (String, String) -> String = { _, fallback in fallback }

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class ClimateStatusModelTests: XCTestCase {
    private func loaded(_ inside: Double = 21) -> ClimateStatusUpdate {
        ClimateStatusUpdate(status: .loaded, input: ClimateStatusInput(insideTemp: inside), unit: .celsius)
    }

    func testLoadingWithoutDataShowsLoading() {
        XCTAssertEqual(ClimateStatusModel.resolvePhase(ClimateStatusUpdate(status: .loading)), .loading)
    }

    func testLoadedWithoutDataShowsEmpty() {
        XCTAssertEqual(ClimateStatusModel.resolvePhase(ClimateStatusUpdate(status: .loaded)), .empty)
        XCTAssertEqual(ClimateStatusModel.resolvePhase(ClimateStatusUpdate(status: .empty)), .empty)
    }

    func testFailedWithoutCacheShowsError() {
        XCTAssertEqual(
            ClimateStatusModel.resolvePhase(ClimateStatusUpdate(status: .failed("boom"))),
            .error("boom")
        )
    }

    func testCachedDataKeepsContentWhileFetchingOrFailed() {
        let withData = ClimateStatusInput(insideTemp: 20)
        XCTAssertEqual(
            ClimateStatusModel.resolvePhase(ClimateStatusUpdate(status: .loading, input: withData)),
            .content
        )
        XCTAssertEqual(
            ClimateStatusModel.resolvePhase(ClimateStatusUpdate(status: .failed("net"), input: withData)),
            .content
        )
    }

    func testModelProjectsLoadedData() {
        let model = ClimateStatusModel(source: InMemoryClimateStatusSource(initial: loaded()))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.rows.first?.value, "21°C")
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyClimateStatusTelemetry()
        let source = InMemoryClimateStatusSource(initial: ClimateStatusUpdate(status: .loading))
        let model = ClimateStatusModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [ClimateStatusWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let source = InMemoryClimateStatusSource(initial: loaded())
        let model = ClimateStatusModel(source: source)
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndUnitTrackUpdates() {
        let source = InMemoryClimateStatusSource(initial: ClimateStatusUpdate(status: .loading))
        let model = ClimateStatusModel(source: source)
        model.start()
        source.push(
            ClimateStatusUpdate(
                status: .loaded,
                connection: .offline,
                input: ClimateStatusInput(insideTemp: 0),
                unit: .fahrenheit,
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.rows.first?.value, "32°F", "0 °C surfaces as 32 °F")
    }

    func testEmptyInputClearsProjection() {
        let source = InMemoryClimateStatusSource(initial: loaded())
        let model = ClimateStatusModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .content)
        source.push(ClimateStatusUpdate(status: .empty))
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.projection, .empty)
    }
}

// MARK: - Registry parity

@MainActor final class ClimateStatusRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = ClimateStatusWidget.registration
        XCTAssertEqual(registration.id, "climate-status")
        XCTAssertEqual(registration.category, "climate")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 2, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = ClimateStatusWidget.registration
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)),
            DashboardWidgetSize(cols: 1, rows: 2)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 2, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 2, rows: 6)),
            DashboardWidgetSize(cols: 2, rows: 6)
        )
    }
}

// MARK: - Accessibility summary content

@MainActor final class ClimateStatusAccessibilityTests: XCTestCase {
    func testSummaryIncludesEveryRowAndChip() {
        let input = ClimateStatusInput(
            insideTemp: 22,
            outsideTemp: 9,
            hvacPower: 2.3,
            defrostMode: "Front",
            batteryHeaterOn: true
        )
        let projection = ClimateStatusProjectionBuilder.build(input: input, unit: .celsius, localize: passthrough)
        let summary = ClimateStatusAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Cabin 22°C"), "names cabin temp")
        XCTAssertTrue(summary.contains("Outside 9°C"), "names outside temp")
        XCTAssertTrue(summary.contains("HVAC 2.3 kW"), "names HVAC power")
        XCTAssertTrue(summary.contains("Defrost"), "names defrost")
        XCTAssertTrue(summary.contains("Heater"), "names heater")
    }

    func testSummaryOmitsInactiveChips() {
        let projection = ClimateStatusProjectionBuilder.build(
            input: ClimateStatusInput(insideTemp: 18, outsideTemp: 12, hvacPower: nil),
            unit: .celsius,
            localize: passthrough
        )
        let summary = ClimateStatusAccessibility.summary(for: projection)
        XCTAssertFalse(summary.contains("Defrost"))
        XCTAssertFalse(summary.contains("Heater"))
        XCTAssertTrue(summary.contains("HVAC —"), "missing HVAC value renders an em dash")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyClimateStatusTelemetry: ClimateStatusTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
