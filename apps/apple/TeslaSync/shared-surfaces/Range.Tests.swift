//
//  Range.Tests.swift
//  TeslaSync — P4 shared surface · 0087 · Range (Apple)
//
//  Coverage for the Range surface's resolved view-state + state-holder:
//    • Projection — the deterministic per-state "snapshot": the value branch (rated metric, ideal
//      imperial, the precision override), the empty branches (nil state, a missing preferred field,
//      and the two distinct web empty paths — the hardcoded "—" for a null selection vs. the
//      `emptyDisplay`-aware fallback for a non-finite value), and the always-present rated/ideal label
//      resolved through the injected i18n facade.
//    • Accessibility — the value label equals the figure; the empty label resolves the i18n key.
//    • Model — the resolved projection, `sync` adoption + idempotence, the once-only `view.opened`
//      telemetry, and the no-op stop.
//    • Views — the public surfaces + subviews compose (signature contract).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so each
//  assertion reads the pure projection / model directly. Fixed `UnitPreferences` are used so the
//  conversion / grouping assertions are deterministic regardless of region.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private func metricPrefs(emptyDisplay: String? = nil) -> UnitPreferences {
    UnitPreferences(
        distance: "km",
        speed: "km/h",
        temperature: "°C",
        pressure: "kPa",
        energy: "Wh",
        duration: "h",
        power: "W",
        locale: "en-US",
        precision: nil,
        emptyDisplay: emptyDisplay
    )
}

private func imperialPrefs() -> UnitPreferences {
    UnitPreferences(
        distance: "mi",
        speed: "mph",
        temperature: "°F",
        pressure: "psi",
        energy: "kWh",
        duration: "min",
        power: "kW",
        locale: "en-US"
    )
}

private let fullState = RangeState(ratedRangeMeters: 576_000, idealRangeMeters: 602_000)

/// A resolver that echoes the key so key-routing can be asserted deterministically.
private let echoStrings: RangeResolve = { key, _ in "[\(key)]" }

// MARK: - Projection (deterministic per-state snapshot)

final class RangeProjectionTests: XCTestCase {
    func testValueBranchRatedMetric() {
        let input = RangeInput(state: fullState, precision: 0, rangeType: .rated, units: metricPrefs())
        let resolved = RangeProjection.resolve(input)
        guard case let .value(value) = resolved.phase else { return XCTFail("expected value branch") }
        XCTAssertEqual(value.text, "576 km")
        XCTAssertEqual(value.accessibilityLabel, "576 km")
        XCTAssertEqual(resolved.label, "Rated Range")
        XCTAssertFalse(resolved.isEmpty)
    }

    func testValueBranchIdealImperial() {
        let input = RangeInput(state: fullState, precision: 0, rangeType: .ideal, units: imperialPrefs())
        let resolved = RangeProjection.resolve(input)
        // 602000 m / 1609.344 = 374.06… → 0 digits → 374 mi.
        XCTAssertEqual(resolved.displayText, "374 mi")
        XCTAssertEqual(resolved.label, "Ideal Range")
    }

    func testValueBranchPrecisionOverride() {
        let input = RangeInput(state: fullState, precision: 1, rangeType: .rated, units: metricPrefs())
        XCTAssertEqual(RangeProjection.resolve(input).displayText, "576.0 km")
    }

    func testEmptyBranchNilStateRendersSentinel() {
        let input = RangeInput(state: nil, precision: 0, rangeType: .rated, units: metricPrefs())
        let resolved = RangeProjection.resolve(input)
        guard case let .empty(empty) = resolved.phase else { return XCTFail("expected empty branch") }
        XCTAssertEqual(empty.text, "—")
        XCTAssertEqual(empty.accessibilityLabel, "No range data")
        XCTAssertEqual(resolved.label, "Rated Range")
        XCTAssertTrue(resolved.isEmpty)
    }

    func testEmptyBranchMissingPreferredField() {
        let partial = RangeState(ratedRangeMeters: 576_000, idealRangeMeters: nil)
        let input = RangeInput(state: partial, precision: 0, rangeType: .ideal, units: metricPrefs())
        let resolved = RangeProjection.resolve(input)
        XCTAssertTrue(resolved.isEmpty)
        XCTAssertEqual(resolved.displayText, "—")
        XCTAssertEqual(resolved.label, "Ideal Range")
    }

    func testNullSelectionUsesHardcodedDashEvenWithCustomEmptyDisplay() {
        // Web `if (meters == null) return <span>—</span>` does NOT consult `emptyDisplay`.
        let input = RangeInput(state: nil, precision: 0, rangeType: .rated, units: metricPrefs(emptyDisplay: "n/a"))
        XCTAssertEqual(RangeProjection.resolve(input).displayText, "—")
    }

    func testNonFiniteSelectionUsesEmptyDisplayOverride() {
        // Web `formatDistance(NaN, …)` → `resolveEmpty(pref)` (the `emptyDisplay ?? '—'` fallback).
        let nanState = RangeState(ratedRangeMeters: .nan, idealRangeMeters: nil)
        let input = RangeInput(
            state: nanState,
            precision: 0,
            rangeType: .rated,
            units: metricPrefs(emptyDisplay: "n/a")
        )
        XCTAssertEqual(RangeProjection.resolve(input).displayText, "n/a")
    }

    func testLabelRoutesThroughInjectedStrings() {
        let input = RangeInput(state: fullState, precision: 0, rangeType: .ideal, units: metricPrefs())
        XCTAssertEqual(RangeProjection.resolve(input, strings: echoStrings).label, "[common.idealRange]")
    }

    func testStandaloneLabelHelperResolvesByPreference() {
        XCTAssertEqual(RangeProjection.label(for: .rated), "Rated Range")
        XCTAssertEqual(RangeProjection.label(for: .ideal), "Ideal Range")
        XCTAssertEqual(RangeProjection.label(for: .rated, strings: echoStrings), "[common.ratedRange]")
    }
}

// MARK: - Accessibility (labels)

final class RangeAccessibilityTests: XCTestCase {
    func testValueLabelEqualsDisplay() {
        XCTAssertEqual(RangeAccessibility.valueLabel("576 km"), "576 km")
    }

    func testEmptyLabelResolvesKeyWithFallback() {
        XCTAssertEqual(RangeAccessibility.emptyLabel(), "No range data")
        XCTAssertEqual(RangeAccessibility.emptyLabel(strings: echoStrings), "[range.empty.accessibilityLabel]")
    }
}

// MARK: - Model (state-holder)

@MainActor
final class RangeModelTests: XCTestCase {
    func testResolvedProjectsInput() {
        let model = RangeModel(
            input: RangeInput(state: fullState, precision: 0, rangeType: .rated, units: metricPrefs()),
            telemetry: SpyRangeTelemetry()
        )
        XCTAssertEqual(model.resolved.displayText, "576 km")
        XCTAssertEqual(model.resolved.label, "Rated Range")
    }

    func testSyncAdoptsNewInput() {
        let model = RangeModel(
            input: RangeInput(state: fullState, precision: 0, rangeType: .rated, units: metricPrefs()),
            telemetry: SpyRangeTelemetry()
        )
        model.sync(RangeInput(state: fullState, precision: 0, rangeType: .ideal, units: imperialPrefs()))
        XCTAssertEqual(model.resolved.displayText, "374 mi")
        XCTAssertEqual(model.resolved.label, "Ideal Range")
    }

    func testSyncToEmptyBranch() {
        let model = RangeModel(
            input: RangeInput(state: fullState, precision: 0, rangeType: .rated, units: metricPrefs()),
            telemetry: SpyRangeTelemetry()
        )
        model.sync(RangeInput(state: nil, precision: 0, rangeType: .rated, units: metricPrefs()))
        XCTAssertTrue(model.resolved.isEmpty)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyRangeTelemetry()
        let model = RangeModel(
            input: RangeInput(state: fullState, rangeType: .rated, units: metricPrefs()),
            telemetry: spy
        )
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [RangeMeta.surfaceSlug])
    }

    func testStopIsSafeAndDoesNotEmit() {
        let spy = SpyRangeTelemetry()
        let model = RangeModel(
            input: RangeInput(state: fullState, rangeType: .rated, units: metricPrefs()),
            telemetry: spy
        )
        model.start()
        model.stop()
        model.stop()
        XCTAssertEqual(spy.surfaces, [RangeMeta.surfaceSlug])
    }
}

// MARK: - Views (every form composes — signature contract)

@MainActor
final class RangeViewTests: XCTestCase {
    func testPublicSurfacesCompose() {
        _ = RangeReadout(state: fullState)
        _ = RangeReadout(state: fullState, precision: 1)
        _ = RangeReadout(state: nil)
        _ = RangeReadout(
            input: RangeInput(state: fullState, rangeType: .ideal, units: metricPrefs()),
            telemetry: SpyRangeTelemetry()
        )
        _ = RangeLabel()
        _ = RangeLabel(rangeType: .ideal)
    }

    func testSubviewsCompose() {
        _ = RangeValueView(value: RangeResolvedValue(text: "576 km", accessibilityLabel: "576 km"))
        _ = RangeEmptyView(empty: RangeResolvedEmpty(text: "—", accessibilityLabel: "No range data"))
        _ = RangeLabelView(label: "Rated Range")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyRangeTelemetry: RangeTelemetry, @unchecked Sendable {
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
