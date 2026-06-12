//
//  SwipeRow.ModelTests.swift
//  TeslaSync — P4 shared surface · 0189 · SwipeRow (Apple)
//
//  The state-holder + source-seam coverage, split from SwipeRow.Tests.swift: the in-memory / static
//  source counters + re-emit, projection adoption + push, once-only `view.opened` (P1/S11), safe
//  stop / re-start, refresh delegation, the stale one-shot auto-refresh (re-armed on return to live;
//  offline never), and the exposed coarse-pointer capability. Runs in the TeslaSync(/-macOS) XCTest
//  targets with no network and no real time.
//

import XCTest
@testable import TeslaSync

// MARK: - Source seams

@MainActor
final class SwipeRowSourceTests: XCTestCase {
    func testInMemoryStartEmitsInitialAndCounts() {
        let source = InMemorySwipeRowSource(initial: SwipeRowInput(hasContent: true))
        var received: SwipeRowInput?
        source.onUpdate = { received = $0 }
        source.start()
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(received?.hasContent, true)
    }

    func testInMemoryStopRefreshCounters() {
        let source = InMemorySwipeRowSource()
        source.stop()
        source.refresh()
        source.refresh()
        XCTAssertEqual(source.stopCount, 1)
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStaticSourceStartAndRefreshReEmit() {
        let source = StaticSwipeRowSource(isCoarsePointer: true, connection: .stale)
        var inputs: [SwipeRowInput] = []
        source.onUpdate = { inputs.append($0) }
        source.start()
        source.refresh()
        XCTAssertEqual(inputs.count, 2)
        XCTAssertEqual(inputs.last?.connection, .stale)
    }

    func testStaticSourceUpdateReplacesAndReEmits() {
        let source = StaticSwipeRowSource(isCoarsePointer: true)
        var inputs: [SwipeRowInput] = []
        source.onUpdate = { inputs.append($0) }
        source.update(SwipeRowInput(isCoarsePointer: false, connection: .offline))
        XCTAssertEqual(inputs.last?.isCoarsePointer, false)
        XCTAssertEqual(inputs.last?.connection, .offline)
    }
}

// MARK: - Model (state-holder)

@MainActor
final class SwipeRowModelTests: XCTestCase {
    private func makeModel(
        initial: SwipeRowInput?,
        telemetry: SwipeRowTelemetry = SpySwipeRowTelemetry()
    ) -> (SwipeRowModel, InMemorySwipeRowSource) {
        let source = InMemorySwipeRowSource(initial: initial)
        let model = SwipeRowModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testStartProjectsInitialSnapshot() {
        let (model, _) = makeModel(initial: SwipeRowInput(isCoarsePointer: true))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.isCoarsePointer)
    }

    func testPushAdoptsNewSnapshot() {
        let (model, source) = makeModel(initial: SwipeRowInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(SwipeRowInput(hasContent: true))
        XCTAssertEqual(model.phase, .content)
    }

    func testExposesCoarsePointerCapability() {
        let (model, source) = makeModel(initial: SwipeRowInput(isCoarsePointer: true))
        model.start()
        XCTAssertTrue(model.isCoarsePointer)
        source.push(SwipeRowInput(isCoarsePointer: false))
        XCTAssertFalse(model.isCoarsePointer)
    }

    func testStartEmitsViewOpenedOnceEvenAcrossRestart() {
        let spy = SpySwipeRowTelemetry()
        let (model, source) = makeModel(initial: SwipeRowInput(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["SwipeRow"])
        XCTAssertEqual(source.startCount, 1)

        model.stop()
        model.start()
        XCTAssertEqual(source.startCount, 2)
        XCTAssertEqual(spy.surfaces, ["SwipeRow"], "view.opened is a once-per-lifetime event")
    }

    func testStopDelegatesToSource() {
        let (model, source) = makeModel(initial: SwipeRowInput())
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(initial: SwipeRowInput())
        model.start()
        let before = source.refreshCount
        model.refresh()
        XCTAssertEqual(source.refreshCount, before + 1)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(initial: SwipeRowInput())
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(SwipeRowInput(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(SwipeRowInput(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleAutoRefreshReArmsAfterLive() {
        let (model, source) = makeModel(initial: SwipeRowInput())
        model.start()
        source.push(SwipeRowInput(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(SwipeRowInput(connection: .live))
        XCTAssertEqual(model.connection, .live)
        source.push(SwipeRowInput(connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineNeverAutoRefreshes() {
        let (model, source) = makeModel(initial: SwipeRowInput())
        model.start()
        source.push(SwipeRowInput(connection: .offline))
        XCTAssertEqual(source.refreshCount, 0)
        XCTAssertEqual(model.connection, .offline)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces; lock-guarded to satisfy the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpySwipeRowTelemetry: SwipeRowTelemetry, @unchecked Sendable {
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
