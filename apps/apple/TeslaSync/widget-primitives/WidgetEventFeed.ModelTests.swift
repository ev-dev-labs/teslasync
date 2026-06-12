//
//  WidgetEventFeed.ModelTests.swift
//  TeslaSync — P4 widget primitive · 0005 · WidgetEventFeed (Apple)
//
//  State-holder coverage for `WidgetEventFeedModel` plus its seams: the P1/S11 `view.opened` telemetry
//  (once + idempotent, re-armed by `stop()`), the phase transitions across every state (loading /
//  empty / error / feed), the drill-through capability derived from the supplied handler, the
//  connection axis (live / stale / offline) with the one-shot stale auto-refresh (re-armed on return
//  to live), offline keeping the list without auto-refreshing, the handler-forwarded row selection
//  (gated on the item carrying an `href`), and the controlled source. Driven through the in-memory
//  seams — no network, no real time.
//

import XCTest
@testable import TeslaSync

private func sampleItem(id: String = "1", href: String? = nil) -> WidgetEventFeedItem {
    WidgetEventFeedItem(
        id: id,
        iconSymbol: "bolt.fill",
        title: "Charging started",
        subtitle: "Home",
        timestamp: Date(timeIntervalSince1970: 1_000_000),
        tone: .success,
        severity: .info,
        href: href
    )
}

private func populatedInput(href: String? = nil) -> WidgetEventFeedInput {
    WidgetEventFeedInput(items: [sampleItem(href: href)])
}

// MARK: - Model (state-holder)

@MainActor
final class WidgetEventFeedModelTests: XCTestCase {
    private func makeModel(
        _ input: WidgetEventFeedInput,
        telemetry: WidgetEventFeedTelemetry = OSLogWidgetEventFeedTelemetry(),
        onSelect: (@MainActor (WidgetEventFeedItem) -> Void)? = nil
    ) -> (WidgetEventFeedModel, InMemoryWidgetEventFeedSource) {
        let source = InMemoryWidgetEventFeedSource(initial: input)
        let model = WidgetEventFeedModel(source: source, telemetry: telemetry, onSelect: onSelect)
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyWidgetEventFeedTelemetry()
        let (model, source) = makeModel(populatedInput(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .feed)
        XCTAssertEqual(model.resolved.items.count, 1)
        XCTAssertEqual(spy.surfaces, [WidgetEventFeed.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testCanSelectDerivedFromHandler() {
        let (withHandler, _) = makeModel(WidgetEventFeedInput(), onSelect: { _ in })
        XCTAssertTrue(withHandler.canSelect)
        let (withoutHandler, _) = makeModel(WidgetEventFeedInput())
        XCTAssertFalse(withoutHandler.canSelect)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(WidgetEventFeedInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testNoItemsProjectsEmpty() {
        let (model, _) = makeModel(WidgetEventFeedInput())
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.resolved.items.isEmpty)
    }

    func testErrorInputProjectsErrorPhase() {
        let (model, _) = makeModel(WidgetEventFeedInput(errorMessage: "boom"))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testPushUpdatesProjectionFromLoadingToFeed() {
        let (model, source) = makeModel(WidgetEventFeedInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(populatedInput())
        XCTAssertEqual(model.phase, .feed)
        XCTAssertEqual(model.resolved.items.count, 1)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(populatedInput())
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(WidgetEventFeedInput(items: [sampleItem()], connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.push(WidgetEventFeedInput(items: [sampleItem()], connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleAutoRefreshReArmsAfterReturningToLive() {
        let (model, source) = makeModel(populatedInput())
        model.start()
        source.push(WidgetEventFeedInput(items: [sampleItem()], connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(WidgetEventFeedInput(items: [sampleItem()], connection: .live))
        XCTAssertEqual(model.connection, .live)
        source.push(WidgetEventFeedInput(items: [sampleItem()], connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsListAndDoesNotAutoRefresh() {
        let (model, source) = makeModel(populatedInput())
        model.start()
        source.push(WidgetEventFeedInput(items: [sampleItem()], connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .feed)
        XCTAssertEqual(model.resolved.items.count, 1)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(populatedInput())
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopReArmsStartAndTelemetry() {
        let spy = SpyWidgetEventFeedTelemetry()
        let (model, source) = makeModel(WidgetEventFeedInput(), telemetry: spy)
        model.start()
        XCTAssertEqual(source.startCount, 1)
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
        XCTAssertEqual(spy.surfaces.count, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(WidgetEventFeed.surfaceSlug, "WidgetEventFeed")
    }
}

// MARK: - Selection (web row `href` `Link`)

@MainActor
final class WidgetEventFeedSelectionTests: XCTestCase {
    func testSelectForwardsWhenItemHasHrefAndHandlerWired() {
        var selected: [String] = []
        let source = InMemoryWidgetEventFeedSource(initial: populatedInput(href: "/charging/1"))
        let model = WidgetEventFeedModel(source: source, onSelect: { selected.append($0.id) })
        model.start()
        model.select(sampleItem(id: "1", href: "/charging/1"))
        XCTAssertEqual(selected, ["1"])
    }

    func testSelectIsNoOpWhenItemHasNoHref() {
        var selected: [String] = []
        let source = InMemoryWidgetEventFeedSource(initial: populatedInput())
        let model = WidgetEventFeedModel(source: source, onSelect: { selected.append($0.id) })
        model.start()
        model.select(sampleItem(id: "1", href: nil))
        XCTAssertTrue(selected.isEmpty)
    }

    func testSelectIsNoOpWhenNoHandlerSupplied() {
        let source = InMemoryWidgetEventFeedSource(initial: populatedInput(href: "/x"))
        let model = WidgetEventFeedModel(source: source)
        model.start()
        model.select(sampleItem(id: "1", href: "/x"))
        XCTAssertFalse(model.canSelect)
    }
}

// MARK: - Controlled source (production parity of the web host)

@MainActor
final class StaticWidgetEventFeedSourceTests: XCTestCase {
    func testStartAndRefreshReEmitTheControlledSnapshot() {
        let source = StaticWidgetEventFeedSource(populatedInput())
        var inputs: [WidgetEventFeedInput] = []
        source.onUpdate = { inputs.append($0) }
        source.start()
        XCTAssertEqual(inputs.last?.items.count, 1)
        source.refresh()
        XCTAssertEqual(inputs.count, 2)
    }

    func testUpdateReplacesAndReEmits() {
        let source = StaticWidgetEventFeedSource(populatedInput())
        var inputs: [WidgetEventFeedInput] = []
        source.onUpdate = { inputs.append($0) }
        source.update(WidgetEventFeedInput(connection: .offline))
        XCTAssertEqual(inputs.last?.connection, .offline)
        XCTAssertTrue(inputs.last?.items.isEmpty ?? false)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyWidgetEventFeedTelemetry: WidgetEventFeedTelemetry, @unchecked Sendable {
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
