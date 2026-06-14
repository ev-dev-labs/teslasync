//
//  ConnectionSegment.PollingTests.swift
//  TeslaSync — P4 shared surface · 0178 · ConnectionSegment (Apple)
//
//  Seam + polling-source coverage: the in-memory source + manual poller doubles, the scripted health probe
//  (ordering + repeat-last + empty fallback), and the production ``PollingConnectionSegmentSource``
//  orchestration — the up-front `connecting` emit, the immediate first probe + the poll cadence wiring, and
//  each reading bucketed into `online` / `degraded` / `offline`. Driven through the in-memory seams + the
//  deterministic `probeOnce` hook — no network, no real time.
//

import XCTest

private let fixedNow = Date(timeIntervalSince1970: 1_700_000_000)

// MARK: - In-memory seams

@MainActor
final class ConnectionSegmentSeamTests: XCTestCase {
    func testInMemorySourceEmitsInitialAndCounts() {
        let source = InMemoryConnectionSegmentSource(
            initial: ConnectionSegmentSnapshot(status: .online, latencyMs: 30, lastCheckedAt: fixedNow)
        )
        var received: [ConnectionHealthStatus] = []
        source.onUpdate = { received.append($0.status) }
        source.start()
        source.push(ConnectionSegmentSnapshot(status: .degraded, latencyMs: 700, lastCheckedAt: fixedNow))
        source.refresh()
        source.stop()
        XCTAssertEqual(received, [.online, .degraded])
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertEqual(source.stopCount, 1)
    }

    func testManualPoller() {
        let poller = ManualConnectionSegmentPoller()
        var ticks = 0
        poller.start(interval: 15) { ticks += 1 }
        XCTAssertTrue(poller.isRunning)
        XCTAssertEqual(poller.interval, 15)
        poller.fire()
        poller.fire()
        XCTAssertEqual(ticks, 2)
        poller.stop()
        XCTAssertFalse(poller.isRunning)
        poller.fire()
        XCTAssertEqual(ticks, 2)
    }
}

// MARK: - Scripted probe

final class ConnectionHealthProbeTests: XCTestCase {
    func testScriptedProbeOrderThenRepeatsLast() async {
        let probe = ScriptedConnectionHealthProbe([
            ConnectionProbeResult(ok: true, latencyMs: 40, checkedAt: fixedNow),
            ConnectionProbeResult(ok: false, latencyMs: 5000, checkedAt: fixedNow)
        ])
        let first = await probe.probe()
        let second = await probe.probe()
        let third = await probe.probe()
        XCTAssertEqual(first, ConnectionProbeResult(ok: true, latencyMs: 40, checkedAt: fixedNow))
        XCTAssertEqual(second, ConnectionProbeResult(ok: false, latencyMs: 5000, checkedAt: fixedNow))
        XCTAssertEqual(third, ConnectionProbeResult(ok: false, latencyMs: 5000, checkedAt: fixedNow))
        let count = await probe.probeCount
        XCTAssertEqual(count, 3)
    }

    func testScriptedProbeEmptyFallbackIsFailure() async {
        let probe = ScriptedConnectionHealthProbe([])
        let result = await probe.probe()
        XCTAssertFalse(result.ok)
    }

    func testClosureProbeForwards() async {
        let probe = ClosureConnectionHealthProbe {
            ConnectionProbeResult(ok: true, latencyMs: 9, checkedAt: fixedNow)
        }
        let result = await probe.probe()
        XCTAssertEqual(result, ConnectionProbeResult(ok: true, latencyMs: 9, checkedAt: fixedNow))
    }
}

// MARK: - Polling source orchestration

@MainActor
final class PollingConnectionSegmentSourceTests: XCTestCase {
    private func makeSource(
        results: [ConnectionProbeResult],
        poller: ManualConnectionSegmentPoller = ManualConnectionSegmentPoller()
    ) -> PollingConnectionSegmentSource {
        PollingConnectionSegmentSource(
            probe: ScriptedConnectionHealthProbe(results),
            poller: poller,
            interval: ConnectionSegmentSurface.pollIntervalSeconds
        )
    }

    func testStartEmitsConnectingAndStartsPoller() {
        let poller = ManualConnectionSegmentPoller()
        let source = makeSource(
            results: [ConnectionProbeResult(ok: true, latencyMs: 30, checkedAt: fixedNow)],
            poller: poller
        )
        var received: [ConnectionSegmentSnapshot] = []
        source.onUpdate = { received.append($0) }
        source.start()
        XCTAssertEqual(received.first?.status, .connecting)
        XCTAssertTrue(poller.isRunning)
        source.stop()
        XCTAssertEqual(poller.stopCount, 1)
    }

    func testSuccessfulProbeEmitsOnlineSnapshot() async {
        let source = makeSource(results: [ConnectionProbeResult(ok: true, latencyMs: 88, checkedAt: fixedNow)])
        var last: ConnectionSegmentSnapshot?
        source.onUpdate = { last = $0 }
        await source.probeOnce()
        XCTAssertEqual(last?.status, .online)
        XCTAssertEqual(last?.latencyMs, 88)
        XCTAssertEqual(last?.lastCheckedAt, fixedNow)
    }

    func testSlowProbeEmitsDegradedSnapshot() async {
        let source = makeSource(results: [ConnectionProbeResult(ok: true, latencyMs: 900, checkedAt: fixedNow)])
        var last: ConnectionSegmentSnapshot?
        source.onUpdate = { last = $0 }
        await source.probeOnce()
        XCTAssertEqual(last?.status, .degraded)
        XCTAssertEqual(last?.latencyMs, 900)
    }

    func testFailedProbeEmitsOfflineSnapshot() async {
        let source = makeSource(results: [ConnectionProbeResult(ok: false, latencyMs: 5000, checkedAt: fixedNow)])
        var last: ConnectionSegmentSnapshot?
        source.onUpdate = { last = $0 }
        await source.probeOnce()
        XCTAssertEqual(last?.status, .offline)
    }

    func testRefreshReProbes() async {
        let source = makeSource(results: [
            ConnectionProbeResult(ok: true, latencyMs: 40, checkedAt: fixedNow),
            ConnectionProbeResult(ok: false, latencyMs: 5000, checkedAt: fixedNow)
        ])
        var statuses: [ConnectionHealthStatus] = []
        source.onUpdate = { statuses.append($0.status) }
        await source.probeOnce()
        await source.probeOnce()
        XCTAssertEqual(statuses, [.online, .offline])
    }
}

@testable import TeslaSync
