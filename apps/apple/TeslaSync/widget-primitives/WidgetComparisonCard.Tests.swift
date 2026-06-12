//
//  WidgetComparisonCard.Tests.swift
//  TeslaSync — P4 widget primitive · 0003 · WidgetComparisonCard (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + value types
//  live in WidgetComparisonCard.AdapterTests.swift; split to keep each file within the SwiftLint
//  file-length budget):
//    • WidgetComparisonCardModel — the once-only `view.opened`, the props `update` re-derivation (empty →
//      populated, and the compact re-slice), and the projection reflecting the resolved column.
//    • Views — the public surface + the subviews compose in every real branch (populated / compact /
//      single / empty), via both the prop initializer and the injected-model seam.
//    • Strings — the empty copy + a11y compositions resolve through the P1/S10 facade with the fallbacks.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum Fixture {
    static func metric(_ label: String, higherIsBetter: Bool = true) -> ComparisonMetric {
        ComparisonMetric(
            label: label,
            current: 10,
            previous: 8,
            formattedCurrent: "10",
            unit: "km",
            higherIsBetter: higherIsBetter
        )
    }

    static let two = [metric("A"), metric("B")]
    static let three = [metric("A"), metric("B"), metric("C")]
}

// MARK: - WidgetComparisonCardModel (telemetry + derivation)

@MainActor
final class WidgetComparisonCardModelTests: XCTestCase {
    private func model(
        _ metrics: [ComparisonMetric],
        compact: Bool = false,
        telemetry: WidgetComparisonCardTelemetry = OSLogWidgetComparisonCardTelemetry()
    ) -> WidgetComparisonCardModel {
        WidgetComparisonCardModel(
            input: WidgetComparisonCardInput(metrics: metrics, compact: compact),
            telemetry: telemetry
        )
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let holder = model(Fixture.two, telemetry: spy)
        holder.start()
        holder.start()
        XCTAssertEqual(spy.surfaces, [WidgetComparisonCardSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let holder = model(Fixture.two, telemetry: spy)
        holder.start()
        holder.stop()
        holder.start()
        XCTAssertEqual(spy.surfaces, [WidgetComparisonCardSurface.slug], "view.opened fires once per instance")
    }

    func testProjectionReflectsPopulatedColumn() {
        guard case let .populated(rows) = model(Fixture.three).projection else {
            return XCTFail("expected populated projection")
        }
        XCTAssertEqual(rows.count, 3)
    }

    func testProjectionReflectsCompactSlice() {
        guard case let .populated(rows) = model(Fixture.three, compact: true).projection else {
            return XCTFail("expected populated projection")
        }
        XCTAssertEqual(rows.count, 2)
    }

    func testEmptyMetricsProjectToEmpty() {
        XCTAssertEqual(model([]).projection, .empty)
    }

    func testUpdateReDerivesProjectionFromEmptyToPopulated() {
        let holder = model([])
        XCTAssertEqual(holder.projection, .empty)
        holder.update(WidgetComparisonCardInput(metrics: Fixture.two))
        guard case let .populated(rows) = holder.projection else {
            return XCTFail("expected populated projection after update")
        }
        XCTAssertEqual(rows.count, 2)
    }
}

// MARK: - Views (every real branch composes)

@MainActor
final class WidgetComparisonCardViewTests: XCTestCase {
    func testSurfaceComposesForEveryBranch() {
        _ = WidgetComparisonCard(metrics: Fixture.three)
        _ = WidgetComparisonCard(metrics: Fixture.three, compact: true)
        _ = WidgetComparisonCard(metrics: [Fixture.metric("A")])
        _ = WidgetComparisonCard(metrics: [])
    }

    func testSurfaceComposesFromInjectedModel() {
        let injected = WidgetComparisonCardModel(
            input: WidgetComparisonCardInput(metrics: Fixture.two),
            telemetry: SpyTelemetry()
        )
        _ = WidgetComparisonCard(model: injected)
        XCTAssertEqual(WidgetComparisonCard.surfaceSlug, "WidgetComparisonCard")
    }

    func testSubviewsCompose() {
        let row = WidgetComparisonCardProjector.rows(
            WidgetComparisonCardInput(metrics: Fixture.two)
        )[0]
        _ = ComparisonMetricRow(row: row)
        _ = WidgetComparisonCardEmptyState()
    }
}

// MARK: - Strings facade (P1/S10)

final class WidgetComparisonCardStringsTests: XCTestCase {
    func testEmptyCopyFallbacks() {
        XCTAssertEqual(WidgetComparisonCardStrings.emptyMessage, "No comparison data")
        XCTAssertFalse(WidgetComparisonCardStrings.emptyHint.isEmpty)
    }

    func testRowAccessibilityLabelComposesLabelAndValue() {
        XCTAssertEqual(
            WidgetComparisonCardStrings.rowAccessibilityLabel(label: "Distance", value: "1,420 km"),
            "Distance, 1,420 km"
        )
    }

    func testValueWithUnitJoinsWhenPresentAndOmitsWhenAbsent() {
        XCTAssertEqual(WidgetComparisonCardStrings.valueWithUnit(value: "268", unit: "Wh/km"), "268 Wh/km")
        XCTAssertEqual(WidgetComparisonCardStrings.valueWithUnit(value: "18", unit: nil), "18")
        XCTAssertEqual(WidgetComparisonCardStrings.valueWithUnit(value: "18", unit: ""), "18")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: WidgetComparisonCardTelemetry, @unchecked Sendable {
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
