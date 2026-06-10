//
//  ReauthDialog.ModelTests.swift
//  TeslaSync — P4 modal/dialog · 0007 · ReauthDialog (Apple)
//
//  State-holder coverage for `ReauthDialogModel`: the P1/S11 `view.opened` telemetry (once +
//  idempotent), the phase transitions across loading / loaded-empty / failed (incl. the inline-error
//  envelope when a cached context survives a failed reload), the form reset on a fresh challenge (web
//  `useEffect` on `open`/`path`) + the re-open-after-clear re-arm, the TOTP-tab fallback, the TOTP
//  sanitiser, the submit routing (confirm-token guard, credential field-required guard, success →
//  complete, failure → mapped error), cancel, the stale auto-refresh (once, re-armed on return to
//  live), and offline keeping the form. Driven through the in-memory source — no HTTP, no queue.
//

import XCTest
@testable import TeslaSync

/// Identity localizer for deterministic copy in assertions.
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

/// Records the `view.opened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under
/// Swift 6 strict concurrency.
private final class SpyReauthTelemetry: ReauthTelemetry, @unchecked Sendable {
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

/// Records completed credentials + cancel calls.
private final class SpyReauthController: ReauthController, @unchecked Sendable {
    private let lock = NSLock()
    private var completed: [ReauthCredential] = []
    private var cancels = 0

    func complete(_ credential: ReauthCredential) {
        lock.lock()
        completed.append(credential)
        lock.unlock()
    }

    func cancel() {
        lock.lock()
        cancels += 1
        lock.unlock()
    }

    var completions: [ReauthCredential] {
        lock.lock()
        defer { lock.unlock() }
        return completed
    }

    var cancelCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return cancels
    }
}

/// Returns a canned outcome and records the submitted bodies.
private final class StubReauthCredentialService: ReauthCredentialService, @unchecked Sendable {
    private let lock = NSLock()
    private let outcome: ReauthSubmitOutcome
    private var bodies: [ReauthSubmitBody] = []

    init(outcome: ReauthSubmitOutcome) {
        self.outcome = outcome
    }

    func submit(_ body: ReauthSubmitBody) async -> ReauthSubmitOutcome {
        lock.withLock { bodies.append(body) }
        return outcome
    }

    var submittedBodies: [ReauthSubmitBody] {
        lock.withLock { bodies }
    }
}

@MainActor
final class ReauthDialogModelTests: XCTestCase {
    private func makeModel(
        source: InMemoryReauthChallengeSource,
        telemetry: SpyReauthTelemetry = SpyReauthTelemetry(),
        service: StubReauthCredentialService = StubReauthCredentialService(outcome: .failure(code: nil, message: "")),
        controller: SpyReauthController = SpyReauthController()
    ) -> ReauthDialogModel {
        ReauthDialogModel(
            source: source,
            telemetry: telemetry,
            service: service,
            controller: controller,
            localize: passthroughLocalize
        )
    }

    private func credentialContext(
        path: String = "/settings/reset",
        totp: Bool = true
    ) -> ReauthChallengeContext {
        ReauthChallengeContext(path: path, mode: .credential, totpTabAvailable: totp)
    }

    private func confirmContext(path: String = "/settings/reset") -> ReauthChallengeContext {
        ReauthChallengeContext(path: path, mode: .confirm, totpTabAvailable: false)
    }

    // MARK: Telemetry + phases

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyReauthTelemetry()
        let source = InMemoryReauthChallengeSource()
        let model = makeModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["ReauthDialog"])
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadingThenContent() {
        let source = InMemoryReauthChallengeSource(initial: ReauthChallengeUpdate(status: .loading))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(ReauthChallengeUpdate(status: .loaded, context: credentialContext()))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.methods, [.password, .totp])
        XCTAssertTrue(model.isCredentialMode)
    }

    func testLoadedNoContextResolvesEmpty() {
        let source = InMemoryReauthChallengeSource(initial: ReauthChallengeUpdate(status: .loaded))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedNoContextResolvesError() {
        let source = InMemoryReauthChallengeSource(initial: ReauthChallengeUpdate(status: .failed("timeout")))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
        XCTAssertNil(model.inlineErrorMessage)
    }

    func testFailedWithContextKeepsContentAndSurfacesInlineError() {
        let loaded = ReauthChallengeUpdate(status: .loaded, context: credentialContext())
        let source = InMemoryReauthChallengeSource(initial: loaded)
        let model = makeModel(source: source)
        model.start()
        source.push(ReauthChallengeUpdate(status: .failed("stale read"), context: credentialContext()))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.inlineErrorMessage, "stale read")
    }

    // MARK: Form reset + tab fallback

    func testFormResetsOnNewChallengePathButNotOnSamePath() {
        let source = InMemoryReauthChallengeSource(
            initial: ReauthChallengeUpdate(status: .loaded, context: credentialContext(path: "/a"))
        )
        let model = makeModel(source: source)
        model.start()
        model.password = "secret"
        // Same path re-push must NOT clobber the user's entry.
        source.push(ReauthChallengeUpdate(status: .loaded, context: credentialContext(path: "/a")))
        XCTAssertEqual(model.password, "secret")
        // A new challenge path DOES reset.
        source.push(ReauthChallengeUpdate(status: .loaded, context: credentialContext(path: "/b")))
        XCTAssertEqual(model.password, "")
    }

    func testReopeningSameChallengeAfterClearResetsForm() {
        let source = InMemoryReauthChallengeSource(
            initial: ReauthChallengeUpdate(status: .loaded, context: credentialContext(path: "/a"))
        )
        let model = makeModel(source: source)
        model.start()
        model.password = "secret"
        // Challenge clears (queue empty) then the same path re-opens → web `open` flips → reset.
        source.push(ReauthChallengeUpdate(status: .loaded, context: nil))
        source.push(ReauthChallengeUpdate(status: .loaded, context: credentialContext(path: "/a")))
        XCTAssertEqual(model.password, "")
    }

    func testTotpTabFallbackWhenAvailabilityDrops() {
        let source = InMemoryReauthChallengeSource(
            initial: ReauthChallengeUpdate(status: .loaded, context: credentialContext(path: "/a", totp: true))
        )
        let model = makeModel(source: source)
        model.start()
        model.selectMethod(.totp)
        XCTAssertEqual(model.activeTab, .totp)
        // Same path, totp tab withdrawn → fall back to password (no reset since path is unchanged).
        source.push(ReauthChallengeUpdate(status: .loaded, context: credentialContext(path: "/a", totp: false)))
        XCTAssertEqual(model.activeTab, .password)
        XCTAssertEqual(model.methods, [.password])
    }

    func testUpdateTOTPSanitises() {
        let source = InMemoryReauthChallengeSource(
            initial: ReauthChallengeUpdate(status: .loaded, context: credentialContext())
        )
        let model = makeModel(source: source)
        model.start()
        model.updateTOTP("12ab34-56789")
        XCTAssertEqual(model.totp, "12345678")
    }

    // MARK: Submit routing

    func testConfirmSubmitRejectsWrongTokenThenCompletesOnMatch() async {
        let controller = SpyReauthController()
        let source = InMemoryReauthChallengeSource(
            initial: ReauthChallengeUpdate(status: .loaded, context: confirmContext())
        )
        let model = makeModel(source: source, controller: controller)
        model.start()
        model.confirmText = "nope"
        await model.submit()
        XCTAssertEqual(model.errorMessage, "Type CONFIRM exactly to confirm.")
        XCTAssertTrue(controller.completions.isEmpty)
        model.confirmText = "CONFIRM"
        await model.submit()
        XCTAssertEqual(controller.completions.count, 1)
        XCTAssertEqual(controller.completions.first?.mode, .open)
    }

    func testCredentialSubmitGuardsEmptyFieldWithoutCallingService() async {
        let service = StubReauthCredentialService(outcome: .failure(code: nil, message: ""))
        let controller = SpyReauthController()
        let source = InMemoryReauthChallengeSource(
            initial: ReauthChallengeUpdate(status: .loaded, context: credentialContext())
        )
        let model = makeModel(source: source, service: service, controller: controller)
        model.start()
        model.password = "   "
        await model.submit()
        XCTAssertEqual(model.errorMessage, "Enter your password to continue.")
        XCTAssertTrue(service.submittedBodies.isEmpty)
        XCTAssertTrue(controller.completions.isEmpty)
        XCTAssertFalse(model.submitting)
    }

    func testCredentialSubmitSuccessCompletesWithCredential() async {
        let credential = ReauthCredential(mode: .session, token: "tok", expiresAt: "2030-01-01T00:00:00Z")
        let service = StubReauthCredentialService(outcome: .success(credential))
        let controller = SpyReauthController()
        let source = InMemoryReauthChallengeSource(
            initial: ReauthChallengeUpdate(status: .loaded, context: credentialContext())
        )
        let model = makeModel(source: source, service: service, controller: controller)
        model.start()
        model.password = "secret"
        await model.submit()
        XCTAssertEqual(service.submittedBodies, [ReauthSubmitBody(password: "secret")])
        XCTAssertEqual(controller.completions, [credential])
        XCTAssertNil(model.errorMessage)
        XCTAssertFalse(model.submitting)
    }

    func testCredentialSubmitFailureMapsInvalidCredential() async {
        let service = StubReauthCredentialService(
            outcome: .failure(code: ReauthErrorCode.invalidCredential, message: "bad")
        )
        let controller = SpyReauthController()
        let source = InMemoryReauthChallengeSource(
            initial: ReauthChallengeUpdate(status: .loaded, context: credentialContext())
        )
        let model = makeModel(source: source, service: service, controller: controller)
        model.start()
        model.password = "secret"
        await model.submit()
        XCTAssertEqual(model.errorMessage, "Password did not match.")
        XCTAssertTrue(controller.completions.isEmpty)
    }

    // MARK: Cancel + freshness

    func testCancelDelegatesToController() {
        let controller = SpyReauthController()
        let source = InMemoryReauthChallengeSource(
            initial: ReauthChallengeUpdate(status: .loaded, context: credentialContext())
        )
        let model = makeModel(source: source, controller: controller)
        model.start()
        model.cancel()
        XCTAssertEqual(controller.cancelCount, 1)
    }

    func testStaleAutoRefreshesOnceThenReArms() {
        let loaded = ReauthChallengeUpdate(status: .loaded, context: credentialContext())
        let source = InMemoryReauthChallengeSource(initial: loaded)
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(ReauthChallengeUpdate(status: .loaded, context: credentialContext(), connection: .stale))
        source.push(ReauthChallengeUpdate(status: .loaded, context: credentialContext(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(ReauthChallengeUpdate(status: .loaded, context: credentialContext(), connection: .live))
        source.push(ReauthChallengeUpdate(status: .loaded, context: credentialContext(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsContentAndDoesNotRefresh() {
        let loaded = ReauthChallengeUpdate(status: .loaded, context: credentialContext())
        let source = InMemoryReauthChallengeSource(initial: loaded)
        let model = makeModel(source: source)
        model.start()
        source.push(ReauthChallengeUpdate(status: .loaded, context: credentialContext(), connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(source.refreshCount, 0)
    }
}
