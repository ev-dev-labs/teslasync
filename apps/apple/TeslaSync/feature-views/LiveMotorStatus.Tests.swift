//
//  LiveMotorStatus.Tests.swift
//  TeslaSync — P4 feature view · 0170 · LiveMotorStatus (Apple)
//
//  Unit + UI coverage for the LiveMotorStatus surface: the adapter projection (web-parity
//  formatting, Celsius→Fahrenheit, gauge clamp/fill/decimals, captions, the "Awaiting data"
//  branch, shift-badge tone/text), the state-holder phase/refresh/telemetry seam, the VoiceOver
//  summary, and a per-state view render smoke. Pure-logic tests use `InMemoryLiveMotorSource`;
//  the view tests render via `ImageRenderer`.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Adapter: formatting + temperature conversion (web parity)

@MainActor final class LiveMotorFormatTests: XCTestCase {
    func testNumberGroupsAndFixesFractionDigits() {
        XCTAssertEqual(LiveMotorFormat.number(1234.0, decimals: 1), "1,234.0")
        XCTAssertEqual(LiveMotorFormat.number(1234.567, decimals: 2), "1,234.57")
        XCTAssertEqual(LiveMotorFormat.number(5230, decimals: 0), "5,230")
    }

    func testNumberRoundsHalfAwayFromZero() {
        XCTAssertEqual(LiveMotorFormat.number(0.5, decimals: 0), "1")
        XCTAssertEqual(LiveMotorFormat.number(124.16, decimals: 1), "124.2")
    }

    func testSafeNumberCollapsesNonFinite() {
        XCTAssertEqual(LiveMotorFormat.safeNumber(.nan), 0)
        XCTAssertEqual(LiveMotorFormat.safeNumber(.infinity), 0)
        XCTAssertEqual(LiveMotorFormat.safeNumber(42.5), 42.5)
    }

    func testTemperatureConversionMatchesWeb() {
        XCTAssertEqual(convertLiveMotorTempFromSI(51.2, to: .celsius), 51.2, accuracy: 1e-9)
        XCTAssertEqual(convertLiveMotorTempFromSI(0, to: .fahrenheit), 32, accuracy: 1e-9)
        XCTAssertEqual(convertLiveMotorTempFromSI(51.2, to: .fahrenheit), 124.16, accuracy: 1e-9)
    }

    func testTemperatureUnitResolvesFromSymbol() {
        XCTAssertEqual(LiveMotorTemperatureUnit.from(symbol: "°F"), .fahrenheit)
        XCTAssertEqual(LiveMotorTemperatureUnit.from(symbol: "°C"), .celsius)
        XCTAssertEqual(LiveMotorTemperatureUnit.from(symbol: "K"), .celsius)
    }
}

// MARK: - Adapter: projector gauge math (web parity)

@MainActor final class LiveMotorProjectorTests: XCTestCase {
    private func gauge(_ id: String, in projection: LiveMotorProjection) -> MotorGaugeTile? {
        projection.gauges.first { $0.id == id }
    }

    private func sample() -> MotorSnapshotInput {
        MotorSnapshotInput(
            torqueFrontNm: 184.5,
            torqueRearNm: 312.0,
            rpmFront: 5230,
            motorTempCFront: 48.4,
            motorTempCRear: 51.2,
            shiftState: "D"
        )
    }

    func testGaugeOrderAccentsAndUnits() {
        let projection = LiveMotorProjector.project(motor: sample(), units: LiveMotorUnitPrefs())
        XCTAssertEqual(projection.gauges.map(\.id), ["torque", "rpm-front", "motor-temp"])
        XCTAssertEqual(projection.gauges.map(\.accent), [.torqueBlue, .rpmPurple, .tempAmber])
        XCTAssertEqual(gauge("torque", in: projection)?.unit, "Nm")
        XCTAssertEqual(gauge("rpm-front", in: projection)?.unit, "RPM")
        XCTAssertEqual(gauge("motor-temp", in: projection)?.unit, "°C")
    }

    func testTorqueSumsBothAxlesAndFormatsCenterAndCaption() {
        // torqueTotal = 184.5 + 312.0 = 496.5 (non-integer → global precision 2)
        let projection = LiveMotorProjector.project(motor: sample(), units: LiveMotorUnitPrefs())
        XCTAssertEqual(gauge("torque", in: projection)?.centerValue, "496.50")
        XCTAssertEqual(gauge("torque", in: projection)?.caption, "496.50 Nm")
        XCTAssertEqual(gauge("torque", in: projection)?.fraction ?? -1, 496.5 / 1000.0, accuracy: 1e-9)
    }

    func testRpmCenterIsIntegerAndCaptionHasNoDecimals() {
        let projection = LiveMotorProjector.project(motor: sample(), units: LiveMotorUnitPrefs())
        XCTAssertEqual(gauge("rpm-front", in: projection)?.centerValue, "5,230")
        XCTAssertEqual(gauge("rpm-front", in: projection)?.caption, "5,230 RPM")
        XCTAssertEqual(gauge("rpm-front", in: projection)?.fraction ?? -1, 5230.0 / 18000.0, accuracy: 1e-9)
    }

    func testMotorTempTakesAxleMaxInCelsius() {
        // max(48.4, 51.2) = 51.2 °C; caption is 1-decimal, center uses global precision
        let projection = LiveMotorProjector.project(motor: sample(), units: LiveMotorUnitPrefs())
        XCTAssertEqual(gauge("motor-temp", in: projection)?.centerValue, "51.20")
        XCTAssertEqual(gauge("motor-temp", in: projection)?.caption, "51.2°C")
        XCTAssertEqual(gauge("motor-temp", in: projection)?.fraction ?? -1, 51.2 / 200.0, accuracy: 1e-9)
    }

    func testMotorTempConvertsToFahrenheit() {
        let units = LiveMotorUnitPrefs(temperature: .fahrenheit)
        let projection = LiveMotorProjector.project(motor: sample(), units: units)
        // 51.2 °C → 124.16 °F
        XCTAssertEqual(gauge("motor-temp", in: projection)?.unit, "°F")
        XCTAssertEqual(gauge("motor-temp", in: projection)?.centerValue, "124.16")
        XCTAssertEqual(gauge("motor-temp", in: projection)?.caption, "124.2°F")
    }

    func testMissingTemperatureRendersAwaitingCaption() {
        let parked = MotorSnapshotInput(
            torqueFrontNm: 0,
            torqueRearNm: 0,
            rpmFront: 0,
            motorTempCFront: nil,
            motorTempCRear: nil,
            shiftState: "P"
        )
        let projection = LiveMotorProjector.project(motor: parked, units: LiveMotorUnitPrefs())
        // motorTempC nil → display 0 → ring centre "0°C", caption the localized awaiting fallback
        XCTAssertEqual(gauge("motor-temp", in: projection)?.centerValue, "0")
        XCTAssertEqual(gauge("motor-temp", in: projection)?.caption, "Awaiting data")
        XCTAssertEqual(gauge("motor-temp", in: projection)?.fraction ?? -1, 0, accuracy: 1e-9)
    }

    func testSingleAxleTorqueAndTemperatureUseNilCoalescing() {
        let oneAxle = MotorSnapshotInput(
            torqueFrontNm: 120,
            torqueRearNm: nil,
            rpmFront: nil,
            motorTempCFront: nil,
            motorTempCRear: 40,
            shiftState: nil
        )
        let projection = LiveMotorProjector.project(motor: oneAxle, units: LiveMotorUnitPrefs())
        // torque = 120 + 0; rpm = 0; temp = max(-inf, 40) = 40
        XCTAssertEqual(gauge("torque", in: projection)?.centerValue, "120")
        XCTAssertEqual(gauge("rpm-front", in: projection)?.caption, "0 RPM")
        XCTAssertEqual(gauge("motor-temp", in: projection)?.caption, "40.0°C")
    }

    func testValuesClampToGaugeMax() {
        let over = MotorSnapshotInput(
            torqueFrontNm: 900,
            torqueRearNm: 900,
            rpmFront: 25000,
            motorTempCFront: 260,
            motorTempCRear: nil,
            shiftState: "D"
        )
        let projection = LiveMotorProjector.project(motor: over, units: LiveMotorUnitPrefs())
        // torque 1800 → clamp 1000 (full ring); caption keeps the raw total
        XCTAssertEqual(gauge("torque", in: projection)?.centerValue, "1,000")
        XCTAssertEqual(gauge("torque", in: projection)?.caption, "1,800.00 Nm")
        XCTAssertEqual(gauge("torque", in: projection)?.fraction ?? -1, 1, accuracy: 1e-9)
        // rpm 25000 → clamp 18000 (full ring)
        XCTAssertEqual(gauge("rpm-front", in: projection)?.fraction ?? -1, 1, accuracy: 1e-9)
        // temp 260 → clamp 200 (full ring)
        XCTAssertEqual(gauge("motor-temp", in: projection)?.fraction ?? -1, 1, accuracy: 1e-9)
    }

    func testNonFiniteTorqueCollapsesToZero() {
        let bad = MotorSnapshotInput(
            torqueFrontNm: .nan,
            torqueRearNm: .infinity,
            rpmFront: .nan,
            motorTempCFront: nil,
            motorTempCRear: nil,
            shiftState: nil
        )
        let projection = LiveMotorProjector.project(motor: bad, units: LiveMotorUnitPrefs())
        XCTAssertEqual(gauge("torque", in: projection)?.centerValue, "0")
        XCTAssertEqual(gauge("torque", in: projection)?.caption, "0.00 Nm")
        XCTAssertEqual(gauge("torque", in: projection)?.fraction ?? -1, 0, accuracy: 1e-9)
        XCTAssertEqual(gauge("rpm-front", in: projection)?.centerValue, "0")
    }

    func testPrecisionPreferenceFlowsIntoCaptions() {
        let units = LiveMotorUnitPrefs(localeIdentifier: "en_US", precision: 0)
        let projection = LiveMotorProjector.project(motor: sample(), units: units)
        // torque caption uses the configured precision (0 → "497 Nm")
        XCTAssertEqual(gauge("torque", in: projection)?.caption, "497 Nm")
    }

    func testShiftBadgeToneAndText() {
        let drive = LiveMotorProjector.project(motor: sample(), units: LiveMotorUnitPrefs()).shift
        XCTAssertTrue(drive.isDrive)
        XCTAssertEqual(drive.displayText, "D")
        let park = MotorShiftBadge(state: "P")
        XCTAssertFalse(park.isDrive)
        XCTAssertEqual(park.displayText, "P")
        let unknown = MotorShiftBadge(state: nil)
        XCTAssertFalse(unknown.isDrive)
        XCTAssertEqual(unknown.displayText, "Unknown")
    }
}

// MARK: - State holder: phases + refresh + telemetry

@MainActor final class LiveMotorStatusModelTests: XCTestCase {
    private func makeModel(
        _ update: LiveMotorUpdate,
        telemetry: LiveMotorTelemetry = OSLogLiveMotorTelemetry()
    ) -> (LiveMotorStatusModel, InMemoryLiveMotorSource) {
        let source = InMemoryLiveMotorSource(initial: update)
        let model = LiveMotorStatusModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func sample() -> MotorSnapshotInput {
        MotorSnapshotInput(torqueFrontNm: 100, torqueRearNm: 120, rpmFront: 4000, motorTempCFront: 40, shiftState: "D")
    }

    func testResolvePhaseMatrix() {
        XCTAssertEqual(LiveMotorStatusModel.resolvePhase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(LiveMotorStatusModel.resolvePhase(status: .loading, hasData: true), .content)
        XCTAssertEqual(LiveMotorStatusModel.resolvePhase(status: .empty, hasData: false), .empty)
        XCTAssertEqual(LiveMotorStatusModel.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(LiveMotorStatusModel.resolvePhase(status: .loaded, hasData: true), .content)
        XCTAssertEqual(LiveMotorStatusModel.resolvePhase(status: .failed("e"), hasData: false), .error("e"))
        XCTAssertEqual(LiveMotorStatusModel.resolvePhase(status: .failed("e"), hasData: true), .content)
    }

    func testInitialContentProjectsGaugesAndShift() {
        let (model, _) = makeModel(LiveMotorUpdate(status: .loaded, motor: sample()))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.gauges.count, 3)
        XCTAssertEqual(model.projection?.shift.displayText, "D")
    }

    func testEmptyAndLoadingAndErrorPhases() {
        let (empty, _) = makeModel(LiveMotorUpdate(status: .empty, motor: nil))
        empty.start()
        XCTAssertEqual(empty.phase, .empty)
        let (loading, _) = makeModel(LiveMotorUpdate(status: .loading))
        loading.start()
        XCTAssertEqual(loading.phase, .loading)
        let (failed, _) = makeModel(LiveMotorUpdate(status: .failed("boom")))
        failed.start()
        XCTAssertEqual(failed.phase, .error("boom"))
    }

    func testCachedReadingsStayContentWhileFailing() {
        let (model, source) = makeModel(LiveMotorUpdate(status: .loaded, motor: sample()))
        model.start()
        source.push(LiveMotorUpdate(status: .failed("net"), connection: .offline, motor: sample()))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.connection, .offline)
    }

    func testUnitsAndFreshnessTrackUpdates() {
        let (model, source) = makeModel(LiveMotorUpdate(status: .loading))
        model.start()
        source.push(
            LiveMotorUpdate(
                status: .loaded,
                connection: .stale,
                isFetching: true,
                motor: sample(),
                units: LiveMotorUnitPrefs(temperature: .fahrenheit),
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.units.temperature, .fahrenheit)
        XCTAssertEqual(model.connection, .stale)
        XCTAssertTrue(model.isFetching)
        XCTAssertNotNil(model.updatedAt)
    }

    func testRefreshDelegates() {
        let (model, source) = makeModel(LiveMotorUpdate(status: .loaded, motor: sample()))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStaleAutoRefreshesOnceUntilLiveAgain() {
        let (model, source) = makeModel(LiveMotorUpdate(status: .loaded, motor: sample()))
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        // first stale snapshot → exactly one auto-refresh
        source.push(LiveMotorUpdate(status: .loaded, connection: .stale, motor: sample()))
        XCTAssertEqual(source.refreshCount, 1)
        // still stale → guarded, no repeat
        source.push(LiveMotorUpdate(status: .loaded, connection: .stale, motor: sample()))
        XCTAssertEqual(source.refreshCount, 1)
        // back to live resets the guard, next stale fires once more
        source.push(LiveMotorUpdate(status: .loaded, connection: .live, motor: sample()))
        source.push(LiveMotorUpdate(status: .loaded, connection: .stale, motor: sample()))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testAutoRefreshIfStaleGuardsFetching() {
        let (model, source) = makeModel(LiveMotorUpdate(status: .loaded, motor: sample()))
        model.start()
        // live → no refresh
        model.autoRefreshIfStale()
        XCTAssertEqual(source.refreshCount, 0)
        // stale + fetching → guarded
        source.push(LiveMotorUpdate(status: .loaded, connection: .stale, isFetching: true, motor: sample()))
        let countAfterStaleFetching = source.refreshCount
        model.autoRefreshIfStale()
        XCTAssertEqual(source.refreshCount, countAfterStaleFetching)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyLiveMotorTelemetry()
        let (model, source) = makeModel(LiveMotorUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [LiveMotorStatusSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }
}

// MARK: - Accessibility summary

@MainActor final class LiveMotorAccessibilityTests: XCTestCase {
    func testSummaryIncludesEveryGaugeAndShift() {
        let motor = MotorSnapshotInput(
            torqueFrontNm: 184.5,
            torqueRearNm: 312.0,
            rpmFront: 5230,
            motorTempCFront: 48.4,
            motorTempCRear: 51.2,
            shiftState: "D"
        )
        let projection = LiveMotorProjector.project(motor: motor, units: LiveMotorUnitPrefs())
        let summary = LiveMotorAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Torque 496.50 Nm"))
        XCTAssertTrue(summary.contains("Front RPM 5,230 RPM"))
        XCTAssertTrue(summary.contains("Motor 51.2°C"))
        XCTAssertTrue(summary.contains("Shift State D"))
    }
}

// MARK: - View: per-state render smoke (every state materializes)

#if canImport(UIKit) || canImport(AppKit)
    @MainActor final class LiveMotorStatusViewStateTests: XCTestCase {
        private func renders(_ update: LiveMotorUpdate) -> Bool {
            let source = InMemoryLiveMotorSource(initial: update)
            let model = LiveMotorStatusModel(source: source)
            model.start()
            let renderer = ImageRenderer(content: LiveMotorStatus(model: model).frame(width: 390, height: 320))
            #if canImport(UIKit)
                return renderer.uiImage != nil
            #else
                return renderer.nsImage != nil
            #endif
        }

        private func sample() -> MotorSnapshotInput {
            MotorSnapshotInput(
                torqueFrontNm: 184.5,
                torqueRearNm: 312.0,
                rpmFront: 5230,
                motorTempCFront: 48.4,
                motorTempCRear: 51.2,
                shiftState: "D"
            )
        }

        func testContentRenders() {
            XCTAssertTrue(renders(LiveMotorUpdate(status: .loaded, motor: sample())))
        }

        func testEmptyRenders() {
            XCTAssertTrue(renders(LiveMotorUpdate(status: .empty, motor: nil)))
        }

        func testLoadingRenders() {
            XCTAssertTrue(renders(LiveMotorUpdate(status: .loading)))
        }

        func testErrorRenders() {
            XCTAssertTrue(renders(LiveMotorUpdate(status: .failed("offline"))))
        }

        func testStaleRenders() {
            XCTAssertTrue(renders(LiveMotorUpdate(status: .loaded, connection: .stale, motor: sample())))
        }

        func testOfflineRenders() {
            XCTAssertTrue(renders(LiveMotorUpdate(status: .loaded, connection: .offline, motor: sample())))
        }
    }
#endif

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyLiveMotorTelemetry: LiveMotorTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
