//
//  VersionSegment.PollingTests.swift
//  TeslaSync — P4 shared surface · 0181 · VersionSegment (Apple)
//
//  Seam + polling-source coverage: the in-memory source + changelog observer + manual poller doubles, the
//  scripted version/update probes (ordering + repeat-last + empty fallback), the build-info provider
//  fallback, and the production ``PollingVersionSegmentSource`` orchestration — the boot loading emit, the
//  version-probe success/baseline/stale/offline failure semantics, the swallowed update-check failure,
//  the live changelog count, and the poller wiring. Driven through the in-memory seams + the deterministic
//  `probeVersionOnce` / `probeUpdateOnce` hooks — no network, no real time.
//

import XCTest
@testable import TeslaSync

// MARK: - In-memory seams

@MainActor
final class VersionSegmentSeamTests: XCTestCase {
    func testInMemorySourceEmitsInitialAndCounts() {
        let source = InMemoryVersionSegmentSource(initial: VersionSegmentSnapshot(changelogUnseenCount: 3))
        var received: [VersionSegmentSnapshot] = []
        source.onUpdate = { received.append($0) }
        source.start()
        source.push(VersionSegmentSnapshot(changelogUnseenCount: 5))
        source.refresh()
        source.stop()
        XCTAssertEqual(received.map(\.changelogUnseenCount), [3, 5])
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertEqual(source.stopCount, 1)
    }

    func testInMemoryChangelogObserver() {
        let observer = InMemoryChangelogObserver(unseenCount: 2)
        var received: [Int] = []
        observer.onUnseenCountChange = { received.append($0) }
        observer.start()
        observer.push(7)
        XCTAssertEqual(received, [2, 7])
        XCTAssertEqual(observer.unseenCount, 7)
        XCTAssertEqual(observer.startCount, 1)
    }

    func testManualPoller() {
        let poller = ManualVersionSegmentPoller()
        var ticks = 0
        poller.start(interval: 60) { ticks += 1 }
        XCTAssertTrue(poller.isRunning)
        XCTAssertEqual(poller.interval, 60)
        poller.fire()
        poller.fire()
        XCTAssertEqual(ticks, 2)
        poller.stop()
        XCTAssertFalse(poller.isRunning)
        poller.fire()
        XCTAssertEqual(ticks, 2)
    }

    func testBuildInfoProviderAlwaysResolvesNonEmpty() {
        let info = VersionSegmentBuildInfoProvider.bundle(Bundle(for: type(of: self)))
        XCTAssertNotNil(info.buildVersion)
        XCTAssertNotNil(info.buildSHA)
        XCTAssertFalse(info.buildVersion?.isEmpty ?? true)
        XCTAssertFalse(info.buildSHA?.isEmpty ?? true)
    }
}

// MARK: - Scripted probes

final class VersionSegmentProbeTests: XCTestCase {
    func testScriptedVersionProbeOrderThenRepeatsLast() async {
        let probe = ScriptedVersionInfoProbe([
            .info(VersionSegmentInfo(appVersion: "1")),
            .failed(message: "boom", offline: true)
        ])
        let first = await probe.probe()
        let second = await probe.probe()
        let third = await probe.probe()
        XCTAssertEqual(first, .info(VersionSegmentInfo(appVersion: "1")))
        XCTAssertEqual(second, .failed(message: "boom", offline: true))
        XCTAssertEqual(third, .failed(message: "boom", offline: true))
        let count = await probe.probeCount
        XCTAssertEqual(count, 3)
    }

    func testScriptedVersionProbeEmptyFallback() async {
        let probe = ScriptedVersionInfoProbe([])
        let outcome = await probe.probe()
        XCTAssertEqual(outcome, .failed(message: "no scripted outcome", offline: false))
    }

    func testScriptedUpdateProbeOrder() async {
        let probe = ScriptedUpdateCheckProbe([
            .result(UpdateCheckResult(updateAvailable: true, latest: "2.0")),
            .failed(message: "x", offline: false)
        ])
        let first = await probe.probe()
        XCTAssertEqual(first, .result(UpdateCheckResult(updateAvailable: true, latest: "2.0")))
        let second = await probe.probe()
        XCTAssertEqual(second, .failed(message: "x", offline: false))
    }

    func testClosureProbeForwards() async {
        let probe = ClosureVersionInfoProbe { .info(VersionSegmentInfo(appVersion: "9")) }
        let outcome = await probe.probe()
        XCTAssertEqual(outcome, .info(VersionSegmentInfo(appVersion: "9")))
    }
}

// MARK: - Polling source orchestration

@MainActor
final class PollingVersionSegmentSourceTests: XCTestCase {
    private func makeSource(
        version: [VersionInfoProbeOutcome],
        update: [UpdateCheckProbeOutcome] = [.result(UpdateCheckResult(updateAvailable: false))],
        unseen: Int = 0,
        versionPoller: ManualVersionSegmentPoller = ManualVersionSegmentPoller(),
        updatePoller: ManualVersionSegmentPoller = ManualVersionSegmentPoller()
    ) -> PollingVersionSegmentSource {
        PollingVersionSegmentSource(
            versionProbe: ScriptedVersionInfoProbe(version),
            updateProbe: ScriptedUpdateCheckProbe(update),
            changelog: InMemoryChangelogObserver(unseenCount: unseen),
            versionPoller: versionPoller,
            updatePoller: updatePoller
        )
    }

    func testStartEmitsLoadingAndStartsPollers() {
        let versionPoller = ManualVersionSegmentPoller()
        let updatePoller = ManualVersionSegmentPoller()
        let source = makeSource(
            version: [.info(VersionSegmentInfo(appVersion: "1"))],
            versionPoller: versionPoller,
            updatePoller: updatePoller
        )
        var received: [VersionSegmentSnapshot] = []
        source.onUpdate = { received.append($0) }
        source.start()
        XCTAssertTrue(received.first?.isLoading ?? false)
        XCTAssertTrue(versionPoller.isRunning)
        XCTAssertTrue(updatePoller.isRunning)
        source.stop()
        XCTAssertEqual(versionPoller.stopCount, 1)
        XCTAssertEqual(updatePoller.stopCount, 1)
    }

    func testVersionSuccessEmitsReadySnapshot() async {
        let source = makeSource(version: [.info(VersionSegmentInfo(appVersion: "2026.6.2"))])
        var last: VersionSegmentSnapshot?
        source.onUpdate = { last = $0 }
        await source.probeVersionOnce()
        XCTAssertEqual(last?.versionInfo?.appVersion, "2026.6.2")
        XCTAssertFalse(last?.isLoading ?? true)
        XCTAssertNil(last?.errorMessage)
        XCTAssertEqual(last?.connection, .live)
    }

    func testFirstVersionFailureSurfacesError() async {
        let source = makeSource(version: [.failed(message: "down", offline: false)])
        var last: VersionSegmentSnapshot?
        source.onUpdate = { last = $0 }
        await source.probeVersionOnce()
        XCTAssertEqual(last?.errorMessage, "down")
        XCTAssertNil(last?.versionInfo)
        XCTAssertFalse(last?.isLoading ?? true)
    }

    func testFirstVersionFailureOfflineSetsOffline() async {
        let source = makeSource(version: [.failed(message: "no net", offline: true)])
        var last: VersionSegmentSnapshot?
        source.onUpdate = { last = $0 }
        await source.probeVersionOnce()
        XCTAssertEqual(last?.connection, .offline)
        XCTAssertEqual(last?.errorMessage, "no net")
    }

    func testLaterVersionFailureKeepsCachedAndGoesStale() async {
        let source = makeSource(version: [
            .info(VersionSegmentInfo(appVersion: "2026.6.2")),
            .failed(message: "blip", offline: false)
        ])
        var last: VersionSegmentSnapshot?
        source.onUpdate = { last = $0 }
        await source.probeVersionOnce()
        await source.probeVersionOnce()
        XCTAssertEqual(last?.versionInfo?.appVersion, "2026.6.2")
        XCTAssertEqual(last?.connection, .stale)
        XCTAssertNil(last?.errorMessage)
    }

    func testLaterVersionFailureOfflineKeepsCached() async {
        let source = makeSource(version: [
            .info(VersionSegmentInfo(appVersion: "2026.6.2")),
            .failed(message: "blip", offline: true)
        ])
        var last: VersionSegmentSnapshot?
        source.onUpdate = { last = $0 }
        await source.probeVersionOnce()
        await source.probeVersionOnce()
        XCTAssertEqual(last?.connection, .offline)
        XCTAssertEqual(last?.versionInfo?.appVersion, "2026.6.2")
    }

    func testUpdateSuccessAndSwallowedFailure() async {
        let source = makeSource(
            version: [.info(VersionSegmentInfo(appVersion: "1"))],
            update: [
                .result(UpdateCheckResult(updateAvailable: true, latest: "2.0")),
                .failed(message: "x", offline: false)
            ]
        )
        var last: VersionSegmentSnapshot?
        source.onUpdate = { last = $0 }
        await source.probeUpdateOnce()
        XCTAssertEqual(last?.updateCheck, UpdateCheckResult(updateAvailable: true, latest: "2.0"))
        // A later update-check failure is swallowed — the last result is retained.
        await source.probeUpdateOnce()
        XCTAssertEqual(last?.updateCheck, UpdateCheckResult(updateAvailable: true, latest: "2.0"))
    }

    func testChangelogCountFlowsIntoSnapshot() {
        let source = makeSource(version: [.info(VersionSegmentInfo(appVersion: "1"))], unseen: 4)
        var last: VersionSegmentSnapshot?
        source.onUpdate = { last = $0 }
        source.start()
        XCTAssertEqual(last?.changelogUnseenCount, 4)
        source.stop()
    }
}
