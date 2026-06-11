//
//  Delta.Tests.swift
//  TeslaSync — P4 shared surface · 0081 · Delta (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + value
//  types live in Delta.AdapterTests.swift; split to keep each file within the SwiftLint file-length
//  budget):
//    • DeltaModel — the once-only `view.opened`, the props / units update + identical-update guards,
//      the derived projection, the inline flag, and the populated / empty VoiceOver labels.
//    • Views — the content view + the public surface compose in every branch; the tone / arrow / size
//      token projections resolve.
//    • Strings — the two web `t()` keys resolve through the P1/S10 facade with the English fallbacks.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - DeltaModel (surface lifecycle + derivation)

@MainActor
final class DeltaModelTests: XCTestCase {
    private func model(
        _ inputs: DeltaInputs,
        units: UnitPreferences = .metric,
        telemetry: DeltaTelemetry = OSLogDeltaTelemetry()
    ) -> DeltaModel {
        DeltaModel(inputs: inputs, units: units, telemetry: telemetry)
    }

    private func inputs(
        current: Double?,
        previous: Double?,
        display: DeltaDisplay = .percent,
        inline: Bool = true
    ) -> DeltaInputs {
        DeltaInputs(metric: .id("range"), current: current, previous: previous, display: display, inline: inline)
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyDeltaTelemetry()
        let indicator = model(inputs(current: 312, previous: 298), telemetry: spy)
        indicator.start()
        indicator.start()
        XCTAssertEqual(spy.surfaces, [DeltaSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyDeltaTelemetry()
        let indicator = model(inputs(current: 312, previous: 298), telemetry: spy)
        indicator.start()
        indicator.stop()
        indicator.start()
        XCTAssertEqual(spy.surfaces, [DeltaSurface.slug], "view.opened fires once per instance")
    }

    func testProjectionReflectsInputsAndUnits() {
        let indicator = model(inputs(current: 312, previous: 298, display: .absolute), units: .metric)
        guard case let .value(value) = indicator.projection else { return XCTFail("expected value") }
        XCTAssertEqual(value.text, "14.00 km")
    }

    func testUpdateInputsChangesProjectionAndGuardsIdentical() {
        let initial = inputs(current: 298, previous: 298)
        let indicator = model(initial)
        indicator.update(initial)
        guard case let .value(zero) = indicator.projection else { return XCTFail("expected value") }
        XCTAssertEqual(zero.arrow, .right)
        indicator.update(inputs(current: 312, previous: 298))
        guard case let .value(rise) = indicator.projection else { return XCTFail("expected value") }
        XCTAssertEqual(rise.arrow, .up)
    }

    func testUpdateUnitsFlipsAffixAndGuardsIdentical() {
        let indicator = model(inputs(current: 312, previous: 298, display: .absolute), units: .metric)
        guard case let .value(metric) = indicator.projection else { return XCTFail("expected value") }
        XCTAssertEqual(metric.text, "14.00 km")
        indicator.update(units: .imperial)
        guard case let .value(imperial) = indicator.projection else { return XCTFail("expected value") }
        XCTAssertEqual(imperial.text, "14.00 mi")
        indicator.update(units: .imperial)
        XCTAssertEqual(indicator.units, .imperial)
    }

    func testAccessibilityLabelPopulatedAndEmpty() {
        let populated = model(inputs(current: 312, previous: 298), units: .metric)
        XCTAssertEqual(populated.accessibilityLabel, "312.00 vs 298.00")

        let empty = model(inputs(current: nil, previous: 298))
        XCTAssertEqual(empty.accessibilityLabel, "No comparison data")
    }

    func testInlineReflectsInputs() {
        XCTAssertTrue(model(inputs(current: 1, previous: 1, inline: true)).inline)
        XCTAssertFalse(model(inputs(current: 1, previous: 1, inline: false)).inline)
    }
}

// MARK: - Views (every branch composes + token projections)

@MainActor
final class DeltaViewCompositionTests: XCTestCase {
    func testSurfaceComposesForEveryInitAndBranch() {
        _ = Delta(metric: .id("range"), current: 312, previous: 298, comparedTo: "vs last week")
        _ = Delta(metric: .id("cost"), current: 42.5, previous: 39, display: .absolute, precision: 2)
        _ = Delta(metric: .id("range"), current: 312, previous: 298, display: .both, size: .md)
        _ = Delta(metric: .inline(direction: .neutral, unit: .count), current: nil, previous: 3)
        _ = Delta(metric: .id("range"), current: 312, previous: 298, loading: true)
        _ = Delta(metric: .id("range"), current: 312, previous: 298, inline: false, hideArrow: true)
    }

    func testSurfaceComposesFromInjectedModel() {
        let injected = DeltaModel(
            inputs: DeltaInputs(metric: .id("range"), current: 312, previous: 298),
            telemetry: SpyDeltaTelemetry()
        )
        _ = Delta(model: injected)
        XCTAssertEqual(Delta.surfaceSlug, "Delta")
    }

    func testContentViewComposesForEveryArm() {
        let arms: [DeltaInputs] = [
            DeltaInputs(metric: .id("range"), current: 312, previous: 298, loading: true),
            DeltaInputs(metric: .id("range"), current: nil, previous: 298, comparedTo: "vs last week"),
            DeltaInputs(metric: .id("range"), current: 312, previous: 298, comparedTo: "vs last week")
        ]
        for arm in arms {
            let projection = DeltaProjector.resolve(arm, units: .metric)
            _ = DeltaContentView(projection: projection, inline: arm.inline)
        }
    }

    func testTokenProjectionsAreResolvable() {
        XCTAssertEqual(DeltaTone.success.color, Color.TS.statusSuccess)
        XCTAssertEqual(DeltaTone.danger.color, Color.TS.statusDanger)
        XCTAssertEqual(DeltaTone.muted.color, Color.TS.textMuted)
        XCTAssertEqual(DeltaTone.secondary.color, Color.TS.textSecondary)
        XCTAssertEqual(DeltaArrow.up.systemName, "arrow.up")
        XCTAssertEqual(DeltaArrow.down.systemName, "arrow.down")
        XCTAssertEqual(DeltaArrow.right.systemName, "arrow.right")
        XCTAssertNil(DeltaArrow.hidden.systemName)
        XCTAssertEqual(DeltaSize.md.skeletonHeight, 16)
        XCTAssertEqual(DeltaSize.sm.skeletonHeight, 14)
    }
}

// MARK: - Strings facade (P1/S10)

final class DeltaStringsTests: XCTestCase {
    func testTitleInterpolatesEndpoints() {
        XCTAssertEqual(DeltaStrings.title(current: "312", previous: "298"), "312 vs 298")
    }

    func testNoComparisonFallback() {
        XCTAssertEqual(DeltaStrings.noComparison, "No comparison data")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyDeltaTelemetry: DeltaTelemetry, @unchecked Sendable {
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
