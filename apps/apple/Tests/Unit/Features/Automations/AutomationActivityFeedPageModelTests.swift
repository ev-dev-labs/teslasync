import XCTest
@testable import TeslaSync

/// State-machine + projection tests for `AutomationActivityFeedPageModel` — every data state
/// the page renders (loading / empty / success), the live-event cap, the stats gate, the
/// connection chip, and the web formatting ports.
@MainActor final class AutomationActivityFeedPageModelTests: XCTestCase {
    private struct StubFeed: AutomationActivityFeedProviding {
        let value: AutomationActivityFeedSnapshot
        init(_ value: AutomationActivityFeedSnapshot) {
            self.value = value
        }

        func snapshot() async -> AutomationActivityFeedSnapshot {
            value
        }
    }

    private func run(_ id: String, status: AutomationActivityRunStatus = .success) -> AutomationActivityRun {
        AutomationActivityRun(id: id, name: "Run \(id)", status: status, durationMs: 1200)
    }

    // MARK: - States

    func testInitialStateIsLoading() {
        let model = AutomationActivityFeedPageModel(provider: StubFeed(AutomationActivityFeedSnapshot()))
        XCTAssertEqual(model.state, .loading)
        XCTAssertTrue(model.runs.isEmpty)
        XCTAssertFalse(model.showsStats)
    }

    func testLoadSuccessPopulatesRuns() async {
        let runs = [run("1"), run("2", status: .failed)]
        let model = AutomationActivityFeedPageModel(provider: StubFeed(AutomationActivityFeedSnapshot(runs: runs)))
        await model.load()
        XCTAssertEqual(model.state, .success)
        XCTAssertEqual(model.runs.count, 2)
    }

    func testLoadEmptyYieldsEmptyState() async {
        let model = AutomationActivityFeedPageModel(provider: StubFeed(AutomationActivityFeedSnapshot(runs: [])))
        await model.load()
        XCTAssertEqual(model.state, .empty)
        XCTAssertTrue(model.runs.isEmpty)
    }

    func testIsLoadingSnapshotStaysLoadingEvenWithStats() async {
        let snapshot = AutomationActivityFeedSnapshot(
            stats: AutomationActivityStats(totalRuns: 5, successRate: 80, avgDurationMs: 1000),
            isLoading: true
        )
        let model = AutomationActivityFeedPageModel(provider: StubFeed(snapshot))
        await model.load()
        XCTAssertEqual(model.state, .loading)
        // Header stats render independently of the loading history list.
        XCTAssertTrue(model.showsStats)
    }

    // MARK: - Header overlays

    func testStatsGateHidesWhenZeroExecutions() async {
        let snapshot = AutomationActivityFeedSnapshot(
            runs: [run("1")],
            stats: AutomationActivityStats(totalRuns: 0, successRate: 0, avgDurationMs: 0)
        )
        let model = AutomationActivityFeedPageModel(provider: StubFeed(snapshot))
        await model.load()
        XCTAssertNil(model.stats)
        XCTAssertFalse(model.showsStats)
    }

    func testStatsShownWhenExecutionsPresent() async {
        let snapshot = AutomationActivityFeedSnapshot(
            runs: [run("1")],
            stats: AutomationActivityStats(totalRuns: 142, successRate: 93, avgDurationMs: 1320)
        )
        let model = AutomationActivityFeedPageModel(provider: StubFeed(snapshot))
        await model.load()
        XCTAssertEqual(model.stats?.totalRuns, 142)
        XCTAssertTrue(model.showsStats)
    }

    func testLiveEventsCappedAtFive() async {
        let events = (0 ..< 8).map {
            AutomationActivityLiveEvent(id: "ae-\($0)", type: "automation.triggered", automationId: $0, name: "A\($0)")
        }
        let model = AutomationActivityFeedPageModel(
            provider: StubFeed(AutomationActivityFeedSnapshot(runs: [run("1")], liveEvents: events))
        )
        await model.load()
        XCTAssertEqual(model.liveEvents.count, AutomationActivityFeedPageModel.liveEventLimit)
        XCTAssertEqual(model.liveEvents.first?.id, "ae-0")
    }

    func testConnectionReflectsSnapshot() async {
        let model = AutomationActivityFeedPageModel(
            provider: StubFeed(AutomationActivityFeedSnapshot(connection: .reconnecting))
        )
        await model.load()
        XCTAssertEqual(model.connection, .reconnecting)
    }

    func testRefreshReloadsFromProvider() async {
        let model = AutomationActivityFeedPageModel(
            provider: StubFeed(AutomationActivityFeedSnapshot(runs: [run("1")]))
        )
        await model.refresh()
        XCTAssertEqual(model.state, .success)
        XCTAssertEqual(model.runs.count, 1)
    }

    func testDefaultProviderProducesSuccess() async {
        let model = AutomationActivityFeedPageModel()
        await model.load()
        XCTAssertEqual(model.state, .success)
        XCTAssertFalse(model.runs.isEmpty)
        XCTAssertTrue(model.showsStats)
    }

    // MARK: - Parsing + projection

    func testStatusParseFallsBackToRunning() {
        XCTAssertEqual(AutomationActivityRunStatus.parse("success"), .success)
        XCTAssertEqual(AutomationActivityRunStatus.parse("SKIPPED"), .skipped)
        XCTAssertEqual(AutomationActivityRunStatus.parse("nonsense"), .running)
    }

    func testEventKindParseFallsBackToTriggered() {
        XCTAssertEqual(AutomationActivityEventKind.parse("automation.failed"), .failed)
        XCTAssertEqual(AutomationActivityEventKind.parse("automation.state_changed"), .stateChanged)
        XCTAssertEqual(AutomationActivityEventKind.parse("unknown"), .triggered)
    }

    func testLiveEventNameFallsBackToId() {
        let event = AutomationActivityLiveEvent(id: "x", type: "automation.triggered", automationId: 42)
        XCTAssertEqual(event.name, "#42")
    }

    func testRunActionsTextGating() {
        XCTAssertNil(AutomationActivityRun(id: "1", name: "n", status: .success).actionsText)
        let withActions = AutomationActivityRun(
            id: "2",
            name: "n",
            status: .success,
            actionsTotal: 3,
            actionsSucceeded: 2
        )
        XCTAssertEqual(withActions.actionsText, "2/3")
    }

    func testEmptyErrorFoldsToNil() {
        let run = AutomationActivityRun(id: "1", name: "n", status: .failed, error: "")
        XCTAssertNil(run.error)
    }

    // MARK: - Formatting (web ports)

    func testDurationFormatting() {
        XCTAssertEqual(AutomationActivityFormat.duration(nil), "—")
        XCTAssertEqual(AutomationActivityFormat.duration(450), "450ms")
        XCTAssertEqual(AutomationActivityFormat.duration(1840), "1.8s")
    }

    func testPercentFormatting() {
        XCTAssertEqual(AutomationActivityFormat.percent(93, locale: Locale(identifier: "en_US")), "93%")
        XCTAssertEqual(AutomationActivityFormat.percent(nil, locale: Locale(identifier: "en_US")), "0%")
    }

    func testDateParsing() {
        XCTAssertNotNil(AutomationActivityFormat.parseDate("2026-01-05T15:04:05Z"))
        XCTAssertNotNil(AutomationActivityFormat.parseDate("1736089445"))
        XCTAssertNil(AutomationActivityFormat.parseDate(""))
    }
}
