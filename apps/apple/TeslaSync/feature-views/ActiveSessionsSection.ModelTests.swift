//
//  ActiveSessionsSection.ModelTests.swift
//  TeslaSync — P4 feature view · 0197 · ActiveSessionsSection (Apple)
//
//  State-holder coverage for `ActiveSessionsModel`: the P1/S11 `view.opened` telemetry
//  (once + idempotent), the phase transitions across loading / loaded-empty / open /
//  failed (incl. the inline-error envelope when cached rows survive a failed reload),
//  the per-row revoke + all-others flows (seam call + list refresh + dialog / in-flight
//  bookkeeping), the failure-skips-refresh paths, the stale auto-refresh (once,
//  re-armed on return to live), offline keeping cached rows, and pruning a pending
//  target whose row vanished. Driven through the in-memory source — no network.
//

import XCTest
@testable import TeslaSync

/// Identity localizer for deterministic device labels in assertions.
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

/// Records the `view.opened` surfaces. Lock-guarded so it satisfies the `Sendable`
/// telemetry seam under Swift 6 strict concurrency.
private final class SpyActiveSessionsTelemetry: ActiveSessionsTelemetry, @unchecked Sendable {
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

/// Records the revoke calls and returns configured results.
private actor RecordingRevoker: ActiveSessionsRevoker {
    private(set) var revokedIDs: [String] = []
    private(set) var allOthersCalls = 0
    private let revokeResult: Bool
    private let allOthersResult: Int

    init(revokeResult: Bool = true, allOthersResult: Int = 2) {
        self.revokeResult = revokeResult
        self.allOthersResult = allOthersResult
    }

    func revoke(id: String) async -> Bool {
        revokedIDs.append(id)
        return revokeResult
    }

    func revokeAllOthers() async -> Int {
        allOthersCalls += 1
        return allOthersResult
    }
}

private enum ActiveSessionsSectionSampleSessions {
    static func current(id: String = "1") -> ActiveSessionItem {
        ActiveSessionItem(
            id: id,
            userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15",
            ip: "192.168.1.2",
            createdAt: Date(timeIntervalSince1970: 1_716_000_000),
            lastSeenAt: Date(timeIntervalSince1970: 1_717_000_000),
            current: true
        )
    }

    static func other(id: String = "2") -> ActiveSessionItem {
        ActiveSessionItem(
            id: id,
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36",
            ip: "203.0.113.9",
            createdAt: Date(timeIntervalSince1970: 1_715_000_000),
            lastSeenAt: Date(timeIntervalSince1970: 1_716_500_000),
            current: false
        )
    }

    static func both() -> [ActiveSessionItem] {
        [current(), other()]
    }
}

@MainActor final class ActiveSessionsModelTests: XCTestCase {
    private func makeModel(
        source: InMemoryActiveSessionsSource,
        telemetry: SpyActiveSessionsTelemetry = SpyActiveSessionsTelemetry(),
        revoker: RecordingRevoker = RecordingRevoker()
    ) -> ActiveSessionsModel {
        ActiveSessionsModel(
            source: source,
            telemetry: telemetry,
            revoker: revoker,
            localize: passthroughLocalize
        )
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyActiveSessionsTelemetry()
        let source = InMemoryActiveSessionsSource()
        let model = makeModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["ActiveSessionsSection"])
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadingThenContent() {
        let source = InMemoryActiveSessionsSource(initial: ActiveSessionsUpdate(status: .loading))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(ActiveSessionsUpdate(status: .loaded, items: ActiveSessionsSectionSampleSessions.both()))
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.hasOtherDevices)
    }

    func testLoadedEmptyResolvesEmpty() {
        let source = InMemoryActiveSessionsSource(initial: ActiveSessionsUpdate(status: .loaded))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertFalse(model.hasOtherDevices)
    }

    func testOpenModeRenders() {
        let source = InMemoryActiveSessionsSource(
            initial: ActiveSessionsUpdate(status: .loaded, mode: .open)
        )
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .openMode)
    }

    func testFailedNoRowsResolvesError() {
        let source = InMemoryActiveSessionsSource(
            initial: ActiveSessionsUpdate(status: .failed("timeout"))
        )
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
        XCTAssertNil(model.inlineErrorMessage)
    }

    func testFailedWithRowsKeepsContentAndSurfacesInlineError() {
        let rows = ActiveSessionsSectionSampleSessions.both()
        let source = InMemoryActiveSessionsSource(
            initial: ActiveSessionsUpdate(status: .loaded, items: rows)
        )
        let model = makeModel(source: source)
        model.start()
        source.push(ActiveSessionsUpdate(status: .failed("stale read"), items: rows))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.inlineErrorMessage, "stale read")
    }

    func testRevokeFlowCallsSeamAndRefreshes() async {
        let source = InMemoryActiveSessionsSource(
            initial: ActiveSessionsUpdate(status: .loaded, items: ActiveSessionsSectionSampleSessions.both())
        )
        let recorder = RecordingRevoker(revokeResult: true)
        let model = makeModel(source: source, revoker: recorder)
        model.start()
        let target = ActiveSessionsSectionSampleSessions.other()
        model.requestRevoke(target)
        XCTAssertEqual(model.revokeTarget?.id, target.id)
        await model.confirmRevoke()
        XCTAssertNil(model.revokeTarget)
        XCTAssertNil(model.revokingID)
        let revoked = await recorder.revokedIDs
        XCTAssertEqual(revoked, [target.id])
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testConfirmRevokeWithoutTargetIsNoOp() async {
        let source = InMemoryActiveSessionsSource(initial: ActiveSessionsUpdate(status: .loaded))
        let recorder = RecordingRevoker()
        let model = makeModel(source: source, revoker: recorder)
        model.start()
        await model.confirmRevoke()
        let revoked = await recorder.revokedIDs
        XCTAssertTrue(revoked.isEmpty)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testRevokeFailureSkipsRefresh() async {
        let source = InMemoryActiveSessionsSource(
            initial: ActiveSessionsUpdate(status: .loaded, items: ActiveSessionsSectionSampleSessions.both())
        )
        let model = makeModel(source: source, revoker: RecordingRevoker(revokeResult: false))
        model.start()
        model.requestRevoke(ActiveSessionsSectionSampleSessions.other())
        await model.confirmRevoke()
        XCTAssertNil(model.revokeTarget)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testRevokeAllOthersFlow() async {
        let source = InMemoryActiveSessionsSource(
            initial: ActiveSessionsUpdate(status: .loaded, items: ActiveSessionsSectionSampleSessions.both())
        )
        let recorder = RecordingRevoker(allOthersResult: 3)
        let model = makeModel(source: source, revoker: recorder)
        model.start()
        model.requestRevokeAllOthers()
        XCTAssertTrue(model.showAllOthersConfirm)
        await model.confirmRevokeAllOthers()
        XCTAssertFalse(model.showAllOthersConfirm)
        XCTAssertFalse(model.isRevokingAllOthers)
        let calls = await recorder.allOthersCalls
        XCTAssertEqual(calls, 1)
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testRevokeAllOthersFailureSkipsRefresh() async {
        let source = InMemoryActiveSessionsSource(initial: ActiveSessionsUpdate(status: .loaded))
        let model = makeModel(source: source, revoker: RecordingRevoker(allOthersResult: -1))
        model.start()
        model.requestRevokeAllOthers()
        await model.confirmRevokeAllOthers()
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testStaleAutoRefreshesOnceThenReArms() {
        let rows = ActiveSessionsSectionSampleSessions.both()
        let source = InMemoryActiveSessionsSource(initial: ActiveSessionsUpdate(status: .loaded, items: rows))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(ActiveSessionsUpdate(status: .loaded, items: rows, connection: .stale))
        source.push(ActiveSessionsUpdate(status: .loaded, items: rows, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(ActiveSessionsUpdate(status: .loaded, items: rows, connection: .live))
        source.push(ActiveSessionsUpdate(status: .loaded, items: rows, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsRowsAndDoesNotRefresh() {
        let rows = ActiveSessionsSectionSampleSessions.both()
        let source = InMemoryActiveSessionsSource(initial: ActiveSessionsUpdate(status: .loaded, items: rows))
        let model = makeModel(source: source)
        model.start()
        source.push(ActiveSessionsUpdate(status: .loaded, items: rows, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testPendingTargetPrunedWhenRowVanishes() {
        let source = InMemoryActiveSessionsSource(
            initial: ActiveSessionsUpdate(status: .loaded, items: ActiveSessionsSectionSampleSessions.both())
        )
        let model = makeModel(source: source)
        model.start()
        model.requestRevoke(ActiveSessionsSectionSampleSessions.other())
        XCTAssertNotNil(model.revokeTarget)
        source.push(ActiveSessionsUpdate(status: .loaded, items: [ActiveSessionsSectionSampleSessions.current()]))
        XCTAssertNil(model.revokeTarget)
    }
}
