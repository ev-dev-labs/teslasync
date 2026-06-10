//
//  ChargeStatusWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0021 · ChargeStatusWidget (Apple)
//
//  Unit coverage for the ChargeStatusWidget surface:
//    • Adapter (cached → projection) — `ChargeStatusProjector` value parity with the web
//      widget's numeric pipeline (fmtNumber(charger_power), fmtInt(convertDistanceFromSI(
//      charge_rate)), {battery_level}, time_to_full ? fmtNumber(_,1)+"h" : "—", and the
//      idle {battery}% · {fmtNumber(convertDistanceFromSI(rated_range),0)} {unit}).
//    • State holder — `ChargeStatusModel` phase resolution across loading / empty / error /
//      content, plus the P1/S11 `view.opened` telemetry, refresh + stale auto-refresh wiring.
//    • Registry — canonical `charge-status` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content for both bodies.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store:
//  the model is driven by `InMemoryChargeStatusSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached DTO → projection (port parity with the web widget)

@MainActor final class ChargeStatusWidgetChargeStatusAdapterTests: XCTestCase {
    private let chargingSample = ChargeStateDTO(
        isCharging: true,
        chargerPowerKw: 11,
        chargeRateMetersPerHour: 48000,
        batteryLevelPercent: 64,
        timeToFullChargeHours: 1.5,
        ratedRangeMeters: 360_000
    )

    private let idleSample = ChargeStateDTO(
        isCharging: false,
        batteryLevelPercent: 72,
        ratedRangeMeters: 405_000
    )

    /// Pins the exact charging-grid strings for the mile preference:
    /// fmtNumber(11) = "11.00", fmtInt(48000/1609.344) = "30", {64} = "64", fmtNumber(1.5,1)+"h".
    func testChargingProjectionMiles() {
        guard case let .charging(charging) = ChargeStatusProjector.project(
            state: chargingSample,
            units: ChargeUnitPrefs(distance: .miles)
        ) else {
            return XCTFail("expected charging projection")
        }
        XCTAssertEqual(charging.power.value, "11.00")
        XCTAssertEqual(charging.power.unit, "kW")
        XCTAssertEqual(charging.power.tone, .positive)
        XCTAssertEqual(charging.rate.value, "30")
        XCTAssertEqual(charging.rate.unit, "mi/h")
        XCTAssertEqual(charging.rate.tone, .primary)
        XCTAssertEqual(charging.battery.value, "64")
        XCTAssertEqual(charging.battery.unit, "%")
        XCTAssertEqual(charging.timeToFull.value, "1.5h")
        XCTAssertEqual(charging.timeToFull.unit, "")
        XCTAssertEqual(charging.metrics.map(\.id), ["power", "rate", "battery", "time-to-full"])
    }

    /// Pins the kilometre branch: fmtInt(48000/1000) = "48", unit "km/h".
    func testChargingProjectionKilometers() {
        guard case let .charging(charging) = ChargeStatusProjector.project(
            state: chargingSample,
            units: ChargeUnitPrefs(distance: .kilometers)
        ) else {
            return XCTFail("expected charging projection")
        }
        XCTAssertEqual(charging.rate.value, "48")
        XCTAssertEqual(charging.rate.unit, "km/h")
        XCTAssertEqual(charging.power.value, "11.00")
        XCTAssertEqual(charging.battery.value, "64")
    }

    /// Pins the foot branch (metres / 0.3048) — exercises grouped-thousands formatting on rate.
    func testChargingRateFeetGroupsThousands() {
        guard case let .charging(charging) = ChargeStatusProjector.project(
            state: chargingSample,
            units: ChargeUnitPrefs(distance: .feet)
        ) else {
            return XCTFail("expected charging projection")
        }
        XCTAssertEqual(charging.rate.value, "157,480")
        XCTAssertEqual(charging.rate.unit, "ft/h")
    }

    /// `time_to_full_charge <= 0` renders the em-dash fallback (web `'—'`).
    func testTimeToFullZeroRendersDash() {
        let state = ChargeStateDTO(
            isCharging: true,
            chargerPowerKw: 7,
            chargeRateMetersPerHour: 0,
            batteryLevelPercent: 100,
            timeToFullChargeHours: 0
        )
        guard case let .charging(charging) = ChargeStatusProjector.project(
            state: state,
            units: ChargeUnitPrefs(distance: .kilometers)
        ) else {
            return XCTFail("expected charging projection")
        }
        XCTAssertEqual(charging.timeToFull.value, "—")
        XCTAssertEqual(charging.rate.value, "0")
    }

    /// Honors the global formatter precision (numberFormat.ts `_globalPrecision`) for power.
    func testChargerPowerHonorsPrecision() {
        guard case let .charging(charging) = ChargeStatusProjector.project(
            state: ChargeStateDTO(isCharging: true, chargerPowerKw: 11.25),
            units: ChargeUnitPrefs(distance: .kilometers, decimalPrecision: 0)
        ) else {
            return XCTFail("expected charging projection")
        }
        XCTAssertEqual(charging.power.value, "11")
    }

    /// Pins the not-charging summary for km: "{battery}% · {fmtNumber(rated_range/1000,0)} km".
    func testIdleProjectionKilometers() {
        guard case let .idle(idle) = ChargeStatusProjector.project(
            state: idleSample,
            units: ChargeUnitPrefs(distance: .kilometers)
        ) else {
            return XCTFail("expected idle projection")
        }
        XCTAssertEqual(idle.batteryPercent, "72")
        XCTAssertEqual(idle.rangeValue, "405")
        XCTAssertEqual(idle.rangeUnit, "km")
        XCTAssertEqual(idle.summary, "72% · 405 km")
    }

    /// Pins the not-charging summary for miles: rated_range / 1609.344 then fmtNumber(_, 0).
    func testIdleProjectionMiles() {
        guard case let .idle(idle) = ChargeStatusProjector.project(
            state: idleSample,
            units: ChargeUnitPrefs(distance: .miles)
        ) else {
            return XCTFail("expected idle projection")
        }
        XCTAssertEqual(idle.rangeValue, "252")
        XCTAssertEqual(idle.summary, "72% · 252 mi")
    }

    /// Null inner fields collapse to 0 (web `?? 0` / `safeNumber`).
    func testNilInnerFieldsProjectToZero() {
        guard case let .charging(charging) = ChargeStatusProjector.project(
            state: ChargeStateDTO(isCharging: true),
            units: ChargeUnitPrefs(distance: .kilometers)
        ) else {
            return XCTFail("expected charging projection")
        }
        XCTAssertEqual(charging.power.value, "0.00")
        XCTAssertEqual(charging.rate.value, "0")
        XCTAssertEqual(charging.battery.value, "0")
        XCTAssertEqual(charging.timeToFull.value, "—")
    }

    func testLabelsResolveToWebFallback() {
        guard case let .charging(charging) = ChargeStatusProjector.project(
            state: chargingSample,
            units: ChargeUnitPrefs(distance: .kilometers)
        ) else {
            return XCTFail("expected charging projection")
        }
        XCTAssertEqual(charging.power.label, "Power")
        XCTAssertEqual(charging.rate.label, "Rate")
        XCTAssertEqual(charging.battery.label, "Battery")
        XCTAssertEqual(charging.timeToFull.label, "Time to Full")
    }

    func testNumberFormattingRoundsHalfAwayFromZero() {
        XCTAssertEqual(ChargeStatusFormat.number(1000, decimals: 2), "1,000.00")
        XCTAssertEqual(ChargeStatusFormat.number(1234.5, decimals: 0), "1,235")
        XCTAssertEqual(ChargeStatusFormat.number(1234.4, decimals: 0), "1,234")
        XCTAssertEqual(ChargeStatusFormat.number(-5, decimals: 0), "-5")
        XCTAssertEqual(ChargeStatusFormat.integer(157_480.31), "157,480")
    }

    func testPlainIntegerHasNoGroupingAndRounds() {
        XCTAssertEqual(ChargeStatusFormat.plainInteger(64), "64")
        XCTAssertEqual(ChargeStatusFormat.plainInteger(72.6), "73")
        XCTAssertEqual(ChargeStatusFormat.plainInteger(0), "0")
        XCTAssertEqual(ChargeStatusFormat.plainInteger(1234), "1234")
    }

    func testNonFiniteInputsCollapseToZero() {
        XCTAssertEqual(convertChargeDistanceFromSI(.nan, to: ChargeDistanceUnit.kilometers), 0)
        XCTAssertEqual(convertChargeDistanceFromSI(.infinity, to: ChargeDistanceUnit.miles), 0)
        XCTAssertEqual(ChargeStatusFormat.number(.infinity, decimals: 2), "0.00")
        XCTAssertEqual(ChargeStatusFormat.plainInteger(.nan), "0")
    }

    func testDistanceConversionFactors() {
        XCTAssertEqual(convertChargeDistanceFromSI(1000, to: ChargeDistanceUnit.kilometers), 1, accuracy: 1e-9)
        XCTAssertEqual(convertChargeDistanceFromSI(1609.344, to: ChargeDistanceUnit.miles), 1, accuracy: 1e-9)
        XCTAssertEqual(convertChargeDistanceFromSI(0.3048, to: ChargeDistanceUnit.feet), 1, accuracy: 1e-9)
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class ChargeStatusWidgetChargeStatusPhaseTests: XCTestCase {
    func testResolvePhaseMatrix() {
        XCTAssertEqual(ChargeStatusModel.resolvePhase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(ChargeStatusModel.resolvePhase(status: .loading, hasData: true), .content)
        XCTAssertEqual(ChargeStatusModel.resolvePhase(status: .empty, hasData: false), .empty)
        XCTAssertEqual(ChargeStatusModel.resolvePhase(status: .empty, hasData: true), .empty)
        XCTAssertEqual(ChargeStatusModel.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(ChargeStatusModel.resolvePhase(status: .loaded, hasData: true), .content)
        XCTAssertEqual(ChargeStatusModel.resolvePhase(status: .failed("x"), hasData: false), .error("x"))
        XCTAssertEqual(ChargeStatusModel.resolvePhase(status: .failed("x"), hasData: true), .content)
    }
}

@MainActor final class ChargeStatusWidgetChargeStatusModelTests: XCTestCase {
    private func makeModel(
        _ update: ChargeStatusUpdate,
        telemetry: ChargeStatusTelemetry = OSLogChargeStatusTelemetry()
    ) -> (ChargeStatusModel, InMemoryChargeStatusSource) {
        let source = InMemoryChargeStatusSource(initial: update)
        let model = ChargeStatusModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(ChargeStatusUpdate(status: .loading, state: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutStateShowsEmpty() {
        let (model, _) = makeModel(ChargeStatusUpdate(status: .loaded, state: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(ChargeStatusUpdate(status: .failed("boom"), state: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testStatePresentShowsContentEvenWhileFailed() {
        let state = ChargeStateDTO(isCharging: true, chargerPowerKw: 11)
        let (model, _) = makeModel(ChargeStatusUpdate(status: .failed("net"), state: state))
        model.start()
        XCTAssertEqual(model.phase, .content)
        if case let .charging(charging) = model.projection {
            XCTAssertEqual(charging.power.value, "11.00")
        } else {
            XCTFail("expected charging projection")
        }
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = ChargeStatusWidgetSpyChargeStatusTelemetry()
        let (model, source) = makeModel(ChargeStatusUpdate(status: .loading, state: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [ChargeStatusWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(ChargeStatusUpdate(status: .loaded, state: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testAutoRefreshOnlyWhenStaleAndNotFetching() {
        let state = ChargeStateDTO(isCharging: true, chargerPowerKw: 11)
        let (model, source) = makeModel(ChargeStatusUpdate(status: .loaded, state: state))
        model.start()

        model.autoRefreshIfStale() // live → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(ChargeStatusUpdate(status: .loaded, connection: .stale, isFetching: true, state: state))
        model.autoRefreshIfStale() // stale but fetching → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(ChargeStatusUpdate(status: .loaded, connection: .stale, isFetching: false, state: state))
        model.autoRefreshIfStale() // stale + idle → refresh
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testConnectionAndUnitsTrackUpdates() {
        let (model, source) = makeModel(ChargeStatusUpdate(status: .loading, state: nil))
        model.start()
        source.push(
            ChargeStatusUpdate(
                status: .loaded,
                connection: .offline,
                state: ChargeStateDTO(isCharging: false, batteryLevelPercent: 50, ratedRangeMeters: 161_000),
                units: ChargeUnitPrefs(distance: .miles),
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.units.distance, .miles)
        if case let .idle(idle) = model.projection {
            XCTAssertEqual(idle.rangeUnit, "mi")
            XCTAssertEqual(idle.rangeValue, "100")
        } else {
            XCTFail("expected idle projection")
        }
    }
}

// MARK: - Registry parity

@MainActor final class ChargeStatusWidgetChargeStatusRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = ChargeStatusWidget.registration
        XCTAssertEqual(registration.id, "charge-status")
        XCTAssertEqual(registration.category, "charging")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 2))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 3, rows: 40))
        XCTAssertEqual(ChargeStatusWidget.surfaceSlug, "ChargeStatusWidget")
    }

    func testClampHonorsMinAndMax() {
        let registration = ChargeStatusWidget.registration
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

// MARK: - Accessibility summary content

@MainActor final class ChargeStatusWidgetChargeStatusAccessibilityTests: XCTestCase {
    func testChargingSummaryIncludesEveryMetric() {
        let projection = ChargeStatusProjector.project(
            state: ChargeStateDTO(
                isCharging: true,
                chargerPowerKw: 11,
                chargeRateMetersPerHour: 48000,
                batteryLevelPercent: 64,
                timeToFullChargeHours: 1.5
            ),
            units: ChargeUnitPrefs(distance: .miles)
        )
        let summary = ChargeStatusAccessibility.summary(for: projection)
        XCTAssertEqual(
            summary,
            "Charge Status. Charging. Power 11.00 kW. Rate 30 mi/h. Battery 64 %. Time to Full 1.5h"
        )
    }

    func testIdleSummaryReadsBatteryAndRange() {
        let projection = ChargeStatusProjector.project(
            state: ChargeStateDTO(isCharging: false, batteryLevelPercent: 72, ratedRangeMeters: 405_000),
            units: ChargeUnitPrefs(distance: .kilometers)
        )
        let summary = ChargeStatusAccessibility.summary(for: projection)
        XCTAssertEqual(summary, "Charge Status. Not Charging. 72% · 405 km")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class ChargeStatusWidgetSpyChargeStatusTelemetry: ChargeStatusTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
