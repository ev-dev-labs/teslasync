//
//  LiveSignalsWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0058 · LiveSignalsWidget (Apple)
//
//  Unit coverage for the LiveSignalsWidget surface:
//    • Adapter (cached → projection) — `LiveSignalsBuilder` / `LiveSignalsFormat`
//      parity with the web row expressions + lib/unitConversion + lib/numberFormat.
//    • State holder — `LiveSignalsModel` phase resolution across loading / empty /
//      error / content, plus the P1/S11 `view.opened` telemetry + source wiring.
//    • Registry — canonical `live-signals` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content for each section.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryLiveSignalsSource`. The pure-adapter
//  subset is additionally proven by an executed host harness (see the gate log).
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: pure conversion + formatting (parity with the web lib)

@MainActor
final class LiveSignalsFormatTests: XCTestCase {
    func testTemperatureConversion() {
        XCTAssertEqual(LiveSignalsFormat.convertTempFromSI(20, .celsius), 20, accuracy: 0.0001)
        XCTAssertEqual(LiveSignalsFormat.convertTempFromSI(45, .fahrenheit), 113, accuracy: 0.0001)
        XCTAssertEqual(LiveSignalsFormat.convertTempFromSI(0, .fahrenheit), 32, accuracy: 0.0001)
    }

    func testPressureConversion() {
        XCTAssertEqual(LiveSignalsFormat.convertPressureFromSI(250, .kpa), 250, accuracy: 0.0001)
        XCTAssertEqual(LiveSignalsFormat.convertPressureFromSI(100, .bar), 1, accuracy: 0.0001)
        XCTAssertEqual(LiveSignalsFormat.convertPressureFromSI(250, .psi), 250 / 6.894757, accuracy: 0.0001)
    }

    func testFmtNumberAndInt() {
        XCTAssertEqual(LiveSignalsFormat.fmtNumber(2.34, 1, locale: "en-US"), "2.3")
        XCTAssertEqual(LiveSignalsFormat.fmtNumber(nil, 1, locale: "en-US"), "0.0")
        XCTAssertEqual(LiveSignalsFormat.fmtInt(12345, locale: "en-US"), "12,345")
        XCTAssertEqual(LiveSignalsFormat.fmtInt(45, locale: "en-US"), "45")
    }

    func testJsNumberMatchesTemplateLiteral() {
        XCTAssertEqual(LiveSignalsFormat.jsNumber(320), "320")
        XCTAssertEqual(LiveSignalsFormat.jsNumber(320.5), "320.5")
        XCTAssertEqual(LiveSignalsFormat.jsNumber(-12), "-12")
    }

    func testCleanNilFiltersGoSentinels() {
        XCTAssertNil(LiveSignalsFormat.cleanNil(nil))
        XCTAssertNil(LiveSignalsFormat.cleanNil(""))
        XCTAssertNil(LiveSignalsFormat.cleanNil("<nil>"))
        XCTAssertNil(LiveSignalsFormat.cleanNil("nil"))
        XCTAssertNil(LiveSignalsFormat.cleanNil("null"))
        XCTAssertEqual(LiveSignalsFormat.cleanNil("D"), "D")
    }
}

// MARK: - Adapter: cached DTO → projection

@MainActor
final class LiveSignalsBuilderTests: XCTestCase {
    private let metric = LiveSignalsUnitPrefs(temperature: .celsius, pressure: .bar, locale: "en-US")
    private let imperial = LiveSignalsUnitPrefs(temperature: .fahrenheit, pressure: .psi, locale: "en-US")

    func testEmptyWhenAllInputsNil() {
        let projection = LiveSignalsBuilder.buildProjection(
            motor: nil, climate: nil, security: nil, tires: nil, prefs: metric
        )
        XCTAssertEqual(projection, .empty)
        XCTAssertFalse(projection.hasData)
    }

    func testMotorRowsMetric() {
        let projection = LiveSignalsBuilder.buildProjection(
            motor: LiveSignalsMotorInput(torqueNm: 320, statorTempC: 45, gear: "D"),
            climate: nil, security: nil, tires: nil, prefs: metric
        )
        let motor = try? XCTUnwrap(projection.motor)
        XCTAssertEqual(motor?.torque, "320 Nm")
        XCTAssertEqual(motor?.temperature, "45°C")
        XCTAssertEqual(motor?.gear, "D")
        XCTAssertTrue(projection.hasData)
    }

    func testMotorRowsImperialAndNilGear() {
        let projection = LiveSignalsBuilder.buildProjection(
            motor: LiveSignalsMotorInput(torqueNm: 320.5, statorTempC: 45, gear: "<nil>"),
            climate: nil, security: nil, tires: nil, prefs: imperial
        )
        XCTAssertEqual(projection.motor?.torque, "320.5 Nm")
        XCTAssertEqual(projection.motor?.temperature, "113°F")
        XCTAssertEqual(projection.motor?.gear, "—")
    }

    func testMotorPresentButFieldsMissingShowsDashes() {
        let projection = LiveSignalsBuilder.buildProjection(
            motor: LiveSignalsMotorInput(), climate: nil, security: nil, tires: nil, prefs: metric
        )
        XCTAssertNotNil(projection.motor)
        XCTAssertEqual(projection.motor?.torque, "—")
        XCTAssertEqual(projection.motor?.temperature, "—")
        XCTAssertEqual(projection.motor?.gear, "—")
    }

    func testClimateRows() {
        let projection = LiveSignalsBuilder.buildProjection(
            motor: nil,
            climate: LiveSignalsClimateInput(insideTempC: 21, outsideTempC: 8, hvacPowerKw: 2.34),
            security: nil, tires: nil, prefs: metric
        )
        XCTAssertEqual(projection.climate?.cabin, "21°C")
        XCTAssertEqual(projection.climate?.outside, "8°C")
        XCTAssertEqual(projection.climate?.hvac, "2.3 kW")
    }

    func testTireRowsBarAndPsi() {
        let bar = LiveSignalsBuilder.buildProjection(
            motor: nil, climate: nil, security: nil,
            tires: LiveSignalsTiresInput(frontLeftKpa: 250, frontRightKpa: 250, rearLeftKpa: 248, rearRightKpa: nil),
            prefs: metric
        )
        XCTAssertEqual(bar.tires?.frontLeft, "2.5 bar")
        XCTAssertEqual(bar.tires?.rearLeft, "2.5 bar")
        XCTAssertEqual(bar.tires?.rearRight, "—")

        let psi = LiveSignalsBuilder.buildProjection(
            motor: nil, climate: nil, security: nil,
            tires: LiveSignalsTiresInput(frontLeftKpa: 250), prefs: imperial
        )
        XCTAssertEqual(psi.tires?.frontLeft, "36.3 psi")
    }

    func testSecurityBooleansTreatNilAsFalsy() {
        let locked = LiveSignalsBuilder.buildProjection(
            motor: nil, climate: nil,
            security: LiveSignalsSecurityInput(locked: true, sentryMode: false), tires: nil, prefs: metric
        )
        XCTAssertEqual(locked.security?.locked, true)
        XCTAssertEqual(locked.security?.sentryActive, false)

        let unknown = LiveSignalsBuilder.buildProjection(
            motor: nil, climate: nil,
            security: LiveSignalsSecurityInput(locked: nil, sentryMode: nil), tires: nil, prefs: metric
        )
        XCTAssertEqual(unknown.security?.locked, false)
        XCTAssertEqual(unknown.security?.sentryActive, false)
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor
final class LiveSignalsModelTests: XCTestCase {
    private func makeModel(
        _ update: LiveSignalsUpdate,
        telemetry: LiveSignalsTelemetry = OSLogLiveSignalsTelemetry()
    ) -> (LiveSignalsModel, InMemoryLiveSignalsSource) {
        let source = InMemoryLiveSignalsSource(initial: update)
        let model = LiveSignalsModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(LiveSignalsUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(LiveSignalsUpdate(status: .loaded))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(LiveSignalsUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsContentEvenWhileFetchingOrFailed() {
        let motor = LiveSignalsMotorInput(gear: "D")
        let (loading, _) = makeModel(LiveSignalsUpdate(status: .loading, motor: motor))
        loading.start()
        XCTAssertEqual(loading.phase, .content)

        let (failed, _) = makeModel(LiveSignalsUpdate(status: .failed("net"), motor: motor))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyLiveSignalsTelemetry()
        let (model, source) = makeModel(LiveSignalsUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [LiveSignalsWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(LiveSignalsUpdate(status: .loaded))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(LiveSignalsUpdate(status: .loading))
        model.start()
        source.push(
            LiveSignalsUpdate(
                status: .loaded,
                connection: .offline,
                prefs: .metric,
                security: LiveSignalsSecurityInput(locked: true, sentryMode: true),
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.security?.locked, true)
    }

    func testStopResetsStartedGuard() {
        let (model, source) = makeModel(LiveSignalsUpdate(status: .loaded))
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(source.startCount, 2)
        XCTAssertEqual(source.stopCount, 1)
    }
}

// MARK: - Registry parity

@MainActor
final class LiveSignalsRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = LiveSignalsWidget.registration
        XCTAssertEqual(registration.id, "live-signals")
        XCTAssertEqual(registration.category, "telemetry")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 2, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = LiveSignalsWidget.registration
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 1, rows: 1)),
            DashboardWidgetSize(cols: 2, rows: 2)
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

@MainActor
final class LiveSignalsAccessibilityTests: XCTestCase {
    func testSummaryIncludesEverySectionLabel() {
        let projection = LiveSignalsBuilder.buildProjection(
            motor: LiveSignalsMotorInput(torqueNm: 285, statorTempC: 42, gear: "D"),
            climate: LiveSignalsClimateInput(insideTempC: 21, outsideTempC: 9, hvacPowerKw: 1.8),
            security: LiveSignalsSecurityInput(locked: true, sentryMode: true),
            tires: LiveSignalsTiresInput(frontLeftKpa: 250, frontRightKpa: 250, rearLeftKpa: 248, rearRightKpa: 249),
            prefs: LiveSignalsUnitPrefs(temperature: .celsius, pressure: .bar, locale: "en-US")
        )
        let summary = LiveSignalsAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Motor"))
        XCTAssertTrue(summary.contains("Climate"))
        XCTAssertTrue(summary.contains("Tires"))
        XCTAssertTrue(summary.contains("Security"))
        XCTAssertTrue(summary.contains("Locked"))
        XCTAssertTrue(summary.contains("Active"))
        XCTAssertTrue(summary.contains("285 Nm"))
    }

    func testSummaryUnlockedAndOff() {
        let projection = LiveSignalsBuilder.buildProjection(
            motor: nil, climate: nil,
            security: LiveSignalsSecurityInput(locked: false, sentryMode: false), tires: nil,
            prefs: .metric
        )
        let summary = LiveSignalsAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Unlocked"))
        XCTAssertTrue(summary.contains("Off"))
    }

    func testSummaryFallsBackWhenEmpty() {
        let summary = LiveSignalsAccessibility.summary(for: .empty)
        XCTAssertEqual(summary, "No live signal data")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyLiveSignalsTelemetry: LiveSignalsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
