//
//  CommandSelectDialog.ModelTests.swift
//  TeslaSync — P4 modal / dialog · 0031 · CommandSelectDialog (Apple)
//
//  State-holder coverage for `CommandSelectModel`: the P1/S11 `view.opened` telemetry (once +
//  idempotent), the body-phase / visibility machine (request presents, none hides, pinned suppresses,
//  no-options resolves empty, a failed reload over a cached request keeps content + surfaces the
//  inline error), the select command (the in-flight `submittingValue` observed mid-call + delegation
//  + the re-entrancy / unknown-value / no-request / parent-loading guards), cancel (delegation +
//  swallowed while busy), and the stale / offline freshness arms. Driven through the in-memory source
//  — no network, no navigation.
//

import XCTest
@testable import TeslaSync

// MARK: - Test doubles

/// Records the `view.opened` surfaces. Lock-guarded for the `Sendable` telemetry seam.
private final class SpyCommandSelectTelemetry: CommandSelectTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    func viewOpened(surface: String) {
        lock.withLock { storage.append(surface) }
    }

    var surfaces: [String] {
        lock.withLock { storage }
    }
}

/// Records select / cancel calls, completing `select` immediately.
private final class RecordingCommandSelectController: CommandSelectController, @unchecked Sendable {
    private let lock = NSLock()
    private var selected: [String] = []
    private var cancels = 0

    func select(_ value: String) async {
        lock.withLock { selected.append(value) }
    }

    func cancel() {
        lock.withLock { cancels += 1 }
    }

    var selectedValues: [String] {
        lock.withLock { selected }
    }

    var cancelCount: Int {
        lock.withLock { cancels }
    }
}

/// A `select` that suspends on a gate so the in-flight `submittingValue` can be observed mid-call.
private final class GatedCommandSelectController: CommandSelectController, @unchecked Sendable {
    private let lock = NSLock()
    private var selects = 0
    private var continuation: CheckedContinuation<Void, Never>?

    func select(_: String) async {
        lock.withLock { selects += 1 }
        await withCheckedContinuation { cont in
            lock.withLock { continuation = cont }
        }
    }

    func cancel() {}

    /// Resumes a suspended `select`.
    func release() {
        let cont = lock.withLock { () -> CheckedContinuation<Void, Never>? in
            let pending = continuation
            continuation = nil
            return pending
        }
        cont?.resume()
    }

    var selectCount: Int {
        lock.withLock { selects }
    }
}

private func sampleOptions() -> [CommandSelectOption] {
    [
        CommandSelectOption(value: "rear", label: "Rear trunk", description: "Open the rear trunk"),
        CommandSelectOption(value: "front", label: "Front trunk")
    ]
}

private func sampleRequest(loading: Bool = false) -> CommandSelectRequest {
    CommandSelectRequest(id: "trunk", title: "Open trunk", options: sampleOptions(), loading: loading)
}

@MainActor
final class CommandSelectModelTests: XCTestCase {
    private func makeModel(
        source: InMemoryCommandSelectSource,
        pinned: Bool = false,
        telemetry: SpyCommandSelectTelemetry = SpyCommandSelectTelemetry(),
        controller: any CommandSelectController = RecordingCommandSelectController()
    ) -> CommandSelectModel {
        CommandSelectModel(
            source: source,
            pinned: pinned,
            telemetry: telemetry,
            controller: controller,
            localize: { _, fallback in fallback }
        )
    }

    // MARK: Telemetry

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyCommandSelectTelemetry()
        let source = InMemoryCommandSelectSource()
        let model = makeModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["CommandSelectDialog"])
        XCTAssertEqual(source.startCount, 1)
    }

    // MARK: Phase + visibility

    func testLoadingThenContent() {
        let source = InMemoryCommandSelectSource(initial: CommandSelectUpdate(status: .loading))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertEqual(model.visibility, .hidden)
        source.push(CommandSelectUpdate(status: .loaded, request: sampleRequest()))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.visibility, .presented)
        XCTAssertEqual(model.options.map(\.value), ["rear", "front"])
        XCTAssertEqual(model.titleText, "Open trunk")
    }

    func testLoadedNoRequestResolvesEmptyWhenPinned() {
        let source = InMemoryCommandSelectSource(initial: CommandSelectUpdate(status: .loaded))
        let model = makeModel(source: source, pinned: true)
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.visibility, .presented)
    }

    func testNoRequestHidesWhenNotPinned() {
        let source = InMemoryCommandSelectSource(initial: CommandSelectUpdate(status: .loaded))
        let model = makeModel(source: source, pinned: false)
        model.start()
        XCTAssertEqual(model.visibility, .hidden)
    }

    func testRequestWithoutOptionsResolvesEmpty() {
        let empty = CommandSelectRequest(id: "x", title: "Nothing", options: [])
        let source = InMemoryCommandSelectSource(initial: CommandSelectUpdate(status: .loaded, request: empty))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.visibility, .presented)
    }

    func testFailedNoRequestResolvesError() {
        let source = InMemoryCommandSelectSource(initial: CommandSelectUpdate(status: .failed("timeout")))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
    }

    func testFailedWithRequestKeepsContentAndSurfacesInlineError() {
        let loaded = CommandSelectUpdate(status: .loaded, request: sampleRequest())
        let source = InMemoryCommandSelectSource(initial: loaded)
        let model = makeModel(source: source)
        model.start()
        source.push(CommandSelectUpdate(status: .failed("stale read"), request: sampleRequest()))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.inlineErrorMessage, "stale read")
    }

    // MARK: Select

    func testSelectDelegatesAndClearsSubmitting() async {
        let controller = RecordingCommandSelectController()
        let source = InMemoryCommandSelectSource(
            initial: CommandSelectUpdate(status: .loaded, request: sampleRequest())
        )
        let model = makeModel(source: source, controller: controller)
        model.start()
        await model.select("rear")
        XCTAssertEqual(controller.selectedValues, ["rear"])
        XCTAssertNil(model.submittingValue)
        XCTAssertFalse(model.isBusy)
    }

    func testSelectMarksTappedOptionInFlight() async {
        let controller = GatedCommandSelectController()
        let source = InMemoryCommandSelectSource(
            initial: CommandSelectUpdate(status: .loaded, request: sampleRequest())
        )
        let model = makeModel(source: source, controller: controller)
        model.start()

        let task = Task { await model.select("front") }
        while controller.selectCount == 0 {
            await Task.yield()
        }

        XCTAssertTrue(model.isSubmitting("front"))
        XCTAssertFalse(model.isSubmitting("rear"))
        XCTAssertTrue(model.isBusy)

        // A second select while one is in flight is swallowed (web disables every option).
        await model.select("rear")
        XCTAssertEqual(controller.selectCount, 1)

        controller.release()
        await task.value
        XCTAssertNil(model.submittingValue)
        XCTAssertFalse(model.isBusy)
    }

    func testSelectUnknownValueIsIgnored() async {
        let controller = RecordingCommandSelectController()
        let source = InMemoryCommandSelectSource(
            initial: CommandSelectUpdate(status: .loaded, request: sampleRequest())
        )
        let model = makeModel(source: source, controller: controller)
        model.start()
        await model.select("missing")
        XCTAssertTrue(controller.selectedValues.isEmpty)
    }

    func testSelectWithNoRequestIsIgnored() async {
        let controller = RecordingCommandSelectController()
        let source = InMemoryCommandSelectSource(initial: CommandSelectUpdate(status: .loading))
        let model = makeModel(source: source, controller: controller)
        model.start()
        await model.select("rear")
        XCTAssertTrue(controller.selectedValues.isEmpty)
    }

    func testSelectIgnoredWhileParentLoading() async {
        let controller = RecordingCommandSelectController()
        let source = InMemoryCommandSelectSource(
            initial: CommandSelectUpdate(status: .loaded, request: sampleRequest(loading: true))
        )
        let model = makeModel(source: source, controller: controller)
        model.start()
        XCTAssertTrue(model.isBusy)
        await model.select("rear")
        XCTAssertTrue(controller.selectedValues.isEmpty)
    }

    // MARK: Cancel

    func testCancelDelegatesToController() {
        let controller = RecordingCommandSelectController()
        let source = InMemoryCommandSelectSource(
            initial: CommandSelectUpdate(status: .loaded, request: sampleRequest())
        )
        let model = makeModel(source: source, controller: controller)
        model.start()
        model.cancel()
        XCTAssertEqual(controller.cancelCount, 1)
    }

    func testCancelSwallowedWhileParentLoading() {
        let controller = RecordingCommandSelectController()
        let source = InMemoryCommandSelectSource(
            initial: CommandSelectUpdate(status: .loaded, request: sampleRequest(loading: true))
        )
        let model = makeModel(source: source, controller: controller)
        model.start()
        model.cancel()
        XCTAssertEqual(controller.cancelCount, 0)
    }

    // MARK: Freshness

    func testStaleAutoRefreshesOnceThenReArms() {
        let loaded = CommandSelectUpdate(status: .loaded, request: sampleRequest())
        let source = InMemoryCommandSelectSource(initial: loaded)
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(CommandSelectUpdate(status: .loaded, request: sampleRequest(), connection: .stale))
        source.push(CommandSelectUpdate(status: .loaded, request: sampleRequest(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(CommandSelectUpdate(status: .loaded, request: sampleRequest(), connection: .live))
        source.push(CommandSelectUpdate(status: .loaded, request: sampleRequest(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsContentAndDoesNotRefresh() {
        let loaded = CommandSelectUpdate(status: .loaded, request: sampleRequest())
        let source = InMemoryCommandSelectSource(initial: loaded)
        let model = makeModel(source: source)
        model.start()
        source.push(CommandSelectUpdate(status: .loaded, request: sampleRequest(), connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(source.refreshCount, 0)
    }
}
