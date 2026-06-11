//
//  DateTime.ModelTests.swift
//  TeslaSync — P4 shared surface · 0084 · DateTime (Apple)
//
//  State-holder coverage for `DateTimeModel` plus its seams: the P1/S11 `view.opened` telemetry
//  (once + idempotent), the phase transitions across every state (loading / empty / error / content),
//  the snapshot re-projection on push, the connection axis (live / stale / offline) with the one-shot
//  stale auto-refresh (re-armed on return to live), the manual refresh + stop delegation, and the
//  live source's snapshot re-emit. Driven through the in-memory seams — no network.
//

import XCTest
@testable import TeslaSync

/// Normalizes the narrow / non-breaking spaces `Date.FormatStyle` emits (e.g. U+202F before AM/PM)
/// to a regular space, so the assertions read with ordinary literals regardless of ICU spacing.
private func norm(_ value: String) -> String {
    value
        .replacingOccurrences(of: "\u{202f}", with: " ")
        .replacingOccurrences(of: "\u{00a0}", with: " ")
}

private func contentInput(connection: DateTimeConnection = .live) -> DateTimeInput {
    DateTimeInput(
        value: .iso("2026-04-04T09:30:00Z"),
        variant: .full,
        mode: .utc,
        locale: "en-US",
        connection: connection
    )
}

// MARK: - Model (state-holder)

@MainActor
final class DateTimeModelTests: XCTestCase {
    private func makeModel(
        _ input: DateTimeInput,
        telemetry: DateTimeTelemetry = OSLogDateTimeTelemetry()
    ) -> (DateTimeModel, InMemoryDateTimeSource) {
        let source = InMemoryDateTimeSource(initial: input)
        let model = DateTimeModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyDateTimeTelemetry()
        let (model, source) = makeModel(contentInput(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(norm(model.resolved.display), "Apr 4, 2026 at 9:30 AM")
        XCTAssertEqual(spy.surfaces, [DateTime.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(DateTimeInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testAbsentValueProjectsEmpty() {
        let (model, _) = makeModel(DateTimeInput(value: .absent))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.resolved.isFallback)
    }

    func testErrorInputProjectsErrorPhase() {
        let (model, _) = makeModel(DateTimeInput(errorMessage: "boom"))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testPushUpdatesFromLoadingToContent() {
        let (model, source) = makeModel(DateTimeInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(contentInput())
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(norm(model.resolved.display), "Apr 4, 2026 at 9:30 AM")
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
        XCTAssertEqual(DateTime.surfaceSlug, "DateTime")
    }
}

// MARK: - Live source (production value/context bridge)

@MainActor
final class LiveDateTimeSourceTests: XCTestCase {
    func testStartEmitsInitialSnapshot() {
        let source = LiveDateTimeSource()
        var snapshots: [DateTimeInput] = []
        source.onUpdate = { snapshots.append($0) }
        source.start()
        XCTAssertEqual(snapshots.last?.value, .absent)
        XCTAssertEqual(snapshots.last?.connection, .live)
    }

    func testUpdateReEmitsTheNewSnapshot() {
        let source = LiveDateTimeSource()
        var latest: DateTimeInput?
        source.onUpdate = { latest = $0 }
        source.start()
        source.update(DateTimeInput(value: .iso("2026-04-04T09:30:00Z"), variant: .time))
        XCTAssertEqual(latest?.value, .iso("2026-04-04T09:30:00Z"))
        XCTAssertEqual(latest?.variant, .time)
    }

    func testRefreshReEmitsCurrentSnapshot() {
        let source = LiveDateTimeSource(snapshot: DateTimeInput(value: .iso("2026-04-04T09:30:00Z")))
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
private final class SpyDateTimeTelemetry: DateTimeTelemetry, @unchecked Sendable {
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
