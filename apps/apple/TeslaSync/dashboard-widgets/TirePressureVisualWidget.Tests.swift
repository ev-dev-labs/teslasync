//
//  TirePressureVisualWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0102 · TirePressureVisualWidget (Apple)
//
//  Unit coverage for the TirePressureVisualWidget surface:
//    • Adapter (cached → projection) — threshold classifier parity with the web
//      `getPressureStatus`, unit conversion parity with `convertPressureFromSI`,
//      the 1-decimal value formatter, the relative reading-time formatter, and
//      the projection aggregates (allNormal / hasWarning / latestReading).
//    • State holder — `TirePressureModel` phase resolution across loading / empty
//      / error / content, plus the P1/S11 `view.opened` telemetry + source wiring.
//    • Registry — canonical `tire-pressure-visual` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content for the diagram + footer.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemoryTirePressureSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: thresholds, units, formatting, reading time

@MainActor final class TirePressureVisualWidgetAdapterTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }
    private let keyTap: (String, String) -> String = { key, _ in "L:\(key)" }

    func testPressureStatusGreenBand() {
        XCTAssertEqual(TirePressureClassifier.pressureStatus(bar: 2.4), .green)
        XCTAssertEqual(TirePressureClassifier.pressureStatus(bar: 2.275), .green)
        XCTAssertEqual(TirePressureClassifier.pressureStatus(bar: 2.896), .green)
    }

    func testPressureStatusAmberBand() {
        XCTAssertEqual(TirePressureClassifier.pressureStatus(bar: 2.2), .amber)
        XCTAssertEqual(TirePressureClassifier.pressureStatus(bar: 2.068), .amber)
        XCTAssertEqual(TirePressureClassifier.pressureStatus(bar: 3.0), .amber)
        XCTAssertEqual(TirePressureClassifier.pressureStatus(bar: 3.103), .amber)
    }

    func testPressureStatusRedBandAndNil() {
        XCTAssertEqual(TirePressureClassifier.pressureStatus(bar: 2.0), .red)
        XCTAssertEqual(TirePressureClassifier.pressureStatus(bar: 3.2), .red)
        XCTAssertEqual(TirePressureClassifier.pressureStatus(bar: nil), .red)
        XCTAssertEqual(TirePressureClassifier.pressureStatus(bar: .infinity), .red)
    }

    func testStatusFromKilopascalsReducesToBar() {
        XCTAssertEqual(TirePressureClassifier.status(forKilopascals: 240), .green)
        XCTAssertEqual(TirePressureClassifier.status(forKilopascals: 220), .amber)
        XCTAssertEqual(TirePressureClassifier.status(forKilopascals: 200), .red)
        XCTAssertEqual(TirePressureClassifier.status(forKilopascals: nil), .red)
    }

    func testUnitConversionMatchesWebConstants() {
        XCTAssertEqual(TirePressureVisualWidgetUnit.bar.convert(fromKilopascals: 241) ?? -1, 2.41, accuracy: 0.0001)
        XCTAssertEqual(TirePressureVisualWidgetUnit.psi.convert(fromKilopascals: 240) ?? -1, 34.80906, accuracy: 0.0001)
        XCTAssertEqual(
            TirePressureVisualWidgetUnit.kilopascals.convert(fromKilopascals: 241) ?? -1,
            241,
            accuracy: 0.0001
        )
        XCTAssertNil(TirePressureVisualWidgetUnit.bar.convert(fromKilopascals: nil))
        XCTAssertNil(TirePressureVisualWidgetUnit.bar.convert(fromKilopascals: .nan))
    }

    func testUnitFromLabelDefaultsToBar() {
        XCTAssertEqual(TirePressureVisualWidgetUnit.from(label: "psi"), .psi)
        XCTAssertEqual(TirePressureVisualWidgetUnit.from(label: "kPa"), .kilopascals)
        XCTAssertEqual(TirePressureVisualWidgetUnit.from(label: "bar"), .bar)
        XCTAssertEqual(TirePressureVisualWidgetUnit.from(label: "garbage"), .bar)
    }

    func testFormatterOneDecimalAndDashFallback() {
        let enUS = Locale(identifier: "en_US")
        XCTAssertEqual(TirePressureFormatter.format(kilopascals: 240, unit: .bar, locale: enUS), "2.4")
        XCTAssertEqual(TirePressureFormatter.format(kilopascals: 240, unit: .psi, locale: enUS), "34.8")
        XCTAssertEqual(TirePressureFormatter.format(kilopascals: nil, unit: .bar, locale: enUS), "—")
    }

    func testFormatterIsLocaleAware() {
        let deDE = Locale(identifier: "de_DE")
        XCTAssertEqual(TirePressureFormatter.format(kilopascals: 240, unit: .bar, locale: deDE), "2,4")
    }

    func testReadingTimeBuckets() {
        let now = Date()
        XCTAssertEqual(TireReadingTime.string(for: nil, now: now, localize: echo), "No reading")
        XCTAssertEqual(TireReadingTime.string(for: now.addingTimeInterval(-10), now: now, localize: echo), "Just now")
        XCTAssertEqual(TireReadingTime.string(for: now.addingTimeInterval(-300), now: now, localize: echo), "5m ago")
        XCTAssertEqual(TireReadingTime.string(for: now.addingTimeInterval(-7200), now: now, localize: echo), "2h ago")
        XCTAssertEqual(
            TireReadingTime.string(for: now.addingTimeInterval(-172_800), now: now, localize: echo),
            "2d ago"
        )
    }

    func testReadingTimeResolvesWebKeys() {
        let now = Date()
        XCTAssertEqual(TireReadingTime.string(for: nil, now: now, localize: keyTap), "L:widget.tireNoReading")
        XCTAssertEqual(
            TireReadingTime.string(for: now.addingTimeInterval(-5), now: now, localize: keyTap),
            "L:widget.tireJustNow"
        )
        XCTAssertEqual(
            TireReadingTime.string(for: now.addingTimeInterval(-600), now: now, localize: keyTap),
            "10m L:widget.ago"
        )
    }
}

// MARK: - Adapter: projection aggregates

@MainActor final class TirePressureProjectionTests: XCTestCase {
    func testProjectionKeepsCornerOrderAndStatuses() {
        let reading = TirePressureReading(
            frontLeftKilopascals: 240,
            frontRightKilopascals: 220,
            rearLeftKilopascals: 200,
            rearRightKilopascals: 245
        )
        let projection = TirePressureVisualWidgetProjection.project(from: reading)
        XCTAssertEqual(projection.readings.map(\.corner), [.frontLeft, .frontRight, .rearLeft, .rearRight])
        XCTAssertEqual(projection.frontLeft.status, .green)
        XCTAssertEqual(projection.frontRight.status, .amber)
        XCTAssertEqual(projection.rearLeft.status, .red)
        XCTAssertEqual(projection.rearRight.status, .green)
    }

    func testAllNormalAndHasWarning() {
        let healthy = TirePressureVisualWidgetProjection.project(
            from: TirePressureReading(
                frontLeftKilopascals: 240,
                frontRightKilopascals: 241,
                rearLeftKilopascals: 242,
                rearRightKilopascals: 243
            )
        )
        XCTAssertTrue(healthy.allNormal)
        XCTAssertFalse(healthy.hasWarning)

        let degraded = TirePressureVisualWidgetProjection.project(
            from: TirePressureReading(frontLeftKilopascals: 240, frontRightKilopascals: 200)
        )
        XCTAssertFalse(degraded.allNormal)
        XCTAssertTrue(degraded.hasWarning)
    }

    func testLatestReadingPicksMostRecentTimestamp() {
        let base = Date(timeIntervalSince1970: 1_000_000)
        let reading = TirePressureReading(
            lastSeenFrontLeft: base,
            lastSeenFrontRight: base.addingTimeInterval(300),
            lastSeenRearLeft: nil,
            lastSeenRearRight: base.addingTimeInterval(-300)
        )
        let projection = TirePressureVisualWidgetProjection.project(from: reading)
        XCTAssertEqual(projection.latestReading, base.addingTimeInterval(300))
    }

    func testLatestReadingNilWhenNoTimestamps() {
        let projection = TirePressureVisualWidgetProjection
            .project(from: TirePressureReading(frontLeftKilopascals: 240))
        XCTAssertNil(projection.latestReading)
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class TirePressureVisualWidgetModelTests: XCTestCase {
    private func makeModel(
        _ update: TirePressureUpdate,
        telemetry: TirePressureTelemetry = OSLogTirePressureTelemetry()
    ) -> (TirePressureModel, InMemoryTirePressureSource) {
        let source = InMemoryTirePressureSource(initial: update)
        let model = TirePressureModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutReadingShowsLoading() {
        let (model, _) = makeModel(TirePressureUpdate(status: .loading, reading: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutReadingShowsEmpty() {
        let (model, _) = makeModel(TirePressureUpdate(status: .loaded, reading: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutReadingShowsError() {
        let (model, _) = makeModel(TirePressureUpdate(status: .failed("boom"), reading: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testReadingPresentShowsContentEvenWhileLoadingOrFailed() {
        let reading = TirePressureReading(frontLeftKilopascals: 240)
        let (loading, _) = makeModel(TirePressureUpdate(status: .loading, reading: reading))
        loading.start()
        XCTAssertEqual(loading.phase, .content)

        let (failed, _) = makeModel(TirePressureUpdate(status: .failed("net"), reading: reading))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testAllNullReadingStillRendersContent() {
        let (model, _) = makeModel(TirePressureUpdate(status: .loaded, reading: TirePressureReading()))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.allNormal, false)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = TirePressureVisualWidgetSpyTirePressureTelemetry()
        let (model, source) = makeModel(TirePressureUpdate(status: .loading, reading: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [TirePressureVisualWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(TirePressureUpdate(status: .loaded, reading: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionUnitLocaleAndProjectionTrackUpdates() {
        let (model, source) = makeModel(TirePressureUpdate(status: .loading, reading: nil))
        model.start()
        source.push(
            TirePressureUpdate(
                status: .loaded,
                connection: .offline,
                reading: TirePressureReading(frontLeftKilopascals: 240, frontRightKilopascals: 200),
                unit: .psi,
                localeIdentifier: "de_DE",
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.unit, .psi)
        XCTAssertEqual(model.locale.identifier, "de_DE")
        XCTAssertEqual(model.projection?.hasWarning, true)
    }
}

// MARK: - Registry parity

@MainActor final class TirePressureVisualWidgetRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = TirePressureVisualWidget.registration
        XCTAssertEqual(registration.id, "tire-pressure-visual")
        XCTAssertEqual(registration.category, "tires")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = TirePressureVisualWidget.registration
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 1, rows: 1)),
            DashboardWidgetSize(cols: 2, rows: 4)
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

@MainActor final class TirePressureVisualWidgetAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testSummaryIncludesEveryCornerAndAllNormal() {
        let projection = TirePressureVisualWidgetProjection.project(
            from: TirePressureReading(
                frontLeftKilopascals: 240,
                frontRightKilopascals: 241,
                rearLeftKilopascals: 242,
                rearRightKilopascals: 243
            )
        )
        let summary = TirePressureAccessibility.summary(
            for: projection,
            unit: .bar,
            locale: Locale(identifier: "en_US"),
            localize: echo
        )
        XCTAssertTrue(summary.contains("Tire Pressure"))
        XCTAssertTrue(summary.contains("FL 2.4 bar"))
        XCTAssertTrue(summary.contains("RR 2.4 bar"))
        XCTAssertTrue(summary.contains("All Normal"))
    }

    func testSummaryReportsCheckPressureWhenDegraded() {
        let projection = TirePressureVisualWidgetProjection.project(
            from: TirePressureReading(frontLeftKilopascals: 240, frontRightKilopascals: 200)
        )
        let summary = TirePressureAccessibility.summary(
            for: projection,
            unit: .bar,
            locale: Locale(identifier: "en_US"),
            localize: echo
        )
        XCTAssertTrue(summary.contains("Check Pressure"))
        XCTAssertTrue(summary.contains("FR 2.0 bar"))
        XCTAssertTrue(summary.contains("RL —"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class TirePressureVisualWidgetSpyTirePressureTelemetry: TirePressureTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
