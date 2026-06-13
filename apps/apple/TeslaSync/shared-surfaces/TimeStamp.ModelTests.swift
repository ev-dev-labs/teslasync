//
//  TimeStamp.ModelTests.swift
//  TeslaSync — P4 shared surface · 0108 · TimeStamp (Apple)
//
//  State-holder coverage for `TimeStampModel` plus its seams: the P1/S11 `view.opened` telemetry
//  (once + idempotent), the phase transitions across every state (loading / empty / error / content),
//  the snapshot re-projection on push, the connection axis (live / stale / offline) with the one-shot
//  stale auto-refresh (re-armed on return to live), the manual refresh + stop delegation, and the
//  live source's snapshot re-emit. Driven through the in-memory seams — no network.
//
//  Content assertions use `format: .absolute` + `mode: .utc`, whose visible body is independent of the
//  wall clock, so they stay deterministic without injecting `now` through the model.
//

import XCTest
@testable import TeslaSync

/// Normalizes the narrow / non-breaking spaces `Date.FormatStyle` emits (e.g. U+202F before AM/PM) to
/// a regular space, so the assertions read with ordinary literals regardless of ICU spacing.
private func norm(_ value: String) -> String {
    value
        .replacingOccurrences(of: "\u{202f}", with: " ")
        .replacingOccurrences(of: "\u{00a0}", with: " ")
}

private func contentInput(connection: TimeStampConnection = .live) -> TimeStampInput {
    TimeStampInput(
        value: .iso("2026-04-04T09:30:00Z"),
        format: .absolute,
        mode: .utc,
        preference: .relative,
        locale: "en-US",
        connection: connection
    )
}

// MARK: - Model (state-holder)

@MainActor
final class TimeStampModelTests: XCTestCase {
    private func makeModel(
        _ input: TimeStampInput,
        telemetry: TimeStampTelemetry = OSLogTimeStampTelemetry()
    ) -> (TimeStampModel, InMemoryTimeStampSource) {
        let source = InMemoryTimeStampSource(initial: input)
        let model = TimeStampModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyTimeStampTelemetry()
        let (model, source) = makeModel(contentInput(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(norm(model.resolved.primary), "Apr 4, 2026 at 9:30 AM")
        XCTAssertEqual(spy.surfaces, [TimeStamp.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(TimeStampInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testAbsentValueProjectsEmpty() {
        let (model, _) = makeModel(TimeStampInput(value: .absent))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.resolved.isFallback)
        XCTAssertNil(model.resolved.secondary)
    }

    func testErrorInputProjectsErrorPhase() {
        let (model, _) = makeModel(TimeStampInput(errorMessage: "boom"))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testPushUpdatesFromLoadingToContent() {
        let (model, source) = makeModel(TimeStampInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(contentInput())
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(norm(model.resolved.primary), "Apr 4, 2026 at 9:30 AM")
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(contentInput())
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(contentInput(connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.push(contentInput(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleAutoRefreshReArmsAfterReturningToLive() {
        let (model, source) = makeModel(contentInput())
        model.start()
        source.push(contentInput(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(contentInput(connection: .live))
        XCTAssertEqual(model.connection, .live)
        source.push(contentInput(connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsContentAndDoesNotAutoRefresh() {
        let (model, source) = makeModel(contentInput())
        model.start()
        source.push(contentInput(connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(contentInput())
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(contentInput())
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(TimeStamp.surfaceSlug, "TimeStamp")
    }
}

// MARK: - Live source (production value/context bridge)

@MainActor
final class LiveTimeStampSourceTests: XCTestCase {
    func testStartEmitsInitialSnapshot() {
        let source = LiveTimeStampSource()
        var snapshots: [TimeStampInput] = []
        source.onUpdate = { snapshots.append($0) }
        source.start()
        XCTAssertEqual(snapshots.last?.value, .absent)
        XCTAssertEqual(snapshots.last?.connection, .live)
    }

    func testUpdateReEmitsTheNewSnapshot() {
        let source = LiveTimeStampSource()
        var latest: TimeStampInput?
        source.onUpdate = { latest = $0 }
        source.start()
        source.update(TimeStampInput(value: .iso("2026-04-04T09:30:00Z"), format: .relative))
        XCTAssertEqual(latest?.value, .iso("2026-04-04T09:30:00Z"))
        XCTAssertEqual(latest?.format, .relative)
    }

    func testRefreshReEmitsCurrentSnapshot() {
        let source = LiveTimeStampSource(snapshot: TimeStampInput(value: .iso("2026-04-04T09:30:00Z")))
        var count = 0
        source.onUpdate = { _ in count += 1 }
        source.start()
        source.refresh()
        XCTAssertEqual(count, 2)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyTimeStampTelemetry: TimeStampTelemetry, @unchecked Sendable {
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
