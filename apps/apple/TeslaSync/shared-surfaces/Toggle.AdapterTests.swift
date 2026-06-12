//
//  Toggle.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0230 · Toggle (Apple)
//
//  Pure-core coverage for the Toggle surface (Foundation only, no view, no store):
//    • ToggleMeta — the diagnostics slug, the `size` default, and the `useId` identifier resolution.
//    • ToggleSize — the web `'sm'` / `'md'` literal mapping (+ the unrecognised / absent fallback) and
//      the case set.
//    • ToggleAccessibility — the visible-label guard (nil / empty → no label) and the accessible name
//      (label passthrough vs. the localized unlabeled fallback, routed through the injected facade).
//    • ToggleInput — the default arguments.
//
//  These run in the TeslaSync(/-macOS) XCTest targets with no network and no real store, so each
//  assertion reads the pure core directly. The projection / model / view / telemetry coverage lives
//  in Toggle.Tests.swift.
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - Fixtures

/// A resolver that echoes the key so key-routing can be asserted deterministically.
private let echoStrings: ToggleResolve = { key, _ in "[\(key)]" }

// MARK: - ToggleMeta (diagnostics slug + defaults + useId)

final class ToggleMetaTests: XCTestCase {
    func testSurfaceSlugAndDefaults() {
        XCTAssertEqual(ToggleMeta.surfaceSlug, "Toggle")
        XCTAssertEqual(ToggleMeta.defaultSize, .medium)
        XCTAssertEqual(ToggleMeta.identifierPrefix, "toggle")
    }

    func testMakeIdentifierPrefersExplicitThenGenerates() {
        XCTAssertEqual(ToggleMeta.makeIdentifier("custom-id"), "custom-id")
        XCTAssertTrue(ToggleMeta.makeIdentifier(nil).hasPrefix("toggle-"))
        XCTAssertTrue(ToggleMeta.makeIdentifier("   ").hasPrefix("toggle-"))
        XCTAssertNotEqual(ToggleMeta.makeIdentifier(nil), ToggleMeta.makeIdentifier(nil))
    }
}

// MARK: - ToggleSize (web 'sm' / 'md' literal mapping)

final class ToggleSizeTests: XCTestCase {
    func testFromMapsWebLiterals() {
        XCTAssertEqual(ToggleSize.from("sm"), .small)
        XCTAssertEqual(ToggleSize.from("md"), .medium)
    }

    func testFromFallsBackForAbsentOrUnknown() {
        XCTAssertEqual(ToggleSize.from(nil), ToggleMeta.defaultSize)
        XCTAssertEqual(ToggleSize.from("xl"), ToggleMeta.defaultSize)
        XCTAssertEqual(ToggleSize.from(""), ToggleMeta.defaultSize)
    }

    func testRawValuesAndCaseSet() {
        XCTAssertEqual(ToggleSize.small.rawValue, "sm")
        XCTAssertEqual(ToggleSize.medium.rawValue, "md")
        XCTAssertEqual(Set(ToggleSize.allCases), [.small, .medium])
    }
}

// MARK: - ToggleAccessibility (visible label + name)

final class ToggleAccessibilityTests: XCTestCase {
    func testVisibleLabelGuardsNilAndEmpty() {
        XCTAssertEqual(ToggleAccessibility.visibleLabel("Sentry mode"), "Sentry mode")
        XCTAssertNil(ToggleAccessibility.visibleLabel(nil))
        XCTAssertNil(ToggleAccessibility.visibleLabel(""))
    }

    func testNameUsesLabelWhenPresent() {
        XCTAssertEqual(ToggleAccessibility.name("Sentry mode", strings: echoStrings), "Sentry mode")
    }

    func testNameFallsBackThroughInjectedStrings() {
        XCTAssertEqual(ToggleAccessibility.name(nil, strings: echoStrings), "[toggle.accessibility.unlabeled]")
        XCTAssertEqual(ToggleAccessibility.name("", strings: echoStrings), "[toggle.accessibility.unlabeled]")
    }

    func testNameDefaultResolverReturnsFallbackCopy() {
        XCTAssertEqual(ToggleAccessibility.name(nil, strings: ToggleStrings.string), "Toggle")
    }
}

// MARK: - ToggleInput (default arguments)

final class ToggleInputTests: XCTestCase {
    func testDefaults() {
        let snapshot = ToggleInput(isOn: true)
        XCTAssertTrue(snapshot.isOn)
        XCTAssertNil(snapshot.label)
        XCTAssertEqual(snapshot.size, ToggleMeta.defaultSize)
        XCTAssertEqual(snapshot.identifier, ToggleMeta.identifierPrefix)
    }
}
