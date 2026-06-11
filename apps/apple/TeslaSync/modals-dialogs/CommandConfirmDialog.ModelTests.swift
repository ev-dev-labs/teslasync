//
//  CommandConfirmDialog.ModelTests.swift
//  TeslaSync — P4 modal / dialog · 0029 · CommandConfirmDialog (Apple)
//
//  State-holder coverage for `CommandConfirmModel`, split across two classes for the lint body budget:
//  `CommandConfirmModelTests` covers the `view.opened` telemetry, the body-phase / visibility machine
//  (request presents, none hides, pinned suppresses, inline error), the typed-confirmation gate, the
//  countdown lifecycle (ticker start / decrement / stop, gate opening at zero, no ticker when zero),
//  the form reset on a new command (and the freshness-only no-reset), and the stale / offline
//  freshness arms; `CommandConfirmModelCommandTests` covers the confirm command (countdown / typed /
//  busy guards, in-flight `submitting` + re-entrancy + delegation) and cancel / dismiss. Driven
//  through the in-memory source + a manual ticker — no network, no wall-clock waits.
//

import XCTest
@testable import TeslaSync

// MARK: - Test doubles

/// Records the `view.opened` surfaces. Lock-guarded for the `Sendable` telemetry seam.
private final class SpyCommandConfirmTelemetry: CommandConfirmTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    func viewOpened(surface: String) {
        lock.withLock { storage.append(surface) }
    }

    var surfaces: [String] {
        lock.withLock { storage }
    }
}

/// Records confirm / cancel calls, completing `confirm()` immediately.
private final class RecordingCommandConfirmController: CommandConfirmController, @unchecked Sendable {
    private let lock = NSLock()
    private var confirms = 0
    private var cancels = 0

    func confirm() async {
        lock.withLock { confirms += 1 }
    }

    func cancel() {
        lock.withLock { cancels += 1 }
    }

    var confirmCount: Int {
        lock.withLock { confirms }
    }

    var cancelCount: Int {
        lock.withLock { cancels }
    }
}

/// A `confirm()` that suspends on a gate so the in-flight `submitting` flag can be observed mid-call.
private final class GatedCommandConfirmController: CommandConfirmController, @unchecked Sendable {
    private let lock = NSLock()
    private var confirms = 0
    private var continuation: CheckedContinuation<Void, Never>?

    func confirm() async {
        lock.withLock { confirms += 1 }
        await withCheckedContinuation { cont in
            lock.withLock { continuation = cont }
        }
    }

    func cancel() {}

    /// Resumes a suspended `confirm()`.
    func release() {
        let cont = lock.withLock { () -> CheckedContinuation<Void, Never>? in
            let pending = continuation
            continuation = nil
            return pending
        }
        cont?.resume()
    }

    var confirmCount: Int {
        lock.withLock { confirms }
    }
}

// MARK: - Fixtures (file-private so both test classes share them)

@MainActor
private func makeCommandModel(
    source: InMemoryCommandConfirmSource,
    pinned: Bool = false,
    telemetry: SpyCommandConfirmTelemetry = SpyCommandConfirmTelemetry(),
    controller: any CommandConfirmController = RecordingCommandConfirmController(),
    ticker: ManualCommandConfirmTicker = ManualCommandConfirmTicker()
) -> CommandConfirmModel {
    CommandConfirmModel(
        source: source,
        pinned: pinned,
        telemetry: telemetry,
        controller: controller,
        ticker: ticker,
        localize: { _, fallback in fallback }
    )
}

private func plainRequest(loading: Bool = false) -> CommandConfirmRequest {
    CommandConfirmRequest(commandID: "lock", title: "Lock?", message: "Doors lock.", loading: loading)
}

private func countdownRequest(id: String = "remote-start", countdown: Int = 3) -> CommandConfirmRequest {
    CommandConfirmRequest(commandID: id, title: "Start?", message: "Runs climate.", countdown: countdown)
}

private func typedRequest() -> CommandConfirmRequest {
    CommandConfirmRequest(commandID: "erase", title: "Erase?", message: "Erases all.", confirmInput: "ERASE")
}

private func loadedUpdate(
    _ request: CommandConfirmRequest?,
    connection: CommandConfirmConnection = .live
) -> CommandConfirmUpdate {
    CommandConfirmUpdate(status: .loaded, request: request, connection: connection)
}

// MARK: - Telemetry / phases / visibility / typed gate / countdown / reset / freshness

@MainActor
final class CommandConfirmModelTests: XCTestCase {
    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyCommandConfirmTelemetry()
        let source = InMemoryCommandConfirmSource()
        let model = makeCommandModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["CommandConfirmDialog"])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRequestPresentsContent() {
        let source = InMemoryCommandConfirmSource(initial: loadedUpdate(plainRequest()))
        let model = makeCommandModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.visibility, .presented)
        XCTAssertEqual(model.messageText, "Doors lock.")
    }

    func testNoRequestHidesWhenNotPinned() {
        let source = InMemoryCommandConfirmSource(initial: loadedUpdate(nil))
        let model = makeCommandModel(source: source)
        model.start()
        XCTAssertEqual(model.visibility, .hidden)
        XCTAssertEqual(model.phase, .empty)
    }

    func testLoadingThenContent() {
        let source = InMemoryCommandConfirmSource(initial: CommandConfirmUpdate(status: .loading))
        let model = makeCommandModel(source: source, pinned: true)
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(loadedUpdate(plainRequest()))
        XCTAssertEqual(model.phase, .content)
    }

    func testLoadedNoRequestResolvesEmpty() {
        let source = InMemoryCommandConfirmSource(initial: loadedUpdate(nil))
        let model = makeCommandModel(source: source, pinned: true)
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.visibility, .presented)
    }

    func testFailedNoRequestResolvesError() {
        let source = InMemoryCommandConfirmSource(
            initial: CommandConfirmUpdate(status: .failed("timeout"), request: nil)
        )
        let model = makeCommandModel(source: source, pinned: true)
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
        XCTAssertNil(model.inlineErrorMessage)
    }

    func testFailedWithRequestKeepsContentAndSurfacesInlineError() {
        let source = InMemoryCommandConfirmSource(initial: loadedUpdate(plainRequest()))
        let model = makeCommandModel(source: source)
        model.start()
        source.push(CommandConfirmUpdate(status: .failed("stale read"), request: plainRequest()))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.inlineErrorMessage, "stale read")
    }

    func testTypedGateDisablesConfirmUntilCaseInsensitiveMatch() {
        let source = InMemoryCommandConfirmSource(initial: loadedUpdate(typedRequest()))
        let model = makeCommandModel(source: source)
        model.start()
        XCTAssertTrue(model.showsTypedInput)
        XCTAssertTrue(model.confirmDisabled)
        model.typed = "eras"
        XCTAssertTrue(model.confirmDisabled)
        model.typed = "  erase \n"
        XCTAssertFalse(model.confirmDisabled)
    }

    func testCountdownStartsTickerDecrementsAndOpensGate() {
        let ticker = ManualCommandConfirmTicker()
        let source = InMemoryCommandConfirmSource(initial: loadedUpdate(countdownRequest(countdown: 3)))
        let model = makeCommandModel(source: source, ticker: ticker)
        model.start()
        XCTAssertEqual(model.remaining, 3)
        XCTAssertTrue(model.countdownActive)
        XCTAssertTrue(model.confirmDisabled)
        XCTAssertEqual(ticker.startCount, 1)
        XCTAssertTrue(ticker.isRunning)

        ticker.fire()
        ticker.fire()
        XCTAssertEqual(model.remaining, 1)
        XCTAssertTrue(model.confirmDisabled)

        ticker.fire()
        XCTAssertEqual(model.remaining, 0)
        XCTAssertFalse(model.countdownActive)
        XCTAssertFalse(model.confirmDisabled)
        XCTAssertFalse(ticker.isRunning)
    }

    func testNoCountdownDoesNotStartTicker() {
        let ticker = ManualCommandConfirmTicker()
        let source = InMemoryCommandConfirmSource(initial: loadedUpdate(plainRequest()))
        let model = makeCommandModel(source: source, ticker: ticker)
        model.start()
        XCTAssertEqual(model.remaining, 0)
        XCTAssertEqual(ticker.startCount, 0)
        XCTAssertFalse(model.confirmDisabled)
    }

    func testNewCommandResetsTypedAndRestartsCountdown() {
        let ticker = ManualCommandConfirmTicker()
        let source = InMemoryCommandConfirmSource(initial: loadedUpdate(countdownRequest(id: "a", countdown: 3)))
        let model = makeCommandModel(source: source, ticker: ticker)
        model.start()
        model.typed = "draft"
        source.push(loadedUpdate(countdownRequest(id: "b", countdown: 2)))
        XCTAssertEqual(model.typed, "")
        XCTAssertEqual(model.remaining, 2)
        XCTAssertEqual(ticker.startCount, 2)
    }

    func testFreshnessOnlyUpdateDoesNotResetForm() {
        let request = typedRequest()
        let source = InMemoryCommandConfirmSource(initial: loadedUpdate(request))
        let model = makeCommandModel(source: source)
        model.start()
        model.typed = "ERA"
        source.push(loadedUpdate(request, connection: .offline))
        XCTAssertEqual(model.typed, "ERA")
    }

    func testStaleAutoRefreshesOnceThenReArms() {
        let source = InMemoryCommandConfirmSource(initial: loadedUpdate(plainRequest()))
        let model = makeCommandModel(source: source)
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(loadedUpdate(plainRequest(), connection: .stale))
        source.push(loadedUpdate(plainRequest(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(loadedUpdate(plainRequest(), connection: .live))
        source.push(loadedUpdate(plainRequest(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsContentAndDoesNotRefresh() {
        let source = InMemoryCommandConfirmSource(initial: loadedUpdate(plainRequest()))
        let model = makeCommandModel(source: source)
        model.start()
        source.push(loadedUpdate(plainRequest(), connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testStopHaltsTicker() {
        let ticker = ManualCommandConfirmTicker()
        let source = InMemoryCommandConfirmSource(initial: loadedUpdate(countdownRequest(countdown: 5)))
        let model = makeCommandModel(source: source, ticker: ticker)
        model.start()
        XCTAssertTrue(ticker.isRunning)
        model.stop()
        XCTAssertFalse(ticker.isRunning)
        XCTAssertEqual(source.stopCount, 1)
    }
}

// MARK: - Confirm / cancel / dismiss commands

@MainActor
final class CommandConfirmModelCommandTests: XCTestCase {
    func testConfirmIsGuardedByCountdown() async {
        let ticker = ManualCommandConfirmTicker()
        let controller = RecordingCommandConfirmController()
        let source = InMemoryCommandConfirmSource(initial: loadedUpdate(countdownRequest(countdown: 2)))
        let model = makeCommandModel(source: source, controller: controller, ticker: ticker)
        model.start()
        await model.confirm()
        XCTAssertEqual(controller.confirmCount, 0)
        ticker.fire()
        ticker.fire()
        await model.confirm()
        XCTAssertEqual(controller.confirmCount, 1)
    }

    func testConfirmIsGuardedByTypedGate() async {
        let controller = RecordingCommandConfirmController()
        let source = InMemoryCommandConfirmSource(initial: loadedUpdate(typedRequest()))
        let model = makeCommandModel(source: source, controller: controller)
        model.start()
        await model.confirm()
        XCTAssertEqual(controller.confirmCount, 0)
        model.typed = "ERASE"
        await model.confirm()
        XCTAssertEqual(controller.confirmCount, 1)
    }

    func testConfirmIsGuardedByBusyLoadingProp() async {
        let controller = RecordingCommandConfirmController()
        let source = InMemoryCommandConfirmSource(initial: loadedUpdate(plainRequest(loading: true)))
        let model = makeCommandModel(source: source, controller: controller)
        model.start()
        XCTAssertTrue(model.isBusy)
        await model.confirm()
        XCTAssertEqual(controller.confirmCount, 0)
    }

    func testConfirmTogglesSubmittingFlagAndDelegates() async {
        let controller = GatedCommandConfirmController()
        let source = InMemoryCommandConfirmSource(initial: loadedUpdate(plainRequest()))
        let model = makeCommandModel(source: source, controller: controller)
        model.start()
        XCTAssertFalse(model.submitting)

        let task = Task { await model.confirm() }
        await Task.yield()
        XCTAssertTrue(model.submitting)
        XCTAssertEqual(controller.confirmCount, 1)

        // A second tap while in flight is a no-op (re-entrancy guard).
        await model.confirm()
        XCTAssertEqual(controller.confirmCount, 1)

        controller.release()
        await task.value
        XCTAssertFalse(model.submitting)
    }

    func testConfirmSettlesWithImmediateController() async {
        let controller = RecordingCommandConfirmController()
        let source = InMemoryCommandConfirmSource(initial: loadedUpdate(plainRequest()))
        let model = makeCommandModel(source: source, controller: controller)
        model.start()
        await model.confirm()
        XCTAssertEqual(controller.confirmCount, 1)
        XCTAssertFalse(model.submitting)
    }

    func testCancelDelegates() {
        let controller = RecordingCommandConfirmController()
        let source = InMemoryCommandConfirmSource(initial: loadedUpdate(plainRequest()))
        let model = makeCommandModel(source: source, controller: controller)
        model.start()
        model.cancel()
        XCTAssertEqual(controller.cancelCount, 1)
    }

    func testDismissDelegatesEvenWhenBusy() {
        // Web routes Escape / close to onClose unconditionally — not gated by the loading prop.
        let controller = RecordingCommandConfirmController()
        let source = InMemoryCommandConfirmSource(initial: loadedUpdate(plainRequest(loading: true)))
        let model = makeCommandModel(source: source, controller: controller)
        model.start()
        model.dismiss()
        XCTAssertEqual(controller.cancelCount, 1)
    }
}
