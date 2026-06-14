//
//  WidgetDetailCard.Tests.swift
//  TeslaSync — P4 widget primitive · 0004 · WidgetDetailCard (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + value types
//  live in WidgetDetailCard.AdapterTests.swift; split to keep each file within the SwiftLint file-length
//  budget):
//    • WidgetDetailCardModel — the once-only `view.opened`, the props `update` re-derivation (empty →
//      populated, and the compact re-slice), and the projection reflecting the resolved column.
//    • Views — the public surface + the subviews compose in every real branch (populated / compact /
//      single / empty / empty-override), via both the prop initializer and the injected-model seam; the
//      badge tone mapping ports the web `badgeVariantMap`.
//    • Strings — the empty copy + the em-dash value fallback + the a11y compositions resolve through the
//      P1/S10 facade with the fallbacks.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum Fixture {
    static func entry(_ label: String, value: String? = "value") -> DetailEntry {
        DetailEntry(label: label, value: value)
    }

    static let three = [entry("A"), entry("B"), entry("C")]
    static let five = [entry("A"), entry("B"), entry("C"), entry("D"), entry("E")]
}

// MARK: - WidgetDetailCardModel (telemetry + derivation)

@MainActor
final class WidgetDetailCardModelTests: XCTestCase {
    private func model(
        _ entries: [DetailEntry],
        compact: Bool = false,
        telemetry: WidgetDetailCardTelemetry = OSLogWidgetDetailCardTelemetry()
    ) -> WidgetDetailCardModel {
        WidgetDetailCardModel(
            input: WidgetDetailCardInput(entries: entries, compact: compact),
            telemetry: telemetry
        )
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let holder = model(Fixture.three, telemetry: spy)
        holder.start()
        holder.start()
        XCTAssertEqual(spy.surfaces, [WidgetDetailCardSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let holder = model(Fixture.three, telemetry: spy)
        holder.start()
        holder.stop()
        holder.start()
        XCTAssertEqual(spy.surfaces, [WidgetDetailCardSurface.slug], "view.opened fires once per instance")
    }

    func testProjectionReflectsPopulatedColumn() {
        guard case let .populated(rows) = model(Fixture.three).projection else {
            return XCTFail("expected populated projection")
        }
        XCTAssertEqual(rows.count, 3)
    }

    func testProjectionReflectsCompactSlice() {
        guard case let .populated(rows) = model(Fixture.five, compact: true).projection else {
            return XCTFail("expected populated projection")
        }
        XCTAssertEqual(rows.count, 4)
    }

    func testEmptyEntriesProjectToEmpty() {
        XCTAssertEqual(model([]).projection, .empty)
    }

    func testUpdateReDerivesProjectionFromEmptyToPopulated() {
        let holder = model([])
        XCTAssertEqual(holder.projection, .empty)
        holder.update(WidgetDetailCardInput(entries: Fixture.three))
        guard case let .populated(rows) = holder.projection else {
            return XCTFail("expected populated projection after update")
        }
        XCTAssertEqual(rows.count, 3)
    }
}

// MARK: - Views (every real branch composes)

@MainActor
final class WidgetDetailCardViewTests: XCTestCase {
    func testSurfaceComposesForEveryBranch() {
        _ = WidgetDetailCard(entries: Fixture.five)
        _ = WidgetDetailCard(entries: Fixture.five, compact: true)
        _ = WidgetDetailCard(entries: [Fixture.entry("A")])
        _ = WidgetDetailCard(entries: [])
        _ = WidgetDetailCard(entries: [], emptyMessage: "No session", emptyIconSymbol: "bolt.slash")
    }

    func testSurfaceComposesFromInjectedModel() {
        let injected = WidgetDetailCardModel(
            input: WidgetDetailCardInput(entries: Fixture.three),
            telemetry: SpyTelemetry()
        )
        _ = WidgetDetailCard(model: injected)
        XCTAssertEqual(WidgetDetailCard.surfaceSlug, "WidgetDetailCard")
    }

    func testSubviewsCompose() {
        let badge = DetailBadge(text: "Active", variant: .success)
        let row = WidgetDetailCardProjector.rows(
            WidgetDetailCardInput(entries: [DetailEntry(label: "VIN", value: "5YJ", badge: badge, mono: true)])
        )[0]
        _ = DetailEntryRow(row: row)
        _ = WidgetDetailCardEmptyState(message: nil, iconSymbol: nil)
        _ = WidgetDetailCardEmptyState(message: "No session", iconSymbol: "bolt.slash")
    }
}

// MARK: - Badge tone mapping (web `badgeVariantMap`)

final class WidgetDetailCardToneTests: XCTestCase {
    func testVariantTonePortsBadgeVariantMap() {
        XCTAssertEqual(DetailBadgeVariant.success.tone, .success)
        XCTAssertEqual(DetailBadgeVariant.warning.tone, .warning)
        XCTAssertEqual(DetailBadgeVariant.error.tone, .danger)
        XCTAssertEqual(DetailBadgeVariant.neutral.tone, .neutral)
    }
}

// MARK: - Strings facade (P1/S10)

final class WidgetDetailCardStringsTests: XCTestCase {
    func testEmptyCopyFallbacks() {
        XCTAssertEqual(WidgetDetailCardStrings.emptyMessage, "No details available")
        XCTAssertFalse(WidgetDetailCardStrings.emptyHint.isEmpty)
    }

    func testValueFallbackIsEmDash() {
        XCTAssertEqual(WidgetDetailCardStrings.valueFallback, "—")
    }

    func testDisplayValueUsesFallbackForMissingValue() {
        XCTAssertEqual(WidgetDetailCardStrings.displayValue("142 km"), "142 km")
        XCTAssertEqual(WidgetDetailCardStrings.displayValue(nil), "—")
        XCTAssertEqual(WidgetDetailCardStrings.displayValue(""), "—")
    }

    func testRowAccessibilityLabelComposesWithAndWithoutBadge() {
        XCTAssertEqual(
            WidgetDetailCardStrings.rowAccessibilityLabel(label: "Status", value: "Charging", badge: nil),
            "Status, Charging"
        )
        XCTAssertEqual(
            WidgetDetailCardStrings.rowAccessibilityLabel(label: "Status", value: "Charging", badge: "Active"),
            "Status, Charging, Active"
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: WidgetDetailCardTelemetry, @unchecked Sendable {
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
