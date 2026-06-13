//
//  AnimatedMarker.Tests.swift
//  TeslaSync — P4 shared surface · 0184 · AnimatedMarker (Apple)
//
//  State-holder + view coverage for the AnimatedMarker surface: the model's lifecycle (start
//  idempotence + the once-only `view.opened` telemetry that fires on appear), the position snapshot
//  apply (connection / phase / fix, with the offline snapshot retaining the last-known fix and a
//  settled null-island row clearing it to empty), the connectivity axis with the one-shot stale
//  auto-refresh (re-armed on return to live) and offline never auto-refreshing, the every-state view
//  composition (signature contract + status routing), and the freshness / overlay / info-chip
//  accessibility copy. Runs in the TeslaSync(/-macOS) XCTest targets.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Model (state-holder)

@MainActor
final class AnimatedMarkerModelTests: XCTestCase {
    private struct Harness {
        let model: AnimatedMarkerModel
        let source: InMemoryAnimatedMarkerSource
        let spy: SpyAnimatedMarkerTelemetry
    }

    private func makeHarness(_ input: AnimatedMarkerInput) -> Harness {
        let source = InMemoryAnimatedMarkerSource(initial: input)
        let spy = SpyAnimatedMarkerTelemetry()
        let model = AnimatedMarkerModel(content: AnimatedMarkerContent(), source: source, telemetry: spy)
        return Harness(model: model, source: source, spy: spy)
    }

    private var validRow: AnimatedMarkerFixRow {
        AnimatedMarkerFixRow(latitude: 37.7749, longitude: -122.4194, heading: 45)
    }

    private var liveLoaded: AnimatedMarkerInput {
        AnimatedMarkerInput(connection: .live, phase: .loaded, row: validRow)
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
        XCTAssertEqual(env.spy.surfaces, [AnimatedMarkerMeta.surfaceSlug])
        env.source.push(AnimatedMarkerInput(connection: .stale, phase: .loaded, row: validRow))
        XCTAssertEqual(env.spy.surfaces, [AnimatedMarkerMeta.surfaceSlug])
    }

    func testViewOpenedStaysOnceAcrossStopStart() {
        let env = makeHarness(liveLoaded)
        env.model.start()
        env.model.stop()
        env.model.start()
        XCTAssertEqual(env.source.startCount, 2)
        XCTAssertEqual(env.spy.surfaces, [AnimatedMarkerMeta.surfaceSlug])
    }

    func testApplyUpdatesConnectionPhaseAndFix() {
        let env = makeHarness(liveLoaded)
        env.model.start()
        XCTAssertEqual(env.model.connection, .live)
        XCTAssertEqual(env.model.phase, .loaded)
        XCTAssertEqual(env.model.resolved.status, .ready)
        XCTAssertEqual(env.model.fix?.coordinate.latitude, 37.7749)
        XCTAssertEqual(env.model.fix?.heading, 45)
    }

    func testOfflineSnapshotRetainsLastFix() {
        let env = makeHarness(liveLoaded)
        env.model.start()
        XCTAssertNotNil(env.model.fix)

        // Offline with no fresh row → keep the cached fix (web cache-then-network).
        env.source.push(AnimatedMarkerInput(connection: .offline, phase: .loaded, row: nil))
        XCTAssertEqual(env.model.connection, .offline)
        XCTAssertEqual(env.model.fix?.coordinate.latitude, 37.7749)
        XCTAssertEqual(env.model.resolved.status, .ready)
    }

    func testSettledNullIslandRowClearsToEmpty() {
        let env = makeHarness(liveLoaded)
        env.model.start()
        XCTAssertNotNil(env.model.fix)

        env.source.push(AnimatedMarkerInput(
            connection: .live,
            phase: .loaded,
            row: AnimatedMarkerFixRow(latitude: 0, longitude: 0)
        ))
        XCTAssertNil(env.model.fix)
        XCTAssertEqual(env.model.resolved.status, .empty)
    }

    func testStaleTriggersOneShotAutoRefresh() {
        let env = makeHarness(liveLoaded)
        env.model.start()
        XCTAssertEqual(env.source.refreshCount, 0)

        env.source.push(AnimatedMarkerInput(connection: .stale, phase: .loaded, row: validRow))
        XCTAssertEqual(env.source.refreshCount, 1)

        // Staying stale does not re-arm the auto-refresh.
        env.source.push(AnimatedMarkerInput(connection: .stale, phase: .loaded, row: validRow))
        XCTAssertEqual(env.source.refreshCount, 1)
    }

    func testStaleReArmsAfterReturningToLive() {
        let env = makeHarness(liveLoaded)
        env.model.start()
        env.source.push(AnimatedMarkerInput(connection: .stale, phase: .loaded, row: validRow))
        XCTAssertEqual(env.source.refreshCount, 1)
        env.source.push(liveLoaded)
        env.source.push(AnimatedMarkerInput(connection: .stale, phase: .loaded, row: validRow))
        XCTAssertEqual(env.source.refreshCount, 2)
    }

    func testOfflineDoesNotAutoRefresh() {
        let env = makeHarness(liveLoaded)
        env.model.start()
        env.source.push(AnimatedMarkerInput(connection: .offline, phase: .loaded, row: validRow))
        XCTAssertEqual(env.source.refreshCount, 0)
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
final class AnimatedMarkerViewTests: XCTestCase {
    private func model(_ input: AnimatedMarkerInput) -> AnimatedMarkerModel {
        let model = AnimatedMarkerModel(
            content: AnimatedMarkerContent(),
            source: InMemoryAnimatedMarkerSource(initial: input)
        )
        model.start()
        return model
    }

    private var validRow: AnimatedMarkerFixRow {
        AnimatedMarkerFixRow(latitude: 37.7749, longitude: -122.4194, heading: 45)
    }

    func testSurfaceBuildsForEveryConnectivityState() {
        for connection in AnimatedMarkerConnection.allCases {
            let view = AnimatedMarker(model: model(AnimatedMarkerInput(
                connection: connection,
                phase: .loaded,
                row: validRow
            )))
            XCTAssertEqual(AnimatedMarker.surfaceSlug, "AnimatedMarker")
            _ = view.body
        }
    }

    func testStatusRoutingForEveryLoadState() {
        XCTAssertEqual(
            model(AnimatedMarkerInput(connection: .live, phase: .loading, row: nil)).resolved.status,
            .loading
        )
        XCTAssertEqual(
            model(AnimatedMarkerInput(connection: .live, phase: .failed, row: validRow)).resolved.status,
            .error
        )
        XCTAssertEqual(
            model(AnimatedMarkerInput(
                connection: .live,
                phase: .loaded,
                row: AnimatedMarkerFixRow(latitude: 0, longitude: 0)
            )).resolved.status,
            .empty
        )
        XCTAssertEqual(
            model(AnimatedMarkerInput(connection: .live, phase: .loaded, row: validRow)).resolved.status,
            .ready
        )
    }

    func testOverlayAndGlyphViewsBuild() {
        let fix = AnimatedMarkerFix(
            coordinate: AnimatedMarkerCoordinate(latitude: 37.7749, longitude: -122.4194),
            heading: 45,
            color: AnimatedMarkerPalette.fallback
        )
        _ = AnimatedMarkerLoadingOverlay().body
        _ = AnimatedMarkerEmptyOverlay().body
        _ = AnimatedMarkerErrorOverlay(onRetry: {}).body
        _ = AnimatedMarkerConnectivityBanner(connection: .offline).body
        _ = AnimatedMarkerConnectivityChip(connection: .stale, onRefresh: {}).body
        _ = AnimatedMarkerInfoChip(fix: fix).body
        _ = AnimatedMarkerGlyph(color: fix.color.color, heading: 45).body
        _ = AnimatedMarkerGlyph(color: fix.color.color, heading: nil).body
    }
}

// MARK: - Accessibility + freshness copy

final class AnimatedMarkerAccessibilityTests: XCTestCase {
    func testFreshnessLabelsResolve() {
        XCTAssertEqual(AnimatedMarkerFreshness.label(for: .live), "Live")
        XCTAssertEqual(AnimatedMarkerFreshness.label(for: .stale), "Stale")
        XCTAssertEqual(AnimatedMarkerFreshness.label(for: .offline), "Offline")
    }

    func testFreshnessNotesAreNonEmptyAndDistinct() {
        let stale = AnimatedMarkerFreshness.note(for: .stale)
        let offline = AnimatedMarkerFreshness.note(for: .offline)
        XCTAssertFalse(stale.isEmpty)
        XCTAssertFalse(offline.isEmpty)
        XCTAssertNotEqual(stale, offline)
    }

    func testFreshnessTonesAreDistinct() {
        XCTAssertNotEqual(AnimatedMarkerFreshness.tone(for: .live), AnimatedMarkerFreshness.tone(for: .stale))
        XCTAssertNotEqual(AnimatedMarkerFreshness.tone(for: .stale), AnimatedMarkerFreshness.tone(for: .offline))
    }

    func testFormatCoordinatesAndHeading() {
        let coordinate = AnimatedMarkerCoordinate(latitude: 37.7749, longitude: -122.4194)
        XCTAssertEqual(AnimatedMarkerFormat.coordinates(coordinate), "37.7749, -122.4194")
        XCTAssertEqual(AnimatedMarkerFormat.heading(45), "45°")
        XCTAssertEqual(AnimatedMarkerFormat.heading(269.6), "270°")
    }

    func testAccessibilityValueDescribesEachState() {
        let fix = AnimatedMarkerFix(
            coordinate: AnimatedMarkerCoordinate(latitude: 37.7749, longitude: -122.4194),
            heading: 45,
            color: AnimatedMarkerPalette.fallback
        )
        let ready = AnimatedMarkerProjection.resolve(
            content: AnimatedMarkerContent(),
            fix: fix,
            phase: .loaded,
            connection: .live
        )
        let readyValue = AnimatedMarkerAccessibility.value(for: ready)
        XCTAssertTrue(readyValue.contains("37.7749"))
        XCTAssertTrue(readyValue.contains("45°"))

        let offline = AnimatedMarkerProjection.resolve(
            content: AnimatedMarkerContent(),
            fix: fix,
            phase: .loaded,
            connection: .offline
        )
        XCTAssertTrue(AnimatedMarkerAccessibility.value(for: offline)
            .contains(AnimatedMarkerFreshness.note(for: .offline)))

        let empty = AnimatedMarkerProjection.resolve(
            content: AnimatedMarkerContent(),
            fix: nil,
            phase: .loaded,
            connection: .live
        )
        XCTAssertEqual(AnimatedMarkerAccessibility.value(for: empty), "No location")
    }
}

// MARK: - Telemetry spy

private final class SpyAnimatedMarkerTelemetry: AnimatedMarkerTelemetry, @unchecked Sendable {
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
