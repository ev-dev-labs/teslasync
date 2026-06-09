//
//  ClimateControlPanelWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0026 · ClimateControlPanelWidget (Apple)
//
//  State-holder / registry / accessibility coverage for the surface (the pure
//  adapter coverage lives in ClimateControlPanelWidget.AdapterTests.swift):
//    • State holder — `ClimatePanelModel` phase resolution + projection wiring +
//      P1/S11 telemetry.
//    • Registry — canonical `climate-control-panel` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. No network, no real store:
//  the model is driven by `InMemoryClimatePanelSource`.
//

import XCTest
@testable import TeslaSync

/// A bundle-free localizer: returns the English fallback verbatim so the
/// accessibility summary asserts the web copy regardless of the host bundle.
private let passthrough: @Sendable (String, String) -> String = { _, fallback in fallback }

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class ClimatePanelModelTests: XCTestCase {
    private func loaded(_ inside: Double = 21) -> ClimatePanelUpdate {
        ClimatePanelUpdate(status: .loaded, input: ClimatePanelInput(insideTemp: inside), unit: .celsius)
    }

    func testLoadingWithoutDataShowsLoading() {
        XCTAssertEqual(ClimatePanelModel.resolvePhase(ClimatePanelUpdate(status: .loading)), .loading)
    }

    func testLoadedWithoutDataShowsEmpty() {
        XCTAssertEqual(ClimatePanelModel.resolvePhase(ClimatePanelUpdate(status: .loaded)), .empty)
        XCTAssertEqual(ClimatePanelModel.resolvePhase(ClimatePanelUpdate(status: .empty)), .empty)
    }

    func testFailedWithoutCacheShowsError() {
        XCTAssertEqual(
            ClimatePanelModel.resolvePhase(ClimatePanelUpdate(status: .failed("boom"))),
            .error("boom")
        )
    }

    func testCachedDataKeepsContentWhileFetchingOrFailed() {
        let withData = ClimatePanelInput(insideTemp: 20)
        XCTAssertEqual(
            ClimatePanelModel.resolvePhase(ClimatePanelUpdate(status: .loading, input: withData)),
            .content
        )
        XCTAssertEqual(
            ClimatePanelModel.resolvePhase(ClimatePanelUpdate(status: .failed("net"), input: withData)),
            .content
        )
    }

    func testModelProjectsLoadedData() {
        let model = ClimatePanelModel(source: InMemoryClimatePanelSource(initial: loaded()))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.metrics.first?.value, "21°C")
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyClimatePanelTelemetry()
        let source = InMemoryClimatePanelSource(initial: ClimatePanelUpdate(status: .loading))
        let model = ClimatePanelModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [ClimateControlPanelWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let source = InMemoryClimatePanelSource(initial: loaded())
        let model = ClimatePanelModel(source: source)
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndUnitTrackUpdates() {
        let source = InMemoryClimatePanelSource(initial: ClimatePanelUpdate(status: .loading))
        let model = ClimatePanelModel(source: source)
        model.start()
        source.push(
            ClimatePanelUpdate(
                status: .loaded,
                connection: .offline,
                input: ClimatePanelInput(insideTemp: 0),
                unit: .fahrenheit,
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.temperatureUnitLabel, "°F")
        XCTAssertEqual(model.projection.compactValue, "32°F", "0 °C surfaces as 32 °F")
    }

    func testEmptyInputClearsProjection() {
        let source = InMemoryClimatePanelSource(initial: loaded())
        let model = ClimatePanelModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .content)
        source.push(ClimatePanelUpdate(status: .empty))
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.projection, .empty)
    }
}

// MARK: - Registry parity

@MainActor final class ClimatePanelRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = ClimateControlPanelWidget.registration
        XCTAssertEqual(registration.id, "climate-control-panel")
        XCTAssertEqual(registration.category, "climate")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = ClimateControlPanelWidget.registration
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)),
            DashboardWidgetSize(cols: 1, rows: 2)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 2, rows: 6)),
            DashboardWidgetSize(cols: 2, rows: 6)
        )
    }
}

// MARK: - Accessibility summary content

@MainActor final class ClimatePanelAccessibilityTests: XCTestCase {
    func testSummaryIncludesEveryActiveSection() {
        let input = ClimatePanelInput(
            insideTemp: 22,
            outsideTemp: 9,
            hvacPower: 2.3,
            hvacACEnabled: true,
            hvacFanSpeed: 4,
            seatHeaterLeft: 3,
            steeringWheelHeatLevel: 2,
            defrostMode: "Front",
            batteryHeaterOn: true
        )
        let projection = ClimatePanelProjectionBuilder.build(input: input, unit: .celsius, localize: passthrough)
        let summary = ClimatePanelAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("HVAC On"), "names HVAC state")
        XCTAssertTrue(summary.contains("Cabin 22°C"), "names cabin temp")
        XCTAssertTrue(summary.contains("Outside 9°C"), "names outside temp")
        XCTAssertTrue(summary.contains("Fan Speed 4"), "names fan speed")
        XCTAssertTrue(summary.contains("Wheel Heat 2/3"), "names wheel heat")
        XCTAssertTrue(summary.contains("FL 3/3"), "names the active seat heater")
        XCTAssertTrue(summary.contains("Defrost"), "names defrost")
        XCTAssertTrue(summary.contains("Bat Heater"), "names battery heater")
    }

    func testSummaryFallsBackToNoSeatHeaters() {
        let projection = ClimatePanelProjectionBuilder.build(
            input: ClimatePanelInput(insideTemp: 18),
            unit: .celsius,
            localize: passthrough
        )
        let summary = ClimatePanelAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("No seat heaters active"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyClimatePanelTelemetry: ClimatePanelTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
