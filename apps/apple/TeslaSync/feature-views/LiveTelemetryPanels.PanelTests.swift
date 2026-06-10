//
//  LiveTelemetryPanels.PanelTests.swift
//  TeslaSync — P4 feature view · 0281 · LiveTelemetryPanels (Apple)
//
//  Unit coverage for the remaining four panel projections (Vehicle State / Tire Pressure /
//  Energy & Charging / Media & Navigation) + the aggregate projector. Continues
//  LiveTelemetryPanels.Tests.swift (formatting / units / Powertrain / Climate / Security).
//  Pure Foundation logic — runs on a plain host.
//

import XCTest
@testable import TeslaSync

// MARK: - Vehicle State projection (web `VehicleStatePanel`)

@MainActor final class LTPVehicleStateProjectionTests: XCTestCase {
    private let units = LTPUnitPrefs()

    func testRowValuesTonesAndSpeedLimit() {
        let live = LTPVehicleStateLive(
            lightsHighBeams: true,
            lightsTurnSignal: "Left",
            lightsHazards: false,
            driverSeatOccupied: true,
            pairedKeyCount: "3",
            valetMode: true,
            serviceMode: false,
            speedLimitMode: true,
            currentSpeedLimit: 29,
            centerDisplay: "<nil>",
            homelinkDeviceCount: "2"
        )
        let projection = LTPVehicleStateProjection.project(live, sseConnected: true, units)
        XCTAssertTrue(projection.sseConnected)

        XCTAssertEqual(projection.lightsRows.map(\.value), ["On", "Left", "Off"])
        XCTAssertEqual(projection.lightsRows.map(\.valueTone), [.accent, .warning, .neutral])

        XCTAssertEqual(projection.driverRows.map(\.value), ["Occupied", "3"])
        XCTAssertEqual(projection.driverRows[0].valueTone, .success)

        // valet=Enabled/purple, service=Off/neutral, speed limit=formatSpeed(29 m/s),
        // center display scrubbed to dash, homelink=2.
        XCTAssertEqual(projection.accessRows.map(\.value), ["Enabled", "Off", "104 km/h", "—", "2"])
        XCTAssertEqual(projection.accessRows[0].valueTone, .purple)
        XCTAssertEqual(projection.accessRows[2].valueTone, .accent)
    }

    func testTurnSignalOffAndSpeedLimitDisabled() {
        let live = LTPVehicleStateLive(lightsTurnSignal: nil, speedLimitMode: false)
        let projection = LTPVehicleStateProjection.project(live, sseConnected: false, units)
        XCTAssertEqual(projection.lightsRows[1].value, "Off")
        XCTAssertEqual(projection.lightsRows[1].valueTone, .neutral)
        XCTAssertEqual(projection.accessRows[2].value, "Off") // speed limit off
        XCTAssertFalse(projection.sseConnected)
    }
}

// MARK: - Tire projection (web `TirePressurePanel`)

@MainActor final class LTPTireProjectionTests: XCTestCase {
    private let units = LTPUnitPrefs()

    func testEmptyWhenNoTire() {
        XCTAssertFalse(LTPTireProjection.project(nil, units).hasData)
    }

    func testAllNormalStatusAndCornerValues() {
        let projection = LTPTireProjection.project(
            LTPTire(frontLeft: 290_000, frontRight: 288_500, rearLeft: 291_000, rearRight: 289_000),
            units
        )
        XCTAssertEqual(projection.corners.map(\.label), ["FL", "FR", "RL", "RR"])
        XCTAssertEqual(projection.corners[0].value, "2.9 bar") // 290 kPa / 100
        XCTAssertEqual(projection.corners.map(\.tone), [.success, .success, .success, .success])
        XCTAssertEqual(projection.statusChip.text, "✓ All Normal")
        XCTAssertEqual(projection.statusChip.tone, .success)
    }

    func testAnyBadAndCheckPressureStatuses() {
        let bad = LTPTireProjection.project(
            LTPTire(frontLeft: 200_000, frontRight: 290_000, rearLeft: 290_000, rearRight: 290_000),
            units
        )
        XCTAssertEqual(bad.corners[0].tone, .danger)
        XCTAssertEqual(bad.statusChip.text, "✗ Attention Needed")
        XCTAssertEqual(bad.statusChip.tone, .danger)

        // One soft-low corner (230 kPa, between critical and warning) → check pressure.
        let check = LTPTireProjection.project(
            LTPTire(frontLeft: 230_000, frontRight: 290_000, rearLeft: 290_000, rearRight: 290_000),
            units
        )
        XCTAssertEqual(check.statusChip.text, "⚠ Check Pressure")
        XCTAssertEqual(check.statusChip.tone, .warning)
    }
}

// MARK: - Energy & charging projection (web `EnergyChargingPanel`)

@MainActor final class LTPEnergyChargingProjectionTests: XCTestCase {
    private let units = LTPUnitPrefs()

    func testEmptyWhenNoCharging() {
        XCTAssertFalse(LTPEnergyChargingProjection.project(nil, units).hasData)
    }

    func testTilesPowerEnergyQuirkStateAndRate() {
        let projection = LTPEnergyChargingProjection.project(
            LTPCharging(
                chargerVoltage: 232,
                chargerActualCurrent: 16,
                chargerPowerW: 11000,
                chargeEnergyAddedWh: 24500,
                chargingState: "Charging",
                batteryLevel: 64,
                rangeAddedMetersPerHour: 48000
            ),
            units
        )
        XCTAssertEqual(projection.voltageTile.value, "232.00")
        XCTAssertEqual(projection.voltageTile.unit, "V")
        XCTAssertEqual(projection.currentTile.value, "16.00")
        XCTAssertEqual(projection.currentTile.unit, "A")
        // Web `fmtWithUnit(raw_w, 'kW')` / `fmtWithUnit(raw_wh, 'kWh')` — unit on the raw SI
        // magnitude, reproduced verbatim.
        XCTAssertEqual(projection.chargerPowerRow.value, "11,000.00 kW")
        XCTAssertEqual(projection.energyAddedRow.value, "24,500.00 kWh")
        XCTAssertEqual(projection.chargingStateChip.text, "Charging")
        XCTAssertEqual(projection.chargingStateChip.tone, .accent)
        XCTAssertEqual(projection.batteryLevelRow.value, "64.00%")
        XCTAssertEqual(projection.chargeRateRow.value, "48 km/h") // 48000 m/h / 3600 → m/s → km/h
    }

    func testCompleteStateAndUnknownAndMissingValues() {
        let complete = LTPEnergyChargingProjection.project(LTPCharging(chargingState: "Complete"), units)
        XCTAssertEqual(complete.chargingStateChip.tone, .success)
        XCTAssertEqual(complete.chargerPowerRow.value, "—")
        XCTAssertEqual(complete.batteryLevelRow.value, "—")
        XCTAssertEqual(complete.chargeRateRow.value, "—")

        let unknown = LTPEnergyChargingProjection.project(LTPCharging(chargingState: nil), units)
        XCTAssertEqual(unknown.chargingStateChip.text, "Unknown")
        XCTAssertEqual(unknown.chargingStateChip.tone, .neutral)
    }
}

// MARK: - Media & navigation projection (web `MediaNavigationPanel`)

@MainActor final class LTPMediaNavProjectionTests: XCTestCase {
    private let imperial = LTPUnitPrefs.imperial

    func testNowPlayingAndStatusChips() {
        let projection = LTPMediaNavProjection.project(
            LTPMedia(
                nowPlayingTitle: "Electric Feel",
                nowPlayingArtist: "MGMT",
                playbackSource: "Spotify",
                playbackStatus: "Playing"
            ),
            nil,
            imperial
        )
        XCTAssertTrue(projection.hasMedia)
        XCTAssertEqual(projection.mediaTitle, "Electric Feel")
        XCTAssertEqual(projection.mediaArtist, "MGMT")
        XCTAssertEqual(projection.sourceChip?.text, "Spotify")
        XCTAssertEqual(projection.sourceChip?.filled, false)
        XCTAssertEqual(projection.statusChip?.text, "Playing")
        XCTAssertEqual(projection.statusChip?.tone, .success)
        XCTAssertFalse(projection.hasLocation)
    }

    func testMediaFallbacksWhenNil() {
        let projection = LTPMediaNavProjection.project(nil, nil, imperial)
        XCTAssertFalse(projection.hasMedia)
        XCTAssertEqual(projection.mediaTitle, "Nothing playing")
        XCTAssertEqual(projection.mediaArtist, "Unknown artist")
        XCTAssertNil(projection.sourceChip)
        XCTAssertNil(projection.statusChip)
        XCTAssertEqual(projection.mediaEmpty, "No media data")
        XCTAssertEqual(projection.locationEmpty, "No location data")
    }

    func testNavigationDistanceEtaAndPlaceChips() {
        let projection = LTPMediaNavProjection.project(
            nil,
            LTPLocation(
                destinationName: "Supercharger",
                metresToArrival: 18400,
                minutesToArrival: 14,
                locatedAtHome: true,
                locatedAtWork: false,
                locatedAtFavorite: true
            ),
            imperial
        )
        XCTAssertTrue(projection.hasLocation)
        XCTAssertEqual(projection.destinationName, "Supercharger")
        XCTAssertEqual(projection.distanceText, "11.43 mi") // 18400 m → mi, fmtNumber(2)
        XCTAssertEqual(projection.etaText, "14 min")
        XCTAssertEqual(projection.placeChips.map(\.id), ["home", "favorite"])
        XCTAssertEqual(projection.placeChips[0].text, "🏠 Home")
        XCTAssertEqual(projection.placeChips[1].tone, .purple)
    }

    func testNoActiveDestination() {
        let projection = LTPMediaNavProjection.project(nil, LTPLocation(destinationName: nil), imperial)
        XCTAssertTrue(projection.hasLocation)
        XCTAssertNil(projection.destinationName)
        XCTAssertEqual(projection.noDestination, "No active destination")
    }
}

// MARK: - Aggregate projector

@MainActor final class LiveTelemetryPanelsProjectorTests: XCTestCase {
    func testProjectsAllSevenPanelsAgeAndHasTelemetry() {
        let now = Date(timeIntervalSince1970: 2_000_000)
        let update = LiveTelemetryPanelsUpdate(
            motor: LTPMotor(shiftState: "P"),
            climate: LTPClimate(insideTempC: 20),
            updatedAt: now.addingTimeInterval(-30)
        )
        let projection = LiveTelemetryPanelsProjector.project(update: update, now: now)
        XCTAssertTrue(projection.powertrain.hasData)
        XCTAssertTrue(projection.climate.hasData)
        XCTAssertFalse(projection.security.hasData)
        XCTAssertFalse(projection.tire.hasData)
        XCTAssertFalse(projection.energyCharging.hasData)
        XCTAssertEqual(projection.ageLabel, "30s ago")
        XCTAssertTrue(projection.hasAnyTelemetry)
    }

    func testHasAnyTelemetryFalseForEmptyUpdate() {
        let projection = LiveTelemetryPanelsProjector.project(update: LiveTelemetryPanelsUpdate())
        XCTAssertFalse(projection.hasAnyTelemetry)
    }

    func testLiveSignalAloneCountsAsTelemetry() {
        let update = LiveTelemetryPanelsUpdate(live: LTPVehicleStateLive(driverSeatOccupied: true))
        XCTAssertTrue(LiveTelemetryPanelsProjector.project(update: update).hasAnyTelemetry)
    }
}
