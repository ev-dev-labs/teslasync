//
//  LiveVehicleState.Tests.swift
//  TeslaSync — P4 feature view · 0044 · LiveVehicleState (Apple)
//
//  Unit coverage for the LiveVehicleState surface:
//    • Logic — `boolLabel` / `asNonEmptyString` / `isActiveString` parity across
//      every wire variant (port of the web `buildLiveSignals` helpers).
//    • Projection — the ten cells' value / active / icon / VoiceOver summary across
//      the active, idle, and absent (empty) events, including the web string
//      "off"-substring and boolean-vs-string speed-limit quirks.
//    • State holder — `LiveVehicleStateModel.resolvePhase` across loading / empty /
//      loaded / failed, plus the model wiring, the P1/S11 `view.opened` telemetry,
//      the `hasLatest` pill gate, and the stale one-shot auto-refresh.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryLiveVehicleStateSource`.
//

import XCTest
@testable import TeslaSync

/// Echo localizer: returns the web English fallback so projected strings can be
/// asserted without the catalog (the P1/S10 facade is exercised separately).
private let echo: @Sendable (String, String) -> String = { _, fallback in fallback }

// MARK: - Logic (port of the web buildLiveSignals helpers)

@MainActor final class LiveVehicleStateLogicTests: XCTestCase {
    func testBoolLabel() {
        XCTAssertEqual(LiveVehicleStateLogic.boolLabel(nil, echo), "—")
        XCTAssertEqual(LiveVehicleStateLogic.boolLabel(true, echo), "On")
        XCTAssertEqual(LiveVehicleStateLogic.boolLabel(false, echo), "Off")
    }

    func testAsNonEmptyString() {
        XCTAssertEqual(LiveVehicleStateLogic.asNonEmptyString(.text("Left")), "Left")
        XCTAssertNil(LiveVehicleStateLogic.asNonEmptyString(.text("")))
        XCTAssertNil(LiveVehicleStateLogic.asNonEmptyString(.boolean(true)))
        XCTAssertNil(LiveVehicleStateLogic.asNonEmptyString(.absent))
    }

    func testIsActiveString() {
        XCTAssertTrue(LiveVehicleStateLogic.isActiveString(.text("Left")))
        XCTAssertTrue(LiveVehicleStateLogic.isActiveString(.text("25 mph")))
        // Any value containing "off" (case-insensitive) is inactive.
        XCTAssertFalse(LiveVehicleStateLogic.isActiveString(.text("Off")))
        XCTAssertFalse(LiveVehicleStateLogic.isActiveString(.text("OFF")))
        XCTAssertFalse(LiveVehicleStateLogic.isActiveString(.text("")))
        XCTAssertFalse(LiveVehicleStateLogic.isActiveString(.boolean(true)))
        XCTAssertFalse(LiveVehicleStateLogic.isActiveString(.absent))
    }
}

// MARK: - Projection: the ten cells across events

@MainActor final class LiveVehicleStateProjectionTests: XCTestCase {
    private func signal(_ signals: [LiveSignalViewModel], _ identifier: String) -> LiveSignalViewModel {
        guard let match = signals.first(where: { $0.id == identifier }) else {
            return LiveSignalViewModel(id: identifier, label: "", value: "", systemImage: "", active: false)
        }
        return match
    }

    private let activeEvent = LiveVehicleStateLatest(
        lightsHazardsActive: true,
        lightsHighBeams: false,
        lightsTurnSignal: .text("Left"),
        driverSeatOccupied: true,
        pairedPhoneKeyCount: 2,
        valetModeEnabled: false,
        serviceMode: true,
        speedLimitMode: .boolean(true),
        homelinkDeviceCount: 3,
        centerDisplay: .text("Drive")
    )

    func testAbsentEventYieldsEmptyGrid() {
        XCTAssertTrue(LiveVehicleStateProjection.signals(latest: nil, localize: echo).isEmpty)
    }

    func testSignalOrderAndCount() {
        let signals = LiveVehicleStateProjection.signals(latest: activeEvent, localize: echo)
        XCTAssertEqual(signals.count, 10)
        XCTAssertEqual(
            signals.map(\.id),
            [
                "hazards", "highBeams", "turnSignal", "driverSeat", "pairedKeys",
                "valetMode", "serviceMode", "speedLimit", "homelinkDevices", "centerDisplay"
            ]
        )
    }

    func testActiveEventRendersValuesAndFlags() {
        let signals = LiveVehicleStateProjection.signals(latest: activeEvent, localize: echo)
        XCTAssertEqual(signal(signals, "hazards").value, "On")
        XCTAssertTrue(signal(signals, "hazards").active)
        XCTAssertEqual(signal(signals, "hazards").systemImage, "exclamationmark.triangle.fill")
        XCTAssertEqual(signal(signals, "highBeams").value, "Off")
        XCTAssertFalse(signal(signals, "highBeams").active)
        XCTAssertEqual(signal(signals, "turnSignal").value, "Left")
        XCTAssertTrue(signal(signals, "turnSignal").active)
        XCTAssertEqual(signal(signals, "driverSeat").value, "Occupied")
        XCTAssertTrue(signal(signals, "driverSeat").active)
        XCTAssertEqual(signal(signals, "pairedKeys").value, "2")
        XCTAssertTrue(signal(signals, "pairedKeys").active)
        XCTAssertEqual(signal(signals, "valetMode").value, "Off")
        XCTAssertFalse(signal(signals, "valetMode").active)
        XCTAssertEqual(signal(signals, "serviceMode").value, "On")
        XCTAssertTrue(signal(signals, "serviceMode").active)
        XCTAssertEqual(signal(signals, "speedLimit").value, "On")
        XCTAssertTrue(signal(signals, "speedLimit").active)
        XCTAssertEqual(signal(signals, "homelinkDevices").value, "3")
        XCTAssertTrue(signal(signals, "homelinkDevices").active)
        XCTAssertEqual(signal(signals, "centerDisplay").value, "Drive")
        XCTAssertTrue(signal(signals, "centerDisplay").active)
    }

    func testNilAndEmptyFieldsRenderDashes() {
        let event = LiveVehicleStateLatest(
            lightsHazardsActive: nil,
            lightsHighBeams: nil,
            lightsTurnSignal: .text(""),
            driverSeatOccupied: nil,
            pairedPhoneKeyCount: nil,
            valetModeEnabled: nil,
            serviceMode: nil,
            speedLimitMode: .absent,
            homelinkDeviceCount: nil,
            centerDisplay: .absent
        )
        let signals = LiveVehicleStateProjection.signals(latest: event, localize: echo)
        XCTAssertEqual(signal(signals, "hazards").value, "—")
        XCTAssertFalse(signal(signals, "hazards").active)
        XCTAssertEqual(signal(signals, "turnSignal").value, "—")
        XCTAssertEqual(signal(signals, "driverSeat").value, "—")
        XCTAssertEqual(signal(signals, "pairedKeys").value, "—")
        XCTAssertEqual(signal(signals, "valetMode").value, "—")
        XCTAssertEqual(signal(signals, "speedLimit").value, "—")
        XCTAssertEqual(signal(signals, "homelinkDevices").value, "—")
        XCTAssertEqual(signal(signals, "centerDisplay").value, "—")
    }

    func testDriverSeatEmptyAndZeroCounts() {
        let event = LiveVehicleStateLatest(
            driverSeatOccupied: false,
            pairedPhoneKeyCount: 0,
            homelinkDeviceCount: 0
        )
        let signals = LiveVehicleStateProjection.signals(latest: event, localize: echo)
        XCTAssertEqual(signal(signals, "driverSeat").value, "Empty")
        XCTAssertFalse(signal(signals, "driverSeat").active)
        XCTAssertEqual(signal(signals, "pairedKeys").value, "0")
        XCTAssertFalse(signal(signals, "pairedKeys").active)
        XCTAssertEqual(signal(signals, "homelinkDevices").value, "0")
        XCTAssertFalse(signal(signals, "homelinkDevices").active)
    }

    func testTurnSignalOffStringIsInactive() {
        let event = LiveVehicleStateLatest(lightsTurnSignal: .text("Off"))
        let signals = LiveVehicleStateProjection.signals(latest: event, localize: echo)
        XCTAssertEqual(signal(signals, "turnSignal").value, "Off")
        XCTAssertFalse(signal(signals, "turnSignal").active)
    }

    func testSpeedLimitBooleanAndStringBranches() {
        let boolOff = LiveVehicleStateProjection.signals(
            latest: LiveVehicleStateLatest(speedLimitMode: .boolean(false)),
            localize: echo
        )
        XCTAssertEqual(signal(boolOff, "speedLimit").value, "Off")
        XCTAssertFalse(signal(boolOff, "speedLimit").active)

        let stringOn = LiveVehicleStateProjection.signals(
            latest: LiveVehicleStateLatest(speedLimitMode: .text("25 mph")),
            localize: echo
        )
        XCTAssertEqual(signal(stringOn, "speedLimit").value, "25 mph")
        XCTAssertTrue(signal(stringOn, "speedLimit").active)

        let stringOff = LiveVehicleStateProjection.signals(
            latest: LiveVehicleStateLatest(speedLimitMode: .text("Off")),
            localize: echo
        )
        XCTAssertEqual(signal(stringOff, "speedLimit").value, "Off")
        XCTAssertFalse(signal(stringOff, "speedLimit").active)
    }

    func testCenterDisplayBooleanFallsBackToDash() {
        // Web `asNonEmptyString` returns null for a boolean, so a boolean center
        // display renders the em-dash and is inactive.
        let event = LiveVehicleStateLatest(centerDisplay: .boolean(true))
        let signals = LiveVehicleStateProjection.signals(latest: event, localize: echo)
        XCTAssertEqual(signal(signals, "centerDisplay").value, "—")
        XCTAssertFalse(signal(signals, "centerDisplay").active)
    }
}

// MARK: - Accessibility summary content

@MainActor final class LiveVehicleStateAccessibilityTests: XCTestCase {
    func testAccessibilityLabelCombinesLabelAndValue() {
        let signals = LiveVehicleStateProjection.signals(
            latest: LiveVehicleStateLatest(lightsHazardsActive: true),
            localize: echo
        )
        let hazards = signals.first { $0.id == "hazards" }
        XCTAssertEqual(hazards?.accessibilityLabel, "Hazards: On")
    }

    func testEverySignalHasANonEmptyAccessibilityLabel() {
        let signals = LiveVehicleStateProjection.signals(
            latest: LiveVehicleStateLatest(lightsHazardsActive: true),
            localize: echo
        )
        for sig in signals {
            XCTAssertFalse(sig.accessibilityLabel.isEmpty, "missing a11y label for \(sig.id)")
            XCTAssertFalse(sig.systemImage.isEmpty, "missing icon for \(sig.id)")
        }
    }
}

// MARK: - Phase resolution

@MainActor final class LiveVehicleStatePhaseTests: XCTestCase {
    private let event = LiveVehicleStateLatest(lightsHazardsActive: true)

    func testLoadingWithoutDataIsLoading() {
        XCTAssertEqual(LiveVehicleStateModel.resolvePhase(LiveVehicleStateUpdate(status: .loading)), .loading)
    }

    func testLoadingWithCachedDataStaysContent() {
        let update = LiveVehicleStateUpdate(status: .loading, latest: event)
        XCTAssertEqual(LiveVehicleStateModel.resolvePhase(update), .content)
    }

    func testEmptyStatusIsEmpty() {
        XCTAssertEqual(LiveVehicleStateModel.resolvePhase(LiveVehicleStateUpdate(status: .empty)), .empty)
    }

    func testLoadedWithoutDataIsEmpty() {
        XCTAssertEqual(LiveVehicleStateModel.resolvePhase(LiveVehicleStateUpdate(status: .loaded)), .empty)
    }

    func testLoadedWithDataIsContent() {
        let update = LiveVehicleStateUpdate(status: .loaded, latest: event)
        XCTAssertEqual(LiveVehicleStateModel.resolvePhase(update), .content)
    }

    func testFailedWithoutDataIsError() {
        XCTAssertEqual(
            LiveVehicleStateModel.resolvePhase(LiveVehicleStateUpdate(status: .failed("boom"))),
            .error("boom")
        )
    }

    func testFailedWithCachedDataStaysContent() {
        let update = LiveVehicleStateUpdate(status: .failed("boom"), latest: event)
        XCTAssertEqual(LiveVehicleStateModel.resolvePhase(update), .content)
    }
}

// MARK: - State holder: wiring + telemetry + stale auto-refresh

@MainActor final class LiveVehicleStateModelTests: XCTestCase {
    private func makeModel(
        _ update: LiveVehicleStateUpdate,
        telemetry: LiveVehicleStateTelemetry = OSLogLiveVehicleStateTelemetry()
    ) -> (LiveVehicleStateModel, InMemoryLiveVehicleStateSource) {
        let source = InMemoryLiveVehicleStateSource(initial: update)
        let model = LiveVehicleStateModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyLiveVehicleStateTelemetry()
        let (model, source) = makeModel(
            LiveVehicleStateUpdate(
                status: .loaded,
                connection: .live,
                latest: LiveVehicleStateLatest(lightsHazardsActive: true)
            ),
            telemetry: spy
        )
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.signals.count, 10)
        XCTAssertTrue(model.hasLatest)
        XCTAssertEqual(spy.surfaces, [LiveVehicleState.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(LiveVehicleStateUpdate(status: .loading))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testEmptyResolvesToEmptyPhaseWithNoSignals() {
        let (model, _) = makeModel(LiveVehicleStateUpdate(status: .empty, latest: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.signals.isEmpty)
        XCTAssertFalse(model.hasLatest)
    }

    func testLoadingWithoutDataHasNoLivePill() {
        let (model, _) = makeModel(LiveVehicleStateUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertFalse(model.hasLatest)
    }

    func testStaleTriggersExactlyOneAutoRefreshUntilLive() {
        let event = LiveVehicleStateLatest(lightsHazardsActive: true)
        let (model, source) = makeModel(
            LiveVehicleStateUpdate(status: .loaded, connection: .live, latest: event)
        )
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(LiveVehicleStateUpdate(status: .loaded, connection: .stale, latest: event))
        source.push(LiveVehicleStateUpdate(status: .loaded, connection: .stale, latest: event))
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertEqual(model.connection, .stale)
        source.push(LiveVehicleStateUpdate(status: .loaded, connection: .live, latest: event))
        source.push(LiveVehicleStateUpdate(status: .loaded, connection: .stale, latest: event))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineDoesNotAutoRefresh() {
        let event = LiveVehicleStateLatest(lightsHazardsActive: true)
        let (model, source) = makeModel(
            LiveVehicleStateUpdate(status: .loaded, connection: .live, latest: event)
        )
        model.start()
        source.push(LiveVehicleStateUpdate(status: .loaded, connection: .offline, latest: event))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyLiveVehicleStateTelemetry: LiveVehicleStateTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
