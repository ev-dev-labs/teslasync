//
//  RegexTester.Tests.swift
//  TeslaSync — P4 feature view · 0019 · RegexTester (Apple)
//
//  Unit coverage for the RegexTester surface:
//    • Adapter (input → outcome) — `RegexEvaluator` parity with the web
//      `new RegExp` + `exec` loop + `try/catch`, plus `RegexFlags` option mapping
//      and `RegexOutcome` flags.
//    • Projection / accessibility — the dynamic label + VoiceOver summary builders.
//    • State holder — `RegexTesterModel` outcome derivation, flag switching, and
//      the P1/S11 `view.opened` telemetry.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  bundle: the adapter + model are pure, driven directly.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: input → outcome (port parity with new RegExp + exec)

@MainActor final class RegexEvaluatorTests: XCTestCase {
    func testEmptyPatternOrTestIsIdle() {
        XCTAssertEqual(RegexEvaluator.evaluate(pattern: "", flags: .global, test: "abc"), .idle)
        XCTAssertEqual(RegexEvaluator.evaluate(pattern: "\\d+", flags: .global, test: ""), .idle)
        XCTAssertEqual(RegexEvaluator.evaluate(pattern: "", flags: .global, test: ""), .idle)
    }

    func testGlobalCollectsEveryMatchWithIndices() {
        let outcome = RegexEvaluator.evaluate(pattern: "\\d+", flags: .global, test: "a1bb22c333")
        XCTAssertEqual(outcome.matches, [
            RegexMatch(ordinal: 1, index: 1, text: "1"),
            RegexMatch(ordinal: 2, index: 4, text: "22"),
            RegexMatch(ordinal: 3, index: 7, text: "333")
        ])
    }

    func testNonGlobalReturnsOnlyFirstMatch() {
        let outcome = RegexEvaluator.evaluate(pattern: "\\d+", flags: .none, test: "a1bb22")
        XCTAssertEqual(outcome.matches, [RegexMatch(ordinal: 1, index: 1, text: "1")])
    }

    func testCaseInsensitiveFlag() {
        let outcome = RegexEvaluator.evaluate(pattern: "abc", flags: .globalCaseInsensitive, test: "ABcabC")
        XCTAssertEqual(outcome.matches.map(\.text), ["ABc", "abC"])
        XCTAssertEqual(outcome.matches.map(\.index), [0, 3])
    }

    func testMultilineFlagAnchorsEachLine() {
        let outcome = RegexEvaluator.evaluate(pattern: "^\\w+", flags: .globalMultiline, test: "foo\nbar")
        XCTAssertEqual(outcome.matches.map(\.text), ["foo", "bar"])
        XCTAssertEqual(outcome.matches.map(\.index), [0, 4])
    }

    func testNonMultilineCaretAnchorsWholeStringOnly() {
        // Without the `m` flag, `^` matches only at index 0 (JS no-multiline).
        let outcome = RegexEvaluator.evaluate(pattern: "^\\w+", flags: .global, test: "foo\nbar")
        XCTAssertEqual(outcome.matches.map(\.text), ["foo"])
    }

    func testZeroWidthMatchBreaksLikeWeb() {
        // web: pushes the trailing empty match once, then `if (!m[0]) break`.
        let outcome = RegexEvaluator.evaluate(pattern: "x*", flags: .global, test: "xxabc")
        XCTAssertEqual(outcome.matches, [
            RegexMatch(ordinal: 1, index: 0, text: "xx"),
            RegexMatch(ordinal: 2, index: 2, text: "")
        ])
    }

    func testInvalidPatternIsEvaluatedEmptyNotIdle() {
        // web `catch` returns [] — distinct from the no-input idle state.
        let outcome = RegexEvaluator.evaluate(pattern: "(unclosed", flags: .global, test: "anything")
        XCTAssertEqual(outcome, .evaluated([]))
        XCTAssertTrue(outcome.isNoMatch)
        XCTAssertEqual(outcome.count, 0)
    }

    func testValidPatternNoHits() {
        let outcome = RegexEvaluator.evaluate(pattern: "zzz", flags: .global, test: "nothing here")
        XCTAssertEqual(outcome, .evaluated([]))
        XCTAssertTrue(outcome.isNoMatch)
    }
}

// MARK: - Flags + outcome value semantics

@MainActor final class RegexFlagsTests: XCTestCase {
    func testIsGlobal() {
        XCTAssertTrue(RegexFlags.global.isGlobal)
        XCTAssertTrue(RegexFlags.globalCaseInsensitive.isGlobal)
        XCTAssertTrue(RegexFlags.globalAll.isGlobal)
        XCTAssertFalse(RegexFlags.none.isGlobal)
    }

    func testOptionMapping() {
        XCTAssertEqual(RegexFlags.global.options, [])
        XCTAssertEqual(RegexFlags.globalCaseInsensitive.options, [.caseInsensitive])
        XCTAssertEqual(RegexFlags.globalMultiline.options, [.anchorsMatchLines])
        XCTAssertEqual(RegexFlags.globalAll.options, [.caseInsensitive, .anchorsMatchLines])
        XCTAssertEqual(RegexFlags.none.options, [])
    }

    func testRawValuesMatchWebFlagStrings() {
        XCTAssertEqual(RegexFlags.allCases.map(\.rawValue), ["g", "gi", "gm", "gim", ""])
    }

    func testOutcomeAccessors() {
        let matches = [RegexMatch(ordinal: 1, index: 0, text: "a")]
        XCTAssertEqual(RegexOutcome.evaluated(matches).matches, matches)
        XCTAssertEqual(RegexOutcome.evaluated(matches).count, 1)
        XCTAssertFalse(RegexOutcome.evaluated(matches).isNoMatch)
        XCTAssertEqual(RegexOutcome.idle.count, 0)
        XCTAssertEqual(RegexOutcome.idle.matches, [])
        XCTAssertFalse(RegexOutcome.idle.isNoMatch)
    }
}

// MARK: - Projection + accessibility (bundle-free localizer)

@MainActor final class RegexProjectionTests: XCTestCase {
    /// English-fallback localizer (bundle-free).
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testCountLabel() {
        XCTAssertEqual(RegexProjection.countLabel(count: 3, localize: echo), "3 Matches")
        XCTAssertEqual(RegexProjection.countLabel(count: 0, localize: echo), "0 Matches")
    }

    func testPositionLabel() {
        XCTAssertEqual(RegexProjection.positionLabel(index: 5, localize: echo), "At Index 5")
    }

    func testSummaryIdle() {
        let summary = RegexAccessibility.summary(outcome: .idle, localize: echo)
        XCTAssertEqual(summary, "Enter a pattern and a test string to find matches")
    }

    func testSummaryWithMatchesIncludesCountTextAndPosition() {
        let outcome = RegexOutcome.evaluated([RegexMatch(ordinal: 1, index: 2, text: "42")])
        let summary = RegexAccessibility.summary(outcome: outcome, localize: echo)
        XCTAssertTrue(summary.contains("1 Matches"))
        XCTAssertTrue(summary.contains("42"))
        XCTAssertTrue(summary.contains("At Index 2"))
    }

    func testSummaryNoMatch() {
        let summary = RegexAccessibility.summary(outcome: .evaluated([]), localize: echo)
        XCTAssertTrue(summary.contains("0 Matches"))
        XCTAssertTrue(summary.contains("No matches"))
    }
}

// MARK: - State holder: RegexTesterModel

@MainActor final class RegexTesterModelTests: XCTestCase {
    func testOutcomeFollowsInputs() {
        let model = RegexTesterModel(
            pattern: "\\d+",
            flags: .global,
            testString: "a1b2",
            telemetry: SpyRegexTelemetry()
        )
        XCTAssertEqual(model.matchCount, 2)
        model.testString = ""
        XCTAssertEqual(model.outcome, .idle)
    }

    func testSelectSwitchesFlagAndRederives() {
        let model = RegexTesterModel(pattern: "a", flags: .global, testString: "AaA", telemetry: SpyRegexTelemetry())
        XCTAssertEqual(model.matchCount, 1)
        model.select(.globalCaseInsensitive)
        XCTAssertEqual(model.flags, .globalCaseInsensitive)
        XCTAssertEqual(model.matchCount, 3)
    }

    func testInvalidPatternSurfacesNoMatch() {
        let model = RegexTesterModel(pattern: "[", flags: .global, testString: "abc", telemetry: SpyRegexTelemetry())
        XCTAssertEqual(model.outcome, .evaluated([]))
        XCTAssertTrue(model.outcome.isNoMatch)
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpyRegexTelemetry()
        let model = RegexTesterModel(telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [RegexSurface.slug])
        XCTAssertEqual(RegexSurface.slug, "RegexTester")
    }
}

// MARK: - Telemetry spy

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpyRegexTelemetry: RegexTesterTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
