//
//  MotorPerformanceWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0067 · MotorPerformanceWidget (Apple)
//
//  Unit coverage for the MotorPerformanceWidget surface:
//    • Adapter (cached SI → projection) — `MotorProjection.make` parity with the web data derivations
//      (torque clamp, torqueColor zones, convertTempFromSI, gear fallback, fmtInt/fmtNumber).
//    • State holder — `MotorPerformanceModel` phase resolution across loading / empty / error / content,
//      plus the P1/S11 `view.opened` telemetry + source wiring.
//    • Registry — canonical `motor-performance` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content for each state.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the model
//  is driven by `InMemoryMotorPerformanceSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached SI snapshot → projection (parity with the web derivations)

@MainActor
final class MotorProjectionAdapterTests: XCTestCase {
    private let sample = MotorPerformanceWidgetSnapshotInput(
        diTorque: 312,
        diStatorTemp: 78,
        motorTempCFront: 64,
        gear: "D",
        shiftState: "P",
        lateralAccel: 0.12,
        longitudinalAccel: -0.34
    )

    func testNilSnapshotYieldsEmpty() {
        let projection = MotorProjection.make(from: nil, temperatureUnit: .celsius)
        XCTAssertEqual(projection, .empty)
        XCTAssertFalse(projection.hasData)
        XCTAssertEqual(projection.gearText, "—")
        XCTAssertNil(projection.statorTempText)
        XCTAssertNil(projection.lateralGText)
    }

    func testBasicProjectionFields() {
        let projection = MotorProjection.make(from: sample, temperatureUnit: .celsius)
        XCTAssertTrue(projection.hasData)
        XCTAssertEqual(projection.torque, 312, accuracy: 0.0001)
        XCTAssertEqual(projection.torqueMagnitude, 312, accuracy: 0.0001)
        XCTAssertEqual(projection.gaugeFraction, 312.0 / 600.0, accuracy: 0.0001)
        XCTAssertEqual(projection.gaugeValueText, "312")
        XCTAssertEqual(projection.torqueLabelText, "312")
        XCTAssertEqual(projection.torqueZone, .medium)
        XCTAssertEqual(projection.statorTempText, "78")
        XCTAssertEqual(projection.statorTempUnit, "°C")
        XCTAssertEqual(projection.gearText, "D")
        XCTAssertEqual(projection.lateralGText, "0.12")
        XCTAssertEqual(projection.longitudinalGText, "-0.34")
    }

    func testTorqueClampsToMaxAndFractionSaturates() {
        let projection = MotorProjection.make(
            from: MotorPerformanceWidgetSnapshotInput(diTorque: 750),
            temperatureUnit: .celsius
        )
        XCTAssertEqual(projection.torqueMagnitude, MotorProjection.torqueMax, accuracy: 0.0001)
        XCTAssertEqual(projection.gaugeFraction, 1.0, accuracy: 0.0001)
        XCTAssertEqual(projection.torqueZone, .high)
        XCTAssertEqual(projection.torqueLabelText, "750")
        XCTAssertEqual(projection.gaugeValueText, "600")
    }

    func testNegativeTorqueUsesMagnitudeForGaugeButKeepsSignedLabel() {
        let projection = MotorProjection.make(
            from: MotorPerformanceWidgetSnapshotInput(diTorque: -312),
            temperatureUnit: .celsius
        )
        XCTAssertEqual(projection.torqueMagnitude, 312, accuracy: 0.0001)
        XCTAssertEqual(projection.torqueLabelText, "-312")
        XCTAssertEqual(projection.torqueZone, .medium)
    }

    func testMissingTorqueDefaultsToZero() {
        let projection = MotorProjection.make(from: MotorPerformanceWidgetSnapshotInput(gear: "N"), temperatureUnit: .celsius)
        XCTAssertTrue(projection.hasData)
        XCTAssertEqual(projection.torque, 0, accuracy: 0.0001)
        XCTAssertEqual(projection.torqueZone, .low)
        XCTAssertEqual(projection.gaugeValueText, "0")
    }

    func testStatorTempFallsBackToFrontMotorTemp() {
        let projection = MotorProjection.make(
            from: MotorPerformanceWidgetSnapshotInput(diStatorTemp: nil, motorTempCFront: 64),
            temperatureUnit: .celsius
        )
        XCTAssertEqual(projection.statorTempText, "64")
        XCTAssertEqual(projection.statorTempUnit, "°C")
    }

    func testStatorTempConvertsToFahrenheit() {
        let projection = MotorProjection.make(
            from: MotorPerformanceWidgetSnapshotInput(diStatorTemp: 100),
            temperatureUnit: .fahrenheit
        )
        XCTAssertEqual(projection.statorTempText, "212")
        XCTAssertEqual(projection.statorTempUnit, "°F")
    }

    func testStatorTempAbsentLeavesNoUnit() {
        let projection = MotorProjection.make(
            from: MotorPerformanceWidgetSnapshotInput(diTorque: 10),
            temperatureUnit: .fahrenheit
        )
        XCTAssertNil(projection.statorTempText)
        XCTAssertNil(projection.statorTempUnit)
    }

    func testGearFallsBackToShiftStateThenDash() {
        let viaGear = MotorProjection.make(
            from: MotorPerformanceWidgetSnapshotInput(gear: "R", shiftState: "P"),
            temperatureUnit: .celsius
        )
        XCTAssertEqual(viaGear.gearText, "R")

        let viaShift = MotorProjection.make(
            from: MotorPerformanceWidgetSnapshotInput(gear: nil, shiftState: "P"),
            temperatureUnit: .celsius
        )
        XCTAssertEqual(viaShift.gearText, "P")

        let blankGear = MotorProjection.make(
            from: MotorPerformanceWidgetSnapshotInput(gear: "  ", shiftState: "N"),
            temperatureUnit: .celsius
        )
        XCTAssertEqual(blankGear.gearText, "N")

        let neither = MotorProjection.make(
            from: MotorPerformanceWidgetSnapshotInput(diTorque: 1),
            temperatureUnit: .celsius
        )
        XCTAssertEqual(neither.gearText, "—")
    }

    func testGForceFormattingAndAbsence() {
        let present = MotorProjection.make(
            from: MotorPerformanceWidgetSnapshotInput(lateralAccel: 0.5, longitudinalAccel: -1.25),
            temperatureUnit: .celsius
        )
        XCTAssertEqual(present.lateralGText, "0.50")
        XCTAssertEqual(present.longitudinalGText, "-1.25")

        let absent = MotorProjection.make(from: MotorPerformanceWidgetSnapshotInput(diTorque: 1), temperatureUnit: .celsius)
        XCTAssertNil(absent.lateralGText)
        XCTAssertNil(absent.longitudinalGText)
    }

    func testFractionalTorqueGaugeUsesTwoDecimals() {
        let projection = MotorProjection.make(
            from: MotorPerformanceWidgetSnapshotInput(diTorque: 312.5),
            temperatureUnit: .celsius
        )
        XCTAssertEqual(projection.gaugeValueText, "312.50")
    }
}

// MARK: - Torque zone thresholds (web `torqueColor`)

@MainActor
final class MotorTorqueZoneTests: XCTestCase {
    func testZoneBoundaries() {
        XCTAssertEqual(MotorTorqueZone.classify(magnitude: 0), .low)
        XCTAssertEqual(MotorTorqueZone.classify(magnitude: 199), .low)
        XCTAssertEqual(MotorTorqueZone.classify(magnitude: 200), .medium)
        XCTAssertEqual(MotorTorqueZone.classify(magnitude: 399), .medium)
        XCTAssertEqual(MotorTorqueZone.classify(magnitude: 400), .high)
        XCTAssertEqual(MotorTorqueZone.classify(magnitude: 600), .high)
    }
}

// MARK: - Number formatting (web `fmtInt` / `fmtNumber`)

@MainActor
final class MotorFormatTests: XCTestCase {
    func testIntegerGrouping() {
        XCTAssertEqual(MotorFormat.int(12345), "12,345")
        XCTAssertEqual(MotorFormat.int(-12345), "-12,345")
        XCTAssertEqual(MotorFormat.int(0), "0")
    }

    func testFixedDecimals() {
        XCTAssertEqual(MotorFormat.number(0.1, decimals: 2), "0.10")
        XCTAssertEqual(MotorFormat.number(312, decimals: 0), "312")
        XCTAssertEqual(MotorFormat.number(1234.5, decimals: 1), "1,234.5")
    }

    func testNonFiniteCoercesToZero() {
        XCTAssertEqual(MotorFormat.number(.nan, decimals: 0), "0")
        XCTAssertEqual(MotorFormat.number(.infinity, decimals: 2), "0.00")
    }
}

// MARK: - Temperature unit (web `convertTempFromSI`)

@MainActor
final class MotorPerformanceWidgetTemperatureUnitTests: XCTestCase {
    func testLabels() {
        XCTAssertEqual(MotorPerformanceWidgetTemperatureUnit.celsius.label, "°C")
        XCTAssertEqual(MotorPerformanceWidgetTemperatureUnit.fahrenheit.label, "°F")
    }

    func testConversion() {
        XCTAssertEqual(MotorPerformanceWidgetTemperatureUnit.celsius.convert(fromCelsius: 20), 20, accuracy: 0.0001)
        XCTAssertEqual(MotorPerformanceWidgetTemperatureUnit.fahrenheit.convert(fromCelsius: 0), 32, accuracy: 0.0001)
        XCTAssertEqual(MotorPerformanceWidgetTemperatureUnit.fahrenheit.convert(fromCelsius: 100), 212, accuracy: 0.0001)
    }

    func testFromLabel() {
        XCTAssertEqual(MotorPerformanceWidgetTemperatureUnit.from(label: "°F"), .fahrenheit)
        XCTAssertEqual(MotorPerformanceWidgetTemperatureUnit.from(label: "°C"), .celsius)
        XCTAssertEqual(MotorPerformanceWidgetTemperatureUnit.from(label: "km"), .celsius)
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor
final class MotorPerformanceModelTests: XCTestCase {
    private func makeModel(
        _ update: MotorUpdate,
        telemetry: MotorPerformanceTelemetry = OSLogMotorPerformanceTelemetry()
    ) -> (MotorPerformanceModel, InMemoryMotorPerformanceSource) {
        let source = InMemoryMotorPerformanceSource(initial: update)
        let model = MotorPerformanceModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(MotorUpdate(status: .loading, snapshot: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutSnapshotShowsEmpty() {
        let (model, _) = makeModel(MotorUpdate(status: .loaded, snapshot: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testLoadedWithSnapshotShowsContent() {
        let (model, _) = makeModel(MotorUpdate(status: .loaded, snapshot: MotorPerformanceWidgetSnapshotInput(diTorque: 120)))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.projection.hasData)
    }

    func testFailedShowsErrorEvenWithCachedSnapshot() {
        let (noCache, _) = makeModel(MotorUpdate(status: .failed("boom"), snapshot: nil))
        noCache.start()
        XCTAssertEqual(noCache.phase, .error("boom"))

        let (cached, _) = makeModel(
            MotorUpdate(status: .failed("net"), snapshot: MotorPerformanceWidgetSnapshotInput(diTorque: 50))
        )
        cached.start()
        XCTAssertEqual(cached.phase, .error("net"))
    }

    func testCachedSnapshotStaysVisibleWhileLoading() {
        let (model, _) = makeModel(
            MotorUpdate(status: .loading, snapshot: MotorPerformanceWidgetSnapshotInput(diTorque: 90))
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
    }

    func testConnectionAndFetchingTrackUpdates() {
        let (model, source) = makeModel(MotorUpdate(status: .loading, snapshot: nil))
        model.start()
        source.push(
            MotorUpdate(
                status: .loaded,
                connection: .offline,
                snapshot: MotorPerformanceWidgetSnapshotInput(diTorque: 410, gear: "D"),
                temperatureUnit: .fahrenheit,
                updatedAt: Date(),
                isFetching: true
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.isFetching)
        XCTAssertEqual(model.projection.torqueZone, .high)
        XCTAssertEqual(model.projection.gearText, "D")
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyMotorPerformanceTelemetry()
        let (model, source) = makeModel(MotorUpdate(status: .loading, snapshot: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [MotorPerformanceWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(MotorUpdate(status: .loaded, snapshot: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStopDelegatesToSource() {
        let (model, source) = makeModel(MotorUpdate(status: .loaded, snapshot: nil))
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}

// MARK: - Registry parity

@MainActor
final class MotorPerformanceRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = MotorPerformanceWidget.registration
        XCTAssertEqual(registration.id, "motor-performance")
        XCTAssertEqual(registration.category, "vehicle")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = MotorPerformanceWidget.registration
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

    func testSurfaceSlugIsStable() {
        XCTAssertEqual(MotorPerformanceWidget.surfaceSlug, "MotorPerformanceWidget")
    }
}

// MARK: - Accessibility summary content

@MainActor
final class MotorPerformanceAccessibilityTests: XCTestCase {
    func testSummaryIncludesAllPresentMetrics() {
        let projection = MotorProjection.make(
            from: MotorPerformanceWidgetSnapshotInput(
                diTorque: 312,
                diStatorTemp: 78,
                gear: "D",
                lateralAccel: 0.12,
                longitudinalAccel: -0.34
            ),
            temperatureUnit: .celsius
        )
        let summary = MotorPerformanceAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Torque"))
        XCTAssertTrue(summary.contains("312"))
        XCTAssertTrue(summary.contains("Nm"))
        XCTAssertTrue(summary.contains("Gear State"))
        XCTAssertTrue(summary.contains("Stator Temp"))
        XCTAssertTrue(summary.contains("78°C"))
        XCTAssertTrue(summary.contains("Lateral G"))
        XCTAssertTrue(summary.contains("Longitudinal G"))
    }

    func testSummaryForEmptyProjection() {
        let summary = MotorPerformanceAccessibility.summary(for: .empty)
        XCTAssertEqual(summary, "No motor data")
    }

    func testSummaryOmitsAbsentOptionalMetrics() {
        let projection = MotorProjection.make(
            from: MotorPerformanceWidgetSnapshotInput(diTorque: 100, gear: "N"),
            temperatureUnit: .celsius
        )
        let summary = MotorPerformanceAccessibility.summary(for: projection)
        XCTAssertFalse(summary.contains("Stator Temp"))
        XCTAssertFalse(summary.contains("Lateral G"))
        XCTAssertTrue(summary.contains("Gear State"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyMotorPerformanceTelemetry: MotorPerformanceTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
