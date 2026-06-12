//
//  ScrollRestoration.Tests.swift
//  TeslaSync — P4 shared surface · 0173 · ScrollRestoration (Apple)
//
//  Unit coverage for the scroll-restoration surface logic above the adapter primitives:
//    • Projection — the web `useLayoutEffect` decision: unavailable-store, POP-restore (finite saved),
//      POP-no-saved / POP-non-finite → top, PUSH / REPLACE → top.
//    • Phase — the leaf-state helpers (restored / degraded / settles-at-top).
//    • Model — `view.opened` once, the per-navigation phase resolution, the save-on-scroll throttle, the
//      final flush bypass, the save → restore round trip, the disabled-store degrade, and the restore
//      token bump (the native trigger for the modifier).
//    • Chrome / a11y — every phase style resolves a distinct, non-empty title + description; the status
//      surface + chip + banner construct for every state (rendering itself is covered by the #Previews).
//    • i18n facade + telemetry — the per-surface table resolves each key to its fallback; the slug is
//      stable.
//
//  These run in the TeslaSync(/-macOS) XCTest targets with no network and no real router; the source +
//  store are driven by in-memory doubles, and the throttle clock is injected for determinism.
//

import XCTest
@testable import TeslaSync

// MARK: - Projection (web useLayoutEffect decision)

final class ScrollRestorationProjectionTests: XCTestCase {
    func testUnavailableStoreAlwaysTopsAndDegrades() {
        let popDecision = ScrollRestorationProjection.decide(action: .pop, savedOffset: 500, isStoreAvailable: false)
        XCTAssertEqual(popDecision.phase, .unavailable)
        XCTAssertEqual(popDecision.targetOffset, 0)
        let pushDecision = ScrollRestorationProjection.decide(action: .push, savedOffset: nil, isStoreAvailable: false)
        XCTAssertEqual(pushDecision.phase, .unavailable)
    }

    func testPopWithFiniteSavedRestores() {
        let decision = ScrollRestorationProjection.decide(action: .pop, savedOffset: 842, isStoreAvailable: true)
        XCTAssertEqual(decision.phase, .restored)
        XCTAssertEqual(decision.targetOffset, 842)
    }

    func testPopWithNoSavedTopsWithoutRestoring() {
        let decision = ScrollRestorationProjection.decide(action: .pop, savedOffset: nil, isStoreAvailable: true)
        XCTAssertEqual(decision.phase, .noSavedTop)
        XCTAssertEqual(decision.targetOffset, 0)
    }

    func testPopWithNonFiniteSavedTops() {
        let nan = ScrollRestorationProjection.decide(action: .pop, savedOffset: .nan, isStoreAvailable: true)
        XCTAssertEqual(nan.phase, .noSavedTop)
        let inf = ScrollRestorationProjection.decide(action: .pop, savedOffset: .infinity, isStoreAvailable: true)
        XCTAssertEqual(inf.phase, .noSavedTop)
    }

    func testPushAndReplaceAlwaysTopIgnoringSaved() {
        let push = ScrollRestorationProjection.decide(action: .push, savedOffset: 999, isStoreAvailable: true)
        XCTAssertEqual(push.phase, .freshTop)
        XCTAssertEqual(push.targetOffset, 0)
        let replace = ScrollRestorationProjection.decide(action: .replace, savedOffset: 999, isStoreAvailable: true)
        XCTAssertEqual(replace.phase, .freshTop)
        XCTAssertEqual(replace.targetOffset, 0)
    }
}

// MARK: - Phase helpers (leaf-state semantics)

final class ScrollRestorationPhaseTests: XCTestCase {
    func testRestoredSavedOffsetOnlyForRestored() {
        XCTAssertTrue(ScrollRestorationPhase.restored.restoredSavedOffset)
        for phase in ScrollRestorationPhase.allCases where phase != .restored {
            XCTAssertFalse(phase.restoredSavedOffset)
        }
    }

    func testIsDegradedOnlyForUnavailable() {
        XCTAssertTrue(ScrollRestorationPhase.unavailable.isDegraded)
        for phase in ScrollRestorationPhase.allCases where phase != .unavailable {
            XCTAssertFalse(phase.isDegraded)
        }
    }

    func testSettlesAtTop() {
        XCTAssertTrue(ScrollRestorationPhase.freshTop.settlesAtTop)
        XCTAssertTrue(ScrollRestorationPhase.noSavedTop.settlesAtTop)
        XCTAssertTrue(ScrollRestorationPhase.unavailable.settlesAtTop)
        XCTAssertFalse(ScrollRestorationPhase.restored.settlesAtTop)
        XCTAssertFalse(ScrollRestorationPhase.preparing.settlesAtTop)
    }
}

// MARK: - Model (web component live behavior)

@MainActor
final class ScrollRestorationModelTests: XCTestCase {
    private func location(_ path: String, _ search: String = "") -> ScrollRestorationLocation {
        ScrollRestorationLocation(path: path, search: search)
    }

    func testInitialPhaseIsPreparing() {
        let model = ScrollRestorationModel(source: StaticScrollRestorationSource(location: location("/a")))
        XCTAssertEqual(model.phase, .preparing)
        XCTAssertNil(model.lastKey)
    }

    func testMarkAppearedEmitsViewOpenedOnce() {
        let spy = SpyScrollRestorationTelemetry()
        let model = ScrollRestorationModel(
            source: StaticScrollRestorationSource(location: location("/a")),
            telemetry: spy
        )
        model.markAppeared()
        model.markAppeared()
        model.markAppeared()
        XCTAssertEqual(spy.surfaces, [ScrollRestorationSurface.slug])
    }

    func testPushNavigationResolvesFreshTop() {
        let source = StaticScrollRestorationSource(location: location("/a"), navigationAction: .push)
        let model = ScrollRestorationModel(source: source, store: SessionScrollPositionStore())
        let decision = model.onNavigation()
        XCTAssertEqual(decision.phase, .freshTop)
        XCTAssertEqual(model.phase, .freshTop)
        XCTAssertEqual(model.lastKey, location("/a").key)
    }

    func testPopWithNothingSavedResolvesNoSavedTop() {
        let source = StaticScrollRestorationSource(location: location("/a"), navigationAction: .pop)
        let model = ScrollRestorationModel(source: source, store: SessionScrollPositionStore())
        XCTAssertEqual(model.onNavigation().phase, .noSavedTop)
    }

    func testSaveThenRestoreRoundTrip() {
        let source = StaticScrollRestorationSource(location: location("/a"), navigationAction: .push)
        let store = SessionScrollPositionStore()
        let model = ScrollRestorationModel(source: source, store: store, throttle: ScrollSaveThrottle(minInterval: 0))

        model.onNavigation() // PUSH /a → freshTop, lastKey /a
        model.recordScroll(offset: 500) // persist 500 under /a
        source.push(path: "/b")
        model.onNavigation() // flush /a, PUSH /b → freshTop
        model.recordScroll(offset: 120) // persist 120 under /b
        source.pop(path: "/a")
        let decision = model.onNavigation() // flush /b, POP /a → restore 500

        XCTAssertEqual(decision.phase, .restored)
        XCTAssertEqual(decision.targetOffset, 500)
        XCTAssertEqual(store.offset(forKey: location("/a").key), 500)
        XCTAssertEqual(store.offset(forKey: location("/b").key), 120)
    }

    func testThrottlePersistsAtMostOncePerInterval() {
        let clock = ScrollRestorationTestClock()
        let store = SessionScrollPositionStore()
        let source = StaticScrollRestorationSource(location: location("/a"), navigationAction: .push)
        let model = ScrollRestorationModel(
            source: source,
            store: store,
            throttle: ScrollSaveThrottle(minInterval: 0.016),
            now: { clock.now }
        )
        model.onNavigation()
        clock.now = 0
        model.recordScroll(offset: 500) // first accepted
        clock.now = 0.005
        model.recordScroll(offset: 600) // dropped (within interval)
        XCTAssertEqual(store.offset(forKey: location("/a").key), 500)
        clock.now = 0.020
        model.recordScroll(offset: 700) // accepted (interval elapsed)
        XCTAssertEqual(store.offset(forKey: location("/a").key), 700)
    }

    func testFlushPersistsLiveOffsetBypassingThrottle() {
        let clock = ScrollRestorationTestClock()
        let store = SessionScrollPositionStore()
        let source = StaticScrollRestorationSource(location: location("/a"), navigationAction: .push)
        let model = ScrollRestorationModel(
            source: source,
            store: store,
            throttle: ScrollSaveThrottle(minInterval: 100),
            now: { clock.now }
        )
        model.onNavigation()
        clock.now = 0
        model.recordScroll(offset: 500) // first accepted
        clock.now = 0.001
        model.recordScroll(offset: 900) // dropped, but retained as live offset
        XCTAssertEqual(store.offset(forKey: location("/a").key), 500)
        model.flushCurrentOffset()
        XCTAssertEqual(store.offset(forKey: location("/a").key), 900, "flush writes the live offset un-throttled")
    }

    func testDisabledStoreDegradesAndNeverPersists() {
        let source = StaticScrollRestorationSource(location: location("/a"), navigationAction: .pop)
        let model = ScrollRestorationModel(source: source, store: UnavailableScrollPositionStore())
        XCTAssertEqual(model.onNavigation().phase, .unavailable)
        XCTAssertFalse(model.storeIsAvailable)
        model.recordScroll(offset: 300)
        XCTAssertNil(model.savedOffset(forKey: location("/a").key))
    }

    func testRestoreTokenIncrementsPerNavigation() {
        let source = StaticScrollRestorationSource(location: location("/a"), navigationAction: .push)
        let model = ScrollRestorationModel(source: source, store: SessionScrollPositionStore())
        let start = model.restoreToken
        model.onNavigation()
        XCTAssertEqual(model.restoreToken, start + 1)
        source.push(path: "/b")
        model.onNavigation()
        XCTAssertEqual(model.restoreToken, start + 2)
    }
}

// MARK: - Chrome + accessibility (every phase resolves distinct, non-empty copy)

@MainActor
final class ScrollRestorationChromeTests: XCTestCase {
    func testEveryPhaseStyleHasNonEmptyDistinctTitles() {
        let titles = ScrollRestorationPhase.allCases.map { ScrollRestorationPhaseStyle.style(for: $0).title }
        XCTAssertTrue(titles.allSatisfy { !$0.isEmpty })
        XCTAssertEqual(Set(titles).count, titles.count, "each phase reads a distinct title")
    }

    func testEveryPhaseStyleHasNonEmptyDescriptionAndGlyph() {
        for phase in ScrollRestorationPhase.allCases {
            let style = ScrollRestorationPhaseStyle.style(for: phase)
            XCTAssertFalse(style.description.isEmpty)
            XCTAssertFalse(style.systemImage.isEmpty)
        }
    }

    func testPhaseStyleGlyphMapping() {
        func glyph(_ phase: ScrollRestorationPhase) -> String {
            ScrollRestorationPhaseStyle.style(for: phase).systemImage
        }
        XCTAssertEqual(glyph(.restored), "arrow.uturn.backward.circle.fill")
        XCTAssertEqual(glyph(.unavailable), "externaldrive.badge.xmark")
        XCTAssertEqual(glyph(.freshTop), "arrow.up.to.line")
    }

    func testSurfaceConstructsForEveryState() {
        for phase in ScrollRestorationPhase.allCases {
            _ = ScrollRestorationStatusView(phase: phase, restoreOffset: 100, storeAvailable: phase != .unavailable)
            _ = ScrollRestorationStatusChip(phase: phase)
        }
        _ = ScrollRestorationDegradedBanner()
    }
}

// MARK: - i18n facade + telemetry

@MainActor
final class ScrollRestorationStringsTests: XCTestCase {
    func testFacadeTableNameIsStable() {
        XCTAssertEqual(ScrollRestorationStrings.table, "ScrollRestoration")
    }

    func testKeysResolveToFallbacks() {
        XCTAssertEqual(
            ScrollRestorationStrings.string("scrollRestoration.title", "Scroll restoration"),
            "Scroll restoration"
        )
        XCTAssertEqual(ScrollRestorationStrings.string("scrollRestoration.offset.top", "Top"), "Top")
        XCTAssertEqual(
            ScrollRestorationStrings.string("scrollRestoration.degraded.title", "Scroll restoration is off"),
            "Scroll restoration is off"
        )
    }

    func testSlugIsStable() {
        XCTAssertEqual(ScrollRestorationSurface.slug, "ScrollRestoration")
        XCTAssertEqual(ScrollRestoration.surfaceSlug, "ScrollRestoration")
    }

    func testOSLogTelemetryIsInvokable() {
        OSLogScrollRestorationTelemetry().viewOpened(surface: ScrollRestorationSurface.slug)
    }
}

// MARK: - Test doubles

/// An injectable monotonic clock for deterministic throttle tests.
@MainActor
private final class ScrollRestorationTestClock {
    var now: Double = 0
}

/// Records `view.opened` surfaces so the telemetry contract can be asserted.
private final class SpyScrollRestorationTelemetry: ScrollRestorationTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
