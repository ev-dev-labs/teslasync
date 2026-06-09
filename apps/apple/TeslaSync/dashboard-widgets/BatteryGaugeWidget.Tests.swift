//
//  BatteryGaugeWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0013 · BatteryGaugeWidget (Apple)
//
//  Unit coverage for the BatteryGaugeWidget surface:
//    • Adapter (cached → projection) — `BatteryGaugeWidgetProjector` value parity with the web
//      widget's colour-banding + numeric pipeline (batteryColor thresholds, fmtNumber gauge readout,
//      "%" unit, charging caption + accessibility).
//    • State holder — `BatteryGaugeWidgetModel` phase resolution across loading / empty / error /
//      content, plus the P1/S11 `view.opened` telemetry, refresh + stale auto-refresh wiring.
//    • Registry — canonical `battery-gauge` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `BatteryGaugeWidgetInMemorySource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum BatteryFixture {
    static let highCharging = BatteryGaugeWidgetStateDTO(batteryLevel: 82, isCharging: true)
    static let medium = BatteryGaugeWidgetStateDTO(batteryLevel: 38, isCharging: false)
    static let low = BatteryGaugeWidgetStateDTO(batteryLevel: 14, isCharging: false)
    static let empty = BatteryGaugeWidgetStateDTO(batteryLevel: 0, isCharging: false)
}

// MARK: - Battery bands (web `batteryColor` thresholds)

final class BatteryGaugeWidgetBandTests: XCTestCase {
    func testThresholdBoundaries() {
        XCTAssertEqual(BatteryGaugeWidgetBand.classify(100), .high)
        XCTAssertEqual(BatteryGaugeWidgetBand.classify(51), .high)
        XCTAssertEqual(BatteryGaugeWidgetBand.classify(50.0001), .high)
        // 50 is NOT > 50 → amber; 20 is NOT > 20 → red (strict `>` like the web source).
        XCTAssertEqual(BatteryGaugeWidgetBand.classify(50), .medium)
        XCTAssertEqual(BatteryGaugeWidgetBand.classify(21), .medium)
        XCTAssertEqual(BatteryGaugeWidgetBand.classify(20.0001), .medium)
        XCTAssertEqual(BatteryGaugeWidgetBand.classify(20), .low)
        XCTAssertEqual(BatteryGaugeWidgetBand.classify(0), .low)
    }

    func testNilLevelIsUnknownAndNonFiniteCollapsesToLow() {
        // Web `!state` grey branch — the surface shows the empty state, the band is the grey neutral.
        XCTAssertEqual(BatteryGaugeWidgetBand.classify(nil), .unknown)
        // Non-finite collapses to the lowest band (the display value also collapses to 0 via safeNumber).
        XCTAssertEqual(BatteryGaugeWidgetBand.classify(.nan), .low)
        XCTAssertEqual(BatteryGaugeWidgetBand.classify(.infinity), .low)
        XCTAssertEqual(BatteryGaugeWidgetBand.classify(-5), .low)
    }
}

// MARK: - Number formatting (gauge fmtNumber)

final class BatteryGaugeWidgetFormatTests: XCTestCase {
    func testGaugeValueIntegerUsesZeroDecimals() {
        XCTAssertEqual(
            BatteryGaugeWidgetFormat.gaugeValue(82, max: 100, precision: 2, localeIdentifier: "en_US"),
            "82"
        )
    }

    func testGaugeValueFractionUsesPrecision() {
        XCTAssertEqual(
            BatteryGaugeWidgetFormat.gaugeValue(82.5, max: 100, precision: 2, localeIdentifier: "en_US"),
            "82.50"
        )
    }

    func testGaugeValueClampsIntoRange() {
        XCTAssertEqual(
            BatteryGaugeWidgetFormat.gaugeValue(120, max: 100, precision: 2, localeIdentifier: "en_US"),
            "100"
        )
        XCTAssertEqual(
            BatteryGaugeWidgetFormat.gaugeValue(-5, max: 100, precision: 2, localeIdentifier: "en_US"),
            "0"
        )
    }

    func testGaugeValueNonFiniteCollapsesToZero() {
        XCTAssertEqual(
            BatteryGaugeWidgetFormat.gaugeValue(.infinity, max: 100, precision: 2, localeIdentifier: "en_US"),
            "0"
        )
    }

    func testPercentUnitMatchesWebLiteral() {
        XCTAssertEqual(BatteryGaugeWidgetFormat.percentUnit, "%")
    }

    func testFillFractionClampsAndCollapses() {
        XCTAssertEqual(BatteryGaugeWidgetProjector.fillFraction(82), 0.82, accuracy: 0.0001)
        XCTAssertEqual(BatteryGaugeWidgetProjector.fillFraction(120), 1, accuracy: 0.0001)
        XCTAssertEqual(BatteryGaugeWidgetProjector.fillFraction(-5), 0, accuracy: 0.0001)
        XCTAssertEqual(BatteryGaugeWidgetProjector.fillFraction(.nan), 0, accuracy: 0.0001)
    }
}

// MARK: - Adapter: cached DTO → projection (port parity with the web widget)

final class BatteryGaugeWidgetAdapterTests: XCTestCase {
    func testProjectsGaugeFromLevel() {
        let projection = BatteryGaugeWidgetProjector.project(
            state: BatteryFixture.highCharging,
            format: BatteryGaugeWidgetFormatPrefs(localeIdentifier: "en_US", precision: 2),
            copy: .fallback
        )
        let gauge = projection.gauge
        XCTAssertEqual(gauge.valueText, "82")
        XCTAssertEqual(gauge.unit, "%")
        XCTAssertEqual(gauge.label, "Battery")
        XCTAssertEqual(gauge.band, .high)
        XCTAssertEqual(gauge.fraction, 0.82, accuracy: 0.0001)
        XCTAssertEqual(gauge.accessibilityLabel, "Battery 82 percent")
    }

    func testChargingDrivesCaptionAndAccessibility() {
        let charging = BatteryGaugeWidgetProjector.project(state: BatteryFixture.highCharging, copy: .fallback)
        XCTAssertTrue(charging.isCharging)
        XCTAssertEqual(charging.chargingText, "Charging")
        XCTAssertEqual(charging.accessibilityLabel, "Battery 82 percent. Charging")

        let idle = BatteryGaugeWidgetProjector.project(state: BatteryFixture.medium, copy: .fallback)
        XCTAssertFalse(idle.isCharging)
        XCTAssertEqual(idle.accessibilityLabel, "Battery 38 percent")
    }

    func testBandsTrackLevel() {
        XCTAssertEqual(
            BatteryGaugeWidgetProjector.project(state: BatteryFixture.highCharging, copy: .fallback).gauge.band,
            .high
        )
        XCTAssertEqual(
            BatteryGaugeWidgetProjector.project(state: BatteryFixture.medium, copy: .fallback).gauge.band,
            .medium
        )
        XCTAssertEqual(BatteryGaugeWidgetProjector.project(state: BatteryFixture.low, copy: .fallback).gauge.band, .low)
    }

    func testZeroLevelRendersGaugeNotEmpty() {
        // A present state (even at 0%) is a rendered gauge — the empty state is only when there is no
        // state at all (web `state ? gauge : EmptyState`).
        let projection = BatteryGaugeWidgetProjector.project(state: BatteryFixture.empty, copy: .fallback)
        XCTAssertEqual(projection.gauge.valueText, "0")
        XCTAssertEqual(projection.gauge.fraction, 0, accuracy: 0.0001)
        XCTAssertEqual(projection.gauge.band, .low)
    }

    func testCopyIsLocalizableViaInjection() {
        let copy = BatteryGaugeWidgetCopy(
            batteryLabel: "Batería",
            charging: "Cargando",
            batteryA11y: "Batería %1$@ por ciento"
        )
        let projection = BatteryGaugeWidgetProjector.project(state: BatteryFixture.highCharging, copy: copy)
        XCTAssertEqual(projection.gauge.label, "Batería")
        XCTAssertEqual(projection.gauge.accessibilityLabel, "Batería 82 por ciento")
        XCTAssertEqual(projection.chargingText, "Cargando")
        XCTAssertEqual(projection.accessibilityLabel, "Batería 82 por ciento. Cargando")
    }
}

// MARK: - State holder: phases + telemetry + source wiring

final class BatteryGaugeWidgetPhaseTests: XCTestCase {
    func testResolvePhaseMatrix() {
        XCTAssertEqual(BatteryGaugeWidgetModel.resolvePhase(status: .loading, hasState: false), .loading)
        XCTAssertEqual(BatteryGaugeWidgetModel.resolvePhase(status: .loading, hasState: true), .content)
        XCTAssertEqual(BatteryGaugeWidgetModel.resolvePhase(status: .empty, hasState: false), .empty)
        XCTAssertEqual(BatteryGaugeWidgetModel.resolvePhase(status: .empty, hasState: true), .empty)
        XCTAssertEqual(BatteryGaugeWidgetModel.resolvePhase(status: .loaded, hasState: false), .empty)
        XCTAssertEqual(BatteryGaugeWidgetModel.resolvePhase(status: .loaded, hasState: true), .content)
        XCTAssertEqual(BatteryGaugeWidgetModel.resolvePhase(status: .failed("x"), hasState: false), .error("x"))
        XCTAssertEqual(BatteryGaugeWidgetModel.resolvePhase(status: .failed("x"), hasState: true), .content)
    }
}

@MainActor final class BatteryGaugeWidgetModelTests: XCTestCase {
    private func makeModel(
        _ update: BatteryGaugeWidgetUpdate,
        telemetry: BatteryGaugeWidgetTelemetry = BatteryGaugeWidgetOSLogTelemetry()
    ) -> (BatteryGaugeWidgetModel, BatteryGaugeWidgetInMemorySource) {
        let source = BatteryGaugeWidgetInMemorySource(initial: update)
        let model = BatteryGaugeWidgetModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutStateShowsLoading() {
        let (model, _) = makeModel(BatteryGaugeWidgetUpdate(status: .loading, state: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertNil(model.projection)
    }

    func testLoadedWithoutStateShowsEmpty() {
        let (model, _) = makeModel(BatteryGaugeWidgetUpdate(status: .loaded, state: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(BatteryGaugeWidgetUpdate(status: .failed("boom"), state: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testStatePresentShowsContentEvenWhileFailed() {
        let (model, _) = makeModel(
            BatteryGaugeWidgetUpdate(status: .failed("net"), state: BatteryFixture.highCharging)
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.gauge.valueText, "82")
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyBatteryTelemetry()
        let (model, source) = makeModel(BatteryGaugeWidgetUpdate(status: .loading, state: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [BatteryGaugeWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(BatteryGaugeWidgetUpdate(status: .loaded, state: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testAutoRefreshOnlyWhenStaleAndNotFetching() {
        let (model, source) = makeModel(
            BatteryGaugeWidgetUpdate(status: .loaded, state: BatteryFixture.highCharging)
        )
        model.start()

        model.autoRefreshIfStale() // live → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(
            BatteryGaugeWidgetUpdate(
                status: .loaded,
                connection: .stale,
                isFetching: true,
                state: BatteryFixture.highCharging
            )
        )
        model.autoRefreshIfStale() // stale but fetching → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(
            BatteryGaugeWidgetUpdate(
                status: .loaded,
                connection: .stale,
                isFetching: false,
                state: BatteryFixture.highCharging
            )
        )
        model.autoRefreshIfStale() // stale + idle → refresh
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(BatteryGaugeWidgetUpdate(status: .loading, state: nil))
        model.start()
        source.push(
            BatteryGaugeWidgetUpdate(
                status: .loaded,
                connection: .offline,
                state: BatteryFixture.low,
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.gauge.band, .low)
        XCTAssertFalse(model.projection?.isCharging ?? true)
    }
}

// MARK: - Registry parity

final class BatteryGaugeWidgetRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = BatteryGaugeWidget.registration
        XCTAssertEqual(registration.id, "battery-gauge")
        XCTAssertEqual(registration.category, "battery")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 2, rows: 40))
        XCTAssertEqual(BatteryGaugeWidget.surfaceSlug, "BatteryGaugeWidget")
    }

    func testClampHonorsMinAndMax() {
        let registration = BatteryGaugeWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 1, rows: 1)), DashboardWidgetSize(cols: 1, rows: 2))
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

final class BatteryGaugeWidgetAccessibilityTests: XCTestCase {
    func testSummaryIncludesGaugeAndChargingWhenCharging() {
        let projection = BatteryGaugeWidgetProjector.project(state: BatteryFixture.highCharging, copy: .fallback)
        XCTAssertEqual(BatteryGaugeWidgetAccessibility.summary(for: projection), "Battery 82 percent. Charging")
    }

    func testSummaryIsGaugeOnlyWhenIdle() {
        let projection = BatteryGaugeWidgetProjector.project(state: BatteryFixture.medium, copy: .fallback)
        XCTAssertEqual(BatteryGaugeWidgetAccessibility.summary(for: projection), "Battery 38 percent")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyBatteryTelemetry: BatteryGaugeWidgetTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
