//
//  ConnectionSegment.Tests.swift
//  TeslaSync — P4 shared surface · 0178 · ConnectionSegment (Apple)
//
//  State-holder / view / telemetry coverage for the ConnectionSegment surface:
//    • Model — snapshot adoption from the source, the `iconOnly` projection through the injected clock, the
//      lazy once-only `view.opened` telemetry, the safe no-op stop, refresh forwarding, and the
//      stale-driven re-probe (`refreshIfStale` + the on-`start()` foreground refresh).
//    • Views — the public surface (both initializers, expanded + iconOnly) and the presentational leaves
//      compose (signature contract), and the tone → token mapping.
//
//  The pure projection / bucketing coverage lives in ConnectionSegment.AdapterTests.swift; the seam +
//  polling coverage in ConnectionSegment.PollingTests.swift. These run in the TeslaSync(/-macOS) XCTest
//  targets with no network and no real transport; a fixed clock keeps the freshness assertions deterministic.
//

import SwiftUI
import XCTest

private let englishStrings: ConnectionSegmentResolve = { _, fallback in fallback }
private let fixedNow = Date(timeIntervalSince1970: 1_700_000_000)

// MARK: - Model (state-holder)

@MainActor
final class ConnectionSegmentModelTests: XCTestCase {
    private func makeModel(
        source: any ConnectionSegmentSource,
        telemetry: any ConnectionSegmentTelemetry = OSLogConnectionSegmentTelemetry(),
        now: Date = fixedNow
    ) -> ConnectionSegmentModel {
        ConnectionSegmentModel(source: source, telemetry: telemetry, strings: englishStrings, clock: { now })
    }

    func testSnapshotAdoptedFromSource() {
        let source = InMemoryConnectionSegmentSource()
        let model = makeModel(source: source)
        XCTAssertEqual(model.snapshot.status, .connecting)

        source.push(ConnectionSegmentSnapshot(status: .online, latencyMs: 42, lastCheckedAt: fixedNow))
        XCTAssertEqual(model.snapshot.status, .online)
        XCTAssertEqual(model.snapshot.latencyMs, 42)
    }

    func testResolvedProjectsSnapshotWithInjectedClock() {
        let source = InMemoryConnectionSegmentSource()
        let model = makeModel(source: source)
        source.push(ConnectionSegmentSnapshot(status: .online, latencyMs: 42, lastCheckedAt: fixedNow))

        let resolved = model.resolved(iconOnly: false)
        XCTAssertEqual(resolved.status, .online)
        XCTAssertEqual(resolved.shortLabel, "API")
        XCTAssertEqual(resolved.suffix, "42ms")
    }

    func testResolvedRespectsIconOnlyGate() {
        let source = InMemoryConnectionSegmentSource()
        let model = makeModel(source: source)
        source.push(ConnectionSegmentSnapshot(status: .online, latencyMs: 42, lastCheckedAt: fixedNow))

        let resolved = model.resolved(iconOnly: true)
        XCTAssertFalse(resolved.showsLabel)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyConnectionSegmentTelemetry()
        let model = makeModel(source: InMemoryConnectionSegmentSource(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [ConnectionSegmentSurface.slug])
    }

    func testStartActivatesSource() {
        let source = InMemoryConnectionSegmentSource(
            initial: ConnectionSegmentSnapshot(status: .online, latencyMs: 10, lastCheckedAt: fixedNow)
        )
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(model.snapshot.status, .online)
    }

    func testStopIsSafeAndDoesNotEmit() {
        let spy = SpyConnectionSegmentTelemetry()
        let source = InMemoryConnectionSegmentSource()
        let model = makeModel(source: source, telemetry: spy)
        model.start()
        model.stop()
        model.stop()
        XCTAssertEqual(spy.surfaces, [ConnectionSegmentSurface.slug])
        XCTAssertEqual(source.stopCount, 2)
    }

    func testRefreshForwardsToSource() {
        let source = InMemoryConnectionSegmentSource()
        let model = makeModel(source: source)
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testRefreshIfStaleReProbesOnlyWhenAged() {
        let source = InMemoryConnectionSegmentSource()
        let model = makeModel(source: source)
        // Fresh reading — no re-probe.
        source.push(ConnectionSegmentSnapshot(status: .online, latencyMs: 42, lastCheckedAt: fixedNow))
        model.refreshIfStale(now: fixedNow)
        XCTAssertEqual(source.refreshCount, 0)
        // Aged reading — one re-probe.
        let aged = fixedNow.addingTimeInterval(-(ConnectionSegmentSurface.stalenessWindowSeconds + 5))
        source.push(ConnectionSegmentSnapshot(status: .online, latencyMs: 42, lastCheckedAt: aged))
        model.refreshIfStale(now: fixedNow)
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStartRefreshesWhenSeededStale() {
        let aged = fixedNow.addingTimeInterval(-(ConnectionSegmentSurface.stalenessWindowSeconds + 5))
        let source = InMemoryConnectionSegmentSource(
            initial: ConnectionSegmentSnapshot(status: .online, latencyMs: 42, lastCheckedAt: aged)
        )
        let model = makeModel(source: source)
        model.start()
        // start() pushes the seeded (stale) snapshot, then refreshIfStale re-probes once.
        XCTAssertEqual(source.refreshCount, 1)
    }
}

// MARK: - Views (every form composes — signature contract)

@MainActor
final class ConnectionSegmentViewTests: XCTestCase {
    private func resolved(_ status: ConnectionHealthStatus) -> ConnectionSegmentResolved {
        ConnectionSegmentProjection.resolve(
            snapshot: ConnectionSegmentSnapshot(status: status, latencyMs: 42, lastCheckedAt: fixedNow),
            now: fixedNow,
            strings: englishStrings
        )
    }

    func testLeavesCompose() {
        _ = ConnectionSegmentChip(resolved: resolved(.online))
        _ = ConnectionSegmentChip(resolved: resolved(.offline))
        _ = ConnectionSegmentStatusIcon(icon: .activity)
        _ = ConnectionSegmentStatusIcon(icon: .help)
    }

    func testPublicSurfacesCompose() {
        _ = ConnectionSegment(model: ConnectionSegmentModel(source: InMemoryConnectionSegmentSource()))
        _ = ConnectionSegment(
            iconOnly: true,
            model: ConnectionSegmentModel(source: InMemoryConnectionSegmentSource()),
            onOpen: {}
        )
        _ = ConnectionSegment(
            probe: ScriptedConnectionHealthProbe([]),
            poller: ManualConnectionSegmentPoller(),
            onOpen: {}
        )
    }

    func testToneMapsToToken() {
        XCTAssertEqual(ConnectionSegmentTone.success.color, Color.TS.statusSuccess)
        XCTAssertEqual(ConnectionSegmentTone.warning.color, Color.TS.statusWarning)
        XCTAssertEqual(ConnectionSegmentTone.danger.color, Color.TS.statusDanger)
        XCTAssertEqual(ConnectionSegmentTone.muted.color, Color.TS.textMuted)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it satisfies
/// the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyConnectionSegmentTelemetry: ConnectionSegmentTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var surfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    func viewOpened(surface: String) {
        lock.lock()
        storage.append(surface)
        lock.unlock()
    }
}

@testable import TeslaSync
