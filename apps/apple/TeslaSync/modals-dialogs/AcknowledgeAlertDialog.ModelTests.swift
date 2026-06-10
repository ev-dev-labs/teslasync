//
//  AcknowledgeAlertDialog.ModelTests.swift
//  TeslaSync — P4 modal/dialog · 0017 · AcknowledgeAlertDialog (Apple)
//
//  State-holder coverage for `AckAlertModel`: the P1/S11 `view.opened` telemetry (once + idempotent),
//  the phase transitions across loading / loaded-empty / failed (incl. the inline-error envelope when a
//  cached context survives a failed reload), the note reset on a fresh alert (web `useEffect` on `open`)
//  + the re-open-after-clear re-arm, the input cap (web `maxLength`), the submit routing (too-long
//  guard without a service call, success → complete, failure → mapped error), cancel, the stale
//  auto-refresh (once, re-armed on return to live), and offline keeping the form. Driven through the
//  in-memory source — no HTTP, no navigation.
//

import XCTest
@testable import TeslaSync

/// Identity localizer for deterministic copy in assertions.
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

/// Records the `view.opened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under
/// Swift 6 strict concurrency.
private final class SpyAckAlertTelemetry: AckAlertTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    func viewOpened(surface: String) {
        lock.withLock { storage.append(surface) }
    }

    var surfaces: [String] {
        lock.withLock { storage }
    }
}

/// Records complete + cancel calls.
private final class SpyAckAlertController: AckAlertController, @unchecked Sendable {
    private let lock = NSLock()
    private var completes = 0
    private var cancels = 0

    func complete() {
        lock.withLock { completes += 1 }
    }

    func cancel() {
        lock.withLock { cancels += 1 }
    }

    var completeCount: Int {
        lock.withLock { completes }
    }

    var cancelCount: Int {
        lock.withLock { cancels }
    }
}

/// Returns a canned outcome and records the submitted bodies.
private final class StubAckAlertService: AckAlertService, @unchecked Sendable {
    private let lock = NSLock()
    private let outcome: AckAlertSubmitOutcome
    private var bodies: [AckAlertSubmitBody] = []

    init(outcome: AckAlertSubmitOutcome) {
        self.outcome = outcome
    }

    func acknowledge(_ body: AckAlertSubmitBody) async -> AckAlertSubmitOutcome {
        lock.withLock { bodies.append(body) }
        return outcome
    }

    var submittedBodies: [AckAlertSubmitBody] {
        lock.withLock { bodies }
    }
}

@MainActor
final class AckAlertModelTests: XCTestCase {
    private func makeModel(
        source: InMemoryAckAlertSource,
        telemetry: SpyAckAlertTelemetry = SpyAckAlertTelemetry(),
        service: StubAckAlertService = StubAckAlertService(outcome: .success),
        controller: SpyAckAlertController = SpyAckAlertController()
    ) -> AckAlertModel {
        AckAlertModel(
            source: source,
            telemetry: telemetry,
            service: service,
            controller: controller,
            localize: passthroughLocalize
        )
    }

    private func context(id: String = "alert-1", title: String? = "High temp") -> AckAlertContext {
        AckAlertContext(alertID: id, title: title)
    }

    // MARK: Telemetry + phases

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyAckAlertTelemetry()
        let source = InMemoryAckAlertSource()
        let model = makeModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["AcknowledgeAlertDialog"])
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadingThenContent() {
        let source = InMemoryAckAlertSource(initial: AckAlertUpdate(status: .loading))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(AckAlertUpdate(status: .loaded, context: context()))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.subtitle, "High temp")
    }

    func testLoadedNoContextResolvesEmpty() {
        let source = InMemoryAckAlertSource(initial: AckAlertUpdate(status: .loaded))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.subtitle)
    }

    func testFailedNoContextResolvesError() {
        let source = InMemoryAckAlertSource(initial: AckAlertUpdate(status: .failed("timeout")))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
        XCTAssertNil(model.inlineErrorMessage)
    }

    func testFailedWithContextKeepsContentAndSurfacesInlineError() {
        let loaded = AckAlertUpdate(status: .loaded, context: context())
        let source = InMemoryAckAlertSource(initial: loaded)
        let model = makeModel(source: source)
        model.start()
        source.push(AckAlertUpdate(status: .failed("stale read"), context: context()))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.inlineErrorMessage, "stale read")
    }

    // MARK: Note reset + input cap

    func testNoteResetsOnNewAlertButNotOnSameAlert() {
        let source = InMemoryAckAlertSource(
            initial: AckAlertUpdate(status: .loaded, context: context(id: "a"))
        )
        let model = makeModel(source: source)
        model.start()
        model.updateNote("draft")
        // Same alert re-push must NOT clobber the user's entry.
        source.push(AckAlertUpdate(status: .loaded, context: context(id: "a")))
        XCTAssertEqual(model.note, "draft")
        // A new alert DOES reset.
        source.push(AckAlertUpdate(status: .loaded, context: context(id: "b")))
        XCTAssertEqual(model.note, "")
    }

    func testReopeningSameAlertAfterClearResetsNote() {
        let source = InMemoryAckAlertSource(
            initial: AckAlertUpdate(status: .loaded, context: context(id: "a"))
        )
        let model = makeModel(source: source)
        model.start()
        model.updateNote("draft")
        // Target clears (dialog closed) then the same alert re-opens → web `open` flips → reset.
        source.push(AckAlertUpdate(status: .loaded, context: nil))
        source.push(AckAlertUpdate(status: .loaded, context: context(id: "a")))
        XCTAssertEqual(model.note, "")
    }

    func testUpdateNoteCapsAtInputLimit() {
        let source = InMemoryAckAlertSource(initial: AckAlertUpdate(status: .loaded, context: context()))
        let model = makeModel(source: source)
        model.start()
        model.updateNote(String(repeating: "a", count: 1200))
        XCTAssertEqual(model.characterCount, 1050)
        XCTAssertTrue(model.isTooLong)
    }

    // MARK: Submit routing

    func testSubmitSuccessCompletesWithTrimmedBody() async {
        let service = StubAckAlertService(outcome: .success)
        let controller = SpyAckAlertController()
        let source = InMemoryAckAlertSource(initial: AckAlertUpdate(status: .loaded, context: context()))
        let model = makeModel(source: source, service: service, controller: controller)
        model.start()
        model.updateNote("  on it \n")
        await model.submit()
        XCTAssertEqual(service.submittedBodies, [AckAlertSubmitBody(note: "on it")])
        XCTAssertEqual(controller.completeCount, 1)
        XCTAssertNil(model.errorMessage)
        XCTAssertFalse(model.submitting)
    }

    func testSubmitAllowsEmptyNote() async {
        let service = StubAckAlertService(outcome: .success)
        let controller = SpyAckAlertController()
        let source = InMemoryAckAlertSource(initial: AckAlertUpdate(status: .loaded, context: context()))
        let model = makeModel(source: source, service: service, controller: controller)
        model.start()
        await model.submit()
        XCTAssertEqual(service.submittedBodies, [AckAlertSubmitBody(note: "")])
        XCTAssertEqual(controller.completeCount, 1)
    }

    func testSubmitFailureSurfacesMappedError() async {
        let service = StubAckAlertService(outcome: .failure(message: "Server rejected the request"))
        let controller = SpyAckAlertController()
        let source = InMemoryAckAlertSource(initial: AckAlertUpdate(status: .loaded, context: context()))
        let model = makeModel(source: source, service: service, controller: controller)
        model.start()
        model.updateNote("note")
        await model.submit()
        XCTAssertEqual(model.errorMessage, "Server rejected the request")
        XCTAssertEqual(controller.completeCount, 0)
        XCTAssertFalse(model.submitting)
    }

    func testSubmitGuardedWhenTooLongWithoutCallingService() async {
        let service = StubAckAlertService(outcome: .success)
        let controller = SpyAckAlertController()
        let source = InMemoryAckAlertSource(initial: AckAlertUpdate(status: .loaded, context: context()))
        let model = makeModel(source: source, service: service, controller: controller)
        model.start()
        model.updateNote(String(repeating: "a", count: 1001))
        await model.submit()
        XCTAssertTrue(service.submittedBodies.isEmpty)
        XCTAssertEqual(controller.completeCount, 0)
    }

    func testUpdateNoteClearsPriorSubmitError() async {
        let service = StubAckAlertService(outcome: .failure(message: "boom"))
        let source = InMemoryAckAlertSource(initial: AckAlertUpdate(status: .loaded, context: context()))
        let model = makeModel(source: source, service: service)
        model.start()
        model.updateNote("note")
        await model.submit()
        XCTAssertEqual(model.errorMessage, "boom")
        model.updateNote("note edited")
        XCTAssertNil(model.errorMessage)
    }

    // MARK: Cancel + freshness

    func testCancelDelegatesToController() {
        let controller = SpyAckAlertController()
        let source = InMemoryAckAlertSource(initial: AckAlertUpdate(status: .loaded, context: context()))
        let model = makeModel(source: source, controller: controller)
        model.start()
        model.cancel()
        XCTAssertEqual(controller.cancelCount, 1)
    }

    func testStaleAutoRefreshesOnceThenReArms() {
        let loaded = AckAlertUpdate(status: .loaded, context: context())
        let source = InMemoryAckAlertSource(initial: loaded)
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(AckAlertUpdate(status: .loaded, context: context(), connection: .stale))
        source.push(AckAlertUpdate(status: .loaded, context: context(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(AckAlertUpdate(status: .loaded, context: context(), connection: .live))
        source.push(AckAlertUpdate(status: .loaded, context: context(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsContentAndDoesNotRefresh() {
        let loaded = AckAlertUpdate(status: .loaded, context: context())
        let source = InMemoryAckAlertSource(initial: loaded)
        let model = makeModel(source: source)
        model.start()
        source.push(AckAlertUpdate(status: .loaded, context: context(), connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(source.refreshCount, 0)
    }
}
