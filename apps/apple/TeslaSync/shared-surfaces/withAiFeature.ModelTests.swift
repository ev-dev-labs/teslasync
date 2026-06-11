//
//  withAiFeature.ModelTests.swift
//  TeslaSync — P4 shared surface · 0062 · withAiFeature (Apple)
//
//  The state-holder + view-composition half of the withAiFeature coverage (split from
//  withAiFeature.Tests.swift to keep each file within the SwiftLint file-length budget):
//    • Model — start idempotence, the lazy once-only `view.opened` telemetry (never while withdrawn),
//      the present-after-loading transition, the gate verdict + marker identifier exposure, the
//      connection axis with the one-shot stale auto-refresh (re-armed on return to live), offline
//      never auto-refreshing, and stop / refresh wiring.
//    • Live source — start + refresh emit the bound snapshot.
//    • Views — the marker modifier, the sample inner, the generic HOC, and the `.withAiFeature(_:)`
//      modifier all compose for presented + withdrawn inputs.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Model (state-holder)

@MainActor
final class WithAiFeatureGateModelTests: XCTestCase {
    private struct Harness {
        let model: WithAiFeatureGateModel
        let source: InMemoryWithAiFeatureGateSource
        let spy: SpyWithAiFeatureTelemetry
    }

    private func makeHarness(_ input: AiFeatureGateInput, testID: String? = nil) -> Harness {
        let source = InMemoryWithAiFeatureGateSource(initial: input)
        let spy = SpyWithAiFeatureTelemetry()
        let model = WithAiFeatureGateModel(
            feature: input.featureID,
            source: source,
            telemetry: spy,
            testID: testID
        )
        return Harness(model: model, source: source, spy: spy)
    }

    private func enabled(_ connection: AiFeatureGateConnection = .live) -> AiFeatureGateInput {
        AiFeatureGateInput(
            featureID: "chatbot-llm",
            status: .resolved,
            mode: .local,
            featureEnabled: true,
            connection: connection
        )
    }

    func testStartIsIdempotent() {
        let env = makeHarness(enabled())
        env.model.start()
        env.model.start()
        XCTAssertEqual(env.source.startCount, 1)
    }

    func testWithdrawnEmitsNoTelemetry() {
        let withdrawnInputs: [AiFeatureGateInput] = [
            AiFeatureGateInput(featureID: "chatbot-llm", status: .resolved, mode: .off, featureEnabled: true),
            AiFeatureGateInput(featureID: "chatbot-llm", status: .loading),
            AiFeatureGateInput(featureID: "chatbot-llm", status: .failed),
            AiFeatureGateInput(featureID: "chatbot-llm", status: .resolved, mode: .local, featureEnabled: false),
            AiFeatureGateInput(featureID: "not-a-real-feature", status: .resolved, mode: .local, featureEnabled: true)
        ]
        for input in withdrawnInputs {
            let env = makeHarness(input)
            env.model.start()
            XCTAssertFalse(env.model.isPresented)
            XCTAssertTrue(env.spy.surfaces.isEmpty, "withdrawn surface must not emit view.opened")
        }
    }

    func testPresentedEmitsTelemetryOnce() {
        let env = makeHarness(enabled())
        env.model.start()
        XCTAssertTrue(env.model.isPresented)
        XCTAssertEqual(env.spy.surfaces, [AiFeatureGateSurface.slug])
        // A second identical snapshot must not re-emit `view.opened`.
        env.source.push(enabled())
        XCTAssertEqual(env.spy.surfaces, [AiFeatureGateSurface.slug])
    }

    func testTelemetryEmittedOnFirstPresentAfterLoading() {
        let env = makeHarness(AiFeatureGateInput(featureID: "chatbot-llm", status: .loading))
        env.model.start()
        XCTAssertTrue(env.spy.surfaces.isEmpty)
        env.source.push(enabled())
        XCTAssertTrue(env.model.isPresented)
        XCTAssertEqual(env.spy.surfaces, [AiFeatureGateSurface.slug])
    }

    func testGateVerdictIsExposed() {
        let env = makeHarness(enabled())
        env.model.start()
        XCTAssertEqual(env.model.gate, .enabled)
    }

    func testMarkerIdentifierExposed() {
        let env = makeHarness(enabled())
        env.model.start()
        XCTAssertEqual(env.model.markerIdentifier, "ai-feature-chatbot-llm")
    }

    func testMarkerIdentifierHonoursTestID() {
        let env = makeHarness(enabled(), testID: "ai-feature-chatbot-llm-root")
        env.model.start()
        XCTAssertEqual(env.model.markerIdentifier, "ai-feature-chatbot-llm-root")
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
final class LiveWithAiFeatureGateSourceTests: XCTestCase {
    func testStartAndRefreshEmitTheBoundSnapshot() {
        let input = AiFeatureGateInput(
            featureID: "chatbot-llm",
            status: .resolved,
            mode: .cloud,
            featureEnabled: true
        )
        let source = LiveWithAiFeatureGateSource(input: input)
        var emissions: [AiFeatureGateInput] = []
        source.onUpdate = { emissions.append($0) }
        source.start()
        source.refresh()
        XCTAssertEqual(emissions, [input, input])
    }
}

// MARK: - Views (every branch composes — signature contract)

@MainActor
final class WithAiFeatureViewTests: XCTestCase {
    func testMarkerAndSampleCompose() {
        _ = WithAiFeatureMarker(identifier: "ai-feature-chatbot-llm")
        _ = WithAiFeatureSampleInner()
    }

    func testHOCComposesForPresentedAndWithdrawn() {
        let inputs: [AiFeatureGateInput] = [
            AiFeatureGateInput(
                featureID: "chatbot-llm",
                status: .resolved,
                mode: .local,
                featureEnabled: true,
                connection: .live
            ),
            AiFeatureGateInput(
                featureID: "chatbot-llm",
                status: .resolved,
                mode: .cloud,
                featureEnabled: true,
                connection: .stale
            ),
            AiFeatureGateInput(featureID: "chatbot-llm", status: .resolved, mode: .off, featureEnabled: true),
            AiFeatureGateInput(featureID: "chatbot-llm", status: .loading),
            AiFeatureGateInput(featureID: "chatbot-llm", status: .failed)
        ]
        for input in inputs {
            _ = WithAiFeature(input.featureID, gate: input) {
                WithAiFeatureSampleInner()
            }
        }
    }

    func testViewModifierSpellingComposes() {
        let input = AiFeatureGateInput(
            featureID: "chatbot-llm",
            status: .resolved,
            mode: .local,
            featureEnabled: true
        )
        _ = WithAiFeatureSampleInner().withAiFeature("chatbot-llm", gate: input)
        _ = WithAiFeatureSampleInner()
            .withAiFeature("chatbot-llm", gate: input, testID: "ai-feature-chatbot-llm-root")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyWithAiFeatureTelemetry: WithAiFeatureTelemetry, @unchecked Sendable {
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
