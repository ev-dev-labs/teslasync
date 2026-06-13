//
//  LiveTelemetrySegment.Tests.swift
//  TeslaSync — P4 shared surface · 0180 · LiveTelemetrySegment (Apple)
//
//  State-holder / view / telemetry / seam coverage for the LiveTelemetrySegment surface:
//    • Model — snapshot adoption from the source, the `iconOnly` projection through the injected clock,
//      the lazy once-only `view.opened` telemetry, the safe no-op stop, and refresh forwarding.
//    • Seams — the in-memory source call counters + initial push, and the production source emitting on
//      `update(_:)` / deriving on `update(reading:)` / seeding on `start()`.
//    • Views — the public surface (both initializers, expanded + iconOnly) and the presentational leaves
//      compose (signature contract), and the tone → token mapping.
//    • Accessibility — every status yields a non-empty VoiceOver label.
//
//  The pure projection / age coverage lives in LiveTelemetrySegment.ProjectionTests.swift. These run in
//  the TeslaSync(/-macOS) XCTest targets with no network and no real transport; a fixed clock + locale
//  keep the freshness assertions deterministic.
//

import SwiftUI
import XCTest

private let englishStrings: LiveTelemetrySegmentResolve = { _, fallback in fallback }
private let fixedNow = Date(timeIntervalSince1970: 1_700_000_000)
private let usLocale = Locale(identifier: "en_US")

// MARK: - Model (state-holder)

@MainActor
final class LiveTelemetrySegmentModelTests: XCTestCase {
    private func makeModel(
        source: any LiveTelemetrySegmentSource,
        telemetry: any LiveTelemetrySegmentTelemetry = OSLogLiveTelemetrySegmentTelemetry()
    ) -> LiveTelemetrySegmentModel {
        LiveTelemetrySegmentModel(
            source: source,
            telemetry: telemetry,
            strings: englishStrings,
            locale: usLocale,
            clock: { fixedNow }
        )
    }

    func testSnapshotAdoptedFromSource() {
        let source = InMemoryLiveTelemetrySegmentSource()
        let model = makeModel(source: source)
        XCTAssertEqual(model.snapshot.status, .unknown)

        source.push(LiveConnectionSnapshot(status: .connected, lastMessageAt: fixedNow))
        XCTAssertEqual(model.snapshot.status, .connected)
    }

    func testResolvedProjectsSnapshotWithInjectedClock() {
        let source = InMemoryLiveTelemetrySegmentSource()
        let model = makeModel(source: source)
        source.push(LiveConnectionSnapshot(status: .connected, lastMessageAt: fixedNow.addingTimeInterval(-300)))

        let resolved = model.resolved(iconOnly: false)
        XCTAssertEqual(resolved.status, .connected)
        XCTAssertEqual(resolved.shortLabel, "Live")
        XCTAssertEqual(resolved.ageText, "5m")
    }

    func testResolvedRespectsIconOnlyGate() {
        let source = InMemoryLiveTelemetrySegmentSource()
        let model = makeModel(source: source)
        source.push(LiveConnectionSnapshot(status: .connected, lastMessageAt: fixedNow.addingTimeInterval(-300)))

        let resolved = model.resolved(iconOnly: true)
        XCTAssertNil(resolved.ageText)
        XCTAssertFalse(resolved.showsLabel)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyLiveTelemetrySegmentTelemetry()
        let model = makeModel(source: InMemoryLiveTelemetrySegmentSource(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [LiveTelemetrySegmentMeta.surfaceSlug])
    }

    func testStartActivatesSource() {
        let source = InMemoryLiveTelemetrySegmentSource(initial: LiveConnectionSnapshot(status: .connected))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(model.snapshot.status, .connected)
    }

    func testStopIsSafeAndDoesNotEmit() {
        let spy = SpyLiveTelemetrySegmentTelemetry()
        let source = InMemoryLiveTelemetrySegmentSource()
        let model = makeModel(source: source, telemetry: spy)
        model.start()
        model.stop()
        model.stop()
        XCTAssertEqual(spy.surfaces, [LiveTelemetrySegmentMeta.surfaceSlug])
        XCTAssertEqual(source.stopCount, 2)
    }

    func testRefreshForwardsToSource() {
        let source = InMemoryLiveTelemetrySegmentSource()
        let model = makeModel(source: source)
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }
}

// MARK: - Seams (sources)

@MainActor
final class LiveTelemetrySegmentSourceTests: XCTestCase {
    func testInMemorySourceStartPushesInitial() {
        let source = InMemoryLiveTelemetrySegmentSource(initial: LiveConnectionSnapshot(status: .disconnected))
        var received: [LiveConnectionStatus] = []
        source.onUpdate = { received.append($0.status) }
        source.start()
        XCTAssertEqual(received, [.disconnected])
        XCTAssertEqual(source.startCount, 1)
    }

    func testProductionSourceUpdateEmits() {
        let source = LiveTelemetryConnectionSource()
        var received: [LiveConnectionStatus] = []
        source.onUpdate = { received.append($0.status) }
        source.update(LiveConnectionSnapshot(status: .connected))
        XCTAssertEqual(received, [.connected])
    }

    func testProductionSourceUpdateWithReadingDerives() {
        let source = LiveTelemetryConnectionSource()
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
        let source = LiveTelemetryConnectionSource(snapshot: LiveConnectionSnapshot(status: .reconnecting))
        var received: [LiveConnectionStatus] = []
        source.onUpdate = { received.append($0.status) }
        source.start()
        XCTAssertEqual(received, [.reconnecting])
    }
}

// MARK: - Views (every form composes — signature contract)

@MainActor
final class LiveTelemetrySegmentViewTests: XCTestCase {
    private func resolved(_ status: LiveConnectionStatus) -> LiveTelemetrySegmentResolved {
        LiveTelemetrySegmentProjection.resolve(
            snapshot: LiveConnectionSnapshot(status: status),
            iconOnly: false,
            now: fixedNow,
            locale: usLocale,
            strings: englishStrings
        )
    }

    func testLeavesCompose() {
        _ = LiveTelemetrySegmentChip(resolved: resolved(.connected), reduceMotion: false)
        _ = LiveTelemetrySegmentChip(resolved: resolved(.disconnected), reduceMotion: true)
        _ = LiveTelemetrySegmentStatusIcon(icon: .reconnecting, isSpinning: true, reduceMotion: false)
        _ = LiveTelemetrySegmentStatusIcon(icon: .wifi, isSpinning: false, reduceMotion: true)
    }

    func testPublicSurfacesCompose() {
        _ = LiveTelemetrySegment()
        _ = LiveTelemetrySegment(iconOnly: true)
        _ = LiveTelemetrySegment(
            iconOnly: false,
            model: LiveTelemetrySegmentModel(source: InMemoryLiveTelemetrySegmentSource()),
            onOpen: {}
        )
    }

    func testToneMapsToToken() {
        XCTAssertEqual(LiveTelemetrySegmentTone.success.color, Color.TS.statusSuccess)
        XCTAssertEqual(LiveTelemetrySegmentTone.warning.color, Color.TS.statusWarning)
        XCTAssertEqual(LiveTelemetrySegmentTone.danger.color, Color.TS.statusDanger)
        XCTAssertEqual(LiveTelemetrySegmentTone.muted.color, Color.TS.textMuted)
    }
}

// MARK: - Accessibility (every status yields a VoiceOver label)

final class LiveTelemetrySegmentAccessibilityTests: XCTestCase {
    func testEveryStatusHasNonEmptyLabel() {
        for status in LiveConnectionStatus.allCases {
            let resolved = LiveTelemetrySegmentProjection.resolve(
                snapshot: LiveConnectionSnapshot(status: status),
                iconOnly: false,
                now: fixedNow,
                locale: usLocale,
                strings: englishStrings
            )
            XCTAssertFalse(resolved.accessibilityLabel.isEmpty, "missing a11y label for \(status)")
            XCTAssertTrue(resolved.accessibilityLabel.contains(resolved.shortLabel))
        }
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it satisfies
/// the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyLiveTelemetrySegmentTelemetry: LiveTelemetrySegmentTelemetry, @unchecked Sendable {
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
