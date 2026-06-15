import XCTest
@testable import TeslaSync

// MARK: - System page model + sample tests

@MainActor
final class SystemPageModelTests: XCTestCase {
    func testBothPanelsStartOnLoadingPhase() {
        let model = SystemPageModel()
        XCTAssertEqual(model.rateLimit.phase, .loading)
        XCTAssertEqual(model.queue.phase, .loading)
    }

    func testSampleSourcesPopulateBothPanelsOnStart() {
        let model = SystemPageModel()
        model.rateLimit.start()
        model.queue.start()

        XCTAssertEqual(model.rateLimit.phase, .data)
        XCTAssertEqual(model.rateLimit.rows.count, 3)
        XCTAssertEqual(model.queue.phase, .data)
        XCTAssertEqual(model.queue.workers.count, 3)
    }

    func testInjectedRateLimitSourceOverridesSample() {
        let source = InMemoryRateLimitSource(
            initial: RateLimitInput(response: RateLimitStatusResponse(generatedAt: nil, scopes: []))
        )
        let model = SystemPageModel(rateLimitSource: source)
        model.rateLimit.start()

        XCTAssertEqual(model.rateLimit.phase, .empty)
        XCTAssertEqual(source.startCount, 1)
    }

    func testInjectedQueueSourceOverridesSample() {
        let source = InMemoryQueueStatusSource(
            initial: QueueStatusInput(response: QueueStatusSnapshot(workers: []))
        )
        let model = SystemPageModel(queueSource: source)
        model.queue.start()

        XCTAssertEqual(model.queue.phase, .empty)
        XCTAssertEqual(source.startCount, 1)
    }

    func testRateLimitSampleSeveritiesAreOkWarnCritical() {
        let response = SystemPageSamples.rateLimitResponse()
        XCTAssertEqual(response.scopes.map(\.severity), [.ok, .warn, .critical])
        XCTAssertEqual(response.scopes.map(\.id), [
            "tesla.fleet_api.burst",
            "api.internal.minute",
            "api.write.minute"
        ])
    }

    func testQueueSampleWorkerIdentitiesAndSeverities() {
        let snapshot = SystemPageSamples.queueSnapshot()
        XCTAssertEqual(snapshot.workers.map(\.worker), ["notification", "export", "automation"])
        XCTAssertEqual(snapshot.workers.map(\.heartbeatSeverity), [.ok, .warn, .ok])
    }
}
