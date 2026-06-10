//
//  AIChatbotIndicator.Tests.swift
//  TeslaSync — P4 shared surface · 0012 · AIChatbotIndicator (Apple)
//
//  Coverage for the AIChatbotIndicator surface:
//    • Gate — the verbatim port of `useAiEnabled('chatbot-llm')`: the fail-closed truth table
//      (enabled only when settings resolved + mode≠off + per-feature flag exactly true; unresolved /
//      failed / mode-off / mode-missing / flag-off all withdraw the surface) + the boolean parity.
//    • Meta — the gated feature id + the diagnostics slug.
//    • Projection — every render branch (gatedOff / loading / unavailable / presented) + the carried
//      connectivity axis.
//    • Accessibility — the freshness-aware badge label (no suffix when live).
//    • Model — start idempotence, the lazy once-only `view.opened` telemetry (never while gated),
//      the phase transitions, the connection axis with the one-shot stale auto-refresh (re-armed on
//      return to live), offline never auto-refreshing, and stop / refresh wiring.
//    • Mark geometry — the ported HelixMark path is non-empty + within its viewBox.
//    • Views — every state's subview composes (signature contract).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so
//  each assertion reads the pure adapter / model directly.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Gate (web `useAiEnabled('chatbot-llm')` truth table)

final class AIChatbotGateTests: XCTestCase {
    private func input(
        _ status: AIChatbotSettingsStatus,
        mode: AIChatbotMode? = nil,
        flag: Bool = false
    ) -> AIChatbotIndicatorInput {
        AIChatbotIndicatorInput(status: status, mode: mode, featureEnabled: flag)
    }

    func testEnabledWhenFullyOn() {
        XCTAssertEqual(AIChatbotGate.evaluate(input(.resolved, mode: .local, flag: true)), .enabled)
        XCTAssertEqual(AIChatbotGate.evaluate(input(.resolved, mode: .cloud, flag: true)), .enabled)
        XCTAssertTrue(AIChatbotGate.isEnabled(input(.resolved, mode: .local, flag: true)))
    }

    func testUnresolvedFailsClosed() {
        XCTAssertEqual(AIChatbotGate.evaluate(input(.loading, mode: .local, flag: true)), .unresolved)
        XCTAssertFalse(AIChatbotGate.isEnabled(input(.loading, mode: .local, flag: true)))
    }

    func testFailedFailsClosed() {
        XCTAssertEqual(AIChatbotGate.evaluate(input(.failed, mode: .local, flag: true)), .failed)
        XCTAssertFalse(AIChatbotGate.isEnabled(input(.failed, mode: .local, flag: true)))
    }

    func testModeOffFailsClosed() {
        XCTAssertEqual(AIChatbotGate.evaluate(input(.resolved, mode: .off, flag: true)), .disabled)
        XCTAssertFalse(AIChatbotGate.isEnabled(input(.resolved, mode: .off, flag: true)))
    }

    func testMissingModeFailsClosed() {
        XCTAssertEqual(AIChatbotGate.evaluate(input(.resolved, mode: nil, flag: true)), .disabled)
        XCTAssertFalse(AIChatbotGate.isEnabled(input(.resolved, mode: nil, flag: true)))
    }

    func testFlagOffFailsClosed() {
        XCTAssertEqual(AIChatbotGate.evaluate(input(.resolved, mode: .local, flag: false)), .disabled)
        XCTAssertFalse(AIChatbotGate.isEnabled(input(.resolved, mode: .local, flag: false)))
    }

    func testIsPresentedOnlyForEnabled() {
        XCTAssertTrue(AIChatbotGate.enabled.isPresented)
        XCTAssertFalse(AIChatbotGate.disabled.isPresented)
        XCTAssertFalse(AIChatbotGate.unresolved.isPresented)
        XCTAssertFalse(AIChatbotGate.failed.isPresented)
    }
}

// MARK: - Meta (web `withAiFeature` id + diagnostics slug)

final class AIChatbotIndicatorMetaTests: XCTestCase {
    func testFeatureIDMatchesWebSource() {
        XCTAssertEqual(AIChatbotIndicatorMeta.featureID, "chatbot-llm")
    }

    func testSurfaceSlug() {
        XCTAssertEqual(AIChatbotIndicatorMeta.surfaceSlug, "AIChatbotIndicator")
        XCTAssertEqual(AIChatbotIndicator.surfaceSlug, "AIChatbotIndicator")
    }
}

// MARK: - Projection (render branches + P4 leaf contract)

final class AIChatbotProjectionTests: XCTestCase {
    func testGatedOffWhenDisabled() {
        let resolved = AIChatbotProjection.resolve(
            AIChatbotIndicatorInput(status: .resolved, mode: .off, featureEnabled: true)
        )
        XCTAssertEqual(resolved.phase, .gatedOff)
    }

    func testLoadingWhenUnresolved() {
        let resolved = AIChatbotProjection.resolve(AIChatbotIndicatorInput(status: .loading))
        XCTAssertEqual(resolved.phase, .loading)
    }

    func testUnavailableWhenFailed() {
        let resolved = AIChatbotProjection.resolve(AIChatbotIndicatorInput(status: .failed))
        XCTAssertEqual(resolved.phase, .unavailable)
    }

    func testPresentedWhenEnabled() {
        let resolved = AIChatbotProjection.resolve(AIChatbotIndicatorInput(
            status: .resolved, mode: .local, featureEnabled: true, connection: .live
        ))
        XCTAssertEqual(resolved.phase, .presented)
        XCTAssertEqual(resolved.connection, .live)
    }

    func testPresentedCarriesStaleAndOffline() {
        let stale = AIChatbotProjection.resolve(AIChatbotIndicatorInput(
            status: .resolved, mode: .cloud, featureEnabled: true, connection: .stale
        ))
        XCTAssertEqual(stale.phase, .presented)
        XCTAssertEqual(stale.connection, .stale)

        let offline = AIChatbotProjection.resolve(AIChatbotIndicatorInput(
            status: .resolved, mode: .local, featureEnabled: true, connection: .offline
        ))
        XCTAssertEqual(offline.phase, .presented)
        XCTAssertEqual(offline.connection, .offline)
    }
}

// MARK: - Accessibility (freshness-aware badge label)

final class AIChatbotAccessibilityTests: XCTestCase {
    func testLiveLabelHasNoSuffix() {
        XCTAssertEqual(
            AIChatbotAccessibility.badgeLabel(brand: "Helix", connection: .live, freshnessNote: "Live"),
            "Helix"
        )
    }

    func testStaleLabelAppendsNote() {
        XCTAssertEqual(
            AIChatbotAccessibility.badgeLabel(
                brand: "Helix", connection: .stale, freshnessNote: "Stale — tap to refresh"
            ),
            "Helix, Stale — tap to refresh"
        )
    }

    func testOfflineLabelAppendsNote() {
        XCTAssertEqual(
            AIChatbotAccessibility.badgeLabel(
                brand: "Helix", connection: .offline, freshnessNote: "Offline — showing the last known state"
            ),
            "Helix, Offline — showing the last known state"
        )
    }
}

// MARK: - Model (state-holder)

@MainActor
final class AIChatbotIndicatorModelTests: XCTestCase {
    private struct Harness {
        let model: AIChatbotIndicatorModel
        let source: InMemoryAIChatbotIndicatorSource
        let spy: SpyAIChatbotTelemetry
    }

    private func makeHarness(_ input: AIChatbotIndicatorInput) -> Harness {
        let source = InMemoryAIChatbotIndicatorSource(initial: input)
        let spy = SpyAIChatbotTelemetry()
        let model = AIChatbotIndicatorModel(source: source, telemetry: spy)
        return Harness(model: model, source: source, spy: spy)
    }

    private func enabled(_ connection: AIChatbotConnection = .live) -> AIChatbotIndicatorInput {
        AIChatbotIndicatorInput(status: .resolved, mode: .local, featureEnabled: true, connection: connection)
    }

    func testStartIsIdempotent() {
        let env = makeHarness(enabled())
        env.model.start()
        env.model.start()
        XCTAssertEqual(env.source.startCount, 1)
    }

    func testGatedOffEmitsNoTelemetry() {
        let env = makeHarness(AIChatbotIndicatorInput(status: .resolved, mode: .off, featureEnabled: true))
        env.model.start()
        XCTAssertEqual(env.model.phase, .gatedOff)
        XCTAssertTrue(env.spy.surfaces.isEmpty)
    }

    func testLoadingPhaseEmitsNoTelemetry() {
        let env = makeHarness(AIChatbotIndicatorInput(status: .loading))
        env.model.start()
        XCTAssertEqual(env.model.phase, .loading)
        XCTAssertTrue(env.spy.surfaces.isEmpty)
    }

    func testFailedProjectsUnavailable() {
        let env = makeHarness(AIChatbotIndicatorInput(status: .failed))
        env.model.start()
        XCTAssertEqual(env.model.phase, .unavailable)
        XCTAssertTrue(env.spy.surfaces.isEmpty)
    }

    func testPresentedEmitsTelemetryOnce() {
        let env = makeHarness(enabled())
        env.model.start()
        XCTAssertEqual(env.model.phase, .presented)
        XCTAssertEqual(env.spy.surfaces, [AIChatbotIndicatorMeta.surfaceSlug])
        // A second identical snapshot must not re-emit `view.opened`.
        env.source.push(enabled())
        XCTAssertEqual(env.spy.surfaces, [AIChatbotIndicatorMeta.surfaceSlug])
    }

    func testTelemetryEmittedOnFirstPresentAfterLoading() {
        let env = makeHarness(AIChatbotIndicatorInput(status: .loading))
        env.model.start()
        XCTAssertTrue(env.spy.surfaces.isEmpty)
        env.source.push(enabled())
        XCTAssertEqual(env.model.phase, .presented)
        XCTAssertEqual(env.spy.surfaces, [AIChatbotIndicatorMeta.surfaceSlug])
    }

    func testConnectionAxisIsExposed() {
        let env = makeHarness(enabled(.live))
        env.model.start()
        XCTAssertEqual(env.model.connection, .live)
        env.source.push(enabled(.offline))
        XCTAssertEqual(env.model.connection, .offline)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let env = makeHarness(enabled(.live))
        env.model.start()
        XCTAssertEqual(env.source.refreshCount, 0)

        env.source.push(enabled(.stale))
        XCTAssertEqual(env.model.connection, .stale)
        XCTAssertEqual(env.source.refreshCount, 1)

        env.source.push(enabled(.stale))
        XCTAssertEqual(env.source.refreshCount, 1)
    }

    func testStaleAutoRefreshReArmsAfterReturningToLive() {
        let env = makeHarness(enabled(.live))
        env.model.start()
        env.source.push(enabled(.stale))
        XCTAssertEqual(env.source.refreshCount, 1)
        env.source.push(enabled(.live))
        XCTAssertEqual(env.model.connection, .live)
        env.source.push(enabled(.stale))
        XCTAssertEqual(env.source.refreshCount, 2)
    }

    func testOfflineNeverAutoRefreshes() {
        let env = makeHarness(enabled(.live))
        env.model.start()
        env.source.push(enabled(.offline))
        XCTAssertEqual(env.model.connection, .offline)
        XCTAssertEqual(env.source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let env = makeHarness(enabled())
        env.model.start()
        env.model.refresh()
        XCTAssertEqual(env.source.refreshCount, 1)
    }

    func testStopThenStartReArms() {
        let env = makeHarness(enabled())
        env.model.start()
        env.model.stop()
        XCTAssertEqual(env.source.stopCount, 1)
        env.model.start()
        XCTAssertEqual(env.source.startCount, 2)
    }
}

// MARK: - Live source (production binding)

@MainActor
final class LiveAIChatbotIndicatorSourceTests: XCTestCase {
    func testStartAndRefreshEmitTheBoundSnapshot() {
        let input = AIChatbotIndicatorInput(status: .resolved, mode: .cloud, featureEnabled: true)
        let source = LiveAIChatbotIndicatorSource(input: input)
        var emissions: [AIChatbotIndicatorInput] = []
        source.onUpdate = { emissions.append($0) }
        source.start()
        source.refresh()
        XCTAssertEqual(emissions, [input, input])
    }
}

// MARK: - Mark geometry (ported HelixMark path)

final class AIChatbotHelixMarkShapeTests: XCTestCase {
    func testPathIsNonEmptyAndWithinViewBox() {
        let rect = CGRect(x: 0, y: 0, width: 24, height: 24)
        let path = AIChatbotHelixMarkShape().path(in: rect)
        XCTAssertFalse(path.isEmpty)
        let bounds = path.boundingRect
        XCTAssertGreaterThanOrEqual(bounds.minX, rect.minX - 0.001)
        XCTAssertGreaterThanOrEqual(bounds.minY, rect.minY - 0.001)
        XCTAssertLessThanOrEqual(bounds.maxX, rect.maxX + 0.001)
        XCTAssertLessThanOrEqual(bounds.maxY, rect.maxY + 0.001)
    }

    func testPathScalesWithFrame() {
        let small = AIChatbotHelixMarkShape().path(in: CGRect(x: 0, y: 0, width: 12, height: 12))
        XCTAssertLessThanOrEqual(small.boundingRect.maxX, 12.001)
        XCTAssertLessThanOrEqual(small.boundingRect.maxY, 12.001)
    }
}

// MARK: - Views (every state composes — signature contract)

@MainActor
final class AIChatbotIndicatorViewTests: XCTestCase {
    func testEveryStateSubviewComposes() {
        _ = AIChatbotHelixMark(size: 14)
        _ = AIChatbotBadge(connection: .live)
        _ = AIChatbotBadge(connection: .stale)
        _ = AIChatbotFreshnessDot(connection: .offline, onRefresh: {})
        _ = AIChatbotPresentedView(connection: .stale, onRefresh: {})
        _ = AIChatbotLoadingChip()
        _ = AIChatbotUnavailableChip(onRetry: {})
    }

    func testSurfaceComposesForEveryInput() {
        let inputs: [AIChatbotIndicatorInput] = [
            AIChatbotIndicatorInput(status: .resolved, mode: .off, featureEnabled: true),
            AIChatbotIndicatorInput(status: .loading),
            AIChatbotIndicatorInput(status: .failed),
            AIChatbotIndicatorInput(status: .resolved, mode: .local, featureEnabled: true, connection: .live),
            AIChatbotIndicatorInput(status: .resolved, mode: .cloud, featureEnabled: true, connection: .stale),
            AIChatbotIndicatorInput(status: .resolved, mode: .local, featureEnabled: true, connection: .offline)
        ]
        for input in inputs {
            _ = AIChatbotIndicator(input: input)
        }
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyAIChatbotTelemetry: AIChatbotTelemetry, @unchecked Sendable {
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
