//
//  SessionExpiringModal.ModelTests.swift
//  TeslaSync — P4 modal / dialog · 0009 · SessionExpiringModal (Apple)
//
//  State-holder coverage for `SessionExpiringModel`: the P1/S11 `view.opened` telemetry (once +
//  idempotent), the body-phase transitions across loading / loaded-empty / failed (incl. the
//  inline-error envelope when a cached countdown survives a failed reload), the visibility machine
//  (near-expiry presents, far hides, pinned suppresses), the live-clock `tick` re-derivation (the
//  countdown ticks down and the dialog hides itself at expiry), the stay command (in-flight flag +
//  controller delegation + re-entrancy guard + fresh-snapshot pull), sign-out delegation, the draft
//  projection, the stale auto-refresh (once, re-armed on return to live), and offline keeping the
//  content. Driven through the in-memory source — no network.
//

import XCTest
@testable import TeslaSync

/// Records the `view.opened` surfaces. Lock-guarded for the `Sendable` telemetry seam.
private final class SpySessionExpiringTelemetry: SessionExpiringTelemetry, @unchecked Sendable {
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

/// Records stay / sign-out calls, completing `stay()` immediately.
private final class RecordingSessionController: SessionExpiringController, @unchecked Sendable {
    private let lock = NSLock()
    private var stays = 0
    private var signOuts = 0

    func stay() async {
        lock.withLock { stays += 1 }
    }

    func signOut() {
        lock.withLock { signOuts += 1 }
    }

    var stayCount: Int {
        lock.withLock { stays }
    }

    var signOutCount: Int {
        lock.withLock { signOuts }
    }
}

/// A `stay()` that suspends on a gate so the in-flight `staying` flag can be observed mid-call.
private final class GatedSessionController: SessionExpiringController, @unchecked Sendable {
    private let lock = NSLock()
    private var stays = 0
    private var continuation: CheckedContinuation<Void, Never>?

    func stay() async {
        lock.withLock { stays += 1 }
        await withCheckedContinuation { cont in
            lock.withLock { continuation = cont }
        }
    }

    func signOut() {}

    /// Resumes a suspended `stay()`.
    func release() {
        let cont = lock.withLock { () -> CheckedContinuation<Void, Never>? in
            let pending = continuation
            continuation = nil
            return pending
        }
        cont?.resume()
    }

    var stayCount: Int {
        lock.withLock { stays }
    }
}

/// A main-actor-safe mutable clock for the tick tests.
private final class MutableClock: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Date

    init(_ value: Date) {
        self.value = value
    }

    var current: Date {
        lock.lock()
        defer { lock.unlock() }
        return value
    }

    func advance(by seconds: TimeInterval) {
        lock.lock()
        value = value.addingTimeInterval(seconds)
        lock.unlock()
    }
}

@MainActor
final class SessionExpiringModelTests: XCTestCase {
    private static let anchor = Date(timeIntervalSince1970: 1_717_000_000)

    private func makeModel(
        source: InMemorySessionExpiringSource,
        pinned: Bool = false,
        telemetry: SpySessionExpiringTelemetry = SpySessionExpiringTelemetry(),
        controller: any SessionExpiringController = RecordingSessionController(),
        now: @escaping () -> Date = { SessionExpiringModelTests.anchor }
    ) -> SessionExpiringModel {
        SessionExpiringModel(
            source: source,
            pinned: pinned,
            telemetry: telemetry,
            controller: controller,
            localize: { _, fallback in fallback },
            now: now
        )
    }

    private func nearExpiry(_ seconds: Int = 45) -> SessionSnapshot {
        SessionSnapshot(
            mode: .session,
            authenticated: true,
            expiresAt: Self.anchor.addingTimeInterval(TimeInterval(seconds)),
            renewable: true
        )
    }

    // MARK: Telemetry

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpySessionExpiringTelemetry()
        let source = InMemorySessionExpiringSource()
        let model = makeModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["SessionExpiringModal"])
        XCTAssertEqual(source.startCount, 1)
    }

    // MARK: Body phases + visibility

    func testNearExpiryPresentsContentWithCountdown() {
        let source = InMemorySessionExpiringSource(
            initial: SessionExpiringUpdate(status: .loaded, session: nearExpiry())
        )
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.visibility, .presented)
        XCTAssertEqual(model.countdownText, "0:45")
    }

    func testFarFromExpiryHidesWhenNotPinned() {
        let source = InMemorySessionExpiringSource(
            initial: SessionExpiringUpdate(status: .loaded, session: nearExpiry(600))
        )
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.visibility, .hidden)
    }

    func testLoadingThenContent() {
        let source = InMemorySessionExpiringSource(initial: SessionExpiringUpdate(status: .loading))
        let model = makeModel(source: source, pinned: true)
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(SessionExpiringUpdate(status: .loaded, session: nearExpiry()))
        XCTAssertEqual(model.phase, .content)
    }

    func testLoadedNoCountdownResolvesEmpty() {
        let openMode = SessionSnapshot(mode: .open, authenticated: true)
        let source = InMemorySessionExpiringSource(
            initial: SessionExpiringUpdate(status: .loaded, session: openMode)
        )
        let model = makeModel(source: source, pinned: true)
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.visibility, .presented)
    }

    func testFailedNoCountdownResolvesError() {
        let source = InMemorySessionExpiringSource(
            initial: SessionExpiringUpdate(status: .failed("timeout"), session: nil)
        )
        let model = makeModel(source: source, pinned: true)
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
        XCTAssertNil(model.inlineErrorMessage)
    }

    func testFailedWithCountdownKeepsContentAndSurfacesInlineError() {
        let source = InMemorySessionExpiringSource(
            initial: SessionExpiringUpdate(status: .loaded, session: nearExpiry())
        )
        let model = makeModel(source: source)
        model.start()
        source.push(SessionExpiringUpdate(status: .failed("stale read"), session: nearExpiry()))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.inlineErrorMessage, "stale read")
    }

    // MARK: Live tick

    func testTickReDerivesAndHidesAtExpiry() {
        let clock = MutableClock(Self.anchor)
        let source = InMemorySessionExpiringSource(
            initial: SessionExpiringUpdate(status: .loaded, session: nearExpiry())
        )
        let model = makeModel(source: source, now: { clock.current })
        model.start()
        XCTAssertEqual(model.countdownText, "0:45")
        XCTAssertEqual(model.visibility, .presented)
        clock.advance(by: 30)
        model.tick()
        XCTAssertEqual(model.countdownText, "0:15")
        XCTAssertEqual(model.visibility, .presented)
        clock.advance(by: 20)
        model.tick()
        XCTAssertTrue(model.derived.hasExpired)
        XCTAssertEqual(model.visibility, .hidden)
    }

    // MARK: Drafts

    func testDraftsSortedCappedAndOverflowCounted() {
        let drafts = (0 ..< 7).map {
            SessionDraft(label: "d\($0)", savedAt: Self.anchor.addingTimeInterval(Double(-$0 * 60)))
        }
        let source = InMemorySessionExpiringSource(
            initial: SessionExpiringUpdate(status: .loaded, session: nearExpiry(), drafts: drafts)
        )
        let model = makeModel(source: source)
        model.start()
        XCTAssertTrue(model.hasDrafts)
        XCTAssertEqual(model.visibleDrafts.count, 5)
        XCTAssertEqual(model.overflowDraftCount, 2)
        // Most-recent first (d0 has the newest savedAt).
        XCTAssertEqual(model.visibleDrafts.first?.label, "d0")
    }

    // MARK: Stay / sign-out

    func testStayTogglesInFlightFlagAndDelegatesThenPullsFreshSnapshot() async {
        let controller = GatedSessionController()
        let source = InMemorySessionExpiringSource(
            initial: SessionExpiringUpdate(status: .loaded, session: nearExpiry())
        )
        let model = makeModel(source: source, controller: controller)
        model.start()
        XCTAssertFalse(model.staying)

        let task = Task { await model.stay() }
        await Task.yield()
        XCTAssertTrue(model.staying)
        XCTAssertEqual(controller.stayCount, 1)

        // A second tap while in flight is a no-op (re-entrancy guard).
        await model.stay()
        XCTAssertEqual(controller.stayCount, 1)

        controller.release()
        await task.value
        XCTAssertFalse(model.staying)
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaySettlesWithImmediateController() async {
        let controller = RecordingSessionController()
        let source = InMemorySessionExpiringSource(
            initial: SessionExpiringUpdate(status: .loaded, session: nearExpiry())
        )
        let model = makeModel(source: source, controller: controller)
        model.start()
        await model.stay()
        XCTAssertEqual(controller.stayCount, 1)
        XCTAssertFalse(model.staying)
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testSignOutDelegates() {
        let controller = RecordingSessionController()
        let source = InMemorySessionExpiringSource(
            initial: SessionExpiringUpdate(status: .loaded, session: nearExpiry())
        )
        let model = makeModel(source: source, controller: controller)
        model.start()
        model.signOut()
        XCTAssertEqual(controller.signOutCount, 1)
    }

    // MARK: Freshness

    func testStaleAutoRefreshesOnceThenReArms() {
        let source = InMemorySessionExpiringSource(
            initial: SessionExpiringUpdate(status: .loaded, session: nearExpiry())
        )
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(SessionExpiringUpdate(status: .loaded, session: nearExpiry(), connection: .stale))
        source.push(SessionExpiringUpdate(status: .loaded, session: nearExpiry(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(SessionExpiringUpdate(status: .loaded, session: nearExpiry(), connection: .live))
        source.push(SessionExpiringUpdate(status: .loaded, session: nearExpiry(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsContentAndDoesNotRefresh() {
        let source = InMemorySessionExpiringSource(
            initial: SessionExpiringUpdate(status: .loaded, session: nearExpiry())
        )
        let model = makeModel(source: source)
        model.start()
        source.push(SessionExpiringUpdate(status: .loaded, session: nearExpiry(), connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.visibility, .presented)
        XCTAssertEqual(source.refreshCount, 0)
    }
}
