//
//  LiveIndicator.Tests.swift
//  TeslaSync — P4 shared surface · 0094 · LiveIndicator (Apple)
//
//  State-holder / view / telemetry / seam coverage for the LiveIndicator surface:
//    • Model — snapshot adoption from the source, the variant projection through the injected clock,
//      the lazy once-only `view.opened` telemetry, the safe no-op stop, and refresh forwarding.
//    • Seams — the in-memory source call counters + initial push, and the production source emitting
//      on `update(_:)` / deriving on `update(reading:)`.
//    • Views — the public surface (both initializers, every variant) and the presentational leaves
//      compose (signature contract).
//
//  The pure derivation / projection / relative-time coverage lives in
//  LiveIndicator.ProjectionTests.swift. These run in the TeslaSync(/-macOS) XCTest targets with no
//  network and no real transport; a fixed clock + locale keep the freshness assertions deterministic.
//

import SwiftUI
import XCTest

private let englishStrings: LiveIndicatorResolve = { _, fallback in fallback }
private let fixedNow = Date(timeIntervalSince1970: 1_700_000_000)
private let usLocale = Locale(identifier: "en_US")

// MARK: - Model (state-holder)

@MainActor
final class LiveIndicatorModelTests: XCTestCase {
    private func makeModel(
        source: any LiveIndicatorSource,
        telemetry: any LiveIndicatorTelemetry = OSLogLiveIndicatorTelemetry()
    ) -> LiveIndicatorModel {
        LiveIndicatorModel(
            source: source,
            telemetry: telemetry,
            strings: englishStrings,
            locale: usLocale,
            clock: { fixedNow }
        )
    }

    func testSnapshotAdoptedFromSource() {
        let source = InMemoryLiveIndicatorSource()
        let model = makeModel(source: source)
        XCTAssertEqual(model.snapshot.status, .unknown)

        source.push(LiveConnectionSnapshot(status: .connected, lastMessageAt: fixedNow))
        XCTAssertEqual(model.snapshot.status, .connected)
    }

    func testResolvedProjectsSnapshotWithInjectedClock() {
        let source = InMemoryLiveIndicatorSource()
        let model = makeModel(source: source)
        source.push(LiveConnectionSnapshot(status: .connected, lastMessageAt: fixedNow.addingTimeInterval(-300)))

        let resolved = model.resolved(variant: .pill)
        XCTAssertEqual(resolved.status, .connected)
        XCTAssertEqual(resolved.label, "Live")
        XCTAssertEqual(resolved.freshness, "5m ago")
    }

    func testResolvedRespectsVariantFreshnessGate() {
        let source = InMemoryLiveIndicatorSource()
        let model = makeModel(source: source)
        source.push(LiveConnectionSnapshot(status: .connected, lastMessageAt: fixedNow.addingTimeInterval(-300)))
        XCTAssertNil(model.resolved(variant: .compact).freshness)
        XCTAssertNil(model.resolved(variant: .dot).freshness)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyLiveIndicatorTelemetry()
        let model = makeModel(source: InMemoryLiveIndicatorSource(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [LiveIndicatorMeta.surfaceSlug])
    }

    func testStartActivatesSource() {
        let source = InMemoryLiveIndicatorSource(initial: LiveConnectionSnapshot(status: .connected))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(model.snapshot.status, .connected)
    }

    func testStopIsSafeAndDoesNotEmit() {
        let spy = SpyLiveIndicatorTelemetry()
        let source = InMemoryLiveIndicatorSource()
        let model = makeModel(source: source, telemetry: spy)
        model.start()
        model.stop()
        model.stop()
        XCTAssertEqual(spy.surfaces, [LiveIndicatorMeta.surfaceSlug])
        XCTAssertEqual(source.stopCount, 2)
    }

    func testRefreshForwardsToSource() {
        let source = InMemoryLiveIndicatorSource()
        let model = makeModel(source: source)
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }
}

// MARK: - Seams (sources)

@MainActor
final class LiveIndicatorSourceTests: XCTestCase {
    func testInMemorySourceStartPushesInitial() {
        let source = InMemoryLiveIndicatorSource(initial: LiveConnectionSnapshot(status: .disconnected))
        var received: [LiveConnectionStatus] = []
        source.onUpdate = { received.append($0.status) }
        source.start()
        XCTAssertEqual(received, [.disconnected])
        XCTAssertEqual(source.startCount, 1)
    }

    func testProductionSourceUpdateEmits() {
        let source = LiveConnectionIndicatorSource()
        var received: [LiveConnectionStatus] = []
        source.onUpdate = { received.append($0.status) }
        source.update(LiveConnectionSnapshot(status: .connected))
        XCTAssertEqual(received, [.connected])
    }

    func testProductionSourceUpdateWithReadingDerives() {
        let source = LiveConnectionIndicatorSource()
        var received: [LiveConnectionSnapshot] = []
        source.onUpdate = { received.append($0) }
        let reading = LiveConnectionReading(
            transport: .reconnecting,
            hasEverConnected: true,
            stateEnteredAt: fixedNow.addingTimeInterval(-30),
            lastMessageAt: fixedNow.addingTimeInterval(-90)
        )
        source.update(reading: reading, now: fixedNow)
        XCTAssertEqual(received.last?.status, .disconnected)
        XCTAssertEqual(received.last?.lastMessageAt, fixedNow.addingTimeInterval(-90))
    }

    func testProductionSourceStartEmitsSeed() {
        let source = LiveConnectionIndicatorSource(snapshot: LiveConnectionSnapshot(status: .reconnecting))
        var received: [LiveConnectionStatus] = []
        source.onUpdate = { received.append($0.status) }
        source.start()
        XCTAssertEqual(received, [.reconnecting])
    }
}

// MARK: - Views (every form composes — signature contract)

@MainActor
final class LiveIndicatorViewTests: XCTestCase {
    private func resolved(_ status: LiveConnectionStatus, variant: LiveIndicatorVariant) -> LiveIndicatorResolved {
        LiveIndicatorProjection.resolve(
            snapshot: LiveConnectionSnapshot(status: status),
            variant: variant,
            now: fixedNow,
            locale: usLocale,
            strings: englishStrings
        )
    }

    func testLeavesCompose() {
        _ = LiveIndicatorDot(resolved: resolved(.connected, variant: .dot))
        _ = LiveIndicatorChip(resolved: resolved(.reconnecting, variant: .pill), reduceMotion: false)
        _ = LiveIndicatorChip(resolved: resolved(.disconnected, variant: .compact), reduceMotion: true)
        _ = LiveIndicatorStatusIcon(icon: .reconnecting, isSpinning: true, reduceMotion: false)
        _ = LiveIndicatorStatusIcon(icon: .wifi, isSpinning: false, reduceMotion: true)
    }

    func testPublicSurfacesCompose() {
        _ = LiveIndicator(variant: .pill)
        _ = LiveIndicator(variant: .dot)
        _ = LiveIndicator(variant: .compact)
        _ = LiveIndicator(
            variant: .pill,
            model: LiveIndicatorModel(source: InMemoryLiveIndicatorSource())
        )
    }

    func testToneMapsToToken() {
        XCTAssertEqual(LiveIndicatorTone.success.color, Color.TS.statusSuccess)
        XCTAssertEqual(LiveIndicatorTone.warning.color, Color.TS.statusWarning)
        XCTAssertEqual(LiveIndicatorTone.danger.color, Color.TS.statusDanger)
        XCTAssertEqual(LiveIndicatorTone.muted.color, Color.TS.textMuted)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyLiveIndicatorTelemetry: LiveIndicatorTelemetry, @unchecked Sendable {
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
