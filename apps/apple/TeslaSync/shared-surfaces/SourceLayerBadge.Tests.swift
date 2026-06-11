//
//  SourceLayerBadge.Tests.swift
//  TeslaSync — P4 shared surface · 0105 · SourceLayerBadge (Apple)
//
//  Coverage for the SourceLayerBadge surface above the pure adapter (see AdapterTests):
//    • Projection — every render phase (loading / unavailable / ready) including the unknown/empty
//      readout, the age-bearing tooltip, and the carried offline decoration, plus the `readyLayer`
//      convenience.
//    • Model — start idempotence; the lazy once-only `view.opened` telemetry (never while loading /
//      unavailable); the stale-layer one-shot auto-refresh (armed on the transition, re-armed after
//      leaving stale, suppressed while offline, never armed by a non-stale layer); manual refresh +
//      stop/start wiring; and the exposed offline + config.
//    • Live source — start/refresh emit the bound snapshot.
//    • Views — every state's subview composes (signature contract) + the surface composes for every
//      input.
//    • Accessibility — the offline-aware readout label.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so
//  each assertion reads the pure projection / model directly.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Shared fixtures

private let resolveFallback: SourceLayerBadgeResolve = { _, fallback in fallback }

private enum SourceFixture {
    static let l1 = SourceLayerBadgeInput(status: .resolved, source: "l1", ageMs: 350)
    static let l2 = SourceLayerBadgeInput(status: .resolved, source: "l2", ageMs: 4200)
    static let log = SourceLayerBadgeInput(status: .resolved, source: "log", ageMs: 7_200_000)
    static let stale = SourceLayerBadgeInput(status: .resolved, source: "stale", ageMs: 185_000)
    static let unknown = SourceLayerBadgeInput(status: .resolved, source: nil)
    static let offlineL1 = SourceLayerBadgeInput(status: .resolved, source: "l1", ageMs: 950, offline: true)
    static let offlineStale = SourceLayerBadgeInput(status: .resolved, source: "stale", ageMs: 200_000, offline: true)
}

// MARK: - Projection (render phases + leaf contract)

final class SourceLayerBadgeProjectionTests: XCTestCase {
    private func resolve(_ input: SourceLayerBadgeInput) -> SourceLayerBadgeResolved {
        SourceLayerBadgeProjection.resolve(input, config: .default, strings: resolveFallback)
    }

    func testLoadingPhase() {
        XCTAssertEqual(resolve(SourceLayerBadgeInput(status: .loading)).phase, .loading)
    }

    func testFailedPhaseIsUnavailable() {
        XCTAssertEqual(resolve(SourceLayerBadgeInput(status: .failed)).phase, .unavailable)
    }

    func testResolvedNilSourceIsUnknownEmptyReadout() {
        let resolved = resolve(SourceFixture.unknown)
        XCTAssertEqual(resolved.readyLayer, .unknown)
        if case let .ready(readout) = resolved.phase {
            XCTAssertEqual(readout.label, "—")
            XCTAssertEqual(readout.description, "Source layer unknown.")
            XCTAssertNil(readout.ageText)
            XCTAssertEqual(readout.tooltip, "Source layer unknown.")
        } else {
            XCTFail("expected ready phase")
        }
    }

    func testResolvedL1ComposesAgeTooltip() {
        let resolved = resolve(SourceFixture.l1)
        XCTAssertEqual(resolved.readyLayer, .l1)
        if case let .ready(readout) = resolved.phase {
            XCTAssertEqual(readout.ageText, "350 ms")
            XCTAssertEqual(
                readout.tooltip,
                "Read from the in-process SignalStore (hot path, freshest). (age: 350 ms)"
            )
        } else {
            XCTFail("expected ready phase")
        }
    }

    func testResolvedStaleLayer() {
        XCTAssertEqual(resolve(SourceFixture.stale).readyLayer, .stale)
    }

    func testOfflineDecorationCarried() {
        XCTAssertTrue(resolve(SourceFixture.offlineL1).offline)
        XCTAssertFalse(resolve(SourceFixture.l1).offline)
    }

    func testReadyLayerNilForChrome() {
        XCTAssertNil(resolve(SourceLayerBadgeInput(status: .loading)).readyLayer)
        XCTAssertNil(resolve(SourceLayerBadgeInput(status: .failed)).readyLayer)
    }
}

// MARK: - Model (state-holder)

@MainActor
final class SourceLayerBadgeModelTests: XCTestCase {
    private struct Harness {
        let model: SourceLayerBadgeModel
        let source: InMemorySourceLayerBadgeSource
        let spy: SpySourceLayerBadgeTelemetry
    }

    private func makeHarness(_ input: SourceLayerBadgeInput) -> Harness {
        let source = InMemorySourceLayerBadgeSource(initial: input)
        let spy = SpySourceLayerBadgeTelemetry()
        let model = SourceLayerBadgeModel(source: source, telemetry: spy, strings: resolveFallback)
        return Harness(model: model, source: source, spy: spy)
    }

    func testStartIsIdempotent() {
        let env = makeHarness(SourceFixture.l1)
        env.model.start()
        env.model.start()
        XCTAssertEqual(env.source.startCount, 1)
    }

    func testLoadingEmitsNoTelemetry() {
        let env = makeHarness(SourceLayerBadgeInput(status: .loading))
        env.model.start()
        XCTAssertEqual(env.model.phase, .loading)
        XCTAssertTrue(env.spy.surfaces.isEmpty)
    }

    func testFailedProjectsUnavailableWithoutTelemetry() {
        let env = makeHarness(SourceLayerBadgeInput(status: .failed))
        env.model.start()
        XCTAssertEqual(env.model.phase, .unavailable)
        XCTAssertTrue(env.spy.surfaces.isEmpty)
    }

    func testReadyEmitsTelemetryOnce() {
        let env = makeHarness(SourceFixture.l1)
        env.model.start()
        XCTAssertEqual(env.model.resolved.readyLayer, .l1)
        XCTAssertEqual(env.spy.surfaces, [SourceLayerBadgeMeta.surfaceSlug])
        env.source.push(SourceFixture.l2)
        XCTAssertEqual(env.spy.surfaces, [SourceLayerBadgeMeta.surfaceSlug])
    }

    func testTelemetryEmittedOnFirstReadyAfterLoading() {
        let env = makeHarness(SourceLayerBadgeInput(status: .loading))
        env.model.start()
        XCTAssertTrue(env.spy.surfaces.isEmpty)
        env.source.push(SourceFixture.l1)
        XCTAssertEqual(env.spy.surfaces, [SourceLayerBadgeMeta.surfaceSlug])
    }

    func testStaleLayerArmsOneRefresh() {
        let env = makeHarness(SourceFixture.l1)
        env.model.start()
        XCTAssertEqual(env.source.refreshCount, 0)

        env.source.push(SourceFixture.stale)
        XCTAssertEqual(env.model.resolved.readyLayer, .stale)
        XCTAssertEqual(env.source.refreshCount, 1)

        env.source.push(SourceFixture.stale)
        XCTAssertEqual(env.source.refreshCount, 1)
    }

    func testStaleAutoRefreshReArmsAfterLeavingStale() {
        let env = makeHarness(SourceFixture.l1)
        env.model.start()
        env.source.push(SourceFixture.stale)
        XCTAssertEqual(env.source.refreshCount, 1)
        env.source.push(SourceFixture.l1)
        XCTAssertEqual(env.model.resolved.readyLayer, .l1)
        env.source.push(SourceFixture.stale)
        XCTAssertEqual(env.source.refreshCount, 2)
    }

    func testOfflineStaleDoesNotAutoRefresh() {
        let env = makeHarness(SourceFixture.l1)
        env.model.start()
        env.source.push(SourceFixture.offlineStale)
        XCTAssertEqual(env.model.resolved.readyLayer, .stale)
        XCTAssertTrue(env.model.offline)
        XCTAssertEqual(env.source.refreshCount, 0)
    }

    func testNonStaleLayerDoesNotAutoRefresh() {
        let env = makeHarness(SourceFixture.l1)
        env.model.start()
        env.source.push(SourceFixture.log)
        XCTAssertEqual(env.model.resolved.readyLayer, .log)
        XCTAssertEqual(env.source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let env = makeHarness(SourceFixture.l1)
        env.model.start()
        env.model.refresh()
        XCTAssertEqual(env.source.refreshCount, 1)
    }

    func testStopThenStartReArms() {
        let env = makeHarness(SourceFixture.l1)
        env.model.start()
        env.model.stop()
        XCTAssertEqual(env.source.stopCount, 1)
        env.model.start()
        XCTAssertEqual(env.source.startCount, 2)
    }

    func testConfigAndOfflineExposed() {
        let source = InMemorySourceLayerBadgeSource(initial: SourceFixture.offlineL1)
        let model = SourceLayerBadgeModel(
            source: source,
            config: SourceLayerBadgeConfig(showLabel: true),
            telemetry: SpySourceLayerBadgeTelemetry(),
            strings: resolveFallback
        )
        model.start()
        XCTAssertTrue(model.config.showLabel)
        XCTAssertTrue(model.offline)
    }
}

// MARK: - Live source (production binding)

@MainActor
final class LiveSourceLayerBadgeSourceTests: XCTestCase {
    func testStartAndRefreshEmitTheBoundSnapshot() {
        let source = LiveSourceLayerBadgeSource(input: SourceFixture.l2)
        var emissions: [SourceLayerBadgeInput] = []
        source.onUpdate = { emissions.append($0) }
        source.start()
        source.refresh()
        XCTAssertEqual(emissions, [SourceFixture.l2, SourceFixture.l2])
    }
}

// MARK: - Views (every state composes — signature contract)

@MainActor
final class SourceLayerBadgeViewTests: XCTestCase {
    private func readout(_ input: SourceLayerBadgeInput) -> SourceLayerBadgeReadout {
        guard case let .ready(readout) = SourceLayerBadgeProjection.resolve(
            input,
            config: .default,
            strings: resolveFallback
        ).phase else {
            fatalError("expected ready readout for fixture")
        }
        return readout
    }

    func testEveryStateSubviewComposes() {
        _ = SourceLayerBadgeChip(readout: readout(SourceFixture.l1), showLabel: false, offline: false)
        _ = SourceLayerBadgeChip(readout: readout(SourceFixture.offlineL1), showLabel: true, offline: true)
        _ = SourceLayerBadgeOfflineMarker()
        _ = SourceLayerBadgeReadyView(readout: readout(SourceFixture.stale), showLabel: true, offline: false)
        _ = SourceLayerBadgeLoadingChip(showLabel: false)
        _ = SourceLayerBadgeUnavailableChip(onRetry: {})
    }

    func testChipStyleCoversEveryLayer() {
        for layer in SourceLayerBadgeKind.allCases {
            _ = layer.chipStyle
        }
    }

    func testSurfaceComposesForEveryInput() {
        let inputs: [SourceLayerBadgeInput] = [
            SourceLayerBadgeInput(status: .loading),
            SourceLayerBadgeInput(status: .failed),
            SourceFixture.l1,
            SourceFixture.l2,
            SourceFixture.log,
            SourceFixture.stale,
            SourceFixture.unknown,
            SourceFixture.offlineL1
        ]
        for input in inputs {
            _ = SourceLayerBadge(input: input)
        }
        _ = SourceLayerBadge(input: SourceFixture.l2, config: SourceLayerBadgeConfig(showLabel: true))
    }
}

// MARK: - Accessibility (offline-aware readout label)

final class SourceLayerBadgeReadoutAccessibilityTests: XCTestCase {
    func testOfflineReadoutLabelAppendsNote() {
        let resolved = SourceLayerBadgeProjection.resolve(
            SourceFixture.offlineL1,
            config: .default,
            strings: resolveFallback
        )
        guard case let .ready(readout) = resolved.phase else {
            return XCTFail("expected ready readout")
        }
        let label = SourceLayerBadgeAccessibility.label(
            tooltip: readout.tooltip,
            offlineNote: "Offline — showing the last known value"
        )
        XCTAssertTrue(label.contains(readout.tooltip))
        XCTAssertTrue(label.hasSuffix("Offline — showing the last known value"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpySourceLayerBadgeTelemetry: SourceLayerBadgeTelemetry, @unchecked Sendable {
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
