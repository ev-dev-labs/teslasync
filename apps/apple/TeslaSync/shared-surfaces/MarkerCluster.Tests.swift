//
//  MarkerCluster.Tests.swift
//  TeslaSync — P4 shared surface · 0186 · MarkerCluster (Apple)
//
//  State-holder + view coverage for the MarkerCluster surface: the model's lifecycle (start
//  idempotence + the once-only `view.opened` telemetry that fires on appear), the point-snapshot apply
//  (connection / phase / points, with an offline snapshot retaining the last-known markers and an
//  explicit empty feed clearing them), the connectivity axis with the one-shot stale auto-refresh
//  (re-armed on return to live) and offline never auto-refreshing, the colour-mode switch re-resolving
//  the cluster colouring, the marker selection + pruning (web `onMarkerClick`), the every-state view
//  composition (signature contract + status routing), the chrome views, and the freshness / colour-mode
//  accessibility copy. Runs in the TeslaSync(/-macOS) XCTest targets.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Model (state-holder)

@MainActor
final class MarkerClusterModelTests: XCTestCase {
    private struct Harness {
        let model: MarkerClusterModel
        let source: InMemoryMarkerClusterSource
        let spy: SpyMarkerClusterTelemetry
    }

    private func point(_ id: String) -> MarkerClusterPoint {
        MarkerClusterPoint(id: id, latitude: 37.7, longitude: -122.4)
    }

    private func makeHarness(
        _ input: MarkerClusterInput,
        content: MarkerClusterContent = MarkerClusterContent()
    ) -> Harness {
        let source = InMemoryMarkerClusterSource(initial: input)
        let spy = SpyMarkerClusterTelemetry()
        let model = MarkerClusterModel(content: content, source: source, telemetry: spy)
        return Harness(model: model, source: source, spy: spy)
    }

    private var liveLoaded: MarkerClusterInput {
        MarkerClusterInput(connection: .live, phase: .loaded, points: [point("a"), point("b"), point("c")])
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
        XCTAssertEqual(env.spy.surfaces, [MarkerClusterMeta.surfaceSlug])
        env.source.push(MarkerClusterInput(connection: .stale, phase: .loaded))
        XCTAssertEqual(env.spy.surfaces, [MarkerClusterMeta.surfaceSlug])
    }

    func testViewOpenedStaysOnceAcrossStopStart() {
        let env = makeHarness(liveLoaded)
        env.model.start()
        env.model.stop()
        env.model.start()
        XCTAssertEqual(env.source.startCount, 2)
        XCTAssertEqual(env.spy.surfaces, [MarkerClusterMeta.surfaceSlug])
    }

    func testApplyUpdatesConnectionPhaseAndPoints() {
        let env = makeHarness(liveLoaded)
        env.model.start()
        XCTAssertEqual(env.model.connection, .live)
        XCTAssertEqual(env.model.phase, .loaded)
        XCTAssertEqual(env.model.points.count, 3)
        XCTAssertEqual(env.model.resolved.status, .ready)

        env.source.push(MarkerClusterInput(connection: .live, phase: .loaded, points: [point("z")]))
        XCTAssertEqual(env.model.points.map(\.id), ["z"])
    }

    func testOfflineSnapshotRetainsLastPoints() {
        let env = makeHarness(liveLoaded)
        env.model.start()
        XCTAssertEqual(env.model.points.count, 3)

        // Offline tick with no fresh points → keep the cached markers (web cache-then-network).
        env.source.push(MarkerClusterInput(connection: .offline, phase: .loaded, points: nil))
        XCTAssertEqual(env.model.connection, .offline)
        XCTAssertEqual(env.model.points.count, 3)
        XCTAssertEqual(env.model.resolved.renderedCount, 3)
    }

    func testExplicitEmptyFeedClearsPoints() {
        let env = makeHarness(liveLoaded)
        env.model.start()
        env.source.push(MarkerClusterInput(connection: .live, phase: .loaded, points: []))
        XCTAssertTrue(env.model.points.isEmpty)
        XCTAssertEqual(env.model.resolved.status, .empty)
    }

    func testStaleTriggersOneShotAutoRefresh() {
        let env = makeHarness(liveLoaded)
        env.model.start()
        XCTAssertEqual(env.source.refreshCount, 0)

        env.source.push(MarkerClusterInput(connection: .stale, phase: .loaded))
        XCTAssertEqual(env.source.refreshCount, 1)

        env.source.push(MarkerClusterInput(connection: .stale, phase: .loaded))
        XCTAssertEqual(env.source.refreshCount, 1)
    }

    func testStaleReArmsAfterReturningToLive() {
        let env = makeHarness(liveLoaded)
        env.model.start()
        env.source.push(MarkerClusterInput(connection: .stale, phase: .loaded))
        XCTAssertEqual(env.source.refreshCount, 1)
        env.source.push(liveLoaded)
        env.source.push(MarkerClusterInput(connection: .stale, phase: .loaded))
        XCTAssertEqual(env.source.refreshCount, 2)
    }

    func testOfflineDoesNotAutoRefresh() {
        let env = makeHarness(liveLoaded)
        env.model.start()
        env.source.push(MarkerClusterInput(connection: .offline, phase: .loaded))
        XCTAssertEqual(env.source.refreshCount, 0)
    }

    func testSetColorModeReResolves() {
        let env = makeHarness(liveLoaded)
        env.model.start()
        XCTAssertEqual(env.model.resolved.colorMode, .countDensity)
        env.model.setColorMode(.dominantChild)
        XCTAssertEqual(env.model.resolved.colorMode, .dominantChild)
    }

    func testSelectAndClearSelection() {
        let env = makeHarness(liveLoaded)
        env.model.start()
        XCTAssertNil(env.model.selectedPoint)
        env.model.select(point("b"))
        XCTAssertEqual(env.model.selectedPoint?.id, "b")
        env.model.clearSelection()
        XCTAssertNil(env.model.selectedPoint)
    }

    func testSelectionPrunedWhenPointRemoved() {
        let env = makeHarness(liveLoaded)
        env.model.start()
        env.model.select(point("b"))
        XCTAssertEqual(env.model.selectedPointID, "b")
        // A fresh feed without "b" drops the dangling selection.
        env.source.push(MarkerClusterInput(connection: .live, phase: .loaded, points: [point("a"), point("c")]))
        XCTAssertNil(env.model.selectedPointID)
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
final class MarkerClusterViewTests: XCTestCase {
    private func point(_ id: String) -> MarkerClusterPoint {
        MarkerClusterPoint(id: id, latitude: 37.7, longitude: -122.4)
    }

    private func model(
        _ input: MarkerClusterInput,
        content: MarkerClusterContent = MarkerClusterContent()
    ) -> MarkerClusterModel {
        let model = MarkerClusterModel(content: content, source: InMemoryMarkerClusterSource(initial: input))
        model.start()
        return model
    }

    func testSurfaceBuildsForEveryConnectivityState() {
        for connection in MarkerClusterConnection.allCases {
            let view = MarkerCluster(model: model(MarkerClusterInput(
                connection: connection,
                phase: .loaded,
                points: [point("a"), point("b")]
            )))
            XCTAssertEqual(MarkerCluster.surfaceSlug, "MarkerCluster")
            _ = view.body
        }
    }

    func testStatusRoutingForEveryLoadState() {
        XCTAssertEqual(
            model(MarkerClusterInput(connection: .live, phase: .loading, points: nil)).resolved.status,
            .loading
        )
        XCTAssertEqual(
            model(MarkerClusterInput(connection: .live, phase: .loaded, points: [])).resolved.status,
            .empty
        )
        XCTAssertEqual(
            model(MarkerClusterInput(connection: .live, phase: .failed, points: [point("a")])).resolved.status,
            .error
        )
        XCTAssertEqual(
            model(MarkerClusterInput(connection: .live, phase: .loaded, points: [point("a")])).resolved.status,
            .ready
        )
    }

    func testChromeViewsBuild() {
        let resolved = model(MarkerClusterInput(
            connection: .stale,
            phase: .loaded,
            points: [point("a"), point("b")]
        )).resolved
        _ = MarkerClusterLoadingOverlay().body
        _ = MarkerClusterEmptyOverlay().body
        _ = MarkerClusterErrorOverlay(onRetry: {}).body
        _ = MarkerClusterConnectivityBanner(connection: .offline).body
        _ = MarkerClusterConnectivityChip(connection: .stale, onRefresh: {}).body
        _ = MarkerClusterCountChip(resolved: resolved).body
        _ = MarkerClusterLegend(colorMode: .countDensity).body
        _ = MarkerClusterColorModeSwitcher(colorMode: .countDensity, onSelect: { _ in }).body
        _ = MarkerClusterCallout(point: point("a"), onDismiss: {}).body
        _ = MarkerClusterFullscreenButton(expanded: .constant(false)).body
    }

    func testTruncationNoteAppearsWhenCapped() {
        let many = (0 ..< 5050).map { point("\($0)") }
        let resolved = model(MarkerClusterInput(connection: .live, phase: .loaded, points: many)).resolved
        XCTAssertTrue(resolved.isTruncated)
        XCTAssertEqual(resolved.renderedCount, MarkerClusterMeta.maxRenderedMarkers)
    }
}

// MARK: - Accessibility + freshness copy

final class MarkerClusterAccessibilityTests: XCTestCase {
    func testFreshnessLabelsResolve() {
        XCTAssertEqual(MarkerClusterFreshness.label(for: .live), "Live")
        XCTAssertEqual(MarkerClusterFreshness.label(for: .stale), "Stale")
        XCTAssertEqual(MarkerClusterFreshness.label(for: .offline), "Offline")
    }

    func testFreshnessNotesAreNonEmptyAndDistinct() {
        let live = MarkerClusterFreshness.note(for: .live)
        let stale = MarkerClusterFreshness.note(for: .stale)
        let offline = MarkerClusterFreshness.note(for: .offline)
        XCTAssertFalse(live.isEmpty)
        XCTAssertFalse(stale.isEmpty)
        XCTAssertFalse(offline.isEmpty)
        XCTAssertNotEqual(stale, offline)
    }

    func testFreshnessTonesAreDistinct() {
        XCTAssertNotEqual(MarkerClusterFreshness.tone(for: .live), MarkerClusterFreshness.tone(for: .stale))
        XCTAssertNotEqual(MarkerClusterFreshness.tone(for: .stale), MarkerClusterFreshness.tone(for: .offline))
    }

    func testColorModeLabelsHaveFallbacks() {
        for mode in MarkerClusterColorMode.allCases {
            XCTAssertFalse(mode.labelFallback.isEmpty)
            XCTAssertTrue(mode.labelKey.hasPrefix("markerCluster.colorMode."))
            XCTAssertFalse(mode.systemImage.isEmpty)
        }
    }
}

// MARK: - Telemetry spy

private final class SpyMarkerClusterTelemetry: MarkerClusterTelemetry, @unchecked Sendable {
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
