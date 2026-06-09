//
//  CommandQuickActionsWidget.ModelTests.swift
//  TeslaSync — P4 dashboard widget · 0030 · CommandQuickActionsWidget (Apple)
//
//  State-holder + command-dispatch coverage for the CommandQuickActionsWidget surface
//  (split from `CommandQuickActionsWidget.Tests.swift` to keep each file focused):
//    • `CommandQuickActionsModel` phase resolution across loading / empty / error /
//      content, the P1/S11 `view.opened` telemetry + source wiring, snapshot field
//      application, and stale auto-refresh.
//    • The command-dispatch lifecycle (web `useVehicleCommand` `activeCommand` +
//      `mutation` + `onSettled`): in-flight running state, settle, success/failure
//      outcome, the no-vehicle guard, and the re-entrancy guard.
//
//  These run in the TeslaSync(/-macOS) XCTest targets, driven by the bundle-free
//  `InMemoryCommandQuickActionsSource` — no network, no real store.
//

import XCTest
@testable import TeslaSync

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class CommandQuickActionsModelTests: XCTestCase {
    private func makeModel(
        _ update: CommandQuickActionsUpdate,
        telemetry: CommandQuickActionsTelemetry = OSLogCommandQuickActionsTelemetry()
    ) -> (CommandQuickActionsModel, InMemoryCommandQuickActionsSource) {
        let source = InMemoryCommandQuickActionsSource(initial: update)
        let model = CommandQuickActionsModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testHasVehiclePredicate() {
        XCTAssertFalse(CommandQuickActionsModel.hasVehicle(nil))
        XCTAssertFalse(CommandQuickActionsModel.hasVehicle(0))
        XCTAssertTrue(CommandQuickActionsModel.hasVehicle(1))
        XCTAssertTrue(CommandQuickActionsModel.hasVehicle(42))
    }

    func testLoadingWithoutVehicleShowsLoading() {
        let (model, _) = makeModel(CommandQuickActionsUpdate(status: .loading, vehicleID: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithVehicleShowsContent() {
        let (model, _) = makeModel(CommandQuickActionsUpdate(status: .loaded, vehicleID: 7))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.vehicleID, 7)
        XCTAssertTrue(model.hasVehicle)
    }

    func testLoadedWithoutVehicleShowsEmpty() {
        let (model, _) = makeModel(CommandQuickActionsUpdate(status: .loaded, vehicleID: 0))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertFalse(model.hasVehicle)
    }

    func testFailedWithoutVehicleShowsError() {
        let (model, _) = makeModel(CommandQuickActionsUpdate(status: .failed("boom"), vehicleID: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testCachedVehicleKeepsContentWhileLoadingOrFailed() {
        let (loading, _) = makeModel(CommandQuickActionsUpdate(status: .loading, vehicleID: 7))
        loading.start()
        XCTAssertEqual(loading.phase, .content)

        let (failed, _) = makeModel(CommandQuickActionsUpdate(status: .failed("net"), vehicleID: 7))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testPhaseResolutionMatrix() {
        XCTAssertEqual(CommandQuickActionsModel.resolvePhase(status: .loading, hasVehicle: false), .loading)
        XCTAssertEqual(CommandQuickActionsModel.resolvePhase(status: .loading, hasVehicle: true), .content)
        XCTAssertEqual(CommandQuickActionsModel.resolvePhase(status: .empty, hasVehicle: false), .empty)
        XCTAssertEqual(CommandQuickActionsModel.resolvePhase(status: .loaded, hasVehicle: false), .empty)
        XCTAssertEqual(CommandQuickActionsModel.resolvePhase(status: .loaded, hasVehicle: true), .content)
        XCTAssertEqual(CommandQuickActionsModel.resolvePhase(status: .failed("x"), hasVehicle: false), .error("x"))
        XCTAssertEqual(CommandQuickActionsModel.resolvePhase(status: .failed("x"), hasVehicle: true), .content)
    }

    func testSnapshotFieldsAreApplied() {
        let when = Date(timeIntervalSince1970: 1_700_000_000)
        let (model, _) = makeModel(CommandQuickActionsUpdate(
            status: .loaded, connection: .offline, isFetching: true, vehicleID: 9, updatedAt: when
        ))
        model.start()
        XCTAssertEqual(model.connection, .offline)
        XCTAssertTrue(model.isFetching)
        XCTAssertEqual(model.vehicleID, 9)
        XCTAssertEqual(model.updatedAt, when)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyCommandQuickActionsTelemetry()
        let (model, source) = makeModel(CommandQuickActionsUpdate(status: .loading, vehicleID: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [CommandQuickActionsWidget.surfaceSlug])
        XCTAssertEqual(spy.surfaces, ["CommandQuickActionsWidget"])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(CommandQuickActionsUpdate(status: .loaded, vehicleID: 7))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testAutoRefreshOnlyWhenStaleAndNotFetching() {
        let (stale, staleSource) = makeModel(
            CommandQuickActionsUpdate(status: .loaded, connection: .stale, isFetching: false, vehicleID: 7)
        )
        stale.start()
        stale.autoRefreshIfStale()
        XCTAssertEqual(staleSource.refreshCount, 1)

        let (live, liveSource) = makeModel(
            CommandQuickActionsUpdate(status: .loaded, connection: .live, vehicleID: 7)
        )
        live.start()
        live.autoRefreshIfStale()
        XCTAssertEqual(liveSource.refreshCount, 0)

        let (fetching, fetchingSource) = makeModel(
            CommandQuickActionsUpdate(status: .loaded, connection: .stale, isFetching: true, vehicleID: 7)
        )
        fetching.start()
        fetching.autoRefreshIfStale()
        XCTAssertEqual(fetchingSource.refreshCount, 0)
    }
}

// MARK: - State holder: command-dispatch lifecycle (web useVehicleCommand)

@MainActor final class CommandQuickActionsDispatchTests: XCTestCase {
    func testDispatchSendsResolvedVehicleAndCommandThenSettles() async {
        let source = InMemoryCommandQuickActionsSource(
            initial: CommandQuickActionsUpdate(status: .loaded, vehicleID: 7),
            result: CommandDispatchResult(success: true, message: "Locked")
        )
        let model = CommandQuickActionsModel(source: source)
        model.start()

        await model.dispatch("lock")

        XCTAssertEqual(source.sent.count, 1)
        XCTAssertEqual(source.sent.first?.vehicleID, 7)
        XCTAssertEqual(source.sent.first?.command, "lock")
        XCTAssertNil(model.activeCommand) // cleared on settle (web onSettled)
        XCTAssertFalse(model.isDispatching)
        XCTAssertEqual(model.lastOutcome, CommandDispatchOutcome(command: "lock", success: true, message: "Locked"))
    }

    func testDispatchMarksCommandRunningWhileInFlight() async {
        let source = InMemoryCommandQuickActionsSource(
            initial: CommandQuickActionsUpdate(status: .loaded, vehicleID: 7),
            result: CommandDispatchResult(success: true, message: "ok"),
            dispatchDelay: .milliseconds(20)
        )
        let model = CommandQuickActionsModel(source: source)
        model.start()

        var activeDuringSend: String?
        var dispatchingDuringSend = false
        var runningFlagDuringSend = false
        source.onSendStarted = { [weak model] in
            activeDuringSend = model?.activeCommand
            dispatchingDuringSend = model?.isDispatching ?? false
            runningFlagDuringSend = model?.isRunning("actuate_frunk") ?? false
        }

        await model.dispatch("actuate_frunk")

        XCTAssertEqual(activeDuringSend, "actuate_frunk")
        XCTAssertTrue(dispatchingDuringSend)
        XCTAssertTrue(runningFlagDuringSend)
        XCTAssertNil(model.activeCommand)
        XCTAssertFalse(model.isRunning("actuate_frunk"))
    }

    func testDispatchFailureRecordsFailureOutcome() async {
        let source = InMemoryCommandQuickActionsSource(
            initial: CommandQuickActionsUpdate(status: .loaded, vehicleID: 7),
            result: CommandDispatchResult(success: false, message: "")
        )
        let model = CommandQuickActionsModel(source: source)
        model.start()

        await model.dispatch("honk_horn")

        XCTAssertEqual(model.lastOutcome?.success, false)
        XCTAssertEqual(model.lastOutcome?.message, "Command failed")
    }

    func testDispatchWithoutVehicleSendsNothing() async {
        let source = InMemoryCommandQuickActionsSource(
            initial: CommandQuickActionsUpdate(status: .loaded, vehicleID: 0)
        )
        let model = CommandQuickActionsModel(source: source)
        model.start()

        await model.dispatch("lock")

        XCTAssertTrue(source.sent.isEmpty)
        XCTAssertNil(model.activeCommand)
        XCTAssertNil(model.lastOutcome)
    }

    func testDispatchIgnoresSecondCommandWhileInFlight() async {
        let source = InMemoryCommandQuickActionsSource(
            initial: CommandQuickActionsUpdate(status: .loaded, vehicleID: 7),
            dispatchDelay: .milliseconds(40)
        )
        let model = CommandQuickActionsModel(source: source)
        model.start()

        async let first: Void = model.dispatch("lock")
        // Let the first dispatch set activeCommand + enter `send` before the second.
        try? await Task.sleep(for: .milliseconds(5))
        await model.dispatch("unlock") // ignored: a command is already in flight
        await first

        XCTAssertEqual(source.sent.map(\.command), ["lock"])
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyCommandQuickActionsTelemetry: CommandQuickActionsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
