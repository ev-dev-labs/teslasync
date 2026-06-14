//
//  Checkbox.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0204 · Checkbox (Apple)
//
//  Pure-core coverage for the Checkbox surface (Foundation only, no view, no store):
//    • CheckboxMeta — the diagnostics slug, the `size` default, the corner radius, and the `useId`
//      identifier resolution.
//    • CheckboxSize — the web `'sm'` / `'md'` / `'lg'` literal mapping (+ the unrecognised / absent
//      fallback), the case set, and the per-size box / icon metrics.
//    • CheckboxAccessibility — the visible-label guard (nil / empty → no label), the accessible name
//      (label passthrough vs. the localized unlabeled fallback), the tri-state resolution (mixed wins),
//      and the spoken value routed through the injected facade.
//    • CheckboxInput — the default arguments.
//
//  These run in the TeslaSync(/-macOS) XCTest targets with no network and no real store, so each
//  assertion reads the pure core directly. The projection / model / view / telemetry coverage lives in
//  Checkbox.Tests.swift.
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - Fixtures

/// A resolver that echoes the key so key-routing can be asserted deterministically.
private let echoStrings: CheckboxResolve = { key, _ in "[\(key)]" }

// MARK: - CheckboxMeta (diagnostics slug + defaults + useId)

final class CheckboxMetaTests: XCTestCase {
    func testSurfaceSlugAndDefaults() {
        XCTAssertEqual(CheckboxMeta.surfaceSlug, "Checkbox")
        XCTAssertEqual(CheckboxMeta.defaultSize, .medium)
        XCTAssertEqual(CheckboxMeta.identifierPrefix, "checkbox")
        XCTAssertEqual(CheckboxMeta.cornerRadius, 4, accuracy: 0.0001)
    }

    func testMakeIdentifierPrefersExplicitThenGenerates() {
        XCTAssertEqual(CheckboxMeta.makeIdentifier("custom-id"), "custom-id")
        XCTAssertTrue(CheckboxMeta.makeIdentifier(nil).hasPrefix("checkbox-"))
        XCTAssertTrue(CheckboxMeta.makeIdentifier("   ").hasPrefix("checkbox-"))
        XCTAssertNotEqual(CheckboxMeta.makeIdentifier(nil), CheckboxMeta.makeIdentifier(nil))
    }
}

// MARK: - CheckboxSize (web 'sm' / 'md' / 'lg' literal mapping + metrics)

final class CheckboxSizeTests: XCTestCase {
    func testFromMapsWebLiterals() {
        XCTAssertEqual(CheckboxSize.from("sm"), .small)
        XCTAssertEqual(CheckboxSize.from("md"), .medium)
        XCTAssertEqual(CheckboxSize.from("lg"), .large)
    }

    func testFromFallsBackForAbsentOrUnknown() {
        XCTAssertEqual(CheckboxSize.from(nil), CheckboxMeta.defaultSize)
        XCTAssertEqual(CheckboxSize.from("xl"), CheckboxMeta.defaultSize)
        XCTAssertEqual(CheckboxSize.from(""), CheckboxMeta.defaultSize)
    }

    func testRawValuesAndCaseSet() {
        XCTAssertEqual(CheckboxSize.small.rawValue, "sm")
        XCTAssertEqual(CheckboxSize.medium.rawValue, "md")
        XCTAssertEqual(CheckboxSize.large.rawValue, "lg")
        XCTAssertEqual(Set(CheckboxSize.allCases), [.small, .medium, .large])
    }

    func testMetricsScaleWithSize() {
        XCTAssertEqual(CheckboxSize.small.metrics, CheckboxMetrics(boxSide: 14, iconPointSize: 10))
        XCTAssertEqual(CheckboxSize.medium.metrics, CheckboxMetrics(boxSide: 16, iconPointSize: 12))
        XCTAssertEqual(CheckboxSize.large.metrics, CheckboxMetrics(boxSide: 20, iconPointSize: 14))
        // The box and glyph grow monotonically with the size, mirroring the web Tailwind dimensions.
        XCTAssertLessThan(CheckboxSize.small.metrics.boxSide, CheckboxSize.medium.metrics.boxSide)
        XCTAssertLessThan(CheckboxSize.medium.metrics.boxSide, CheckboxSize.large.metrics.boxSide)
    }
}

// MARK: - CheckboxAccessibility (visible label + name + tri-state value)

final class CheckboxAccessibilityTests: XCTestCase {
    func testVisibleLabelGuardsNilAndEmpty() {
        XCTAssertEqual(CheckboxAccessibility.visibleLabel("Sentry mode"), "Sentry mode")
        XCTAssertNil(CheckboxAccessibility.visibleLabel(nil))
        XCTAssertNil(CheckboxAccessibility.visibleLabel(""))
    }

    func testNameUsesLabelWhenPresent() {
        XCTAssertEqual(CheckboxAccessibility.name("Sentry mode", strings: echoStrings), "Sentry mode")
    }

    func testNameFallsBackThroughInjectedStrings() {
        XCTAssertEqual(
            CheckboxAccessibility.name(nil, strings: echoStrings),
            "[checkbox.accessibility.unlabeled]"
        )
        XCTAssertEqual(
            CheckboxAccessibility.name("", strings: echoStrings),
            "[checkbox.accessibility.unlabeled]"
        )
    }

    func testNameDefaultResolverReturnsFallbackCopy() {
        XCTAssertEqual(CheckboxAccessibility.name(nil, strings: CheckboxStrings.string), "Checkbox")
    }

    func testStateIndeterminateWinsOverChecked() {
        XCTAssertEqual(CheckboxAccessibility.state(isChecked: true, isIndeterminate: true), .mixed)
        XCTAssertEqual(CheckboxAccessibility.state(isChecked: false, isIndeterminate: true), .mixed)
        XCTAssertEqual(CheckboxAccessibility.state(isChecked: true, isIndeterminate: false), .checked)
        XCTAssertEqual(CheckboxAccessibility.state(isChecked: false, isIndeterminate: false), .unchecked)
    }

    func testStateValueRoutesThroughInjectedStrings() {
        XCTAssertEqual(
            CheckboxAccessibility.stateValue(.checked, strings: echoStrings),
            "[checkbox.accessibility.checked]"
        )
        XCTAssertEqual(
            CheckboxAccessibility.stateValue(.unchecked, strings: echoStrings),
            "[checkbox.accessibility.unchecked]"
        )
        XCTAssertEqual(
            CheckboxAccessibility.stateValue(.mixed, strings: echoStrings),
            "[checkbox.accessibility.mixed]"
        )
    }

    func testStateValueDefaultResolverReturnsFallbackCopy() {
        XCTAssertEqual(CheckboxAccessibility.stateValue(.checked, strings: CheckboxStrings.string), "Checked")
        XCTAssertEqual(
            CheckboxAccessibility.stateValue(.unchecked, strings: CheckboxStrings.string),
            "Not checked"
        )
        XCTAssertEqual(CheckboxAccessibility.stateValue(.mixed, strings: CheckboxStrings.string), "Mixed")
    }
}

// MARK: - CheckboxInput (default arguments)

final class CheckboxInputTests: XCTestCase {
    func testDefaults() {
        let snapshot = CheckboxInput()
        XCTAssertFalse(snapshot.isControlled)
        XCTAssertFalse(snapshot.controlledChecked)
        XCTAssertFalse(snapshot.defaultChecked)
        XCTAssertFalse(snapshot.isIndeterminate)
        XCTAssertFalse(snapshot.isDisabled)
        XCTAssertNil(snapshot.label)
        XCTAssertEqual(snapshot.size, CheckboxMeta.defaultSize)
        XCTAssertEqual(snapshot.identifier, CheckboxMeta.identifierPrefix)
    }
}
