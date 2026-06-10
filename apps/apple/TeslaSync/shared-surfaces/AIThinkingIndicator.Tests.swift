//
//  AIThinkingIndicator.Tests.swift
//  TeslaSync — P4 shared surface · 0053 · AIThinkingIndicator (Apple)
//
//  Coverage for the AIThinkingIndicator surface:
//    • Projection — the verbatim port of `text = label ?? t('helix.thinking', …)`: nil override →
//      default, non-empty override → override, empty / whitespace override → default (null-safety).
//    • Meta — the diagnostics slug + the two web label keys / fallbacks.
//    • Accessibility — the `role="status"` label equals the resolved visible label.
//    • Model — the resolver wiring (default + override), the lazy once-only `view.opened` telemetry
//      (idempotent across re-appears), and the no-op stop / lifecycle wiring.
//    • i18n facade — an unknown key resolves to its English fallback (bundle-independent).
//    • Mark geometry — the ported HelixMark path is non-empty + within its viewBox + scales.
//    • Views — the full + compact bodies and every subview compose (signature contract).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so
//  each assertion reads the pure adapter / model directly.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Projection (override ?? default)

final class AIThinkingProjectionTests: XCTestCase {
    func testNilOverrideUsesDefault() {
        let resolved = AIThinkingProjection.resolve(
            AIThinkingIndicatorInput(labelOverride: nil),
            defaultLabel: "Helix is thinking"
        )
        XCTAssertEqual(resolved.label, "Helix is thinking")
    }

    func testNonEmptyOverrideWins() {
        let resolved = AIThinkingProjection.resolve(
            AIThinkingIndicatorInput(labelOverride: "AI is summarising"),
            defaultLabel: "Helix is thinking"
        )
        XCTAssertEqual(resolved.label, "AI is summarising")
    }

    func testEmptyOverrideFallsBackToDefault() {
        let resolved = AIThinkingProjection.resolve(
            AIThinkingIndicatorInput(labelOverride: ""),
            defaultLabel: "Helix is thinking"
        )
        XCTAssertEqual(resolved.label, "Helix is thinking")
    }

    func testWhitespaceOnlyOverrideFallsBackToDefault() {
        let resolved = AIThinkingProjection.resolve(
            AIThinkingIndicatorInput(labelOverride: "   \n  "),
            defaultLabel: "Helix is thinking"
        )
        XCTAssertEqual(resolved.label, "Helix is thinking")
    }
}

// MARK: - Meta (diagnostics slug + web label keys)

final class AIThinkingIndicatorMetaTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(AIThinkingIndicatorMeta.surfaceSlug, "AIThinkingIndicator")
        XCTAssertEqual(AIThinkingIndicator.surfaceSlug, "AIThinkingIndicator")
    }

    func testDefaultLabelKeyMatchesWebSource() {
        XCTAssertEqual(AIThinkingIndicatorMeta.defaultLabelKey, "helix.thinking")
        XCTAssertEqual(AIThinkingIndicatorMeta.defaultLabelFallback, "Helix is thinking")
    }

    func testAltLabelKeyMatchesWebSource() {
        XCTAssertEqual(AIThinkingIndicatorMeta.altLabelKey, "ai.common.thinking")
        XCTAssertEqual(AIThinkingIndicatorMeta.altLabelFallback, "AI is thinking")
    }
}

// MARK: - Accessibility (status label)

final class AIThinkingAccessibilityTests: XCTestCase {
    func testStatusLabelEqualsResolvedLabel() {
        XCTAssertEqual(AIThinkingAccessibility.statusLabel("Helix is thinking"), "Helix is thinking")
        XCTAssertEqual(AIThinkingAccessibility.statusLabel("AI is summarising"), "AI is summarising")
    }
}

// MARK: - Model (state-holder)

@MainActor
final class AIThinkingIndicatorModelTests: XCTestCase {
    func testResolvesDefaultLabelViaResolver() {
        let model = AIThinkingIndicatorModel(
            input: AIThinkingIndicatorInput(),
            telemetry: SpyAIThinkingTelemetry(),
            resolve: { _, fallback in fallback }
        )
        XCTAssertEqual(model.label, AIThinkingIndicatorMeta.defaultLabelFallback)
    }

    func testResolverIsCalledWithDefaultKey() {
        let model = AIThinkingIndicatorModel(
            input: AIThinkingIndicatorInput(),
            telemetry: SpyAIThinkingTelemetry(),
            resolve: { key, _ in "K:\(key)" }
        )
        XCTAssertEqual(model.label, "K:\(AIThinkingIndicatorMeta.defaultLabelKey)")
    }

    func testOverrideWinsOverResolvedDefault() {
        let model = AIThinkingIndicatorModel(
            input: AIThinkingIndicatorInput(labelOverride: "AI is summarising"),
            telemetry: SpyAIThinkingTelemetry(),
            resolve: { _, fallback in fallback }
        )
        XCTAssertEqual(model.label, "AI is summarising")
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyAIThinkingTelemetry()
        let model = AIThinkingIndicatorModel(
            input: AIThinkingIndicatorInput(),
            telemetry: spy,
            resolve: { _, fallback in fallback }
        )
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [AIThinkingIndicatorMeta.surfaceSlug])
    }

    func testStopIsSafeAndDoesNotEmit() {
        let spy = SpyAIThinkingTelemetry()
        let model = AIThinkingIndicatorModel(
            input: AIThinkingIndicatorInput(),
            telemetry: spy,
            resolve: { _, fallback in fallback }
        )
        model.start()
        model.stop()
        model.stop()
        XCTAssertEqual(spy.surfaces, [AIThinkingIndicatorMeta.surfaceSlug])
    }
}

// MARK: - i18n facade (bundle-independent fallback)

final class AIThinkingStringsTests: XCTestCase {
    func testUnknownKeyResolvesToFallback() {
        let resolved = AIThinkingStrings.string("ai.thinking.unknown.key", "Fallback copy")
        XCTAssertEqual(resolved, "Fallback copy")
    }

    func testTableNameMatchesSurface() {
        XCTAssertEqual(AIThinkingStrings.table, "AIThinkingIndicator")
    }
}

// MARK: - Mark geometry (ported HelixMark path)

final class AIThinkingHelixMarkShapeTests: XCTestCase {
    func testPathIsNonEmptyAndWithinViewBox() {
        let rect = CGRect(x: 0, y: 0, width: 24, height: 24)
        let path = AIThinkingHelixMarkShape().path(in: rect)
        XCTAssertFalse(path.isEmpty)
        let bounds = path.boundingRect
        XCTAssertGreaterThanOrEqual(bounds.minX, rect.minX - 0.001)
        XCTAssertGreaterThanOrEqual(bounds.minY, rect.minY - 0.001)
        XCTAssertLessThanOrEqual(bounds.maxX, rect.maxX + 0.001)
        XCTAssertLessThanOrEqual(bounds.maxY, rect.maxY + 0.001)
    }

    func testPathScalesWithFrame() {
        let small = AIThinkingHelixMarkShape().path(in: CGRect(x: 0, y: 0, width: 12, height: 12))
        XCTAssertLessThanOrEqual(small.boundingRect.maxX, 12.001)
        XCTAssertLessThanOrEqual(small.boundingRect.maxY, 12.001)
    }
}

// MARK: - Views (every state composes — signature contract)

@MainActor
final class AIThinkingIndicatorViewTests: XCTestCase {
    func testEverySubviewComposes() {
        _ = AIThinkingHelixMark(size: 16, tint: .TS.accent, animate: true)
        _ = AIThinkingHelixMark(size: 16, tint: .TS.accent, animate: false)
        _ = AIThinkingBounceDots(active: true, style: AnyShapeStyle(Color.TS.accent))
        _ = AIThinkingBounceDots(active: false, style: AnyShapeStyle(.foreground), spacing: 2)
        _ = AIThinkingBounceDot(active: true, style: AnyShapeStyle(Color.TS.accent), size: 4, delay: 0)
        _ = AIThinkingSkeletonLines()
        _ = AIThinkingFullContent(label: "Helix is thinking")
        _ = AIThinkingCompactContent(label: "AI is thinking")
    }

    func testPublicSurfacesCompose() {
        _ = AIThinkingIndicator()
        _ = AIThinkingIndicator(label: "AI is summarising")
        _ = AIThinkingIndicator(model: AIThinkingIndicatorModel())
        _ = AIThinkingDots(label: "AI is thinking")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyAIThinkingTelemetry: AIThinkingTelemetry, @unchecked Sendable {
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
