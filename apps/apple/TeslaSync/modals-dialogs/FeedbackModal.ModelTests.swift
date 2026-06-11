//
//  FeedbackModal.ModelTests.swift
//  TeslaSync — P4 modal/dialog · 0004 · FeedbackModal (Apple)
//
//  State-holder coverage for `FeedbackModel`: the P1/S11 `view.opened` telemetry (once + idempotent),
//  the auto-context phase transitions across loading / loaded-empty / failed (incl. the inline-error
//  envelope when a cached context survives a failed reload), the touched-gated validation (web
//  `handleBlur`), the async submit lifecycle (validate → delegate → reset + dismiss on success;
//  surface inline error + keep form on failure; no-op when invalid), the conditional recent-errors /
//  console-tail attachment, the stale auto-refresh (once, re-armed on return to live), offline keeping
//  the content, and the reset-on-stop. Driven through the in-memory source + a spy submitter.
//

import XCTest
@testable import TeslaSync

/// Identity localizer for deterministic copy in assertions.
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

/// Records the `view.opened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam
/// under Swift 6 strict concurrency.
private final class SpyFeedbackTelemetry: FeedbackTelemetry, @unchecked Sendable {
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

/// Records the submitted payloads + optionally fails, so the submit lifecycle can be exercised.
private final class SpyFeedbackSubmitter: FeedbackSubmitting, @unchecked Sendable {
    private let lock = NSLock()
    private var submitted: [FeedbackSubmission] = []
    private let shouldFail: Bool

    init(shouldFail: Bool = false) {
        self.shouldFail = shouldFail
    }

    func submit(_ submission: FeedbackSubmission) async throws {
        lock.withLock { submitted.append(submission) }
        if shouldFail { throw FeedbackSubmitError(message: "boom") }
    }

    var submissions: [FeedbackSubmission] {
        lock.withLock { submitted }
    }
}

@MainActor
final class FeedbackModelTests: XCTestCase {
    private func makeModel(
        source: InMemoryFeedbackContextSource,
        telemetry: SpyFeedbackTelemetry = SpyFeedbackTelemetry(),
        submitter: SpyFeedbackSubmitter = SpyFeedbackSubmitter()
    ) -> FeedbackModel {
        FeedbackModel(source: source, telemetry: telemetry, submitter: submitter, localize: passthroughLocalize)
    }

    private func resolvedContext() -> FeedbackContext {
        FeedbackContext(
            pageRoute: "/vehicles/1",
            appVersion: "1.0.0",
            userAgent: "TeslaSync iOS",
            recentErrors: [FeedbackErrorReport(name: "E", message: "m", route: "/r", occurredAt: "t")],
            consoleTail: "console output"
        )
    }

    private func validForm(_ model: FeedbackModel) {
        model.title = "A clear and valid title"
        model.details = String(repeating: "x", count: 40)
    }

    // MARK: Telemetry + context phases

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyFeedbackTelemetry()
        let source = InMemoryFeedbackContextSource()
        let model = makeModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["FeedbackModal"])
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadingThenContent() {
        let source = InMemoryFeedbackContextSource(initial: FeedbackContextUpdate(status: .loading))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.contextPhase, .loading)
        source.push(FeedbackContextUpdate(status: .loaded, context: resolvedContext()))
        XCTAssertEqual(model.contextPhase, .content)
        XCTAssertEqual(model.categoryOptions.count, 3)
        XCTAssertEqual(model.recentErrorCount, 1)
    }

    func testLoadedNoContextResolvesEmpty() {
        let source = InMemoryFeedbackContextSource(initial: FeedbackContextUpdate(status: .loaded))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.contextPhase, .empty)
    }

    func testFailedNoContextResolvesError() {
        let source = InMemoryFeedbackContextSource(initial: FeedbackContextUpdate(status: .failed("timeout")))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.contextPhase, .error("timeout"))
        XCTAssertNil(model.inlineErrorMessage)
    }

    func testFailedWithContextKeepsContentAndSurfacesInlineError() {
        let loaded = FeedbackContextUpdate(status: .loaded, context: resolvedContext())
        let source = InMemoryFeedbackContextSource(initial: loaded)
        let model = makeModel(source: source)
        model.start()
        source.push(FeedbackContextUpdate(status: .failed("stale read"), context: resolvedContext()))
        XCTAssertEqual(model.contextPhase, .content)
        XCTAssertEqual(model.inlineErrorMessage, "stale read")
    }

    // MARK: Validation (touched-gated)

    func testValidationErrorsOnlyAfterTouched() {
        let source = InMemoryFeedbackContextSource(initial: FeedbackContextUpdate(
            status: .loaded,
            context: resolvedContext()
        ))
        let model = makeModel(source: source)
        model.start()
        model.title = "no"
        XCTAssertNil(model.titleError)
        model.markTitleTouched()
        XCTAssertEqual(model.titleError, .tooShort(min: 5))
        model.details = "short"
        XCTAssertNil(model.bodyError)
        model.markBodyTouched()
        XCTAssertEqual(model.bodyError, .tooShort(min: 20))
    }

    func testSubmitDisabledUntilValid() {
        let source = InMemoryFeedbackContextSource(initial: FeedbackContextUpdate(
            status: .loaded,
            context: resolvedContext()
        ))
        let model = makeModel(source: source)
        model.start()
        XCTAssertTrue(model.submitDisabled)
        validForm(model)
        XCTAssertFalse(model.submitDisabled)
        XCTAssertTrue(model.canSubmit)
    }

    // MARK: Submit lifecycle

    func testSubmitSuccessDelegatesResetsAndReportsTrue() async {
        let submitter = SpyFeedbackSubmitter()
        let source = InMemoryFeedbackContextSource(initial: FeedbackContextUpdate(
            status: .loaded,
            context: resolvedContext()
        ))
        let model = makeModel(source: source, submitter: submitter)
        model.start()
        model.category = .feature
        validForm(model)
        let didSucceed = await model.submit()
        XCTAssertTrue(didSucceed)
        XCTAssertEqual(submitter.submissions.count, 1)
        XCTAssertEqual(submitter.submissions.first?.category, .feature)
        XCTAssertEqual(submitter.submissions.first?.title, "A clear and valid title")
        XCTAssertEqual(submitter.submissions.first?.pageRoute, "/vehicles/1")
        // Recent errors attached by default (toggle ON), console off by default.
        XCTAssertEqual(submitter.submissions.first?.recentErrors?.count, 1)
        XCTAssertNil(submitter.submissions.first?.consoleTail)
        // Form reset to web defaults.
        XCTAssertEqual(model.category, .bug)
        XCTAssertEqual(model.title, "")
        XCTAssertEqual(model.details, "")
        XCTAssertTrue(model.includeRecentErrors)
        XCTAssertFalse(model.includeConsoleTail)
        XCTAssertFalse(model.submitting)
        XCTAssertFalse(model.submitFailed)
    }

    func testSubmitAttachesConsoleTailWhenToggledOn() async {
        let submitter = SpyFeedbackSubmitter()
        let source = InMemoryFeedbackContextSource(initial: FeedbackContextUpdate(
            status: .loaded,
            context: resolvedContext()
        ))
        let model = makeModel(source: source, submitter: submitter)
        model.start()
        validForm(model)
        model.includeConsoleTail = true
        _ = await model.submit()
        XCTAssertEqual(submitter.submissions.first?.consoleTail, "console output")
    }

    func testSubmitFailureKeepsFormAndReportsFalse() async {
        let submitter = SpyFeedbackSubmitter(shouldFail: true)
        let source = InMemoryFeedbackContextSource(initial: FeedbackContextUpdate(
            status: .loaded,
            context: resolvedContext()
        ))
        let model = makeModel(source: source, submitter: submitter)
        model.start()
        validForm(model)
        let didSucceed = await model.submit()
        XCTAssertFalse(didSucceed)
        XCTAssertTrue(model.submitFailed)
        XCTAssertFalse(model.submitting)
        // Form NOT reset on failure (the draft is preserved for a retry).
        XCTAssertEqual(model.title, "A clear and valid title")
    }

    func testSubmitNoOpWhenInvalid() async {
        let submitter = SpyFeedbackSubmitter()
        let source = InMemoryFeedbackContextSource(initial: FeedbackContextUpdate(
            status: .loaded,
            context: resolvedContext()
        ))
        let model = makeModel(source: source, submitter: submitter)
        model.start()
        model.title = "no"
        model.details = "short"
        let didSucceed = await model.submit()
        XCTAssertFalse(didSucceed)
        XCTAssertTrue(submitter.submissions.isEmpty)
        // Submitting marks the fields touched so the errors surface (web onSubmit setTouched).
        XCTAssertEqual(model.titleError, .tooShort(min: 5))
        XCTAssertEqual(model.bodyError, .tooShort(min: 20))
    }

    func testSubmitBeforeContextUsesEmptyContext() async {
        let submitter = SpyFeedbackSubmitter()
        let source = InMemoryFeedbackContextSource(initial: FeedbackContextUpdate(status: .loading))
        let model = makeModel(source: source, submitter: submitter)
        model.start()
        validForm(model)
        let didSucceed = await model.submit()
        XCTAssertTrue(didSucceed)
        XCTAssertEqual(submitter.submissions.first?.pageRoute, "")
        XCTAssertNil(submitter.submissions.first?.recentErrors)
    }

    // MARK: Freshness

    func testStaleAutoRefreshesOnceThenReArms() {
        let loaded = FeedbackContextUpdate(status: .loaded, context: resolvedContext())
        let source = InMemoryFeedbackContextSource(initial: loaded)
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(FeedbackContextUpdate(status: .loaded, context: resolvedContext(), connection: .stale))
        source.push(FeedbackContextUpdate(status: .loaded, context: resolvedContext(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(FeedbackContextUpdate(status: .loaded, context: resolvedContext(), connection: .live))
        source.push(FeedbackContextUpdate(status: .loaded, context: resolvedContext(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsContentAndDoesNotRefresh() {
        let loaded = FeedbackContextUpdate(status: .loaded, context: resolvedContext())
        let source = InMemoryFeedbackContextSource(initial: loaded)
        let model = makeModel(source: source)
        model.start()
        source.push(FeedbackContextUpdate(status: .loaded, context: resolvedContext(), connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.contextPhase, .content)
        XCTAssertEqual(source.refreshCount, 0)
    }

    // MARK: Reset on stop

    func testStopResetsFormAndStopsSource() {
        let source = InMemoryFeedbackContextSource(initial: FeedbackContextUpdate(
            status: .loaded,
            context: resolvedContext()
        ))
        let model = makeModel(source: source)
        model.start()
        validForm(model)
        model.includeConsoleTail = true
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        XCTAssertEqual(model.title, "")
        XCTAssertEqual(model.details, "")
        XCTAssertFalse(model.includeConsoleTail)
    }
}
