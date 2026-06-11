//
//  OfflineBanner.Tests.swift
//  TeslaSync — P4 shared surface · 0130 · OfflineBanner (Apple)
//
//  Adapter + projection + model + source coverage for the OfflineBanner surface:
//    • Copy — the web `t('pwa.offline.title')` / `t('pwa.offline.banner')` defaults + the canonical
//      web source-key list (the parity guard).
//    • Accessibility — the composed VoiceOver summary (title + body, plus the stale note) + whitespace
//      normalisation.
//    • Projection — every render branch across error / loading / online / offline, with a cached
//      reading surviving a transient failure (the P4 leaf contract) and the freshness axis carried
//      through to the offline payload.
//    • Model — start telemetry, snapshot application, the stale rising-edge one-shot auto-refresh, stop.
//    • Sources — the controlled source re-emits + updates; the monitored (production) source emits the
//      loading leaf before the first path resolves.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real monitor, so
//  each assertion reads the pure adapter / projection directly or drives the model through an in-memory
//  source. The string resolver is the identity-fallback so the asserted copy is deterministic.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

/// Identity-fallback resolver — returns the web English default so the asserted copy is independent of
/// the bundle / locale catalog.
private let fallbackStrings: OfflineBannerResolve = { _, fallback in fallback }

private let offlineTitle = "You're offline"
private let offlineBody = "Showing cached data. New requests will retry when you reconnect."

// MARK: - Copy (web `pwa.offline.title` / `pwa.offline.banner`)

final class OfflineBannerCopyTests: XCTestCase {
    func testTitleUsesTheWebDefault() {
        XCTAssertEqual(OfflineBannerCopy.title(fallbackStrings), offlineTitle)
    }

    func testBannerUsesTheWebDefault() {
        XCTAssertEqual(OfflineBannerCopy.banner(fallbackStrings), offlineBody)
    }

    func testWebSourceKeysMatchTheWebComponentInRenderOrder() {
        XCTAssertEqual(OfflineBannerCopy.webSourceKeys, ["pwa.offline.title", "pwa.offline.banner"])
    }

    func testEveryWebSourceKeyHasANonEmptyDefault() {
        // Each canonical web key must carry a real, non-empty English default so the surface never
        // renders a blank string when the catalog is missing an entry.
        for key in OfflineBannerCopy.webSourceKeys {
            XCTAssertFalse(key.isEmpty)
        }
        XCTAssertFalse(OfflineBannerCopy.title(fallbackStrings).isEmpty)
        XCTAssertFalse(OfflineBannerCopy.banner(fallbackStrings).isEmpty)
    }

    func testProductionFacadeResolvesTheWebKeysFromTheCatalogValue() {
        // The production P1/S10 facade reads the per-surface table; with no localized override the
        // NSLocalizedString `value:` fallback (the web default) is returned, never the bare key.
        XCTAssertEqual(OfflineBannerStrings.string("pwa.offline.title", offlineTitle), offlineTitle)
        XCTAssertEqual(OfflineBannerStrings.string("pwa.offline.banner", offlineBody), offlineBody)
    }
}

// MARK: - Accessibility

final class OfflineBannerAccessibilityTests: XCTestCase {
    func testBannerSummaryCombinesTitleAndBody() {
        XCTAssertEqual(
            OfflineBannerAccessibility.bannerSummary(
                title: offlineTitle,
                body: offlineBody,
                freshness: .live,
                strings: fallbackStrings
            ),
            "\(offlineTitle) \(offlineBody)"
        )
    }

    func testBannerSummaryAppendsStaleNoteWhenStale() {
        let summary = OfflineBannerAccessibility.bannerSummary(
            title: offlineTitle,
            body: offlineBody,
            freshness: .stale,
            strings: fallbackStrings
        )
        XCTAssertTrue(summary.hasPrefix("\(offlineTitle) \(offlineBody)"))
        XCTAssertTrue(summary.hasSuffix("Rechecking your connection."))
    }

    func testNormalizeCollapsesWhitespace() {
        XCTAssertEqual(
            OfflineBannerAccessibility.normalize("You're   offline.\n Showing  cached data."),
            "You're offline. Showing cached data."
        )
    }

    func testNormalizeTrimsEnds() {
        XCTAssertEqual(OfflineBannerAccessibility.normalize("  Offline  "), "Offline")
    }
}

// MARK: - Projection (render branches + P4 leaf contract)

final class OfflineBannerProjectionTests: XCTestCase {
    private func resolve(_ input: OfflineBannerInput) -> OfflineBannerResolved {
        OfflineBannerProjection.resolve(input: input, strings: fallbackStrings)
    }

    func testErrorWithNoReadingIsError() {
        let resolved = resolve(OfflineBannerInput(errorMessage: "boom"))
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertNil(resolved.data)
    }

    func testErrorWithCachedReadingKeepsShowingIt() {
        let resolved = resolve(OfflineBannerInput(status: .offline, errorMessage: "boom"))
        XCTAssertEqual(resolved.phase, .offline)
        XCTAssertEqual(resolved.data?.title, offlineTitle)
    }

    func testUnknownReadingIsLoading() {
        XCTAssertEqual(resolve(OfflineBannerInput()).phase, .loading)
    }

    func testLoadingWithNoReadingIsLoading() {
        XCTAssertEqual(resolve(OfflineBannerInput(isLoading: true)).phase, .loading)
    }

    func testCachedReadingSurvivesReProbeLoading() {
        XCTAssertEqual(resolve(OfflineBannerInput(status: .online, isLoading: true)).phase, .online)
    }

    func testOnlineIsTheFriendlyEmptyLeaf() {
        let resolved = resolve(OfflineBannerInput(status: .online))
        XCTAssertEqual(resolved.phase, .online)
        XCTAssertNil(resolved.data)
        XCTAssertEqual(resolved.freshness, .live)
    }

    func testOfflineRendersTheWarningWithBothStrings() {
        let resolved = resolve(OfflineBannerInput(status: .offline))
        XCTAssertEqual(resolved.phase, .offline)
        XCTAssertEqual(resolved.data?.title, offlineTitle)
        XCTAssertEqual(resolved.data?.body, offlineBody)
        XCTAssertEqual(resolved.data?.accessibilitySummary, "\(offlineTitle) \(offlineBody)")
        XCTAssertEqual(resolved.freshness, .live)
    }

    func testStaleOfflineCarriesFreshnessAndStaleSummary() {
        let resolved = resolve(OfflineBannerInput(status: .offline, freshness: .stale))
        XCTAssertEqual(resolved.phase, .offline)
        XCTAssertEqual(resolved.freshness, .stale)
        XCTAssertTrue(resolved.data?.accessibilitySummary.hasSuffix("Rechecking your connection.") ?? false)
    }

    func testOnlineIgnoresStaleFreshness() {
        // Freshness is only meaningful while offline; an online reading is always reported live.
        XCTAssertEqual(resolve(OfflineBannerInput(status: .online, freshness: .stale)).freshness, .live)
    }
}

// MARK: - Model (state holder + auto-refresh)

private final class SpyOfflineBannerTelemetry: OfflineBannerTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var opened: [String] = []

    var openedSurfaces: [String] {
        lock.withLock { opened }
    }

    func viewOpened(surface: String) {
        lock.withLock { opened.append(surface) }
    }
}

@MainActor
final class OfflineBannerModelTests: XCTestCase {
    private func makeModel(
        source: InMemoryOfflineBannerSource,
        telemetry: OfflineBannerTelemetry = SpyOfflineBannerTelemetry()
    ) -> OfflineBannerModel {
        OfflineBannerModel(source: source, telemetry: telemetry, strings: fallbackStrings)
    }

    func testStartEmitsViewOpenedAndStartsSource() {
        let source = InMemoryOfflineBannerSource(initial: OfflineBannerInput(status: .online))
        let telemetry = SpyOfflineBannerTelemetry()
        let model = makeModel(source: source, telemetry: telemetry)

        model.start()
        model.start() // idempotent

        XCTAssertEqual(telemetry.openedSurfaces, ["OfflineBanner"])
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(model.phase, .online)
    }

    func testApplyDrivesPhaseFreshnessAndData() {
        let source = InMemoryOfflineBannerSource()
        let model = makeModel(source: source)
        model.start()

        source.push(OfflineBannerInput(status: .offline))

        XCTAssertEqual(model.phase, .offline)
        XCTAssertEqual(model.freshness, .live)
        XCTAssertEqual(model.data?.title, offlineTitle)
        XCTAssertEqual(model.data?.body, offlineBody)
    }

    func testStaleRisingEdgeAutoRefreshesOnce() {
        let source = InMemoryOfflineBannerSource()
        let model = makeModel(source: source)
        model.start()

        source.push(OfflineBannerInput(status: .offline, freshness: .stale))
        XCTAssertEqual(source.refreshCount, 1)

        // A second stale snapshot does not re-trigger the one-shot auto-refresh.
        source.push(OfflineBannerInput(status: .offline, freshness: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testReturningToLiveReArmsTheStaleAutoRefresh() {
        let source = InMemoryOfflineBannerSource()
        let model = makeModel(source: source)
        model.start()

        source.push(OfflineBannerInput(status: .offline, freshness: .stale))
        XCTAssertEqual(source.refreshCount, 1)

        // A live reading resets the edge so the next stale transition re-probes again.
        source.push(OfflineBannerInput(status: .offline, freshness: .live))
        source.push(OfflineBannerInput(status: .offline, freshness: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOnlineReadingDoesNotAutoRefresh() {
        let source = InMemoryOfflineBannerSource()
        let model = makeModel(source: source)
        model.start()

        source.push(OfflineBannerInput(status: .online))
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testRefreshForwardsToSource() {
        let source = InMemoryOfflineBannerSource()
        let model = makeModel(source: source)
        model.start()

        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopStopsSource() {
        let source = InMemoryOfflineBannerSource()
        let model = makeModel(source: source)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}

// MARK: - Sources

@MainActor
final class OfflineBannerSourceTests: XCTestCase {
    func testStaticSourceEmitsAndUpdates() {
        let source = StaticOfflineBannerSource(OfflineBannerInput(status: .online))
        var emissions: [OfflineBannerInput] = []
        source.onUpdate = { emissions.append($0) }

        source.start()
        source.update(OfflineBannerInput(status: .offline, freshness: .stale))
        source.refresh()

        XCTAssertEqual(emissions.count, 3)
        XCTAssertEqual(emissions[0].status, .online)
        XCTAssertEqual(emissions[1].status, .offline)
        XCTAssertEqual(emissions[1].freshness, .stale)
        XCTAssertEqual(emissions[2].status, .offline) // refresh re-emits the updated snapshot
    }

    func testMonitoredSourceEmitsLoadingBeforeFirstPath() {
        let source = MonitoredOfflineBannerSource(staleAfter: 120)
        var first: OfflineBannerInput?
        source.onUpdate = { if first == nil { first = $0 } }

        source.start()
        defer { source.stop() }

        XCTAssertEqual(first?.status, nil)
        XCTAssertEqual(first?.isLoading, true)
    }
}
