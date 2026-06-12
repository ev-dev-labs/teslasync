//
//  WidgetTipCards.Tests.swift
//  TeslaSync — P4 widget primitive · 0012 · WidgetTipCards (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + value types
//  live in WidgetTipCards.AdapterTests.swift; split to keep each file within the SwiftLint file-length
//  budget):
//    • WidgetTipCardsModel — the once-only `view.opened`, the props `update` re-derivation (empty →
//      populated), and the projection reflecting the resolved list.
//    • Views — the public surface + the subviews compose in every real branch (populated / compact /
//      no-impact / empty), via both the prop initializer and the injected-model seam; the impact → tone
//      mapping (web `impactBadgeMap`).
//    • Strings — the empty copy, the localized impact labels, the badge-text resolution, and the a11y
//      compositions resolve through the P1/S10 facade with the fallbacks.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum Fixture {
    static func tip(_ id: String, impact: TipImpact? = nil, impactLabel: String? = nil) -> TipItem {
        TipItem(
            id: id,
            iconSymbol: "lightbulb",
            title: "Tip \(id)",
            description: "Description for \(id).",
            impact: impact,
            impactLabel: impactLabel
        )
    }

    static let three = [tip("a", impact: .high), tip("b", impact: .medium), tip("c", impact: .low)]
}

// MARK: - WidgetTipCardsModel (telemetry + derivation)

@MainActor
final class WidgetTipCardsModelTests: XCTestCase {
    private func model(
        _ tips: [TipItem],
        compact: Bool = false,
        telemetry: WidgetTipCardsTelemetry = OSLogWidgetTipCardsTelemetry()
    ) -> WidgetTipCardsModel {
        WidgetTipCardsModel(
            input: WidgetTipCardsInput(tips: tips, compact: compact),
            telemetry: telemetry
        )
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let holder = model(Fixture.three, telemetry: spy)
        holder.start()
        holder.start()
        XCTAssertEqual(spy.surfaces, [WidgetTipCardsSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let holder = model(Fixture.three, telemetry: spy)
        holder.start()
        holder.stop()
        holder.start()
        XCTAssertEqual(spy.surfaces, [WidgetTipCardsSurface.slug], "view.opened fires once per instance")
    }

    func testProjectionReflectsPopulatedList() {
        guard case let .populated(rows) = model(Fixture.three).projection else {
            return XCTFail("expected populated projection")
        }
        XCTAssertEqual(rows.count, 3)
    }

    func testProjectionReflectsCompactSlice() {
        guard case let .populated(rows) = model(Fixture.three, compact: true).projection else {
            return XCTFail("expected populated projection")
        }
        XCTAssertEqual(rows.count, 1)
    }

    func testEmptyTipsProjectToEmpty() {
        XCTAssertEqual(model([]).projection, .empty)
    }

    func testUpdateReDerivesProjectionFromEmptyToPopulated() {
        let holder = model([])
        XCTAssertEqual(holder.projection, .empty)
        holder.update(WidgetTipCardsInput(tips: Fixture.three))
        guard case let .populated(rows) = holder.projection else {
            return XCTFail("expected populated projection after update")
        }
        XCTAssertEqual(rows.count, 3)
    }
}

// MARK: - Views (every real branch composes)

@MainActor
final class WidgetTipCardsViewTests: XCTestCase {
    func testSurfaceComposesForEveryBranch() {
        _ = WidgetTipCards(tips: Fixture.three)
        _ = WidgetTipCards(tips: Fixture.three, compact: true)
        _ = WidgetTipCards(tips: [Fixture.tip("a")])
        _ = WidgetTipCards(tips: [])
        _ = WidgetTipCards(tips: [], emptyMessage: "Nothing yet", emptyIconSymbol: "checkmark.seal")
    }

    func testSurfaceComposesFromInjectedModel() {
        let injected = WidgetTipCardsModel(
            input: WidgetTipCardsInput(tips: Fixture.three),
            telemetry: SpyTelemetry()
        )
        _ = WidgetTipCards(model: injected)
        XCTAssertEqual(WidgetTipCards.surfaceSlug, "WidgetTipCards")
    }

    func testSubviewsCompose() {
        let row = WidgetTipCardsProjector.rows(WidgetTipCardsInput(tips: Fixture.three))[0]
        _ = TipCardView(row: row)
        _ = WidgetTipCardsEmptyState(message: nil, iconSymbol: nil)
        _ = WidgetTipCardsEmptyState(message: "Custom", iconSymbol: "star")
    }

    func testImpactTonesMapToWebBadgeMap() {
        XCTAssertEqual(TipImpact.high.tone, .success)
        XCTAssertEqual(TipImpact.medium.tone, .warning)
        XCTAssertEqual(TipImpact.low.tone, .neutral)
    }
}

// MARK: - Strings facade (P1/S10)

final class WidgetTipCardsStringsTests: XCTestCase {
    func testEmptyCopyFallbacks() {
        XCTAssertEqual(WidgetTipCardsStrings.emptyMessage, "No recommendations")
        XCTAssertFalse(WidgetTipCardsStrings.emptyHint.isEmpty)
    }

    func testImpactLabelsResolvePerLevel() {
        XCTAssertEqual(WidgetTipCardsStrings.impactLabel(.high), "High")
        XCTAssertEqual(WidgetTipCardsStrings.impactLabel(.medium), "Medium")
        XCTAssertEqual(WidgetTipCardsStrings.impactLabel(.low), "Low")
    }

    func testBadgeTextPrefersOverrideThenLocalizedImpact() {
        XCTAssertEqual(WidgetTipCardsStrings.badgeText(override: "Saves $12/mo", impact: .high), "Saves $12/mo")
        XCTAssertEqual(WidgetTipCardsStrings.badgeText(override: nil, impact: .medium), "Medium")
        XCTAssertEqual(WidgetTipCardsStrings.badgeText(override: "", impact: .low), "Low")
    }

    func testCardAccessibilityLabelComposesWithAndWithoutImpact() {
        XCTAssertEqual(
            WidgetTipCardsStrings.cardAccessibilityLabel(
                title: "Precondition",
                impact: "High",
                description: "Warm the cabin."
            ),
            "Precondition, High. Warm the cabin."
        )
        XCTAssertEqual(
            WidgetTipCardsStrings.cardAccessibilityLabel(
                title: "Plan trip",
                impact: nil,
                description: "Add stops."
            ),
            "Plan trip. Add stops."
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: WidgetTipCardsTelemetry, @unchecked Sendable {
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
