//
//  NewVersionBanner.PollingTests.swift
//  TeslaSync — P4 shared surface · 0129 · NewVersionBanner (Apple)
//
//  Seam + polling-source coverage for the version watcher: the in-memory source's emit counters, the
//  per-version dismissal store (web sessionStorage parity), the manual poll clock, the scripted probe
//  double, and the production ``PollingNewVersionBannerSource`` — the boot baseline captured on the
//  first success, the poll updating `latestVersion` only (so `latest != boot` becomes true), the
//  boot-probe failure surfacing as an error, and the post-baseline poll failure keeping the cache while
//  moving the freshness axis to stale (or offline). Split from NewVersionBanner.ModelTests.swift for
//  the file-length budget. Driven through the manual seams + `await probeOnce()` — no real network, no
//  real time.
//

import XCTest
@testable import TeslaSync

// MARK: - In-memory source (previews + tests)

@MainActor
final class InMemoryNewVersionBannerSourceTests: XCTestCase {
    func testStartEmitsInitialAndCountsLifecycle() {
        let source = InMemoryNewVersionBannerSource(
            initial: NewVersionWatcherSnapshot(bootVersion: "1.0", latestVersion: "1.1")
        )
        var snapshots: [NewVersionWatcherSnapshot] = []
        source.onUpdate = { snapshots.append($0) }
        source.start()
        source.refresh()
        source.stop()
        XCTAssertEqual(snapshots.last?.latestVersion, "1.1")
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertEqual(source.stopCount, 1)
    }

    func testPushEmitsWithoutInitial() {
        let source = InMemoryNewVersionBannerSource()
        var snapshots: [NewVersionWatcherSnapshot] = []
        source.onUpdate = { snapshots.append($0) }
        source.start()
        XCTAssertTrue(snapshots.isEmpty)
        source.push(NewVersionWatcherSnapshot(bootVersion: "1.0", latestVersion: "1.2"))
        XCTAssertEqual(snapshots.last?.latestVersion, "1.2")
    }
}

// MARK: - Dismissal store (web sessionStorage parity)

@MainActor
final class InMemoryNewVersionDismissalStoreTests: XCTestCase {
    func testSeedAndSet() {
        let store = InMemoryNewVersionDismissalStore(dismissedVersion: "1.0")
        XCTAssertEqual(store.dismissedVersion, "1.0")
        store.setDismissed("1.1")
        XCTAssertEqual(store.dismissedVersion, "1.1")
        store.setDismissed(nil)
        XCTAssertNil(store.dismissedVersion)
    }
}

// MARK: - Manual poll clock

@MainActor
final class ManualNewVersionPollerTests: XCTestCase {
    func testFireInvokesScheduledTick() {
        let poller = ManualNewVersionPoller()
        var ticks = 0
        poller.start(interval: 300) { ticks += 1 }
        poller.fire()
        poller.fire()
        XCTAssertEqual(ticks, 2)
        XCTAssertEqual(poller.interval, 300)
        XCTAssertTrue(poller.isRunning)
        XCTAssertEqual(poller.startCount, 1)
    }

    func testStopPreventsFurtherTicks() {
        let poller = ManualNewVersionPoller()
        var ticks = 0
        poller.start(interval: 1) { ticks += 1 }
        poller.stop()
        poller.fire()
        XCTAssertEqual(ticks, 0)
        XCTAssertFalse(poller.isRunning)
        XCTAssertEqual(poller.stopCount, 1)
    }
}

// MARK: - Scripted probe (test double)

final class ScriptedVersionProbeTests: XCTestCase {
    func testReturnsQueuedOutcomesThenRepeatsLast() async {
        let probe = ScriptedVersionProbe([.version("1.0"), .failed(message: "x", offline: true)])
        let first = await probe.probe()
        let second = await probe.probe()
        let third = await probe.probe()
        XCTAssertEqual(first, .version("1.0"))
        XCTAssertEqual(second, .failed(message: "x", offline: true))
        XCTAssertEqual(third, .failed(message: "x", offline: true))
        let count = await probe.probeCount
        XCTAssertEqual(count, 3)
    }

    func testEmptyScriptFailsClosed() async {
        let probe = ScriptedVersionProbe([])
        let outcome = await probe.probe()
        XCTAssertEqual(outcome, .failed(message: "no scripted outcome", offline: false))
    }
}

// MARK: - Polling source (web `useVersionWatcher`)

@MainActor
final class PollingNewVersionBannerSourceTests: XCTestCase {
    private func source(_ outcomes: [NewVersionProbeOutcome]) -> (
        PollingNewVersionBannerSource, Recorder
    ) {
        let source = PollingNewVersionBannerSource(
            probe: ScriptedVersionProbe(outcomes),
            poller: ManualNewVersionPoller()
        )
        let recorder = Recorder()
        source.onUpdate = { recorder.append($0) }
        return (source, recorder)
    }

    func testStartEmitsLoadingSnapshotImmediately() {
        let (source, recorder) = source([.version("1.0")])
        source.start()
        XCTAssertEqual(recorder.snapshots.first?.isLoading, true)
        source.stop()
    }

    func testBootProbeSuccessCapturesBaseline() async {
        let (source, recorder) = source([.version("1.0")])
        await source.probeOnce()
        XCTAssertEqual(recorder.snapshots.last?.bootVersion, "1.0")
        XCTAssertEqual(recorder.snapshots.last?.latestVersion, "1.0")
        XCTAssertEqual(recorder.snapshots.last?.connection, .live)
        XCTAssertEqual(recorder.snapshots.last?.isLoading, false)
        XCTAssertFalse(recorder.snapshots.last?.newVersionAvailable ?? true)
    }

    func testPollAfterBaselineUpdatesLatestOnly() async {
        let (source, recorder) = source([.version("1.0"), .version("1.1")])
        await source.probeOnce()
        await source.probeOnce()
        XCTAssertEqual(recorder.snapshots.last?.bootVersion, "1.0")
        XCTAssertEqual(recorder.snapshots.last?.latestVersion, "1.1")
        XCTAssertTrue(recorder.snapshots.last?.newVersionAvailable ?? false)
    }

    func testBootProbeFailureSurfacesError() async {
        let (source, recorder) = source([.failed(message: "boom", offline: false)])
        await source.probeOnce()
        XCTAssertEqual(recorder.snapshots.last?.errorMessage, "boom")
        XCTAssertNil(recorder.snapshots.last?.bootVersion)
    }

    func testBootProbeOfflineFailureMarksOffline() async {
        let (source, recorder) = source([.failed(message: "no net", offline: true)])
        await source.probeOnce()
        XCTAssertEqual(recorder.snapshots.last?.connection, .offline)
        XCTAssertEqual(recorder.snapshots.last?.errorMessage, "no net")
    }

    func testPollFailureAfterBaselineGoesStaleKeepingCache() async {
        let (source, recorder) = source([.version("1.0"), .failed(message: "net", offline: false)])
        await source.probeOnce()
        await source.probeOnce()
        XCTAssertEqual(recorder.snapshots.last?.bootVersion, "1.0")
        XCTAssertEqual(recorder.snapshots.last?.latestVersion, "1.0")
        XCTAssertEqual(recorder.snapshots.last?.connection, .stale)
        XCTAssertNil(recorder.snapshots.last?.errorMessage)
    }

    func testPollOfflineAfterBaselineKeepsCache() async {
        let (source, recorder) = source([.version("1.0"), .failed(message: "net", offline: true)])
        await source.probeOnce()
        await source.probeOnce()
        XCTAssertEqual(recorder.snapshots.last?.connection, .offline)
        XCTAssertEqual(recorder.snapshots.last?.latestVersion, "1.0")
        XCTAssertNil(recorder.snapshots.last?.errorMessage)
    }

    func testRecoveryAfterStaleReturnsToLive() async {
        let (source, recorder) = source([
            .version("1.0"), .failed(message: "net", offline: false), .version("1.1")
        ])
        await source.probeOnce()
        await source.probeOnce()
        await source.probeOnce()
        XCTAssertEqual(recorder.snapshots.last?.connection, .live)
        XCTAssertEqual(recorder.snapshots.last?.latestVersion, "1.1")
    }
}

/// Collects emitted snapshots on the main actor for the polling-source assertions.
@MainActor
private final class Recorder {
    private(set) var snapshots: [NewVersionWatcherSnapshot] = []
    func append(_ snapshot: NewVersionWatcherSnapshot) {
        snapshots.append(snapshot)
    }
}
