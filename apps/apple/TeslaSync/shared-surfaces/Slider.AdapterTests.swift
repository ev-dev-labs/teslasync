//
//  Slider.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0226 · Slider (Apple)
//
//  Pure-core coverage for the Slider surface (Foundation only, no view, no store):
//    • SliderMath — the web `<input type=range>` numeric semantics: the effective (positive) step,
//      the coerced upper bound, clamp, snap-to-step, the combined sanitize order (snap → clamp), the
//      PageUp/PageDown large step (~10% of range), and the per-command keyboard transitions.
//    • SliderFormatting — the `String(value)` default readout (integral vs. fractional) and the
//      `Number(value)` change-handler parse (valid / blank / non-numeric / non-finite).
//    • SliderMeta — the diagnostics slug, the lib defaults, and the `useId` identifier resolution.
//    • SliderAccessibility — the name / value passthrough and the localized hint key routing.
//
//  These run in the TeslaSync(/-macOS) XCTest targets with no network and no real store, so each
//  assertion reads the pure core directly. The projection / model / view / telemetry coverage lives
//  in Slider.Tests.swift.
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - Fixtures

/// A resolver that echoes the key so key-routing can be asserted deterministically.
private let echoStrings: SliderResolve = { key, _ in "[\(key)]" }

// MARK: - SliderMath (web range-input numeric semantics)

final class SliderMathTests: XCTestCase {
    func testEffectiveStepFallsBackForNonPositiveOrNonFinite() {
        XCTAssertEqual(SliderMath.effectiveStep(5), 5)
        XCTAssertEqual(SliderMath.effectiveStep(0.5), 0.5)
        XCTAssertEqual(SliderMath.effectiveStep(0), SliderMeta.defaultStep)
        XCTAssertEqual(SliderMath.effectiveStep(-3), SliderMeta.defaultStep)
        XCTAssertEqual(SliderMath.effectiveStep(.nan), SliderMeta.defaultStep)
        XCTAssertEqual(SliderMath.effectiveStep(.infinity), SliderMeta.defaultStep)
    }

    func testEffectiveMaximumCoercesBelowMinimum() {
        XCTAssertEqual(SliderMath.effectiveMaximum(minimum: 0, maximum: 100), 100)
        XCTAssertEqual(SliderMath.effectiveMaximum(minimum: 10, maximum: 0), 10)
        XCTAssertEqual(SliderMath.effectiveMaximum(minimum: 5, maximum: 5), 5)
        XCTAssertEqual(SliderMath.effectiveMaximum(minimum: 0, maximum: .nan), 0)
    }

    func testClampBounds() {
        XCTAssertEqual(SliderMath.clamp(50, minimum: 0, maximum: 100), 50)
        XCTAssertEqual(SliderMath.clamp(-5, minimum: 0, maximum: 100), 0)
        XCTAssertEqual(SliderMath.clamp(150, minimum: 0, maximum: 100), 100)
    }

    func testSnapToStepGridFromMinimum() {
        XCTAssertEqual(SliderMath.snap(7, minimum: 0, step: 5), 5)
        XCTAssertEqual(SliderMath.snap(8, minimum: 0, step: 5), 10)
        XCTAssertEqual(SliderMath.snap(12.4, minimum: 0, step: 0.5), 12.5, accuracy: 1e-9)
        // Grid is offset from the (non-zero) minimum, matching the browser.
        XCTAssertEqual(SliderMath.snap(13, minimum: 3, step: 5), 13)
        XCTAssertEqual(SliderMath.snap(14, minimum: 3, step: 5), 13)
    }

    func testSanitizeSnapsThenClamps() {
        // 7 snaps to 5 (in range).
        XCTAssertEqual(SliderMath.sanitize(7, minimum: 0, maximum: 100, step: 5), 5)
        // Below the floor clamps up.
        XCTAssertEqual(SliderMath.sanitize(-20, minimum: 0, maximum: 100, step: 5), 0)
        // Above the ceiling clamps down.
        XCTAssertEqual(SliderMath.sanitize(150, minimum: 0, maximum: 100, step: 5), 100)
        // Non-finite falls back to the minimum.
        XCTAssertEqual(SliderMath.sanitize(.nan, minimum: 10, maximum: 100, step: 5), 10)
        // max < min collapses to the (fixed) minimum.
        XCTAssertEqual(SliderMath.sanitize(50, minimum: 10, maximum: 0, step: 5), 10)
    }

    func testPageDeltaIsLargerOfStepAndTenth() {
        XCTAssertEqual(SliderMath.pageDelta(minimum: 0, maximum: 100, step: 5), 10)
        XCTAssertEqual(SliderMath.pageDelta(minimum: 0, maximum: 100, step: 20), 20)
        XCTAssertEqual(SliderMath.pageDelta(minimum: 0, maximum: 10, step: 1), 1)
        XCTAssertEqual(SliderMath.pageDelta(minimum: 0, maximum: 1, step: 0.05), 0.1, accuracy: 1e-9)
    }

    func testNextAppliesEachKeyboardCommand() {
        let input = SliderInput(value: 50, minimum: 0, maximum: 100, step: 5, label: "L")
        XCTAssertEqual(SliderMath.next(for: .stepUp, from: input), 55)
        XCTAssertEqual(SliderMath.next(for: .stepDown, from: input), 45)
        XCTAssertEqual(SliderMath.next(for: .pageUp, from: input), 60)
        XCTAssertEqual(SliderMath.next(for: .pageDown, from: input), 40)
        XCTAssertEqual(SliderMath.next(for: .toMinimum, from: input), 0)
        XCTAssertEqual(SliderMath.next(for: .toMaximum, from: input), 100)
    }

    func testNextClampsAtBounds() {
        let atMax = SliderInput(value: 100, minimum: 0, maximum: 100, step: 5, label: "L")
        XCTAssertEqual(SliderMath.next(for: .stepUp, from: atMax), 100)
        XCTAssertEqual(SliderMath.next(for: .pageUp, from: atMax), 100)
        let atMin = SliderInput(value: 0, minimum: 0, maximum: 100, step: 5, label: "L")
        XCTAssertEqual(SliderMath.next(for: .stepDown, from: atMin), 0)
        XCTAssertEqual(SliderMath.next(for: .pageDown, from: atMin), 0)
    }
}

// MARK: - SliderFormatting (web `String(value)` default + `Number(value)` parse)

final class SliderFormattingTests: XCTestCase {
    func testDefaultDisplayDropsFractionForIntegralValues() {
        XCTAssertEqual(SliderFormatting.defaultDisplay(32), "32")
        XCTAssertEqual(SliderFormatting.defaultDisplay(0), "0")
        XCTAssertEqual(SliderFormatting.defaultDisplay(-5), "-5")
        XCTAssertEqual(SliderFormatting.defaultDisplay(100), "100")
    }

    func testDefaultDisplayKeepsFractionalValues() {
        XCTAssertEqual(SliderFormatting.defaultDisplay(12.5), "12.5")
        XCTAssertEqual(SliderFormatting.defaultDisplay(0.05), "0.05")
    }

    func testParseAcceptsNumericRejectsBlankAndNonNumeric() {
        XCTAssertEqual(SliderFormatting.parse("12.5"), 12.5)
        XCTAssertEqual(SliderFormatting.parse("  32 "), 32)
        XCTAssertEqual(SliderFormatting.parse("-7"), -7)
        XCTAssertNil(SliderFormatting.parse(""))
        XCTAssertNil(SliderFormatting.parse("abc"))
        XCTAssertNil(SliderFormatting.parse("nan"))
    }
}

// MARK: - SliderMeta (diagnostics slug + lib defaults + useId)

final class SliderMetaTests: XCTestCase {
    func testSurfaceSlugAndDefaults() {
        XCTAssertEqual(SliderMeta.surfaceSlug, "Slider")
        XCTAssertEqual(SliderMeta.defaultStep, 1)
        XCTAssertEqual(SliderMeta.pageStepFraction, 0.1, accuracy: 1e-9)
        XCTAssertEqual(SliderMeta.identifierPrefix, "slider")
    }

    func testMakeIdentifierPrefersExplicitThenGenerates() {
        XCTAssertEqual(SliderMeta.makeIdentifier("custom-id"), "custom-id")
        XCTAssertTrue(SliderMeta.makeIdentifier(nil).hasPrefix("slider-"))
        XCTAssertTrue(SliderMeta.makeIdentifier("   ").hasPrefix("slider-"))
        XCTAssertNotEqual(SliderMeta.makeIdentifier(nil), SliderMeta.makeIdentifier(nil))
    }
}

// MARK: - SliderCommand (the WAI-ARIA APG key set)

final class SliderCommandTests: XCTestCase {
    func testAllCommandsPresent() {
        XCTAssertEqual(
            Set(SliderCommand.allCases),
            [.stepUp, .stepDown, .pageUp, .pageDown, .toMinimum, .toMaximum]
        )
    }
}

// MARK: - SliderAccessibility (labels + hint)

final class SliderAccessibilityTests: XCTestCase {
    func testNameAndValuePassThrough() {
        XCTAssertEqual(SliderAccessibility.label("Brightness"), "Brightness")
        XCTAssertEqual(SliderAccessibility.value("32 percent"), "32 percent")
    }

    func testHintResolvesKeyWithFallback() {
        XCTAssertEqual(SliderAccessibility.hint(strings: SliderStrings.string), "Swipe up or down to adjust the value.")
        XCTAssertEqual(SliderAccessibility.hint(strings: echoStrings), "[slider.accessibility.hint]")
    }
}
