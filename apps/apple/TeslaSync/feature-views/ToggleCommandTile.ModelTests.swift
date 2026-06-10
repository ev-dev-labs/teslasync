//
//  ToggleCommandTile.ModelTests.swift
//  TeslaSync — P4 feature view · 0260 · ToggleCommandTile (Apple)
//
//  State-holder coverage for `ToggleCommandTileModel` (P1/S8): the bound-state vs local-
//  optimistic `isOn` derivation, activate → turn-on / turn-off / request-dialog routing,
//  the execution lifecycle, offline caching, freshness, the favorite toggle, the gating
//  guards, and the `view.opened` telemetry. Split across two XCTestCases for the lint budget.
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - Shared fixtures (def factories + model builder)

private func boundLockDef() -> ToggleCommandTileDef {
    ToggleCommandTileDef(
        id: "lock",
        command: "lock",
        commandOff: "unlock",
        labelKey: "commands.security.lock",
        labelFallback: "Lock",
        systemImageOn: "lock.fill",
        systemImageOff: "lock.open.fill",
        stateField: "is_locked"
    )
}

private func unboundValetDef() -> ToggleCommandTileDef {
    ToggleCommandTileDef(
        id: "valet_mode",
        command: "set_valet_mode",
        commandOff: "valet_off",
        labelKey: "commands.security.valet",
        labelFallback: "Valet",
        systemImageOn: "person.fill",
        variant: .danger
    )
}

private func inputGatedDef() -> ToggleCommandTileDef {
    ToggleCommandTileDef(
        id: "speed_limit",
        command: "speed_limit_activate",
        commandOff: "speed_limit_deactivate",
        labelKey: "commands.drive.speedLimit",
        labelFallback: "Speed Limit",
        systemImageOn: "gauge",
        requiresInput: true
    )
}

private func climateDef(params: ToggleCommandParameters) -> ToggleCommandTileDef {
    ToggleCommandTileDef(
        id: "climate",
        command: "climate_on",
        commandOff: "climate_off",
        labelKey: "k",
        labelFallback: "Climate",
        systemImageOn: "wind",
        stateField: "is_climate_on",
        parameters: params
    )
}

@MainActor
private func makeToggleModel(
    def: ToggleCommandTileDef,
    isFavorite: Bool = false,
    lastStatus: String? = nil,
    dispatcher: InMemoryToggleCommandDispatcher,
    stateSource: InMemoryToggleStateSource = InMemoryToggleStateSource(),
    favorites: InMemoryToggleFavoriteToggle,
    telemetry: any ToggleCommandTelemetry = OSLogToggleCommandTelemetry(),
    now: @escaping @Sendable () -> Date = { Date() },
    stalenessWindow: TimeInterval = 120
) -> ToggleCommandTileModel {
    ToggleCommandTileModel(
        def: def,
        isFavorite: isFavorite,
        lastStatus: lastStatus,
        dispatcher: dispatcher,
        stateSource: stateSource,
        favorites: favorites,
        telemetry: telemetry,
        now: now,
        stalenessWindow: stalenessWindow
    )
}

// MARK: - isOn derivation + activate routing

@MainActor final class ToggleCommandTileModelTests: XCTestCase {
    func testInitialIdleOffState() {
        let model = makeToggleModel(
            def: boundLockDef(),
            dispatcher: InMemoryToggleCommandDispatcher(),
            favorites: InMemoryToggleFavoriteToggle()
        )
        XCTAssertFalse(model.isExecuting)
        XCTAssertNil(model.outcome)
        XCTAssertFalse(model.isOn)
        XCTAssertEqual(model.power, .off)
        XCTAssertNil(model.activeTone)
        XCTAssertEqual(model.phase, .idle)
        XCTAssertEqual(model.connection, .live)
        XCTAssertTrue(model.isInteractive)
    }

    func testInitialParsesLastStatus() {
        let model = makeToggleModel(
            def: boundLockDef(),
            isFavorite: true,
            lastStatus: "✓ Locked",
            dispatcher: InMemoryToggleCommandDispatcher(),
            favorites: InMemoryToggleFavoriteToggle(initial: true)
        )
        XCTAssertEqual(model.outcome, .succeeded(detail: "Locked"))
        XCTAssertEqual(model.phase, .result(.succeeded(detail: "Locked")))
        XCTAssertTrue(model.isFavorite)
        XCTAssertNotNil(model.lastOutcomeAt)
    }

    func testBoundLiveStateDrivesIsOn() {
        let stateSource = InMemoryToggleStateSource()
        let model = makeToggleModel(
            def: boundLockDef(),
            dispatcher: InMemoryToggleCommandDispatcher(),
            stateSource: stateSource,
            favorites: InMemoryToggleFavoriteToggle()
        )
        XCTAssertFalse(model.isOn) // live unknown → local (false)
        stateSource.push(true)
        XCTAssertTrue(model.isOn)
        XCTAssertEqual(model.power, .on)
        XCTAssertEqual(model.activeTone, .accent)
        stateSource.push(false)
        XCTAssertFalse(model.isOn)
    }

    func testUnboundUsesLocalOptimisticToggle() {
        let dispatcher = InMemoryToggleCommandDispatcher(autoEmits: false)
        let model = makeToggleModel(
            def: unboundValetDef(),
            dispatcher: dispatcher,
            favorites: InMemoryToggleFavoriteToggle()
        )
        XCTAssertFalse(model.isOn)
        model.activate() // off → on: flips localToggle on + executes on-command
        XCTAssertTrue(model.isOn)
        XCTAssertEqual(model.localToggle, true)
        XCTAssertEqual(dispatcher.lastCommand, "set_valet_mode")
    }

    func testActivateTurnOnExecutesOnCommandWithParams() {
        let params = ToggleCommandParameters(["temp": .int(72)])
        let dispatcher = InMemoryToggleCommandDispatcher(autoEmits: false)
        let model = makeToggleModel(
            def: climateDef(params: params),
            dispatcher: dispatcher,
            favorites: InMemoryToggleFavoriteToggle()
        )
        model.activate() // off → on
        XCTAssertTrue(model.isExecuting)
        XCTAssertNil(model.outcome)
        XCTAssertEqual(dispatcher.executeCount, 1)
        XCTAssertEqual(dispatcher.lastCommand, "climate_on")
        XCTAssertEqual(dispatcher.lastParameters, params)
        XCTAssertEqual(dispatcher.dialogCount, 0)
    }

    func testActivateTurnOffExecutesOffCommandWithoutParams() {
        let params = ToggleCommandParameters(["temp": .int(72)])
        let dispatcher = InMemoryToggleCommandDispatcher(autoEmits: false)
        let stateSource = InMemoryToggleStateSource()
        let model = makeToggleModel(
            def: climateDef(params: params),
            dispatcher: dispatcher,
            stateSource: stateSource,
            favorites: InMemoryToggleFavoriteToggle()
        )
        stateSource.push(true) // live on
        XCTAssertTrue(model.isOn)
        model.activate() // on → off
        XCTAssertTrue(model.isExecuting)
        XCTAssertEqual(dispatcher.lastCommand, "climate_off")
        XCTAssertNil(dispatcher.lastParameters) // off sends no params (web onExecute(commandOff!))
        XCTAssertEqual(model.localToggle, false) // bound def: local toggle untouched
    }

    func testActivateInputGatedRequestsDialog() {
        let dispatcher = InMemoryToggleCommandDispatcher(autoEmits: false)
        let model = makeToggleModel(
            def: inputGatedDef(),
            dispatcher: dispatcher,
            favorites: InMemoryToggleFavoriteToggle()
        )
        model.activate() // off + requiresInput → dialog, no execute
        XCTAssertEqual(dispatcher.dialogCount, 1)
        XCTAssertEqual(dispatcher.lastDialogID, "speed_limit")
        XCTAssertEqual(dispatcher.executeCount, 0)
        XCTAssertFalse(model.isExecuting)
    }

    func testBoundActivateOffDoesNotMutateLocalToggle() {
        let dispatcher = InMemoryToggleCommandDispatcher(autoEmits: false)
        let model = makeToggleModel(
            def: boundLockDef(),
            dispatcher: dispatcher,
            favorites: InMemoryToggleFavoriteToggle()
        )
        model.activate() // bound, live unknown → off → on-command; localToggle must stay false
        XCTAssertEqual(model.localToggle, false)
        XCTAssertEqual(dispatcher.lastCommand, "lock")
    }

    func testActivateGuardedWhileExecuting() {
        let dispatcher = InMemoryToggleCommandDispatcher(autoEmits: false)
        let model = makeToggleModel(
            def: unboundValetDef(),
            dispatcher: dispatcher,
            favorites: InMemoryToggleFavoriteToggle()
        )
        model.activate()
        model.activate()
        XCTAssertEqual(dispatcher.executeCount, 1)
    }
}

// MARK: - Execution lifecycle + offline + favorite + freshness + telemetry

@MainActor final class ToggleCommandTileLifecycleTests: XCTestCase {
    func testSucceededEventSettlesOutcome() {
        let dispatcher = InMemoryToggleCommandDispatcher(autoEmits: false)
        let model = makeToggleModel(
            def: boundLockDef(),
            dispatcher: dispatcher,
            favorites: InMemoryToggleFavoriteToggle()
        )
        model.activate()
        dispatcher.push(.succeeded(detail: "Locked"))
        XCTAssertFalse(model.isExecuting)
        XCTAssertEqual(model.outcome, .succeeded(detail: "Locked"))
        XCTAssertEqual(model.connection, .live)
        XCTAssertTrue(model.isInteractive)
    }

    func testFailedEventSettlesOutcome() {
        let dispatcher = InMemoryToggleCommandDispatcher(autoEmits: false)
        let model = makeToggleModel(
            def: boundLockDef(),
            dispatcher: dispatcher,
            favorites: InMemoryToggleFavoriteToggle()
        )
        model.activate()
        dispatcher.push(.failed(detail: "Asleep"))
        XCTAssertFalse(model.isExecuting)
        XCTAssertEqual(model.outcome, .failed(detail: "Asleep"))
    }

    func testAutoEmittingDispatcherSettlesOnActivate() {
        let dispatcher = InMemoryToggleCommandDispatcher(event: .succeeded(detail: "Done"))
        let model = makeToggleModel(
            def: unboundValetDef(),
            dispatcher: dispatcher,
            favorites: InMemoryToggleFavoriteToggle()
        )
        model.activate()
        XCTAssertFalse(model.isExecuting)
        XCTAssertEqual(model.outcome, .succeeded(detail: "Done"))
    }

    func testOfflineEventKeepsCachedOutcomeAndBlocks() {
        let dispatcher = InMemoryToggleCommandDispatcher(autoEmits: false)
        let model = makeToggleModel(
            def: boundLockDef(),
            lastStatus: "✓ Locked",
            dispatcher: dispatcher,
            favorites: InMemoryToggleFavoriteToggle()
        )
        dispatcher.push(.offline(detail: "No connection"))
        XCTAssertFalse(model.isExecuting)
        XCTAssertTrue(model.isOffline)
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.outcome, .succeeded(detail: "Locked")) // cached outcome stays
        XCTAssertFalse(model.isInteractive)
    }

    func testActivateBlockedWhileOffline() {
        let dispatcher = InMemoryToggleCommandDispatcher(autoEmits: false)
        let model = makeToggleModel(
            def: boundLockDef(),
            dispatcher: dispatcher,
            favorites: InMemoryToggleFavoriteToggle()
        )
        dispatcher.push(.offline(detail: "No connection"))
        model.activate()
        XCTAssertEqual(dispatcher.executeCount, 0)
        XCTAssertEqual(dispatcher.dialogCount, 0)
    }

    func testToggleFavoriteFlipsAndCallsSeam() {
        let favorites = InMemoryToggleFavoriteToggle(initial: false)
        let model = makeToggleModel(
            def: boundLockDef(),
            dispatcher: InMemoryToggleCommandDispatcher(),
            favorites: favorites
        )
        model.toggleFavorite()
        XCTAssertTrue(model.isFavorite)
        XCTAssertEqual(favorites.toggleCount, 1)
        XCTAssertEqual(favorites.lastCommandID, "lock")
    }

    func testFavoriteSeamIsAuthoritative() {
        let favorites = InMemoryToggleFavoriteToggle(initial: false, autoConfirms: false)
        let model = makeToggleModel(
            def: boundLockDef(),
            dispatcher: InMemoryToggleCommandDispatcher(),
            favorites: favorites
        )
        model.toggleFavorite()
        XCTAssertTrue(model.isFavorite) // optimistic flip
        favorites.confirm(false) // server rejects
        XCTAssertFalse(model.isFavorite)
    }

    func testStaleAfterFreshnessWindow() {
        let clock = ToggleCommandTileMutableClock(Date(timeIntervalSince1970: 1_000_000))
        let model = makeToggleModel(
            def: boundLockDef(),
            lastStatus: "✓ Locked",
            dispatcher: InMemoryToggleCommandDispatcher(),
            favorites: InMemoryToggleFavoriteToggle(),
            now: { clock.now() },
            stalenessWindow: 120
        )
        XCTAssertFalse(model.isStale)
        XCTAssertEqual(model.connection, .live)

        clock.current = Date(timeIntervalSince1970: 1_000_300)
        XCTAssertTrue(model.isStale)
        XCTAssertEqual(model.connection, .stale)
    }

    func testIdleTileNeverGoesStale() {
        let clock = ToggleCommandTileMutableClock(Date(timeIntervalSince1970: 1_000_000))
        let model = makeToggleModel(
            def: boundLockDef(),
            dispatcher: InMemoryToggleCommandDispatcher(),
            favorites: InMemoryToggleFavoriteToggle(),
            now: { clock.now() },
            stalenessWindow: 120
        )
        clock.current = Date(timeIntervalSince1970: 1_000_300)
        XCTAssertFalse(model.isStale)
        XCTAssertEqual(model.connection, .live)
    }

    func testStartEmitsViewOpenedOnceAndStartsStateSource() {
        let spy = SpyToggleCommandTelemetry()
        let stateSource = InMemoryToggleStateSource(initial: true)
        let model = makeToggleModel(
            def: boundLockDef(),
            dispatcher: InMemoryToggleCommandDispatcher(),
            stateSource: stateSource,
            favorites: InMemoryToggleFavoriteToggle(),
            telemetry: spy
        )
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [ToggleCommandTileSurface.slug])
        XCTAssertEqual(ToggleCommandTileSurface.slug, "ToggleCommandTile")
        XCTAssertEqual(stateSource.startCount, 1) // observing started once
        XCTAssertTrue(model.isOn) // initial bound value replayed on start
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyToggleCommandTelemetry: ToggleCommandTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

/// A settable clock so the freshness window can be crossed deterministically.
private final class ToggleCommandTileMutableClock: @unchecked Sendable {
    var current: Date
    init(_ start: Date) {
        current = start
    }

    func now() -> Date {
        current
    }
}
