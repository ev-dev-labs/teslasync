//
//  MapTileLayer.Tests.swift
//  TeslaSync — P4 shared surface · 0185 · MapTileLayer (Apple)
//
//  State-holder + view coverage for the MapTileLayer surface: the model's lifecycle (start
//  idempotence + the once-only `view.opened` telemetry that fires on appear), the config snapshot
//  apply (connection / phase / config, with the offline snapshot retaining the last-known config),
//  the connectivity axis with the one-shot stale auto-refresh (re-armed on return to live) and
//  offline never auto-refreshing, the style switch re-resolving the tiles, the every-state view
//  composition (signature contract + status routing), the corner-alignment mapping, and the
//  freshness / overlay accessibility copy. Runs in the TeslaSync(/-macOS) XCTest targets.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Model (state-holder)

@MainActor
final class MapTileLayerModelTests: XCTestCase {
    private struct Harness {
        let model: MapTileLayerModel
        let source: InMemoryMapTileLayerSource
        let spy: SpyMapTileLayerTelemetry
    }

    private func makeHarness(_ input: MapTileLayerInput, style: MapTileLayerStyle = .dark) -> Harness {
        let source = InMemoryMapTileLayerSource(initial: input)
        let spy = SpyMapTileLayerTelemetry()
        let content = MapTileLayerContent(style: style)
        let model = MapTileLayerModel(content: content, source: source, telemetry: spy)
        return Harness(model: model, source: source, spy: spy)
    }

    private var liveLoaded: MapTileLayerInput {
        MapTileLayerInput(
            connection: .live,
            phase: .loaded,
            config: MapTileLayerConfigRow(provider: "free", apiKey: "")
        )
    }

    func testStartIsIdempotent() {
        let env = makeHarness(liveLoaded)
        env.model.start()
        env.model.start()
        XCTAssertEqual(env.source.startCount, 1)
    }

    func testStartEmitsViewOpenedOnce() {
        let env = makeHarness(liveLoaded)
        env.model.start()
        XCTAssertEqual(env.spy.surfaces, [MapTileLayerMeta.surfaceSlug])
        env.source.push(MapTileLayerInput(connection: .stale, phase: .loaded))
        XCTAssertEqual(env.spy.surfaces, [MapTileLayerMeta.surfaceSlug])
    }

    func testViewOpenedStaysOnceAcrossStopStart() {
        let env = makeHarness(liveLoaded)
        env.model.start()
        env.model.stop()
        env.model.start()
        XCTAssertEqual(env.source.startCount, 2)
        XCTAssertEqual(env.spy.surfaces, [MapTileLayerMeta.surfaceSlug])
    }

    func testApplyUpdatesConnectionPhaseAndConfig() {
        let env = makeHarness(liveLoaded)
        env.model.start()
        XCTAssertEqual(env.model.connection, .live)
        XCTAssertEqual(env.model.phase, .loaded)
        XCTAssertEqual(env.model.resolved.provider, .free)

        env.source.push(MapTileLayerInput(
            connection: .live,
            phase: .loaded,
            config: MapTileLayerConfigRow(provider: "google", apiKey: "K")
        ))
        XCTAssertEqual(env.model.resolved.provider, .google)
    }

    func testOfflineSnapshotRetainsLastConfig() {
        let env = makeHarness(MapTileLayerInput(
            connection: .live,
            phase: .loaded,
            config: MapTileLayerConfigRow(provider: "google", apiKey: "K")
        ))
        env.model.start()
        XCTAssertEqual(env.model.resolved.provider, .google)

        // Offline with no fresh config → keep the cached provider (web cache-then-network).
        env.source.push(MapTileLayerInput(connection: .offline, phase: .loaded, config: nil))
        XCTAssertEqual(env.model.connection, .offline)
        XCTAssertEqual(env.model.resolved.provider, .google)
    }

    func testStaleTriggersOneShotAutoRefresh() {
        let env = makeHarness(liveLoaded)
        env.model.start()
        XCTAssertEqual(env.source.refreshCount, 0)

        env.source.push(MapTileLayerInput(connection: .stale, phase: .loaded))
        XCTAssertEqual(env.source.refreshCount, 1)

        // Staying stale does not re-arm the auto-refresh.
        env.source.push(MapTileLayerInput(connection: .stale, phase: .loaded))
        XCTAssertEqual(env.source.refreshCount, 1)
    }

    func testStaleReArmsAfterReturningToLive() {
        let env = makeHarness(liveLoaded)
        env.model.start()
        env.source.push(MapTileLayerInput(connection: .stale, phase: .loaded))
        XCTAssertEqual(env.source.refreshCount, 1)
        env.source.push(liveLoaded)
        env.source.push(MapTileLayerInput(connection: .stale, phase: .loaded))
        XCTAssertEqual(env.source.refreshCount, 2)
    }

    func testOfflineDoesNotAutoRefresh() {
        let env = makeHarness(liveLoaded)
        env.model.start()
        env.source.push(MapTileLayerInput(connection: .offline, phase: .loaded))
        XCTAssertEqual(env.source.refreshCount, 0)
    }

    func testSetStyleReResolvesTiles() {
        let env = makeHarness(liveLoaded, style: .dark)
        env.model.start()
        XCTAssertEqual(env.model.resolved.style, .dark)
        XCTAssertTrue(env.model.resolved.tileDef.url.contains("cartocdn"))

        env.model.setStyle(.satellite)
        XCTAssertEqual(env.model.resolved.style, .satellite)
        XCTAssertTrue(env.model.resolved.tileDef.url.contains("arcgisonline"))
    }

    func testManualRefreshForwardsToSource() {
        let env = makeHarness(liveLoaded)
        env.model.start()
        env.model.refresh()
        XCTAssertEqual(env.source.refreshCount, 1)
    }
}

// MARK: - View composition (every state renders — signature contract + status routing)

@MainActor
final class MapTileLayerViewTests: XCTestCase {
    private func model(_ input: MapTileLayerInput, style: MapTileLayerStyle = .dark) -> MapTileLayerModel {
        let model = MapTileLayerModel(
            content: MapTileLayerContent(style: style),
            source: InMemoryMapTileLayerSource(initial: input)
        )
        model.start()
        return model
    }

    func testSurfaceBuildsForEveryConnectivityState() {
        for connection in MapTileLayerConnection.allCases {
            let view = MapTileLayer(model: model(MapTileLayerInput(
                connection: connection,
                phase: .loaded,
                config: MapTileLayerConfigRow(provider: "free", apiKey: "")
            )))
            XCTAssertEqual(MapTileLayer.surfaceSlug, "MapTileLayer")
            _ = view.body
        }
    }

    func testStatusRoutingForEveryLoadState() {
        XCTAssertEqual(
            model(MapTileLayerInput(connection: .live, phase: .loading, config: nil)).resolved.status,
            .loading
        )
        XCTAssertEqual(
            model(MapTileLayerInput(
                connection: .live,
                phase: .failed,
                config: MapTileLayerConfigRow(provider: "free", apiKey: "")
            )).resolved.status,
            .error
        )
        XCTAssertEqual(
            model(MapTileLayerInput(
                connection: .live,
                phase: .loaded,
                config: MapTileLayerConfigRow(provider: "free", apiKey: "")
            )).resolved.status,
            .ready
        )
    }

    func testOverlayViewsBuild() {
        _ = MapTileLayerLoadingOverlay().body
        _ = MapTileLayerEmptyOverlay().body
        _ = MapTileLayerErrorOverlay(onRetry: {}).body
        _ = MapTileLayerConnectivityBanner(connection: .offline).body
        _ = MapTileLayerAttributionChip(attribution: "© CARTO").body
    }

    func testCornerAlignmentMapping() {
        XCTAssertEqual(MapTileLayerCorner.topleft.alignment, .topLeading)
        XCTAssertEqual(MapTileLayerCorner.topright.alignment, .topTrailing)
        XCTAssertEqual(MapTileLayerCorner.bottomleft.alignment, .bottomLeading)
        XCTAssertEqual(MapTileLayerCorner.bottomright.alignment, .bottomTrailing)
    }
}

// MARK: - Accessibility + freshness copy

final class MapTileLayerAccessibilityTests: XCTestCase {
    func testFreshnessLabelsResolve() {
        XCTAssertEqual(MapTileLayerFreshness.label(for: .live), "Live")
        XCTAssertEqual(MapTileLayerFreshness.label(for: .stale), "Stale")
        XCTAssertEqual(MapTileLayerFreshness.label(for: .offline), "Offline")
    }

    func testFreshnessNotesAreNonEmptyAndDistinct() {
        let live = MapTileLayerFreshness.note(for: .live)
        let stale = MapTileLayerFreshness.note(for: .stale)
        let offline = MapTileLayerFreshness.note(for: .offline)
        XCTAssertFalse(live.isEmpty)
        XCTAssertFalse(stale.isEmpty)
        XCTAssertFalse(offline.isEmpty)
        XCTAssertNotEqual(stale, offline)
    }

    func testFreshnessTonesAreDistinct() {
        XCTAssertNotEqual(MapTileLayerFreshness.tone(for: .live), MapTileLayerFreshness.tone(for: .stale))
        XCTAssertNotEqual(MapTileLayerFreshness.tone(for: .stale), MapTileLayerFreshness.tone(for: .offline))
    }

    func testStyleAndProviderLabelsHaveFallbacks() {
        for style in MapTileLayerStyle.allCases {
            XCTAssertFalse(style.labelFallback.isEmpty)
            XCTAssertTrue(style.labelKey.hasPrefix("mapTileLayer.style."))
        }
        for provider in MapTileLayerProvider.allCases {
            XCTAssertFalse(provider.labelFallback.isEmpty)
            XCTAssertTrue(provider.labelKey.hasPrefix("mapTileLayer.provider."))
        }
    }
}

// MARK: - Telemetry spy

private final class SpyMapTileLayerTelemetry: MapTileLayerTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var surfaces: [String] {
        lock.lock(); defer { lock.unlock() }
        return storage
    }

    func viewOpened(surface: String) {
        lock.lock(); storage.append(surface); lock.unlock()
    }
}
