//
//  ConfirmDialog.ModelTests.swift
//  TeslaSync — P4 modal / dialog · 0012 · ConfirmDialog (Apple)
//
//  State-holder coverage for `ConfirmDialogModel`, split across two classes for the lint body
//  budget: `ConfirmDialogModelTests` covers the `view.opened` telemetry, the body-phase / visibility
//  machine (request presents, none hides, pinned suppresses), the typed-confirmation gate, the form
//  reset on a new request (and the freshness-only no-reset), and the stale / offline freshness arms;
//  `ConfirmDialogModelCommandTests` covers the confirm command (in-flight `submitting` + delegation +
//  re-entrancy / typed / busy guards), the silence persistence (checked → once, unchecked / danger →
//  never), the silenced auto-resolve, and cancel / dismiss. Driven through the in-memory source — no
//  network.
//

import XCTest
@testable import TeslaSync

// MARK: - Test doubles

/// Records the `view.opened` surfaces. Lock-guarded for the `Sendable` telemetry seam.
private final class SpyConfirmDialogTelemetry: ConfirmDialogTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    func viewOpened(surface: String) {
        lock.lock()
        storage.append(surface)
        lock.unlock()
    }

    var surfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }
}

/// Records confirm / cancel calls, completing `confirm()` immediately. An optional hook fires after
/// each confirm so a test can await the silence auto-resolve.
private final class RecordingConfirmDialogController: ConfirmDialogController, @unchecked Sendable {
    private let lock = NSLock()
    private var confirms = 0
    private var cancels = 0
    var onConfirm: (@Sendable () -> Void)?

    func confirm() async {
        lock.withLock { confirms += 1 }
        onConfirm?()
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
private final class GatedConfirmDialogController: ConfirmDialogController, @unchecked Sendable {
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
private func makeConfirmModel(
    source: InMemoryConfirmDialogSource,
    pinned: Bool = false,
    telemetry: SpyConfirmDialogTelemetry = SpyConfirmDialogTelemetry(),
    controller: any ConfirmDialogController = RecordingConfirmDialogController(),
    store: InMemoryConfirmDialogSilenceStore = InMemoryConfirmDialogSilenceStore()
) -> ConfirmDialogModel {
    ConfirmDialogModel(
        source: source,
        pinned: pinned,
        telemetry: telemetry,
        controller: controller,
        silenceStore: store,
        localize: { _, fallback in fallback }
    )
}

private func dangerRequest(loading: Bool = false) -> ConfirmRequest {
    ConfirmRequest(title: "Delete vehicle?", message: "Permanent.", variant: .danger, loading: loading)
}

private func warningRequest(silenceKey: String? = "reset-dashboard") -> ConfirmRequest {
    ConfirmRequest(title: "Reset?", message: "Defaults.", variant: .warning, silenceKey: silenceKey)
}

private func typedRequest() -> ConfirmRequest {
    ConfirmRequest(title: "Wipe?", message: "Erases all.", variant: .danger, requireTypedConfirmation: "DELETE")
}

private func loadedUpdate(
    _ request: ConfirmRequest?,
    connection: ConfirmConnection = .live
) -> ConfirmDialogUpdate {
    ConfirmDialogUpdate(status: .loaded, request: request, connection: connection)
}

// MARK: - Telemetry / phases / visibility / typed gate / freshness / reset

@MainActor
final class ConfirmDialogModelTests: XCTestCase {
    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyConfirmDialogTelemetry()
        let source = InMemoryConfirmDialogSource()
        let model = makeConfirmModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["ConfirmDialog"])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRequestPresentsContent() {
        let source = InMemoryConfirmDialogSource(initial: loadedUpdate(dangerRequest()))
        let model = makeConfirmModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.visibility, .presented)
        XCTAssertEqual(model.severity, .critical)
    }

    func testNoRequestHidesWhenNotPinned() {
        let source = InMemoryConfirmDialogSource(initial: loadedUpdate(nil))
        let model = makeConfirmModel(source: source)
        model.start()
        XCTAssertEqual(model.visibility, .hidden)
        XCTAssertEqual(model.phase, .empty)
    }

    func testLoadingThenContent() {
        let source = InMemoryConfirmDialogSource(initial: ConfirmDialogUpdate(status: .loading))
        let model = makeConfirmModel(source: source, pinned: true)
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(loadedUpdate(dangerRequest()))
        XCTAssertEqual(model.phase, .content)
    }

    func testLoadedNoRequestResolvesEmpty() {
        let source = InMemoryConfirmDialogSource(initial: loadedUpdate(nil))
        let model = makeConfirmModel(source: source, pinned: true)
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.visibility, .presented)
    }

    func testFailedNoRequestResolvesError() {
        let source = InMemoryConfirmDialogSource(
            initial: ConfirmDialogUpdate(status: .failed("timeout"), request: nil)
        )
        let model = makeConfirmModel(source: source, pinned: true)
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
        XCTAssertNil(model.inlineErrorMessage)
    }

    func testFailedWithRequestKeepsContentAndSurfacesInlineError() {
        let source = InMemoryConfirmDialogSource(initial: loadedUpdate(dangerRequest()))
        let model = makeConfirmModel(source: source)
        model.start()
        source.push(ConfirmDialogUpdate(status: .failed("stale read"), request: dangerRequest()))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.inlineErrorMessage, "stale read")
    }

    func testTypedGateDisablesConfirmUntilExactMatch() {
        let source = InMemoryConfirmDialogSource(initial: loadedUpdate(typedRequest()))
        let model = makeConfirmModel(source: source)
        model.start()
        XCTAssertTrue(model.showsTypedInput)
        XCTAssertTrue(model.confirmDisabled)
        model.typed = "delete"
        XCTAssertTrue(model.confirmDisabled)
        model.typed = "DELETE"
        XCTAssertFalse(model.confirmDisabled)
    }

    func testNewRequestResetsTypedAndDontAskAgain() {
        let source = InMemoryConfirmDialogSource(initial: loadedUpdate(typedRequest()))
        let model = makeConfirmModel(source: source)
        model.start()
        model.typed = "DELETE"
        model.dontAskAgain = true
        source.push(loadedUpdate(warningRequest(silenceKey: "other")))
        XCTAssertEqual(model.typed, "")
        XCTAssertFalse(model.dontAskAgain)
    }

    func testFreshnessOnlyUpdateDoesNotResetTyped() {
        let request = typedRequest()
        let source = InMemoryConfirmDialogSource(initial: loadedUpdate(request))
        let model = makeConfirmModel(source: source)
        model.start()
        model.typed = "DELE"
        source.push(loadedUpdate(request, connection: .offline))
        XCTAssertEqual(model.typed, "DELE")
    }

    func testStaleAutoRefreshesOnceThenReArms() {
        let source = InMemoryConfirmDialogSource(initial: loadedUpdate(dangerRequest()))
        let model = makeConfirmModel(source: source)
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(loadedUpdate(dangerRequest(), connection: .stale))
        source.push(loadedUpdate(dangerRequest(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(loadedUpdate(dangerRequest(), connection: .live))
        source.push(loadedUpdate(dangerRequest(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsContentAndDoesNotRefresh() {
        let source = InMemoryConfirmDialogSource(initial: loadedUpdate(dangerRequest()))
        let model = makeConfirmModel(source: source)
        model.start()
        source.push(loadedUpdate(dangerRequest(), connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.visibility, .presented)
        XCTAssertEqual(source.refreshCount, 0)
    }
}

// MARK: - Confirm / silence / cancel / dismiss commands

@MainActor
final class ConfirmDialogModelCommandTests: XCTestCase {
    func testConfirmIsGuardedByTypedGate() async {
        let controller = RecordingConfirmDialogController()
        let source = InMemoryConfirmDialogSource(initial: loadedUpdate(typedRequest()))
        let model = makeConfirmModel(source: source, controller: controller)
        model.start()
        await model.confirm()
        XCTAssertEqual(controller.confirmCount, 0)
        model.typed = "DELETE"
        await model.confirm()
        XCTAssertEqual(controller.confirmCount, 1)
    }

    func testConfirmIsGuardedByBusyLoadingProp() async {
        let controller = RecordingConfirmDialogController()
        let source = InMemoryConfirmDialogSource(initial: loadedUpdate(dangerRequest(loading: true)))
        let model = makeConfirmModel(source: source, controller: controller)
        model.start()
        XCTAssertTrue(model.isBusy)
        await model.confirm()
        XCTAssertEqual(controller.confirmCount, 0)
    }

    func testConfirmTogglesSubmittingFlagAndDelegates() async {
        let controller = GatedConfirmDialogController()
        let source = InMemoryConfirmDialogSource(initial: loadedUpdate(dangerRequest()))
        let model = makeConfirmModel(source: source, controller: controller)
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
        let controller = RecordingConfirmDialogController()
        let source = InMemoryConfirmDialogSource(initial: loadedUpdate(dangerRequest()))
        let model = makeConfirmModel(source: source, controller: controller)
        model.start()
        await model.confirm()
        XCTAssertEqual(controller.confirmCount, 1)
        XCTAssertFalse(model.submitting)
    }

    func testConfirmPersistsSilenceWhenChecked() async {
        let controller = RecordingConfirmDialogController()
        let store = InMemoryConfirmDialogSilenceStore()
        let source = InMemoryConfirmDialogSource(initial: loadedUpdate(warningRequest()))
        let model = makeConfirmModel(source: source, controller: controller, store: store)
        model.start()
        XCTAssertTrue(model.showsSilenceToggle)
        model.dontAskAgain = true
        await model.confirm()
        XCTAssertEqual(store.silenceCalls, ["reset-dashboard"])
        XCTAssertEqual(controller.confirmCount, 1)
    }

    func testConfirmDoesNotPersistSilenceWhenUnchecked() async {
        let store = InMemoryConfirmDialogSilenceStore()
        let source = InMemoryConfirmDialogSource(initial: loadedUpdate(warningRequest()))
        let model = makeConfirmModel(source: source, store: store)
        model.start()
        await model.confirm()
        XCTAssertTrue(store.silenceCalls.isEmpty)
    }

    func testDangerNeverSilencesEvenWhenForced() async {
        let store = InMemoryConfirmDialogSilenceStore()
        let request = ConfirmRequest(
            title: "Delete?", message: "Permanent.", variant: .danger, silenceKey: "delete-vehicle"
        )
        let source = InMemoryConfirmDialogSource(initial: loadedUpdate(request))
        let model = makeConfirmModel(source: source, store: store)
        model.start()
        XCTAssertFalse(model.showsSilenceToggle)
        model.dontAskAgain = true
        await model.confirm()
        XCTAssertTrue(store.silenceCalls.isEmpty)
    }

    func testSilencedActionAutoResolvesAndHides() async {
        let controller = RecordingConfirmDialogController()
        let store = InMemoryConfirmDialogSilenceStore(silenced: ["reset-dashboard"])
        let confirmed = expectation(description: "auto-confirm fired")
        controller.onConfirm = { confirmed.fulfill() }
        let source = InMemoryConfirmDialogSource(initial: loadedUpdate(warningRequest()))
        let model = makeConfirmModel(source: source, controller: controller, store: store)
        model.start()
        XCTAssertEqual(model.visibility, .hidden)
        await fulfillment(of: [confirmed], timeout: 1)
        XCTAssertEqual(controller.confirmCount, 1)
    }

    func testCancelDelegates() {
        let controller = RecordingConfirmDialogController()
        let source = InMemoryConfirmDialogSource(initial: loadedUpdate(dangerRequest()))
        let model = makeConfirmModel(source: source, controller: controller)
        model.start()
        model.cancel()
        XCTAssertEqual(controller.cancelCount, 1)
    }

    func testDismissCancelsWhenIdleButIsSwallowedWhenBusy() {
        let idleController = RecordingConfirmDialogController()
        let idleModel = makeConfirmModel(
            source: InMemoryConfirmDialogSource(initial: loadedUpdate(dangerRequest())),
            controller: idleController
        )
        idleModel.start()
        idleModel.dismiss()
        XCTAssertEqual(idleController.cancelCount, 1)

        let busyController = RecordingConfirmDialogController()
        let busyModel = makeConfirmModel(
            source: InMemoryConfirmDialogSource(initial: loadedUpdate(dangerRequest(loading: true))),
            controller: busyController
        )
        busyModel.start()
        busyModel.dismiss()
        XCTAssertEqual(busyController.cancelCount, 0)
    }
}
