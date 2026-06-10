//
//  SecurityStatistics.Tests.swift
//  TeslaSync — P4 feature view · 0045 · SecurityStatistics (Apple)
//
//  Unit coverage for the SecurityStatistics surface:
//    • Adapter (cached snapshot → projection) — the 7-tile grid (web `MetricCard`
//      order/labels/values/icons/colors), the `fmtInt`/raw-`{value}` number parity,
//      the freshness-chip projection, and the VoiceOver tile + summary builders.
//    • State holder — `SecurityStatisticsModel` phase transitions across loading /
//      loaded / empty / failed, the cached-behind-offline contract, freshness (stale),
//      the stale auto-refresh + load re-entrancy guard, and the P1/S11 `view.opened`
//      telemetry + seam wiring.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemorySecurityStatisticsSource`.
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private let sampleSnapshot = SecurityStatsSnapshot(
    stats: SecurityStatsValue(
        lockEvents: 42,
        doorOpenCount: 17,
        windowOpenCount: 6,
        homelinkCount: 23,
        guestCount: 3,
        total: 128
    ),
    sentryUptimePercent: 87.4
)

// MARK: - Adapter: cached snapshot → projection

@MainActor final class SecurityStatisticsAdapterTests: XCTestCase {
    /// English-fallback localizer (bundle-free) used by the projection tests.
    private let echo: (String, String) -> String = { _, fallback in fallback }

    // Tile grid (web 7-card order / labels / icons / colors)

    func testTilesProjectionMatchesWebOrderAndContent() {
        let tiles = SecurityStatisticsTiles.project(sampleSnapshot, locale: Locale(identifier: "en_US"))
        XCTAssertEqual(tiles.count, 7)

        XCTAssertEqual(tiles.map(\.id), [
            "lockEvents", "sentryUptime", "doorOpens", "windowOpens", "homelink", "guestMode", "totalEvents"
        ])
        XCTAssertEqual(tiles.map(\.labelKey), [
            "admin.security.stats.lockEvents",
            "admin.security.stats.sentryUptime",
            "admin.security.stats.doorOpens",
            "admin.security.stats.windowOpens",
            "admin.security.stats.homelink",
            "admin.security.stats.guestMode",
            "admin.security.stats.totalEvents"
        ])
        XCTAssertEqual(tiles.map(\.systemImage), [
            "lock.fill", "eye.fill", "door.left.hand.open", "car.fill",
            "house.fill", "person.fill.checkmark", "waveform.path.ecg"
        ])
        XCTAssertEqual(tiles.map(\.color), [.green, .blue, .amber, .amber, .purple, .amber, .cyan])
    }

    func testCountTilesRenderRawIntegerLikeWebJSX() {
        let tiles = SecurityStatisticsTiles.project(sampleSnapshot)
        XCTAssertEqual(tiles[0].value, "42") // lockEvents
        XCTAssertEqual(tiles[2].value, "17") // doorOpens
        XCTAssertEqual(tiles[6].value, "128") // totalEvents
    }

    func testSentryUptimeTileUsesFmtIntPercent() {
        let tiles = SecurityStatisticsTiles.project(sampleSnapshot, locale: Locale(identifier: "en_US"))
        // Web: `${fmtInt(87.4)}%` → "87%" (rounded integer + percent).
        XCTAssertEqual(tiles[1].value, "87%")
    }

    // Number formatting parity (web `fmtInt`)

    func testIntGroupsThousandsAndRoundsHalfUp() {
        let locale = Locale(identifier: "en_US")
        XCTAssertEqual(SecurityStatNumber.int(12345.6, locale: locale), "12,346")
        XCTAssertEqual(SecurityStatNumber.int(2500.5, locale: locale), "2,501")
        XCTAssertEqual(SecurityStatNumber.int(999, locale: locale), "999")
    }

    func testCountNeverGroups() {
        XCTAssertEqual(SecurityStatNumber.count(12345), "12345")
        XCTAssertEqual(SecurityStatNumber.count(0), "0")
    }

    func testPercentRoundsAndAppendsSign() {
        let locale = Locale(identifier: "en_US")
        XCTAssertEqual(SecurityStatNumber.percent(87.6, locale: locale), "88%")
        XCTAssertEqual(SecurityStatNumber.percent(0, locale: locale), "0%")
        XCTAssertEqual(SecurityStatNumber.percent(100, locale: locale), "100%")
    }

    // Color mapping (5 distinct web NeonColors)

    func testColorCasesAreFiveDistinct() {
        XCTAssertEqual(Set(SecurityMetricColor.allCases).count, 5)
    }

    // Freshness chip projection

    func testConnectionChipMapsEveryState() {
        XCTAssertEqual(SecurityStatisticsConnectionChip.project(.live).labelKey, "admin.security.stats.live")
        XCTAssertEqual(SecurityStatisticsConnectionChip.project(.live).tone, .success)
        XCTAssertEqual(SecurityStatisticsConnectionChip.project(.stale).labelKey, "admin.security.stats.stale")
        XCTAssertEqual(SecurityStatisticsConnectionChip.project(.stale).tone, .warning)
        XCTAssertEqual(SecurityStatisticsConnectionChip.project(.offline).labelKey, "admin.security.stats.offline")
        XCTAssertEqual(SecurityStatisticsConnectionChip.project(.offline).tone, .neutral)
    }

    // Accessibility summaries

    func testTileAccessibilityLabelCombinesLabelAndValue() {
        let tiles = SecurityStatisticsTiles.project(sampleSnapshot, locale: Locale(identifier: "en_US"))
        XCTAssertEqual(SecurityStatisticsAccessibility.tileLabel(tiles[1], localize: echo), "Sentry Uptime, 87%")
        XCTAssertEqual(SecurityStatisticsAccessibility.tileLabel(tiles[0], localize: echo), "Lock/Unlock Events, 42")
    }

    func testSummaryAcrossPhases() {
        XCTAssertEqual(
            SecurityStatisticsAccessibility.summary(phase: .loading, tileCount: 0, localize: echo),
            "Security Statistics. Loading statistics…"
        )
        XCTAssertEqual(
            SecurityStatisticsAccessibility.summary(phase: .loaded, tileCount: 7, localize: echo),
            "Security Statistics. 7 metrics"
        )
        XCTAssertEqual(
            SecurityStatisticsAccessibility.summary(phase: .empty, tileCount: 0, localize: echo),
            "Security Statistics. No data available"
        )
        XCTAssertEqual(
            SecurityStatisticsAccessibility.summary(phase: .failed, tileCount: 0, localize: echo),
            "Security Statistics. Couldn't load statistics"
        )
    }
}

// MARK: - State holder: phases + freshness + telemetry + seam wiring

@MainActor final class SecurityStatisticsModelTests: XCTestCase {
    func testInitialStateIsLoading() {
        let model = SecurityStatisticsModel(source: InMemorySecurityStatisticsSource(autoResponds: false))
        XCTAssertEqual(model.phase, .loading)
        XCTAssertNil(model.snapshot)
        XCTAssertFalse(model.showsFreshness)
        XCTAssertEqual(model.connection, .live)
        XCTAssertTrue(model.tiles.isEmpty)
    }

    func testStartLoadsAndEmitsTelemetryOnce() {
        let spy = SpySecurityStatisticsTelemetry()
        let source = InMemorySecurityStatisticsSource(outcome: .loaded(sampleSnapshot))
        let model = SecurityStatisticsModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [SecurityStatisticsSurface.slug])
        XCTAssertEqual(SecurityStatisticsSurface.slug, "SecurityStatistics")
        XCTAssertEqual(source.loadCount, 1)
    }

    func testLoadedOutcomePopulatesSnapshotAndTiles() throws {
        let model = SecurityStatisticsModel(source: InMemorySecurityStatisticsSource(outcome: .loaded(sampleSnapshot)))
        model.start()
        XCTAssertEqual(model.phase, .loaded)
        XCTAssertTrue(model.showsFreshness)
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(try XCTUnwrap(model.snapshot), sampleSnapshot)
        XCTAssertEqual(model.tiles.count, 7)
    }

    func testEmptyOutcomeShowsEmptyPhase() {
        let model = SecurityStatisticsModel(source: InMemorySecurityStatisticsSource(outcome: .empty))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.snapshot)
        XCTAssertFalse(model.showsFreshness)
        XCTAssertTrue(model.tiles.isEmpty)
    }

    func testFailureOutcomeSurfacesError() {
        let source = InMemorySecurityStatisticsSource(outcome: .failure(message: "503 — collector down"))
        let model = SecurityStatisticsModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .failed)
        XCTAssertEqual(model.errorMessage, "503 — collector down")
        XCTAssertFalse(model.showsFreshness)
    }

    func testOfflineKeepsCachedSnapshotVisible() throws {
        let source = InMemorySecurityStatisticsSource(autoResponds: false)
        let model = SecurityStatisticsModel(source: source)
        model.start()
        source.push(.loaded(sampleSnapshot))
        source.push(.offline(message: "Network unavailable"))

        XCTAssertEqual(model.phase, .loaded)
        XCTAssertTrue(model.isOffline)
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(try XCTUnwrap(model.snapshot), sampleSnapshot)
        XCTAssertEqual(model.tiles.count, 7)
    }

    func testOfflineWithoutCacheBecomesFailure() {
        let model =
            SecurityStatisticsModel(
                source: InMemorySecurityStatisticsSource(outcome: .offline(message: "No connection"))
            )
        model.start()
        XCTAssertEqual(model.phase, .failed)
        XCTAssertTrue(model.isOffline)
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.errorMessage, "No connection")
    }

    func testStaleAfterFreshnessWindow() {
        let clock = SecurityStatisticsMutableClock(Date(timeIntervalSince1970: 1_000_000))
        let source = InMemorySecurityStatisticsSource(outcome: .loaded(sampleSnapshot))
        let model = SecurityStatisticsModel(source: source, now: { clock.now() }, stalenessWindow: 60)
        model.start()
        XCTAssertFalse(model.isStale)
        XCTAssertEqual(model.connection, .live)

        clock.current = Date(timeIntervalSince1970: 1_000_200)
        XCTAssertTrue(model.isStale)
        XCTAssertEqual(model.connection, .stale)
    }

    func testReloadIfStaleReloadsOnlyWhenStale() {
        let clock = SecurityStatisticsMutableClock(Date(timeIntervalSince1970: 2_000_000))
        let source = InMemorySecurityStatisticsSource(outcome: .loaded(sampleSnapshot))
        let model = SecurityStatisticsModel(source: source, now: { clock.now() }, stalenessWindow: 60)
        model.start()
        XCTAssertEqual(source.loadCount, 1)

        // Fresh → no-op.
        model.reloadIfStale()
        XCTAssertEqual(source.loadCount, 1)

        // Past the window → reload.
        clock.current = Date(timeIntervalSince1970: 2_000_200)
        model.reloadIfStale()
        XCTAssertEqual(source.loadCount, 2)
    }

    func testLoadIsGuardedWhileFetching() {
        let source = InMemorySecurityStatisticsSource(autoResponds: false)
        let model = SecurityStatisticsModel(source: source)
        model.start()
        model.reload()
        XCTAssertEqual(source.loadCount, 1)

        source.push(.loaded(sampleSnapshot))
        model.reload()
        XCTAssertEqual(source.loadCount, 2)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpySecurityStatisticsTelemetry: SecurityStatisticsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

/// A settable clock so the freshness window can be crossed deterministically.
private final class SecurityStatisticsMutableClock: @unchecked Sendable {
    var current: Date
    init(_ start: Date) {
        current = start
    }

    func now() -> Date {
        current
    }
}
