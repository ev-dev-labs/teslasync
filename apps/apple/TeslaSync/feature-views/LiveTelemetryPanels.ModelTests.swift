//
//  LiveTelemetryPanels.ModelTests.swift
//  TeslaSync — P4 feature view · 0281 · LiveTelemetryPanels (Apple)
//
//  State-holder model + accessibility + per-state view-render coverage for the Live
//  Telemetry section (the adapter / projection tests live in LiveTelemetryPanels.Tests
//  .swift). Pure-logic tests use `InMemoryLiveTelemetryPanelsSource`; the view tests render
//  via `ImageRenderer`.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - State holder model

@MainActor final class LiveTelemetryPanelsModelTests: XCTestCase {
    private func makeModel(
        _ initial: LiveTelemetryPanelsUpdate?,
        telemetry: LiveTelemetryPanelsTelemetry = OSLogLiveTelemetryPanelsTelemetry()
    ) -> (LiveTelemetryPanelsModel, InMemoryLiveTelemetryPanelsSource) {
        let source = InMemoryLiveTelemetryPanelsSource(initial: initial)
        let model = LiveTelemetryPanelsModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func withMotor(
        status: LTPLoadStatus = .loaded,
        connection: LiveTelemetryPanelsConnection = .live,
        isFetching: Bool = false,
        updatedAt: Date? = nil
    ) -> LiveTelemetryPanelsUpdate {
        LiveTelemetryPanelsUpdate(
            motor: LTPMotor(shiftState: "D"),
            status: status,
            connection: connection,
            isFetching: isFetching,
            updatedAt: updatedAt
        )
    }

    func testPhaseLoadingUntilFirstSnapshot() {
        let (model, _) = makeModel(nil)
        XCTAssertEqual(model.phase, .loading)
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testPhaseDataAfterSnapshot() {
        let (model, _) = makeModel(withMotor())
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertNotNil(model.projection)
        XCTAssertTrue(model.projection?.powertrain.hasData ?? false)
    }

    func testPhaseEmptyWhenResolvedWithNoTelemetry() {
        let (model, _) = makeModel(LiveTelemetryPanelsUpdate(status: .loaded))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testPhaseErrorWhenFailedWithNoTelemetry() {
        let (model, _) = makeModel(LiveTelemetryPanelsUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error)
    }

    func testPhaseDataWhenFailedButHasTelemetry() {
        let (model, _) = makeModel(withMotor(status: .failed("partial")))
        model.start()
        XCTAssertEqual(model.phase, .data)
    }

    func testComputePhaseStaticMatrix() {
        XCTAssertEqual(LiveTelemetryPanelsModel.computePhase(LiveTelemetryPanelsUpdate(status: .loading)), .loading)
        XCTAssertEqual(LiveTelemetryPanelsModel.computePhase(LiveTelemetryPanelsUpdate(status: .loaded)), .empty)
        XCTAssertEqual(LiveTelemetryPanelsModel.computePhase(LiveTelemetryPanelsUpdate(status: .failed("x"))), .error)
        XCTAssertEqual(LiveTelemetryPanelsModel.computePhase(withMotor()), .data)
    }

    func testStaleAutoRefreshesOnceUntilLiveAgain() {
        let (model, source) = makeModel(withMotor())
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(withMotor(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(withMotor(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(withMotor(connection: .live))
        source.push(withMotor(connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testFreshnessDerivations() {
        let (stale, _) = makeModel(withMotor(connection: .stale, updatedAt: Date()))
        stale.start()
        XCTAssertTrue(stale.isStale)
        XCTAssertFalse(stale.isOffline)
        XCTAssertTrue(stale.showsFreshnessChip)

        let (offline, _) = makeModel(withMotor(connection: .offline))
        offline.start()
        XCTAssertTrue(offline.isOffline)
        XCTAssertTrue(offline.showsFreshnessChip)

        let (live, _) = makeModel(withMotor(connection: .live))
        live.start()
        XCTAssertFalse(live.showsFreshnessChip)
    }

    func testFetchingShowsFreshnessChipEvenWhenLive() {
        let (model, _) = makeModel(withMotor(connection: .live, isFetching: true))
        model.start()
        XCTAssertTrue(model.showsFreshnessChip)
    }

    func testRefreshAndStopForwardToSource() {
        let (model, source) = makeModel(withMotor())
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyLiveTelemetryPanelsTelemetry()
        let (model, source) = makeModel(withMotor(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [LiveTelemetryPanelsSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }
}

// MARK: - Accessibility

@MainActor final class LiveTelemetryPanelsAccessibilityTests: XCTestCase {
    func testRowSpokenPhraseCombinesLabelAndValue() {
        let projection = LTPVehicleStateProjection.project(
            LTPVehicleStateLive(lightsHighBeams: true),
            sseConnected: true,
            LTPUnitPrefs()
        )
        XCTAssertEqual(projection.lightsRows[0].spoken, "High Beams On")
    }

    func testInfoRowExposesValueForVoiceOver() {
        let projection = LTPEnergyChargingProjection.project(LTPCharging(batteryLevel: 64), LTPUnitPrefs())
        XCTAssertEqual(projection.batteryLevelRow.label, "Battery Level")
        XCTAssertEqual(projection.batteryLevelRow.value, "64.00%")
        XCTAssertEqual(projection.batteryLevelRow.spoken, "Battery Level 64.00%")
    }
}

// MARK: - View: per-state render smoke (every state materializes)

#if canImport(UIKit) || canImport(AppKit)
    @MainActor final class LiveTelemetryPanelsViewStateTests: XCTestCase {
        private func loaded(connection: LiveTelemetryPanelsConnection = .live) -> LiveTelemetryPanelsUpdate {
            LiveTelemetryPanelsUpdate(
                motor: LTPMotor(shiftState: "D", powerKw: 120, motorRpmFront: 4000, torqueNmFront: 300),
                climate: LTPClimate(insideTempC: 21, isClimateOn: true, fanStatus: 3),
                security: LTPSecurity(locked: true, sentryMode: true, userPresent: true),
                tire: LTPTire(frontLeft: 290_000, frontRight: 290_000, rearLeft: 290_000, rearRight: 290_000),
                charging: LTPCharging(chargerPowerW: 11000, chargingState: "Charging", batteryLevel: 60),
                media: LTPMedia(nowPlayingTitle: "Song", playbackStatus: "Playing"),
                location: LTPLocation(destinationName: "Home", metresToArrival: 1000, locatedAtHome: true),
                live: LTPVehicleStateLive(driverSeatOccupied: true, speedLimitMode: true, currentSpeedLimit: 25),
                sseConnected: connection == .live,
                remoteStartEnabled: true,
                status: .loaded,
                connection: connection,
                units: .imperial,
                updatedAt: Date()
            )
        }

        private func renders(_ update: LiveTelemetryPanelsUpdate?) -> Bool {
            let source = InMemoryLiveTelemetryPanelsSource(initial: update)
            let model = LiveTelemetryPanelsModel(source: source)
            model.start()
            let renderer = ImageRenderer(content: LiveTelemetryPanels(model: model).frame(width: 700, height: 1400))
            #if canImport(UIKit)
                return renderer.uiImage != nil
            #else
                return renderer.nsImage != nil
            #endif
        }

        func testDataRenders() {
            XCTAssertTrue(renders(loaded()))
        }

        func testLoadingRenders() {
            XCTAssertTrue(renders(nil))
        }

        func testEmptyRenders() {
            XCTAssertTrue(renders(LiveTelemetryPanelsUpdate(status: .loaded)))
        }

        func testErrorRenders() {
            XCTAssertTrue(renders(LiveTelemetryPanelsUpdate(status: .failed("net"))))
        }

        func testStaleRenders() {
            XCTAssertTrue(renders(loaded(connection: .stale)))
        }

        func testOfflineRenders() {
            XCTAssertTrue(renders(loaded(connection: .offline)))
        }
    }
#endif

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyLiveTelemetryPanelsTelemetry: LiveTelemetryPanelsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
