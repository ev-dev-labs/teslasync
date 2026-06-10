//
//  SessionExpiredModal.ModelTests.swift
//  TeslaSync — P4 modal/dialog · 0008 · SessionExpiredModal (Apple)
//
//  State-holder coverage for `SessionExpiredModel`: the P1/S11 `view.opened` telemetry (once +
//  idempotent, re-armed after stop), the phase transitions across loading / loaded-empty / dormant /
//  failed (incl. the cached-verdict survival of a failed reload), the sticky `eventTriggered` latch
//  (web local state — once the 401 event fires the block stays even if a later poll reports healthy),
//  the re-auth delegation (web `navigateToReauth`), the stale auto-refresh (once, re-armed on return
//  to live), and offline keeping the cached verdict. Driven through the in-memory source — no
//  network.
//

import XCTest
@testable import TeslaSync

/// Records the `view.opened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam
/// under Swift 6 strict concurrency.
private final class SpySessionExpiredTelemetry: SessionExpiredTelemetry, @unchecked Sendable {
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

/// Records the re-auth hand-offs.
private final class SpySessionReauthController: SessionReauthController, @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0

    func signIn() {
        lock.lock()
        count += 1
        lock.unlock()
    }

    var signInCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return count
    }
}

@MainActor
final class SessionExpiredModelTests: XCTestCase {
    private func makeModel(
        source: InMemorySessionExpiredSource,
        telemetry: SpySessionExpiredTelemetry = SpySessionExpiredTelemetry(),
        controller: SpySessionReauthController = SpySessionReauthController()
    ) -> SessionExpiredModel {
        SessionExpiredModel(
            source: source,
            telemetry: telemetry,
            controller: controller,
            localize: { _, fallback in fallback }
        )
    }

    private func expired(_ connection: SessionConnection = .live) -> SessionExpiredUpdate {
        SessionExpiredUpdate(
            status: .loaded,
            context: SessionContext(mode: .session, hasExpired: true),
            connection: connection
        )
    }

    private func healthy(_ connection: SessionConnection = .live) -> SessionExpiredUpdate {
        SessionExpiredUpdate(
            status: .loaded,
            context: SessionContext(mode: .session, hasExpired: false),
            connection: connection
        )
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpySessionExpiredTelemetry()
        let source = InMemorySessionExpiredSource()
        let model = makeModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["SessionExpiredModal"])
        XCTAssertEqual(source.startCount, 1)
    }

    func testStopThenStartReemitsViewOpened() {
        let spy = SpySessionExpiredTelemetry()
        let source = InMemorySessionExpiredSource()
        let model = makeModel(source: source, telemetry: spy)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(spy.surfaces, ["SessionExpiredModal", "SessionExpiredModal"])
    }

    func testLoadingThenExpiredBlocks() {
        let source = InMemorySessionExpiredSource(initial: SessionExpiredUpdate(status: .loading))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertFalse(model.isBlocking)
        source.push(expired())
        XCTAssertEqual(model.phase, .expired)
        XCTAssertTrue(model.isBlocking)
        XCTAssertEqual(model.accessibilitySummary, "Session expired")
    }

    func testOpenModeResolvesEmptyAndDoesNotBlock() {
        let update = SessionExpiredUpdate(
            status: .loaded,
            context: SessionContext(mode: .open, hasExpired: true, eventTriggered: true)
        )
        let source = InMemorySessionExpiredSource(initial: update)
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertFalse(model.isBlocking)
    }

    func testHealthySessionResolvesDormant() {
        let source = InMemorySessionExpiredSource(initial: healthy())
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .dormant)
        XCTAssertFalse(model.isBlocking)
    }

    func testFailedNoContextResolvesError() {
        let source = InMemorySessionExpiredSource(initial: SessionExpiredUpdate(status: .failed("timeout")))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
    }

    func testFailedWithCachedVerdictKeepsBlock() {
        let source = InMemorySessionExpiredSource(initial: expired())
        let model = makeModel(source: source)
        model.start()
        source.push(
            SessionExpiredUpdate(
                status: .failed("stale read"),
                context: SessionContext(mode: .session, hasExpired: true)
            )
        )
        XCTAssertEqual(model.phase, .expired)
    }

    func testEventLatchesAndStaysBlockingAfterHealthyPoll() {
        // The 401 event fires while otherwise healthy → block engages…
        let fired = SessionExpiredUpdate(
            status: .loaded,
            context: SessionContext(mode: .session, hasExpired: false, eventTriggered: true)
        )
        let source = InMemorySessionExpiredSource(initial: fired)
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .expired)
        // …and a later healthy poll (event cleared upstream) must NOT drop the block.
        source.push(healthy())
        XCTAssertEqual(model.phase, .expired)
        XCTAssertTrue(model.isBlocking)
    }

    func testSignInDelegatesToController() {
        let controller = SpySessionReauthController()
        let source = InMemorySessionExpiredSource(initial: expired())
        let model = makeModel(source: source, controller: controller)
        model.start()
        model.signIn()
        XCTAssertEqual(controller.signInCount, 1)
    }

    func testStaleAutoRefreshesOnceThenReArms() {
        let source = InMemorySessionExpiredSource(initial: expired())
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(expired(.stale))
        source.push(expired(.stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(expired(.live))
        source.push(expired(.stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsVerdictAndDoesNotRefresh() {
        let source = InMemorySessionExpiredSource(initial: expired())
        let model = makeModel(source: source)
        model.start()
        source.push(expired(.offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertTrue(model.isOffline)
        XCTAssertEqual(model.phase, .expired)
        XCTAssertEqual(source.refreshCount, 0)
    }
}
