//
//  LiveTelemetry.ModelTests.swift
//  TeslaSync — P4 feature view · 0127 · LiveTelemetry (Apple)
//
//  State-holder coverage for the LiveTelemetry surface: the LiveTelemetryModel wiring,
//  the P1/S11 view.opened telemetry, the stale auto-refresh transition, plus the
//  accessibility-summary content. Adapter / projection coverage lives in
//  LiveTelemetry.Tests.swift.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

// MARK: - State holder: wiring, telemetry, freshness

@MainActor final class LiveTelemetryModelTests: XCTestCase {
    private func makeModel(
        _ input: LiveTelemetryInput,
        diagnostics: LiveTelemetryDiagnostics = OSLogLiveTelemetryDiagnostics()
    ) -> (LiveTelemetryModel, InMemoryLiveTelemetrySource) {
        let source = InMemoryLiveTelemetrySource(initial: input)
        let model = LiveTelemetryModel(source: source, diagnostics: diagnostics, locale: enUS)
        return (model, source)
    }

    private var dataInput: LiveTelemetryInput {
        LiveTelemetryInput(motor: MotorTelemetry(torque: 248), climate: ClimateTelemetry(insideTemp: 21))
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyLiveTelemetryDiagnostics()
        let (model, source) = makeModel(dataInput, diagnostics: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertNotNil(model.resolved.drivetrain)
        XCTAssertEqual(spy.surfaces, [LiveTelemetry.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialStateIsLoadingBeforeSnapshot() {
        let source = InMemoryLiveTelemetrySource()
        let model = LiveTelemetryModel(source: source, locale: enUS)
        XCTAssertEqual(model.phase, .loading)
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(LiveTelemetryInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(dataInput)
        XCTAssertEqual(model.phase, .data)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(dataInput)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        var stale = dataInput
        stale.connection = .stale
        source.push(stale)
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        // Staying stale must not re-trigger the one-shot auto-refresh.
        source.push(stale)
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(dataInput)
        model.start()
        var offline = dataInput
        offline.connection = .offline
        source.push(offline)
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(dataInput)
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(dataInput)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(LiveTelemetry.surfaceSlug, "LiveTelemetry")
    }
}

// MARK: - Accessibility summary content

@MainActor final class LiveTelemetryAccessibilityTests: XCTestCase {
    func testRowLabelJoinsParts() {
        XCTAssertEqual(LiveTelemetryAccessibility.row(label: "Torque", value: "248 Nm"), "Torque, 248 Nm")
    }

    func testTireLabelJoinsParts() {
        XCTAssertEqual(LiveTelemetryAccessibility.tire(corner: "FL", value: "2.6", unit: "bar"), "FL, 2.6 bar")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyLiveTelemetryDiagnostics: LiveTelemetryDiagnostics, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
