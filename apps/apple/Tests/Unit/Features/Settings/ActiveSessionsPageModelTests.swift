import XCTest
@testable import TeslaSync

/// State-machine + behavior tests for `ActiveSessionsPageModel` — every data state the
/// page renders (loading / open / empty / error / loaded), the per-row + bulk revoke
/// flows (busy flag lifecycle, refetch, failure notices), the `hasOtherSessions` gate,
/// and the `SessionDeviceLabel` heuristic ported from the web `describeDevice`.
@MainActor
final class ActiveSessionsPageModelTests: XCTestCase {
    private struct StubError: Error {}

    /// Configurable async double for the data-source seam. Backed by an `actor` so the
    /// revoke mutations persist across the model's refetch, exactly like production.
    private actor StubSource: ActiveSessionsDataSource {
        private var result: SessionsLoadResult
        private let failLoad: Bool
        private let failRevoke: Bool
        private let failAllOthers: Bool
        private(set) var revokedIDs: [String] = []
        private(set) var allOthersCalls = 0

        init(
            result: SessionsLoadResult,
            failLoad: Bool = false,
            failRevoke: Bool = false,
            failAllOthers: Bool = false
        ) {
            self.result = result
            self.failLoad = failLoad
            self.failRevoke = failRevoke
            self.failAllOthers = failAllOthers
        }

        func load() async throws -> SessionsLoadResult {
            if failLoad { throw StubError() }
            return result
        }

        func revoke(id: String) async throws {
            if failRevoke { throw StubError() }
            revokedIDs.append(id)
            if case let .sessions(rows) = result {
                result = .sessions(rows.filter { $0.id != id })
            }
        }

        func revokeAllOthers() async throws -> Int {
            if failAllOthers { throw StubError() }
            allOthersCalls += 1
            guard case let .sessions(rows) = result else { return 0 }
            let removed = rows.filter { !$0.current }.count
            result = .sessions(rows.filter(\.current))
            return removed
        }
    }

    private func session(_ id: String, current: Bool = false, agent: String = "UA") -> ActiveSession {
        ActiveSession(
            id: id,
            userAgent: agent,
            ip: "10.0.0.1",
            createdAt: Date(timeIntervalSince1970: 1_700_000_000),
            lastSeenAt: Date(timeIntervalSince1970: 1_700_100_000),
            current: current
        )
    }

    // MARK: - Load states

    func testInitialStateIsLoading() {
        let model = ActiveSessionsPageModel(dataSource: StubSource(result: .sessions([])))
        XCTAssertEqual(model.state, .loading)
    }

    func testLoadWithRowsResolvesLoaded() async {
        let rows = [session("a", current: true), session("b")]
        let model = ActiveSessionsPageModel(dataSource: StubSource(result: .sessions(rows)))
        await model.load()
        XCTAssertEqual(model.sessions.map(\.id), ["a", "b"])
        XCTAssertTrue(model.hasOtherSessions)
    }

    func testLoadWithNoRowsResolvesEmpty() async {
        let model = ActiveSessionsPageModel(dataSource: StubSource(result: .sessions([])))
        await model.load()
        XCTAssertEqual(model.state, .empty)
        XCTAssertFalse(model.hasOtherSessions)
    }

    func testLoadOpenModeResolvesOpen() async {
        let model = ActiveSessionsPageModel(dataSource: StubSource(result: .open))
        await model.load()
        XCTAssertEqual(model.state, .open)
    }

    func testLoadFailureResolvesError() async {
        let model = ActiveSessionsPageModel(dataSource: StubSource(result: .sessions([]), failLoad: true))
        await model.load()
        guard case .error = model.state else {
            return XCTFail("expected error state, got \(model.state)")
        }
    }

    func testHasOtherSessionsFalseWhenOnlyCurrent() async {
        let model = ActiveSessionsPageModel(dataSource: StubSource(result: .sessions([session("a", current: true)])))
        await model.load()
        XCTAssertFalse(model.hasOtherSessions)
    }

    // MARK: - Revoke flows

    func testRevokeRemovesRowAndRefetches() async {
        let source = StubSource(result: .sessions([session("a", current: true), session("b")]))
        let model = ActiveSessionsPageModel(dataSource: source)
        await model.load()
        await model.revoke(session("b"))
        XCTAssertEqual(model.sessions.map(\.id), ["a"])
        XCTAssertNil(model.revokingSessionID)
        XCTAssertNil(model.actionError)
        let revoked = await source.revokedIDs
        XCTAssertEqual(revoked, ["b"])
    }

    func testRevokeFailureSetsActionError() async {
        let source = StubSource(result: .sessions([session("a", current: true), session("b")]), failRevoke: true)
        let model = ActiveSessionsPageModel(dataSource: source)
        await model.load()
        await model.revoke(session("b"))
        XCTAssertEqual(model.actionError, .revoke)
        XCTAssertEqual(model.sessions.map(\.id), ["a", "b"], "rows stay intact when revoke fails")
        XCTAssertNil(model.revokingSessionID)
    }

    func testRevokeAllOthersRemovesNonCurrentAndRefetches() async {
        let source = StubSource(result: .sessions([session("a", current: true), session("b"), session("c")]))
        let model = ActiveSessionsPageModel(dataSource: source)
        await model.load()
        await model.revokeAllOthers()
        XCTAssertEqual(model.sessions.map(\.id), ["a"])
        XCTAssertFalse(model.isRevokingAllOthers)
        let calls = await source.allOthersCalls
        XCTAssertEqual(calls, 1)
    }

    func testRevokeAllOthersFailureSetsActionError() async {
        let source = StubSource(
            result: .sessions([session("a", current: true), session("b")]),
            failAllOthers: true
        )
        let model = ActiveSessionsPageModel(dataSource: source)
        await model.load()
        await model.revokeAllOthers()
        XCTAssertEqual(model.actionError, .revokeAllOthers)
        XCTAssertEqual(model.sessions.map(\.id), ["a", "b"])
    }

    func testClearActionErrorResets() async {
        let source = StubSource(result: .sessions([session("a", current: true), session("b")]), failRevoke: true)
        let model = ActiveSessionsPageModel(dataSource: source)
        await model.load()
        await model.revoke(session("b"))
        XCTAssertEqual(model.actionError, .revoke)
        model.clearActionError()
        XCTAssertNil(model.actionError)
    }

    // MARK: - Sample seam default

    func testSampleSourceRendersPopulatedList() async {
        let model = ActiveSessionsPageModel()
        await model.load()
        XCTAssertFalse(model.sessions.isEmpty)
        XCTAssertTrue(model.sessions.contains(where: \.current))
        XCTAssertTrue(model.hasOtherSessions)
    }

    // MARK: - Device label heuristic (web describeDevice)

    func testBrowserTokenDetection() {
        XCTAssertEqual(SessionDeviceLabel.browserToken("Mozilla/5.0 Chrome/126.0 Safari/537.36"), "Chrome")
        XCTAssertEqual(SessionDeviceLabel.browserToken("Mozilla/5.0 Firefox/127.0"), "Firefox")
        XCTAssertEqual(
            SessionDeviceLabel.browserToken("Mozilla/5.0 Version/17.5 Safari/605.1.15"),
            "Safari"
        )
        XCTAssertEqual(SessionDeviceLabel.browserToken("Mozilla/5.0 Edg/126.0"), "Edge")
        XCTAssertNil(SessionDeviceLabel.browserToken("curl/8.0"))
    }

    func testOSTokenDetection() {
        XCTAssertEqual(SessionDeviceLabel.osToken("Windows NT 10.0; Win64"), "Windows")
        XCTAssertEqual(SessionDeviceLabel.osToken("Macintosh; Intel Mac OS X 14_5"), "macOS")
        XCTAssertEqual(SessionDeviceLabel.osToken("iPhone; CPU iPhone OS 17_5"), "iOS")
        XCTAssertEqual(SessionDeviceLabel.osToken("Linux x86_64"), "Linux")
        XCTAssertNil(SessionDeviceLabel.osToken("SomethingElse/1.0"))
    }

    func testDeviceLabelEmptyAgentIsUnknown() {
        XCTAssertEqual(SessionDeviceLabel.text(forUserAgent: "   "), String(localized: "sessions.device.unknown"))
    }

    func testDeviceLabelComposesBrowserAndOS() {
        let label = SessionDeviceLabel.text(
            forUserAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/126.0 Safari/537.36"
        )
        XCTAssertTrue(label.contains("Chrome"))
        XCTAssertTrue(label.contains("Windows"))
    }
}
