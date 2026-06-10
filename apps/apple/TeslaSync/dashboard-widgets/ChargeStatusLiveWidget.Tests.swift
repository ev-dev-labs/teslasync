//
//  ChargeStatusLiveWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0020 · ChargeStatusLiveWidget (Apple)
//
//  Unit coverage for the ChargeStatusLiveWidget surface:
//    • Adapter (cached → projection) — `LiveChargeStatusProjector` value parity with the web widget's
//      numeric pipeline (charger_power, time_to_full_charge, charge_rate via convertDistanceFromSI,
//      total_energy_added_wh via convertEnergyFromSI, the formatTime helper, and the `${battery}%`).
//    • State holder — `ChargeStatusLiveModel` phase resolution across loading / empty / error /
//      content, plus the P1/S11 `view.opened` telemetry, refresh + stale auto-refresh wiring.
//    • Registry — canonical `charge-status-live` metadata + size clamping.
//    • Layout — the web `isCompact` / `isTall` size mapping.
//    • Accessibility — the VoiceOver summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store:
//  the model is driven by `InMemoryChargeStatusLiveSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached DTO → projection (port parity with the web widget)

@MainActor final class ChargeStatusLiveWidgetChargeStatusAdapterTests: XCTestCase {
    private let charging = LiveChargeStateDTO(
        isCharging: true,
        chargerPowerKw: 11.5,
        voltage: nil,
        amps: nil,
        timeToFullHours: 1.5,
        chargeRateMeters: 50000,
        batteryLevelPercent: 60
    )
    private let session = LiveChargeSessionDTO(totalEnergyAddedWh: 25000)

    func testChargingProjectionKilometers() {
        let projection = LiveChargeStatusProjector.project(
            state: charging,
            session: session,
            units: LiveChargeUnitPrefs(distance: .kilometers)
        )
        XCTAssertTrue(projection.isCharging)
        XCTAssertEqual(projection.powerValueText, "11.5")
        XCTAssertEqual(projection.powerUnit, "kW")
        XCTAssertEqual(projection.batteryText, "60%")
        XCTAssertEqual(projection.distanceSymbol, "km")

        XCTAssertEqual(projection.chargingMetrics.map(\.id), ["voltage", "current", "time-left", "added"])
        XCTAssertEqual(projection.chargingMetrics.map(\.value), ["—", "—", "1h 30m", "25.0 kWh"])

        XCTAssertEqual(projection.tallMetrics.map(\.id), ["rate", "battery"])
        XCTAssertEqual(projection.tallMetrics.map(\.value), ["50 km/h", "60%"])

        XCTAssertEqual(projection.lastSessionEnergyText, "+25.0 kWh")
    }

    func testChargingProjectionMilesRate() {
        // 80,467.2 m / 1609.344 = 50 mi exactly → "50 mi/h".
        let state = LiveChargeStateDTO(isCharging: true, chargeRateMeters: 80467.2, batteryLevelPercent: 60)
        let projection = LiveChargeStatusProjector.project(
            state: state,
            session: nil,
            units: LiveChargeUnitPrefs(distance: .miles)
        )
        XCTAssertEqual(projection.distanceSymbol, "mi")
        XCTAssertEqual(projection.tallMetrics.first(where: { $0.id == "rate" })?.value, "50 mi/h")
    }

    func testVoltageAndAmpsRenderWhenPresent() {
        let state = LiveChargeStateDTO(isCharging: true, voltage: 240, amps: 32, batteryLevelPercent: 50)
        let projection = LiveChargeStatusProjector.project(
            state: state,
            session: nil,
            units: LiveChargeUnitPrefs(distance: .kilometers)
        )
        XCTAssertEqual(projection.chargingMetrics.first(where: { $0.id == "voltage" })?.value, "240 V")
        XCTAssertEqual(projection.chargingMetrics.first(where: { $0.id == "current" })?.value, "32 A")
    }

    func testNilInnerValuesCollapseToZero() {
        let projection = LiveChargeStatusProjector.project(
            state: LiveChargeStateDTO(isCharging: true),
            session: nil,
            units: LiveChargeUnitPrefs(distance: .kilometers)
        )
        XCTAssertEqual(projection.powerValueText, "0.0")
        XCTAssertEqual(projection.batteryText, "0%")
        XCTAssertEqual(projection.chargingMetrics.first(where: { $0.id == "time-left" })?.value, "—")
        XCTAssertEqual(projection.chargingMetrics.first(where: { $0.id == "added" })?.value, "0.0 kWh")
        XCTAssertEqual(projection.tallMetrics.first(where: { $0.id == "rate" })?.value, "0 km/h")
        XCTAssertNil(projection.lastSessionEnergyText)
    }

    func testIdleProjectionWithLastSession() {
        let projection = LiveChargeStatusProjector.project(
            state: LiveChargeStateDTO(isCharging: false, batteryLevelPercent: 78),
            session: LiveChargeSessionDTO(totalEnergyAddedWh: 41500),
            units: LiveChargeUnitPrefs(distance: .kilometers)
        )
        XCTAssertFalse(projection.isCharging)
        XCTAssertEqual(projection.batteryText, "78%")
        XCTAssertEqual(projection.lastSessionEnergyText, "+41.5 kWh")
    }

    func testIdleProjectionWithoutSessionHasNoLastSession() {
        let projection = LiveChargeStatusProjector.project(
            state: LiveChargeStateDTO(isCharging: false, batteryLevelPercent: 78),
            session: nil,
            units: LiveChargeUnitPrefs(distance: .kilometers)
        )
        XCTAssertNil(projection.lastSessionEnergyText)
    }

    func testLabelsResolveToWebFallback() {
        let projection = LiveChargeStatusProjector.project(
            state: charging,
            session: session,
            units: LiveChargeUnitPrefs(distance: .kilometers)
        )
        XCTAssertEqual(projection.chargingMetrics.map(\.label), ["Voltage", "Current", "Time Left", "Added"])
        XCTAssertEqual(projection.tallMetrics.map(\.label), ["Rate", "Battery"])
    }
}

// MARK: - Formatters (ported from the web numeric helpers)

@MainActor final class ChargeStatusFormatTests: XCTestCase {
    func testNumberRoundsHalfUpWithGrouping() {
        XCTAssertEqual(LiveChargeStatusFormat.number(11.5, decimals: 1), "11.5")
        XCTAssertEqual(LiveChargeStatusFormat.number(25, decimals: 1), "25.0")
        XCTAssertEqual(LiveChargeStatusFormat.number(50, decimals: 0), "50")
        XCTAssertEqual(LiveChargeStatusFormat.number(1234.5, decimals: 0), "1,235")
        XCTAssertEqual(LiveChargeStatusFormat.number(.infinity, decimals: 1), "0.0")
    }

    func testJSNumberDropsTrailingZeros() {
        XCTAssertEqual(LiveChargeStatusFormat.jsNumber(60), "60")
        XCTAssertEqual(LiveChargeStatusFormat.jsNumber(0), "0")
        XCTAssertEqual(LiveChargeStatusFormat.jsNumber(78.5), "78.5")
        XCTAssertEqual(LiveChargeStatusFormat.jsNumber(.nan), "0")
    }

    func testTimeMatchesWebFormatTime() {
        XCTAssertEqual(LiveChargeStatusFormat.time(hours: 0), "—")
        XCTAssertEqual(LiveChargeStatusFormat.time(hours: -1), "—")
        XCTAssertEqual(LiveChargeStatusFormat.time(hours: 0.5), "30m")
        XCTAssertEqual(LiveChargeStatusFormat.time(hours: 2.0), "2h")
        XCTAssertEqual(LiveChargeStatusFormat.time(hours: 1.5), "1h 30m")
        XCTAssertEqual(LiveChargeStatusFormat.time(hours: 1.25), "1h 15m")
    }

    func testEnergyConversionFromSI() {
        XCTAssertEqual(convertChargeEnergyFromSI(25000, to: .kilowattHours), 25, accuracy: 1e-9)
        XCTAssertEqual(convertChargeEnergyFromSI(25000, to: .wattHours), 25000, accuracy: 1e-9)
        XCTAssertEqual(convertChargeEnergyFromSI(.nan, to: .kilowattHours), 0)
    }

    func testDistanceConversionFromSI() {
        XCTAssertEqual(convertChargeDistanceFromSI(1000, to: LiveChargeDistanceUnit.kilometers), 1, accuracy: 1e-9)
        XCTAssertEqual(convertChargeDistanceFromSI(1609.344, to: LiveChargeDistanceUnit.miles), 1, accuracy: 1e-9)
        XCTAssertEqual(convertChargeDistanceFromSI(0.3048, to: LiveChargeDistanceUnit.feet), 1, accuracy: 1e-9)
        XCTAssertEqual(convertChargeDistanceFromSI(.infinity, to: LiveChargeDistanceUnit.kilometers), 0)
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class ChargeStatusLiveWidgetChargeStatusPhaseTests: XCTestCase {
    func testResolvePhaseMatrix() {
        XCTAssertEqual(ChargeStatusLiveModel.resolvePhase(status: .loading, hasState: false), .loading)
        XCTAssertEqual(ChargeStatusLiveModel.resolvePhase(status: .loading, hasState: true), .content)
        XCTAssertEqual(ChargeStatusLiveModel.resolvePhase(status: .empty, hasState: false), .empty)
        XCTAssertEqual(ChargeStatusLiveModel.resolvePhase(status: .empty, hasState: true), .empty)
        XCTAssertEqual(ChargeStatusLiveModel.resolvePhase(status: .loaded, hasState: false), .empty)
        XCTAssertEqual(ChargeStatusLiveModel.resolvePhase(status: .loaded, hasState: true), .content)
        XCTAssertEqual(ChargeStatusLiveModel.resolvePhase(status: .failed("x"), hasState: false), .error("x"))
        XCTAssertEqual(ChargeStatusLiveModel.resolvePhase(status: .failed("x"), hasState: true), .content)
    }
}

@MainActor final class ChargeStatusLiveWidgetChargeStatusModelTests: XCTestCase {
    private func makeModel(
        _ update: LiveChargeStatusUpdate,
        telemetry: ChargeStatusLiveTelemetry = OSLogChargeStatusLiveTelemetry()
    ) -> (ChargeStatusLiveModel, InMemoryChargeStatusLiveSource) {
        let source = InMemoryChargeStatusLiveSource(initial: update)
        let model = ChargeStatusLiveModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutStateShowsLoading() {
        let (model, _) = makeModel(LiveChargeStatusUpdate(status: .loading, state: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutStateShowsEmpty() {
        let (model, _) = makeModel(LiveChargeStatusUpdate(status: .loaded, state: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutStateShowsError() {
        let (model, _) = makeModel(LiveChargeStatusUpdate(status: .failed("boom"), state: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testStatePresentShowsContentEvenWhileFailed() {
        let state = LiveChargeStateDTO(isCharging: true, chargerPowerKw: 7.4, batteryLevelPercent: 55)
        let (model, _) = makeModel(LiveChargeStatusUpdate(status: .failed("net"), state: state))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.powerValueText, "7.4")
        XCTAssertEqual(model.projection?.batteryText, "55%")
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = ChargeStatusLiveWidgetSpyChargeStatusTelemetry()
        let (model, source) = makeModel(LiveChargeStatusUpdate(status: .loading, state: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [ChargeStatusLiveWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(LiveChargeStatusUpdate(status: .loaded, state: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testAutoRefreshOnlyWhenStaleAndNotFetching() {
        let state = LiveChargeStateDTO(isCharging: true, chargerPowerKw: 7.4, batteryLevelPercent: 40)
        let (model, source) = makeModel(LiveChargeStatusUpdate(status: .loaded, state: state))
        model.start()

        model.autoRefreshIfStale() // live → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(LiveChargeStatusUpdate(status: .loaded, connection: .stale, isFetching: true, state: state))
        model.autoRefreshIfStale() // stale but fetching → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(LiveChargeStatusUpdate(status: .loaded, connection: .stale, isFetching: false, state: state))
        model.autoRefreshIfStale() // stale + idle → refresh
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testConnectionAndUnitsTrackUpdates() {
        let (model, source) = makeModel(LiveChargeStatusUpdate(status: .loading, state: nil))
        model.start()
        source.push(
            LiveChargeStatusUpdate(
                status: .loaded,
                connection: .offline,
                state: LiveChargeStateDTO(isCharging: true, chargeRateMeters: 80467.2, batteryLevelPercent: 70),
                units: LiveChargeUnitPrefs(distance: .miles),
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.units.distance, .miles)
        XCTAssertEqual(model.projection?.distanceSymbol, "mi")
    }
}

// MARK: - Registry parity

@MainActor final class ChargeStatusLiveWidgetChargeStatusRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = ChargeStatusLiveWidget.registration
        XCTAssertEqual(registration.id, "charge-status-live")
        XCTAssertEqual(registration.category, "charging")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 2))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 3, rows: 40))
        XCTAssertEqual(ChargeStatusLiveWidget.surfaceSlug, "ChargeStatusLiveWidget")
    }

    func testClampHonorsMinAndMax() {
        let registration = ChargeStatusLiveWidget.registration
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)),
            DashboardWidgetSize(cols: 1, rows: 2)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 3, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 2, rows: 10)),
            DashboardWidgetSize(cols: 2, rows: 10)
        )
    }
}

// MARK: - Layout (web isCompact / isTall)

@MainActor final class ChargeStatusLayoutTests: XCTestCase {
    func testIsCompactRequiresBothDimensionsAtMostOne() {
        XCTAssertTrue(ChargeStatusLayout.isCompact(DashboardWidgetSize(cols: 1, rows: 1)))
        XCTAssertFalse(ChargeStatusLayout.isCompact(DashboardWidgetSize(cols: 1, rows: 2)))
        XCTAssertFalse(ChargeStatusLayout.isCompact(DashboardWidgetSize(cols: 2, rows: 1)))
        XCTAssertFalse(ChargeStatusLayout.isCompact(DashboardWidgetSize(cols: 2, rows: 2)))
    }

    func testIsTallWhenAtLeastTwoRows() {
        XCTAssertFalse(ChargeStatusLayout.isTall(DashboardWidgetSize(cols: 1, rows: 1)))
        XCTAssertTrue(ChargeStatusLayout.isTall(DashboardWidgetSize(cols: 2, rows: 2)))
        XCTAssertTrue(ChargeStatusLayout.isTall(DashboardWidgetSize(cols: 3, rows: 4)))
    }
}

// MARK: - Accessibility summary content

@MainActor final class CSLiveChargeStatusAccessibilityTests: XCTestCase {
    func testChargingSummaryIncludesEveryDatum() {
        let projection = LiveChargeStatusProjector.project(
            state: LiveChargeStateDTO(
                isCharging: true,
                chargerPowerKw: 11.5,
                timeToFullHours: 1.5,
                chargeRateMeters: 50000,
                batteryLevelPercent: 60
            ),
            session: LiveChargeSessionDTO(totalEnergyAddedWh: 25000),
            units: LiveChargeUnitPrefs(distance: .kilometers)
        )
        let summary = LiveChargeStatusAccessibility.summary(for: projection)
        XCTAssertEqual(
            summary,
            "Charge Status. Charging. Battery 60%. 11.5 kW. "
                + "Voltage —. Current —. Time Left 1h 30m. Added 25.0 kWh. Rate 50 km/h"
        )
    }

    func testIdleSummaryIncludesLastSession() {
        let projection = LiveChargeStatusProjector.project(
            state: LiveChargeStateDTO(isCharging: false, batteryLevelPercent: 78),
            session: LiveChargeSessionDTO(totalEnergyAddedWh: 41500),
            units: LiveChargeUnitPrefs(distance: .kilometers)
        )
        let summary = LiveChargeStatusAccessibility.summary(for: projection)
        XCTAssertEqual(summary, "Charge Status. Not Charging. Battery 78%. Last Session +41.5 kWh")
    }

    func testIdleSummaryOmitsLastSessionWhenAbsent() {
        let projection = LiveChargeStatusProjector.project(
            state: LiveChargeStateDTO(isCharging: false, batteryLevelPercent: 78),
            session: nil,
            units: LiveChargeUnitPrefs(distance: .kilometers)
        )
        let summary = LiveChargeStatusAccessibility.summary(for: projection)
        XCTAssertEqual(summary, "Charge Status. Not Charging. Battery 78%")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class ChargeStatusLiveWidgetSpyChargeStatusTelemetry: ChargeStatusLiveTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
