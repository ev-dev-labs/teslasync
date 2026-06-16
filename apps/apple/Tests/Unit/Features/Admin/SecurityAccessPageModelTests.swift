import XCTest
@testable import TeslaSync

// MARK: - Security & Access page model + projection tests

@MainActor
final class SecurityAccessPageModelTests: XCTestCase {
    private let fixedNow = Date(timeIntervalSince1970: 1_750_000_000)

    private func makeModel() -> SecurityAccessPageModel {
        SecurityAccessPageModel(
            dataSource: SampleSecurityAccessDataSource(now: { [fixedNow] in fixedNow }),
            clock: { [fixedNow] in fixedNow }
        )
    }

    func testStartsOnLoadingState() {
        let model = SecurityAccessPageModel()
        XCTAssertEqual(model.state, .loading)
        XCTAssertEqual(model.summary.phase, .loading)
        XCTAssertNil(model.latest)
    }

    func testLoadResolvesLoadedAndFeedsSections() async {
        let model = makeModel()
        await model.load()

        XCTAssertEqual(model.state, .loaded)
        XCTAssertEqual(model.vehicles.count, 2)
        XCTAssertEqual(model.selectedVehicleID, "1")
        XCTAssertNotNil(model.latest)
        XCTAssertEqual(model.totalEvents, 10)
        XCTAssertEqual(model.summary.phase, .data)
        XCTAssertEqual(model.cards.phase, .content)
    }

    func testSampleVehicleIsNotSecureSoAlertShows() async {
        let model = makeModel()
        await model.load()

        // Sample latest is locked + sentry-armed but a window is vented → not secure.
        XCTAssertFalse(model.isSecure)
        XCTAssertTrue(model.showsAlert)
        XCTAssertTrue(model.showsTwin)
    }

    func testSelectVehicleUpdatesSelection() async {
        let model = makeModel()
        await model.load()
        model.selectVehicle("2")
        XCTAssertEqual(model.selectedVehicleID, "2")
    }

    func testRangeFilterNarrowsHistory() async {
        let model = makeModel()
        await model.load()
        XCTAssertEqual(model.totalEvents, 10)

        model.setRange(.day)
        // Only the four records within 24h of `fixedNow` remain.
        XCTAssertEqual(model.range, .day)
        XCTAssertEqual(model.totalEvents, 4)

        model.setRange(.all)
        XCTAssertEqual(model.totalEvents, 10)
    }

    func testErrorStateOnFailure() async {
        let model = SecurityAccessPageModel(dataSource: FailingSecurityAccessDataSource())
        await model.load()
        guard case .error = model.state else {
            return XCTFail("expected error state, got \(model.state)")
        }
    }
}

// MARK: - Posture predicate tests (web helpers parity)

final class SecurityAccessPostureTests: XCTestCase {
    func testDoorClosedSemantics() {
        XCTAssertTrue(SecurityAccessPosture.doorClosed(.text("Closed")))
        XCTAssertTrue(SecurityAccessPosture.doorClosed(.absent))
        XCTAssertTrue(SecurityAccessPosture.doorClosed(.bool(false)))
        XCTAssertFalse(SecurityAccessPosture.doorClosed(.text("Driver Front Open")))
        XCTAssertFalse(SecurityAccessPosture.doorClosed(.bool(true)))
    }

    func testWindowClosedSemantics() {
        XCTAssertTrue(SecurityAccessPosture.windowClosed(.text("Closed")))
        XCTAssertFalse(SecurityAccessPosture.windowClosed(.text("Vent")))
        XCTAssertFalse(SecurityAccessPosture.windowClosed(.text("Open")))
    }

    func testIsSecureRequiresLockedDoorAndWindows() {
        let secure = SecurityReading(
            locked: true,
            doorState: .text("Closed"),
            frontDriverWindow: .text("Closed"),
            frontPassengerWindow: .text("Closed"),
            rearDriverWindow: .text("Closed"),
            rearPassengerWindow: .text("Closed")
        )
        XCTAssertTrue(SecurityAccessPosture.isSecure(secure))

        var vented = secure
        vented.frontDriverWindow = .text("Vent")
        XCTAssertFalse(SecurityAccessPosture.isSecure(vented))

        var unlocked = secure
        unlocked.locked = false
        XCTAssertFalse(SecurityAccessPosture.isSecure(unlocked))

        // No reading → treated as secure (no alarming banner on an empty load).
        XCTAssertTrue(SecurityAccessPosture.isSecure(nil))
    }
}

// MARK: - Projection tests

@MainActor
final class SecurityAccessProjectionTests: XCTestCase {
    private let fixedNow = Date(timeIntervalSince1970: 1_750_000_000)

    func testFilterHistoryByRange() {
        let history = SecurityAccessSampleData.history(now: fixedNow)
        XCTAssertEqual(SecurityAccessProjection.filterHistory(history, range: .all, now: fixedNow).count, 10)
        XCTAssertEqual(SecurityAccessProjection.filterHistory(history, range: .day, now: fixedNow).count, 4)
        XCTAssertEqual(SecurityAccessProjection.filterHistory(history, range: .week, now: fixedNow).count, 10)
    }

    func testSentryBucketsSpanMultipleDays() {
        let history = SecurityAccessSampleData.history(now: fixedNow)
        let buckets = SecurityAccessProjection.buildSentryBuckets(history)
        XCTAssertGreaterThan(buckets.count, 1)
        let total = buckets.reduce(0) { $0 + $1.sentryOn + $1.sentryOff }
        XCTAssertEqual(total, history.count)
    }

    func testStatisticsOutcomeEmptyVsLoaded() {
        XCTAssertEqual(SecurityAccessProjection.statisticsOutcome([]), .empty)
        let history = SecurityAccessSampleData.history(now: fixedNow)
        guard case let .loaded(snapshot) = SecurityAccessProjection.statisticsOutcome(history) else {
            return XCTFail("expected loaded statistics outcome")
        }
        XCTAssertEqual(snapshot.stats.total, history.count)
        XCTAssertGreaterThanOrEqual(snapshot.sentryUptimePercent, 0)
        XCTAssertLessThanOrEqual(snapshot.sentryUptimePercent, 100)
    }

    func testCardsUpdateReflectsLatestPresence() {
        XCTAssertEqual(SecurityAccessProjection.cardsUpdate(nil).status, .empty)
        let loaded = SecurityAccessProjection.cardsUpdate(SecurityAccessSampleData.latest(now: fixedNow))
        XCTAssertEqual(loaded.status, .loaded)
        XCTAssertNotNil(loaded.latest)
    }
}

// MARK: - Test doubles

private struct FailingSecurityAccessDataSource: SecurityAccessDataSource {
    struct LoadError: Error {}
    func load(vehicleID _: String?) async throws -> SecurityAccessReport {
        throw LoadError()
    }
}
