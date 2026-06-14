//
//  PageContainer.ModelTests.swift
//  TeslaSync — P4 shared surface · 0171 · PageContainer (Apple)
//
//  State-holder coverage for `PageContainerModel` plus its seams: the P1/S11 `view.opened` telemetry
//  (once + idempotent, re-armed by `stop()`), the body-phase transitions across every state
//  (loading / error / empty / content), the header projection, the freshness readout, the copy-link
//  clipboard seam (web `CopyLinkButton`), the connectivity axis with the one-shot stale auto-refresh
//  (re-armed on return to fresh) and offline NOT auto-refreshing, the 30s tick re-deriving the
//  relative-age label, and the controlled source. Driven through the in-memory seams — no network, an
//  injected clock instead of real time.
//

import Foundation
import SwiftUI
import XCTest
@testable import TeslaSync

private let identityResolver: PageContainerResolve = { _, fallback in fallback }
private let testEpoch = Date(timeIntervalSince1970: 2_000_000)

// MARK: - Model (state-holder)

@MainActor
final class PageContainerModelTests: XCTestCase {
    private func makeModel(
        _ input: PageContainerInput,
        telemetry: PageContainerTelemetry = OSLogPageContainerTelemetry(),
        clipboard: PageContainerClipboard? = nil,
        clock: @escaping PageContainerClock = { testEpoch }
    ) -> (PageContainerModel, InMemoryPageContainerSource) {
        let source = InMemoryPageContainerSource(initial: input)
        let model = PageContainerModel(
            source: source,
            telemetry: telemetry,
            clipboard: clipboard ?? SpyPageContainerClipboard(),
            clock: clock,
            strings: identityResolver
        )
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsViewOpenedOnce() {
        let spy = SpyPageContainerTelemetry()
        let (model, source) = makeModel(PageContainerInput(title: "Drives", isLoading: true), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertEqual(model.header.title, "Drives")
        XCTAssertEqual(spy.opened, [PageContainerModel.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testErrorPhaseCarriesMessage() {
        let (model, _) = makeModel(PageContainerInput(title: "Analytics", errorMessage: "HTTP 503"))
        model.start()
        XCTAssertEqual(model.phase, .error("HTTP 503"))
    }

    func testEmptyPhaseResolvesDefaultCopy() {
        let (model, _) = makeModel(PageContainerInput(title: "Drives", isEmpty: true))
        model.start()
        XCTAssertEqual(model.phase, .empty("No drives found."))
    }

    func testContentPhaseWhenHealthy() {
        let (model, _) = makeModel(PageContainerInput(title: "Drives"))
        model.start()
        XCTAssertEqual(model.phase, .content)
    }

    func testPushTransitionsPhase() {
        let (model, source) = makeModel(PageContainerInput(title: "Drives", isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(PageContainerInput(title: "Drives"))
        XCTAssertEqual(model.phase, .content)
        source.push(PageContainerInput(title: "Drives", isEmpty: true))
        XCTAssertEqual(model.phase, .empty("No drives found."))
    }

    func testFreshnessReadoutExposed() {
        let (model, _) = makeModel(PageContainerInput(
            title: "Battery",
            query: PageContainerQuery(isStale: true, dataUpdatedAt: testEpoch.addingTimeInterval(-3600))
        ))
        model.start()
        XCTAssertEqual(model.freshness?.status, .stale)
        XCTAssertEqual(model.freshness?.ageLabel, "1h ago")
    }

    func testFreshnessNilWhenNoQuery() {
        let (model, _) = makeModel(PageContainerInput(title: "Drives"))
        model.start()
        XCTAssertNil(model.freshness)
    }

    // MARK: Copy-link clipboard seam

    func testCanCopyLinkDerivedFromShareLink() {
        let (withLink, _) = makeModel(PageContainerInput(title: "Drives", shareLink: "teslasync://drives"))
        withLink.start()
        XCTAssertTrue(withLink.canCopyLink)

        let (withoutLink, _) = makeModel(PageContainerInput(title: "Drives"))
        withoutLink.start()
        XCTAssertFalse(withoutLink.canCopyLink)
    }

    func testCopyLinkWritesShareLinkToClipboard() {
        let clipboard = SpyPageContainerClipboard()
        let (model, _) = makeModel(
            PageContainerInput(title: "Drives", copyLink: true, shareLink: "teslasync://drives?range=30d"),
            clipboard: clipboard
        )
        model.start()
        XCTAssertTrue(model.copyLink())
        XCTAssertEqual(clipboard.copied, ["teslasync://drives?range=30d"])
    }

    func testCopyLinkNoOpWhenNoShareLink() {
        let clipboard = SpyPageContainerClipboard()
        let (model, _) = makeModel(PageContainerInput(title: "Drives", copyLink: true), clipboard: clipboard)
        model.start()
        XCTAssertFalse(model.copyLink())
        XCTAssertTrue(clipboard.copied.isEmpty)
    }

    func testCopyLinkReportsClipboardFailure() {
        let clipboard = SpyPageContainerClipboard()
        clipboard.result = false
        let (model, _) = makeModel(
            PageContainerInput(title: "Drives", copyLink: true, shareLink: "teslasync://drives"),
            clipboard: clipboard
        )
        model.start()
        XCTAssertFalse(model.copyLink())
        XCTAssertEqual(clipboard.copied, ["teslasync://drives"])
    }

    // MARK: Freshness auto-refresh (P4 leaf contract)

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(PageContainerInput(title: "Drives", query: PageContainerQuery()))
        model.start()
        XCTAssertEqual(model.freshness?.status, .fresh)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(PageContainerInput(title: "Drives", query: PageContainerQuery(isStale: true)))
        XCTAssertEqual(model.freshness?.status, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.push(PageContainerInput(title: "Drives", query: PageContainerQuery(isStale: true)))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleAutoRefreshReArmsAfterReturningToFresh() {
        let (model, source) = makeModel(PageContainerInput(title: "Drives", query: PageContainerQuery()))
        model.start()
        source.push(PageContainerInput(title: "Drives", query: PageContainerQuery(isStale: true)))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(PageContainerInput(title: "Drives", query: PageContainerQuery()))
        XCTAssertEqual(model.freshness?.status, .fresh)
        source.push(PageContainerInput(title: "Drives", query: PageContainerQuery(isStale: true)))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(PageContainerInput(title: "Drives", query: PageContainerQuery()))
        model.start()
        source.push(PageContainerInput(title: "Drives", query: PageContainerQuery(isError: true)))
        XCTAssertEqual(model.freshness?.status, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testNoQueryNeverAutoRefreshes() {
        let (_, source) = makeModel(PageContainerInput(title: "Drives"))
        let model = PageContainerModel(source: source, clock: { testEpoch }, strings: identityResolver)
        model.start()
        source.push(PageContainerInput(title: "Drives", isLoading: true))
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(PageContainerInput(title: "Drives"))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    // MARK: Tick (web `DataFreshness` 30s `setInterval`)

    func testTickRecomputesRelativeAgeLabel() {
        let clock = MutableClock(testEpoch)
        let (model, _) = makeModel(
            PageContainerInput(title: "Battery", query: PageContainerQuery(dataUpdatedAt: testEpoch)),
            clock: clock.read
        )
        model.start()
        XCTAssertEqual(model.freshness?.ageLabel, "just now")
        clock.now = testEpoch.addingTimeInterval(125)
        model.tick()
        XCTAssertEqual(model.freshness?.ageLabel, "2m ago")
    }

    // MARK: Lifecycle

    func testStopReArmsStartAndTelemetry() {
        let spy = SpyPageContainerTelemetry()
        let (model, source) = makeModel(PageContainerInput(title: "Drives"), telemetry: spy)
        model.start()
        XCTAssertEqual(source.startCount, 1)
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
        XCTAssertEqual(spy.opened.count, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(PageContainerModel.surfaceSlug, "PageContainer")
        XCTAssertEqual(PageContainer<EmptyView, EmptyView>.surfaceSlug, "PageContainer")
    }
}

// MARK: - Controlled source (production parity of the web host)

@MainActor
final class StaticPageContainerSourceTests: XCTestCase {
    func testStartAndRefreshReEmitTheControlledSnapshot() {
        let source = StaticPageContainerSource(PageContainerInput(title: "Drives", errorMessage: "boom"))
        var inputs: [PageContainerInput] = []
        source.onUpdate = { inputs.append($0) }
        source.start()
        XCTAssertEqual(inputs.last?.errorMessage, "boom")
        source.refresh()
        XCTAssertEqual(inputs.count, 2)
    }

    func testUpdateReplacesAndReEmits() {
        let source = StaticPageContainerSource(PageContainerInput(title: "Drives"))
        var inputs: [PageContainerInput] = []
        source.onUpdate = { inputs.append($0) }
        source.update(PageContainerInput(title: "Charging", isEmpty: true))
        XCTAssertEqual(inputs.last?.title, "Charging")
        XCTAssertEqual(inputs.last?.isEmpty, true)
    }
}

// MARK: - System clipboard

@MainActor
final class SystemPageContainerClipboardTests: XCTestCase {
    func testCopyWritesAndReportsSuccess() {
        let clipboard = SystemPageContainerClipboard()
        // The platform pasteboard write succeeds on iOS / iPadOS / macOS test hosts.
        XCTAssertTrue(clipboard.copy("teslasync://drives"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` so the telemetry contract can be asserted. Lock-guarded so it satisfies the
/// `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyPageContainerTelemetry: PageContainerTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var opened: [String] {
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

/// Records every copied string and lets a test control the reported success — the in-memory parity of
/// the system pasteboard. `@MainActor`-isolated like the seam it implements.
@MainActor
private final class SpyPageContainerClipboard: PageContainerClipboard {
    private(set) var copied: [String] = []
    var result = true

    @discardableResult
    func copy(_ text: String) -> Bool {
        copied.append(text)
        return result
    }
}

/// A mutable, lock-guarded clock for the tick test — advances "now" deterministically without waiting
/// on a wall clock. `@unchecked Sendable` so its `read` closure satisfies the `@Sendable`
/// `PageContainerClock` seam.
private final class MutableClock: @unchecked Sendable {
    private let lock = NSLock()
    private var current: Date

    init(_ start: Date) {
        current = start
    }

    var now: Date {
        get {
            lock.lock()
            defer { lock.unlock() }
            return current
        }
        set {
            lock.lock()
            current = newValue
            lock.unlock()
        }
    }

    var read: PageContainerClock {
        { [self] in now }
    }
}
