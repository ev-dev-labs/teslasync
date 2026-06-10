//
//  VehicleCommandCenter.ModelTests.swift
//  TeslaSync — P4 feature view · 0261 · VehicleCommandCenter (Apple)
//
//  State-holder model + accessibility + per-state view-render coverage for the Vehicle
//  Command Center (the adapter / catalog / filter / param tests live in
//  VehicleCommandCenter.Tests.swift). Pure-logic tests use `InMemoryVehicleCommandSource`;
//  the view tests render via `ImageRenderer`.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - State holder model

@MainActor final class VehicleCommandCenterModelTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_000_000)

    private func vehicle(state: String = "online") -> VCCVehicle {
        VCCVehicle(id: 7, vin: "VIN7", displayName: "Model 3", model: "model3", state: state, updatedAt: now)
    }

    private func boundState() -> VCCVehicleState {
        VCCVehicleState(
            batteryLevel: 82,
            ratedRangeMeters: 386_243,
            insideTempCelsius: 21,
            isLocked: true,
            isCharging: false,
            isClimateOn: false,
            sentryMode: false
        )
    }

    private func update(
        connection: VCCConnection = .live,
        state: String = "online",
        commandStatus: VCCLoadStatus = .loaded,
        commands: [VCCCommandLogEntry] = []
    ) -> VCCUpdate {
        VCCUpdate(
            vehicle: vehicle(state: state),
            state: boundState(),
            latestCommands: commands,
            commandStatus: commandStatus,
            connection: connection
        )
    }

    private func makeModel(
        _ initial: VCCUpdate?,
        favorites: [String]? = nil,
        store: InMemoryVehicleCommandFavoritesStore? = nil,
        feedback: InMemoryVehicleCommandFeedback = InMemoryVehicleCommandFeedback(),
        telemetry: VehicleCommandCenterTelemetry = OSLogVehicleCommandCenterTelemetry()
    ) -> (VehicleCommandCenterModel, InMemoryVehicleCommandSource) {
        let source = InMemoryVehicleCommandSource(initial: initial)
        let favoritesStore = store ?? InMemoryVehicleCommandFavoritesStore(initial: favorites)
        let model = VehicleCommandCenterModel(
            source: source,
            favoritesStore: favoritesStore,
            feedback: feedback,
            telemetry: telemetry
        )
        return (model, source)
    }

    func testFavoritesSeedFromCatalogDefaultsWhenUnset() {
        let (model, _) = makeModel(nil)
        XCTAssertEqual(model.favorites, Set(VehicleCommandCatalog.defaultFavoriteIDs))
    }

    func testFavoritesSeedFromStore() {
        let (model, _) = makeModel(nil, favorites: ["lock"])
        XCTAssertEqual(model.favorites, ["lock"])
    }

    func testPhaseLoadingUntilFirstSnapshot() {
        let (model, _) = makeModel(nil)
        XCTAssertEqual(model.phase, .loading)
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testPhaseContentAfterSnapshot() {
        let (model, _) = makeModel(update())
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.vehicleName, "Model 3")
    }

    func testActivateActionDispatchesImmediately() {
        let (model, source) = makeModel(update())
        model.start()
        model.activate(catalog("flash_lights"))
        XCTAssertEqual(source.executed.map(\.command), ["flash_lights"])
        XCTAssertTrue(model.isExecuting(catalog("flash_lights")))
    }

    func testActivateDangerousOpensConfirmDialog() {
        let (model, source) = makeModel(update())
        model.start()
        model.activate(catalog("remote_start_drive"))
        XCTAssertEqual(model.activeDialog?.kind, .confirm)
        XCTAssertTrue(source.executed.isEmpty)
    }

    func testActivateInputOpensInputDialog() {
        let (model, _) = makeModel(update())
        model.start()
        model.activate(catalog("set_charge_limit"))
        XCTAssertEqual(model.activeDialog?.kind, .input)
    }

    func testActivateSelectOpensSelectDialog() {
        let (model, _) = makeModel(update())
        model.start()
        model.activate(catalog("set_cop_temp"))
        XCTAssertEqual(model.activeDialog?.kind, .select)
    }

    func testToggleOnSendsOffToken() {
        // is_locked == true → activating the lock toggle sends `unlock`.
        let (model, source) = makeModel(update())
        model.start()
        model.activate(catalog("lock"))
        XCTAssertEqual(source.executed.map(\.command), ["unlock"])
    }

    func testToggleOffSendsOnToken() {
        // sentry_mode == false → activating sends `sentry_on`.
        let (model, source) = makeModel(update())
        model.start()
        model.activate(catalog("sentry"))
        XCTAssertEqual(source.executed.map(\.command), ["sentry_on"])
    }

    func testToggleOffWithDialogOpensInput() {
        // valet_mode is a toggle with a PIN input; off → opens the input dialog.
        let (model, source) = makeModel(update())
        model.start()
        model.activate(catalog("valet_mode"))
        XCTAssertEqual(model.activeDialog?.kind, .input)
        XCTAssertTrue(source.executed.isEmpty)
    }

    func testSubmitInputDispatchesAssembledParams() {
        let (model, source) = makeModel(update())
        model.start()
        model.activate(catalog("set_charge_limit"))
        model.submitInput(["percent": "90"])
        XCTAssertEqual(source.executed.count, 1)
        XCTAssertEqual(source.executed.first?.command, "set_charge_limit")
        XCTAssertEqual(source.executed.first?.params.values["percent"], .string("90"))
        XCTAssertNil(model.activeDialog)
    }

    func testSubmitSelectDispatches() {
        let (model, source) = makeModel(update())
        model.start()
        model.activate(catalog("set_cop_temp"))
        model.submitSelect("1")
        XCTAssertEqual(source.executed.first?.command, "set_cop_temp")
        XCTAssertEqual(source.executed.first?.params.values["cop_temp"], .string("1"))
        XCTAssertNil(model.activeDialog)
    }

    func testConfirmDispatches() {
        let (model, source) = makeModel(update())
        model.start()
        model.activate(catalog("remote_start_drive"))
        model.confirm()
        XCTAssertEqual(source.executed.first?.command, "remote_start_drive")
        XCTAssertNil(model.activeDialog)
    }

    func testToggleFavoritePersists() {
        let store = InMemoryVehicleCommandFavoritesStore(initial: [])
        let (model, _) = makeModel(update(), store: store)
        model.start()
        model.toggleFavorite(catalog("frunk_open"))
        XCTAssertTrue(model.isFavorite(catalog("frunk_open")))
        XCTAssertEqual(store.saveCount, 1)
        model.toggleFavorite(catalog("frunk_open"))
        XCTAssertFalse(model.isFavorite(catalog("frunk_open")))
        XCTAssertEqual(store.saveCount, 2)
    }

    func testResultSetsBannerAndSuccessToast() {
        let feedback = InMemoryVehicleCommandFeedback()
        let (model, source) = makeModel(update(), feedback: feedback)
        model.start()
        source.report(VCCCommandResult(commandID: "flash_lights", success: true, message: "OK"))
        XCTAssertEqual(model.lastResult?.success, true)
        XCTAssertNil(model.executingCommandID)
        XCTAssertEqual(feedback.successes, ["Command sent to Model 3"])
    }

    func testFailureToast() {
        let feedback = InMemoryVehicleCommandFeedback()
        let (model, source) = makeModel(update(), feedback: feedback)
        model.start()
        source.report(VCCCommandResult(commandID: "flash_lights", success: false, message: "boom"))
        XCTAssertEqual(feedback.failures, ["Command failed: boom"])
    }

    func testWakeUsesSpecialCopy() {
        let feedback = InMemoryVehicleCommandFeedback()
        let (model, source) = makeModel(update(), feedback: feedback)
        model.start()
        source.report(VCCCommandResult(commandID: "wake_up", success: true, message: "OK"))
        XCTAssertEqual(feedback.successes, ["Model 3 is waking up"])
        source.report(VCCCommandResult(commandID: "wake_up", success: false, message: "timeout"))
        XCTAssertEqual(feedback.failures, ["Failed to wake Model 3: timeout"])
    }

    func testStaleAutoRefreshesOnceUntilLiveAgain() {
        let (model, source) = makeModel(update())
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(update(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(update(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(update(connection: .live))
        source.push(update(connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testSearchFilterAndNoResults() {
        let (model, _) = makeModel(update())
        model.start()
        XCTAssertNil(model.filteredCommands)
        model.search = "charge"
        XCTAssertEqual(model.filteredCommands?.isEmpty, false)
        XCTAssertFalse(model.hasNoSearchResults)
        model.search = "zzzz"
        XCTAssertTrue(model.hasNoSearchResults)
    }

    func testStatusLineAndToggleStateReads() {
        let commands = [VCCCommandLogEntry(command: "lock", status: "success", createdAt: now.addingTimeInterval(-120))]
        let (model, _) = makeModel(update(commands: commands))
        model.start()
        XCTAssertEqual(model.statusLine(for: catalog("lock"))?.hasPrefix("✓"), true)
        XCTAssertTrue(model.isOn(catalog("lock")))
        XCTAssertFalse(model.isOn(catalog("sentry")))
    }

    func testCommandStatusErrorSurfaces() {
        let (model, _) = makeModel(update(commandStatus: .failed("net down")))
        model.start()
        XCTAssertEqual(model.commandStatus, .failed("net down"))
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyVCCTelemetry()
        let (model, source) = makeModel(update(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [VehicleCommandCenterSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    private func catalog(_ id: String) -> VehicleCommand {
        guard let command = VehicleCommandCatalog.command(id: id) else {
            fatalError("missing catalog command \(id)") // parity:allow test fixture lookup, not shipped code
        }
        return command
    }
}

// MARK: - Accessibility

@MainActor final class VCCAccessibilityTests: XCTestCase {
    func testStatSpokenIncludesNameAndValue() {
        let state = VCCVehicleState(batteryLevel: 82, ratedRangeMeters: 386_243, insideTempCelsius: 21)
        let projection = VehicleCommandProjector.project(
            update: VCCUpdate(
                vehicle: VCCVehicle(
                    id: 1,
                    vin: "V",
                    displayName: "M3",
                    model: "m3",
                    state: "online",
                    updatedAt: Date()
                ),
                state: state,
                units: VCCUnitPrefs(distance: "km", temperature: "°C")
            )
        )
        XCTAssertEqual(projection.stats[0].spoken, "Battery 82%")
        XCTAssertTrue(projection.stats[1].spoken.hasPrefix("Rated range"))
        XCTAssertTrue(projection.stats[2].spoken.hasPrefix("Inside temperature"))
    }
}

// MARK: - View: per-state render smoke (every state materializes)

#if canImport(UIKit) || canImport(AppKit)
    @MainActor final class VehicleCommandCenterViewStateTests: XCTestCase {
        private func vehicle(state: String = "online") -> VCCVehicle {
            VCCVehicle(id: 1, vin: "VIN", displayName: "Model 3", model: "model3", state: state, updatedAt: Date())
        }

        private func loaded(connection: VCCConnection = .live, state: String = "online") -> VCCUpdate {
            VCCUpdate(
                vehicle: vehicle(state: state),
                state: VCCVehicleState(
                    batteryLevel: 82,
                    ratedRangeMeters: 386_243,
                    insideTempCelsius: 21,
                    isLocked: true
                ),
                latestCommands: [VCCCommandLogEntry(command: "lock", status: "success", createdAt: Date())],
                commandStatus: .loaded,
                connection: connection
            )
        }

        private func renders(_ update: VCCUpdate?, search: String = "") -> Bool {
            let source = InMemoryVehicleCommandSource(initial: update)
            let model = VehicleCommandCenterModel(source: source)
            model.start()
            model.search = search
            let renderer = ImageRenderer(content: VehicleCommandCenter(model: model).frame(width: 420, height: 800))
            #if canImport(UIKit)
                return renderer.uiImage != nil
            #else
                return renderer.nsImage != nil
            #endif
        }

        func testContentRenders() {
            XCTAssertTrue(renders(loaded()))
        }

        func testLoadingRenders() {
            XCTAssertTrue(renders(nil))
        }

        func testSearchResultsRender() {
            XCTAssertTrue(renders(loaded(), search: "charge"))
        }

        func testSearchEmptyRenders() {
            XCTAssertTrue(renders(loaded(), search: "zzzz"))
        }

        func testCommandStatusErrorRenders() {
            var update = loaded()
            update.commandStatus = .failed("net")
            XCTAssertTrue(renders(update))
        }

        func testStaleRenders() {
            XCTAssertTrue(renders(loaded(connection: .stale)))
        }

        func testOfflineAsleepRenders() {
            XCTAssertTrue(renders(loaded(connection: .offline, state: "asleep")))
        }
    }
#endif

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyVCCTelemetry: VehicleCommandCenterTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
