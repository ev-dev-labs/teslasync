//
//  AiConfirmDialog.ModelTests.swift
//  TeslaSync — P4 modal / dialog · 0001 · ConfirmDialog (Apple)
//
//  State-holder coverage for `AiConfirmModel`: the `view.opened` telemetry, the body-phase / visibility
//  machine (request presents, none hides, pinned suppresses, inline error), the intro selection by
//  `tool.mutates`, the argument projection (cached request → pretty-printed JSON), the busy gates (the
//  parent `loading` prop disables both buttons), the approve command (busy guard, in-flight
//  `submitting` + re-entrancy + delegation), cancel / dismiss (gated by busy, as the web disables
//  Cancel + no-ops the close while loading), and the stale / offline freshness arms. Driven through the
//  in-memory source — no network, no wall-clock waits.
//

import XCTest
@testable import TeslaSync

// MARK: - Test doubles

/// Records the `view.opened` surfaces. Lock-guarded for the `Sendable` telemetry seam.
private final class SpyAiConfirmTelemetry: AiConfirmTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    func viewOpened(surface: String) {
        lock.withLock { storage.append(surface) }
    }

    var surfaces: [String] {
        lock.withLock { storage }
    }
}

/// Records approve / cancel calls, completing `confirm()` immediately.
private final class RecordingAiConfirmController: AiConfirmController, @unchecked Sendable {
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

/// An `confirm()` that suspends on a gate so the in-flight `submitting` flag can be observed mid-call.
private final class GatedAiConfirmController: AiConfirmController, @unchecked Sendable {
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
private func makeModel(
    source: InMemoryAiConfirmSource,
    pinned: Bool = false,
    telemetry: SpyAiConfirmTelemetry = SpyAiConfirmTelemetry(),
    controller: any AiConfirmController = RecordingAiConfirmController()
) -> AiConfirmModel {
    AiConfirmModel(
        source: source,
        pinned: pinned,
        telemetry: telemetry,
        controller: controller,
        localize: { _, fallback in fallback }
    )
}

private func readRequest(loading: Bool = false) -> AiConfirmRequest {
    AiConfirmRequest(
        tool: AiToolPreview(name: "get_state", description: "Reads state.", mutates: false),
        arguments: [AiJSONMember("vehicle_id", .integer(7))],
        loading: loading
    )
}

private func mutatingRequest() -> AiConfirmRequest {
    AiConfirmRequest(
        tool: AiToolPreview(name: "set_limit", mutates: true),
        arguments: [AiJSONMember("limit", .integer(80))]
    )
}

private func loadedUpdate(
    _ request: AiConfirmRequest?,
    connection: AiConfirmConnection = .live
) -> AiConfirmUpdate {
    AiConfirmUpdate(status: .loaded, request: request, connection: connection)
}

// MARK: - Telemetry / phases / visibility / copy / freshness

@MainActor
final class AiConfirmModelTests: XCTestCase {
    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyAiConfirmTelemetry()
        let source = InMemoryAiConfirmSource()
        let model = makeModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["AiConfirmDialog"])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRequestPresentsContent() {
        let source = InMemoryAiConfirmSource(initial: loadedUpdate(readRequest()))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.visibility, .presented)
        XCTAssertEqual(model.toolName, "get_state")
    }

    func testNoRequestHidesWhenNotPinned() {
        let source = InMemoryAiConfirmSource(initial: loadedUpdate(nil))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.visibility, .hidden)
        XCTAssertEqual(model.phase, .empty)
    }

    func testLoadingThenContent() {
        let source = InMemoryAiConfirmSource(initial: AiConfirmUpdate(status: .loading))
        let model = makeModel(source: source, pinned: true)
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(loadedUpdate(readRequest()))
        XCTAssertEqual(model.phase, .content)
    }

    func testLoadedNoRequestResolvesEmpty() {
        let source = InMemoryAiConfirmSource(initial: loadedUpdate(nil))
        let model = makeModel(source: source, pinned: true)
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.visibility, .presented)
    }

    func testFailedNoRequestResolvesError() {
        let source = InMemoryAiConfirmSource(
            initial: AiConfirmUpdate(status: .failed("timeout"), request: nil)
        )
        let model = makeModel(source: source, pinned: true)
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
        XCTAssertNil(model.inlineErrorMessage)
    }

    func testFailedWithRequestKeepsContentAndSurfacesInlineError() {
        let source = InMemoryAiConfirmSource(initial: loadedUpdate(readRequest()))
        let model = makeModel(source: source)
        model.start()
        source.push(AiConfirmUpdate(status: .failed("stale read"), request: readRequest()))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.inlineErrorMessage, "stale read")
    }

    func testIntroSelectsByMutates() {
        let readSource = InMemoryAiConfirmSource(initial: loadedUpdate(readRequest()))
        let readModel = makeModel(source: readSource)
        readModel.start()
        XCTAssertEqual(
            readModel.introText,
            "The assistant wants to run a tool. Review the inputs, then approve or cancel."
        )

        let mutateSource = InMemoryAiConfirmSource(initial: loadedUpdate(mutatingRequest()))
        let mutateModel = makeModel(source: mutateSource)
        mutateModel.start()
        XCTAssertTrue(mutateModel.introText.hasPrefix("The assistant wants to make a change"))
    }

    func testArgumentsProjectToPrettyPrintedJSON() {
        let source = InMemoryAiConfirmSource(initial: loadedUpdate(readRequest()))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.argumentsText, "{\n  \"vehicle_id\": 7\n}")
    }

    func testToolDescriptionPresenceMirrorsTruthiness() {
        let withDesc = InMemoryAiConfirmSource(initial: loadedUpdate(readRequest()))
        let withModel = makeModel(source: withDesc)
        withModel.start()
        XCTAssertTrue(withModel.hasToolDescription)
        XCTAssertEqual(withModel.toolDescription, "Reads state.")

        let withoutDesc = InMemoryAiConfirmSource(initial: loadedUpdate(mutatingRequest()))
        let withoutModel = makeModel(source: withoutDesc)
        withoutModel.start()
        XCTAssertFalse(withoutModel.hasToolDescription)
        XCTAssertNil(withoutModel.toolDescription)
    }

    func testStaleAutoRefreshesOnceThenReArms() {
        let source = InMemoryAiConfirmSource(initial: loadedUpdate(readRequest()))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(loadedUpdate(readRequest(), connection: .stale))
        source.push(loadedUpdate(readRequest(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(loadedUpdate(readRequest(), connection: .live))
        source.push(loadedUpdate(readRequest(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsContentAndDoesNotRefresh() {
        let source = InMemoryAiConfirmSource(initial: loadedUpdate(readRequest()))
        let model = makeModel(source: source)
        model.start()
        source.push(loadedUpdate(readRequest(), connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testStopHaltsSource() {
        let source = InMemoryAiConfirmSource(initial: loadedUpdate(readRequest()))
        let model = makeModel(source: source)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}

// MARK: - Approve / cancel / dismiss commands

@MainActor
final class AiConfirmModelCommandTests: XCTestCase {
    func testApproveDelegatesAndSettles() async {
        let controller = RecordingAiConfirmController()
        let source = InMemoryAiConfirmSource(initial: loadedUpdate(readRequest()))
        let model = makeModel(source: source, controller: controller)
        model.start()
        await model.confirm()
        XCTAssertEqual(controller.confirmCount, 1)
        XCTAssertFalse(model.submitting)
    }

    func testApproveIsGuardedByBusyLoadingProp() async {
        let controller = RecordingAiConfirmController()
        let source = InMemoryAiConfirmSource(initial: loadedUpdate(readRequest(loading: true)))
        let model = makeModel(source: source, controller: controller)
        model.start()
        XCTAssertTrue(model.isBusy)
        XCTAssertTrue(model.confirmDisabled)
        await model.confirm()
        XCTAssertEqual(controller.confirmCount, 0)
    }

    func testApproveIsNoOpWithoutRequest() async {
        let controller = RecordingAiConfirmController()
        let source = InMemoryAiConfirmSource(initial: loadedUpdate(nil))
        let model = makeModel(source: source, pinned: true, controller: controller)
        model.start()
        await model.confirm()
        XCTAssertEqual(controller.confirmCount, 0)
    }

    func testApproveTogglesSubmittingFlagAndGuardsReentrancy() async {
        let controller = GatedAiConfirmController()
        let source = InMemoryAiConfirmSource(initial: loadedUpdate(readRequest()))
        let model = makeModel(source: source, controller: controller)
        model.start()
        XCTAssertFalse(model.submitting)

        let task = Task { await model.confirm() }
        // The child task shares the main actor, so spin (bounded) until it has entered confirm() and
        // set the in-flight flag — deterministic, no reliance on a single yield landing in time.
        var spins = 0
        while !model.submitting, spins < 1000 {
            await Task.yield()
            spins += 1
        }
        XCTAssertTrue(model.submitting)
        XCTAssertTrue(model.isBusy)
        XCTAssertEqual(controller.confirmCount, 1)

        // A second tap while in flight is a no-op (re-entrancy guard).
        await model.confirm()
        XCTAssertEqual(controller.confirmCount, 1)

        controller.release()
        await task.value
        XCTAssertFalse(model.submitting)
    }

    func testCancelDelegates() {
        let controller = RecordingAiConfirmController()
        let source = InMemoryAiConfirmSource(initial: loadedUpdate(readRequest()))
        let model = makeModel(source: source, controller: controller)
        model.start()
        model.cancel()
        XCTAssertEqual(controller.cancelCount, 1)
    }

    func testCancelIsGatedWhileBusy() {
        // Web disables Cancel + no-ops the modal close while loading.
        let controller = RecordingAiConfirmController()
        let source = InMemoryAiConfirmSource(initial: loadedUpdate(readRequest(loading: true)))
        let model = makeModel(source: source, controller: controller)
        model.start()
        XCTAssertTrue(model.cancelDisabled)
        model.cancel()
        model.dismiss()
        XCTAssertEqual(controller.cancelCount, 0)
    }

    func testDismissDelegatesWhenIdle() {
        let controller = RecordingAiConfirmController()
        let source = InMemoryAiConfirmSource(initial: loadedUpdate(readRequest()))
        let model = makeModel(source: source, controller: controller)
        model.start()
        model.dismiss()
        XCTAssertEqual(controller.cancelCount, 1)
    }
}
