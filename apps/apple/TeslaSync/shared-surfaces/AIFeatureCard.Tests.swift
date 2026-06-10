//
//  AIFeatureCard.Tests.swift
//  TeslaSync — P4 shared surface · 0018 · AIFeatureCard (Apple)
//
//  State-holder + view coverage for the AIFeatureCard scaffold: the model's lifecycle (start
//  idempotence + the once-only `view.opened` telemetry that fires because the scaffold always
//  presents), the action forwarding (fires the source when enabled, no-ops while disabled), the
//  connectivity axis with the one-shot stale auto-refresh (re-armed on return to live) and offline
//  never auto-refreshing, the live source binding, the ported HelixMark geometry, and the
//  every-state view composition (signature contract). Runs in the TeslaSync(/-macOS) XCTest targets.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Model (state-holder)

@MainActor
final class AIFeatureCardModelTests: XCTestCase {
    private struct Harness {
        let model: AIFeatureCardModel
        let source: InMemoryAIFeatureCardSource
        let spy: SpyAIFeatureCardTelemetry
    }

    private func makeHarness(_ input: AIFeatureCardInput) -> Harness {
        let source = InMemoryAIFeatureCardSource(initial: input)
        let spy = SpyAIFeatureCardTelemetry()
        let model = AIFeatureCardModel(source: source, telemetry: spy)
        return Harness(model: model, source: source, spy: spy)
    }

    private func enabled(_ connection: AIFeatureCardConnection = .live) -> AIFeatureCardInput {
        AIFeatureCardInput(phase: .idle, canStart: true, connection: connection)
    }

    func testStartIsIdempotent() {
        let env = makeHarness(enabled())
        env.model.start()
        env.model.start()
        XCTAssertEqual(env.source.startCount, 1)
    }

    func testStartEmitsViewOpenedOnce() {
        let env = makeHarness(enabled())
        env.model.start()
        XCTAssertEqual(env.spy.surfaces, [AIFeatureCardMeta.surfaceSlug])
        // A further snapshot must not re-emit.
        env.source.push(enabled(.stale))
        XCTAssertEqual(env.spy.surfaces, [AIFeatureCardMeta.surfaceSlug])
    }

    func testViewOpenedStaysOnceAcrossStopStart() {
        let env = makeHarness(enabled())
        env.model.start()
        env.model.stop()
        env.model.start()
        XCTAssertEqual(env.source.startCount, 2)
        XCTAssertEqual(env.spy.surfaces, [AIFeatureCardMeta.surfaceSlug])
    }

    func testExposesPhaseConnectionAndOutput() {
        let env = makeHarness(enabled())
        env.model.start()
        XCTAssertEqual(env.model.phase, .idle)
        XCTAssertEqual(env.model.connection, .live)
        XCTAssertEqual(env.model.output, .hidden)

        env.source.push(AIFeatureCardInput(phase: .streaming, text: "", canStart: true))
        XCTAssertTrue(env.model.isStreaming)
        XCTAssertEqual(env.model.output, .thinking)

        env.source.push(AIFeatureCardInput(phase: .done, text: "Done", canStart: true))
        XCTAssertEqual(env.model.output, .text("Done"))
    }

    func testActionForwardsToSourceWhenEnabled() {
        let env = makeHarness(enabled())
        env.model.start()
        env.model.action()
        XCTAssertEqual(env.source.actCount, 1)
    }

    func testActionNoOpsWhileStreaming() {
        let env = makeHarness(AIFeatureCardInput(phase: .streaming, canStart: true))
        env.model.start()
        env.model.action()
        XCTAssertEqual(env.source.actCount, 0)
    }

    func testActionNoOpsWhenCannotStart() {
        let env = makeHarness(AIFeatureCardInput(phase: .idle, canStart: false))
        env.model.start()
        env.model.action()
        XCTAssertEqual(env.source.actCount, 0)
    }

    func testActionNoOpsWhileOffline() {
        let env = makeHarness(enabled(.offline))
        env.model.start()
        env.model.action()
        XCTAssertEqual(env.source.actCount, 0)
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
}

// MARK: - Live source (production binding)

@MainActor
final class LiveAIFeatureCardSourceTests: XCTestCase {
    func testStartAndRefreshEmitTheBoundSnapshot() {
        let input = AIFeatureCardInput(phase: .done, text: "ok", canStart: true)
        let source = LiveAIFeatureCardSource(input: input, onAct: {})
        var emissions: [AIFeatureCardInput] = []
        source.onUpdate = { emissions.append($0) }
        source.start()
        source.refresh()
        XCTAssertEqual(emissions, [input, input])
    }

    func testActInvokesTheHandler() {
        var acted = 0
        let source = LiveAIFeatureCardSource(input: AIFeatureCardInput(), onAct: { acted += 1 })
        source.act()
        source.act()
        XCTAssertEqual(acted, 2)
    }
}

// MARK: - Mark geometry (ported HelixMark path)

final class AIFeatureCardHelixMarkShapeTests: XCTestCase {
    func testPathIsNonEmptyAndWithinViewBox() {
        let rect = CGRect(x: 0, y: 0, width: 24, height: 24)
        let path = AIFeatureCardHelixMarkShape().path(in: rect)
        XCTAssertFalse(path.isEmpty)
        let bounds = path.boundingRect
        XCTAssertGreaterThanOrEqual(bounds.minX, rect.minX - 0.001)
        XCTAssertGreaterThanOrEqual(bounds.minY, rect.minY - 0.001)
        XCTAssertLessThanOrEqual(bounds.maxX, rect.maxX + 0.001)
        XCTAssertLessThanOrEqual(bounds.maxY, rect.maxY + 0.001)
    }

    func testPathScalesWithFrame() {
        let small = AIFeatureCardHelixMarkShape().path(in: CGRect(x: 0, y: 0, width: 12, height: 12))
        XCTAssertLessThanOrEqual(small.boundingRect.maxX, 12.001)
        XCTAssertLessThanOrEqual(small.boundingRect.maxY, 12.001)
    }
}

// MARK: - Views (every state composes — signature contract)

@MainActor
final class AIFeatureCardViewTests: XCTestCase {
    private var content: AIFeatureCardContent {
        AIFeatureCardContent(
            title: "Summarize",
            description: "Writes a summary.",
            buttonLabel: "Summarize",
            emptyHint: "Pick a window."
        )
    }

    func testEverySubviewComposes() {
        _ = AIFeatureCardHelixMark(size: 14)
        _ = AIFeatureCardBadge(label: nil, connection: .live)
        _ = AIFeatureCardBadge(label: "Helix", connection: .stale)
        _ = AIFeatureCardHeader(content: content, canStart: false, connection: .live)
        _ = AIFeatureCardActionButton(content: content, isStreaming: true, disabled: true) {}
        _ = AIFeatureCardConnectivityChip(connection: .stale) {}
        _ = AIFeatureCardConnectivityBanner(connection: .offline)
        _ = AIFeatureCardErrorRow(message: "")
        _ = AIFeatureCardThinkingIndicator()
    }

    func testOutputPanelComposesForEveryState() {
        let states: [AIFeatureOutputState] = [.hidden, .thinking, .text("hi"), .error("boom")]
        for state in states {
            _ = AIFeatureCardOutputPanel(output: state)
        }
    }

    func testSurfaceComposesForEveryInput() {
        let inputs: [AIFeatureCardInput] = [
            AIFeatureCardInput(phase: .idle, canStart: true),
            AIFeatureCardInput(phase: .idle, canStart: false),
            AIFeatureCardInput(phase: .streaming, text: ""),
            AIFeatureCardInput(phase: .done, text: "Summary"),
            AIFeatureCardInput(phase: .error("boom")),
            AIFeatureCardInput(phase: .done, text: "Summary", connection: .stale),
            AIFeatureCardInput(phase: .idle, canStart: true, connection: .offline)
        ]
        for input in inputs {
            let model = AIFeatureCardModel(source: InMemoryAIFeatureCardSource(initial: input))
            _ = AIFeatureCard(model: model, content: content)
            _ = AIFeatureCard(model: model, content: content, placement: .below)
        }
    }

    func testSurfaceComposesWithSlotAndChildren() {
        let model = AIFeatureCardModel(
            source: InMemoryAIFeatureCardSource(initial: AIFeatureCardInput())
        )
        _ = AIFeatureCard(
            model: model,
            content: content,
            placement: .below,
            inputSlot: { TSSkeleton(height: 40) },
            children: { EmptyView() }
        )
        _ = AIFeatureCard(model: model, content: content) {
            TSBadge("aiFeatureCard.live", tone: .info)
        }
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyAIFeatureCardTelemetry: AIFeatureCardTelemetry, @unchecked Sendable {
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
