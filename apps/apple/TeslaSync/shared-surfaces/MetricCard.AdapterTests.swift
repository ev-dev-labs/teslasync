//
//  MetricCard.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0095 · MetricCard (Apple)
//
//  Pure-core coverage for the metric card (the model + view-composition + facade half lives in
//  MetricCard.Tests.swift; split to keep each file within the SwiftLint file-length budget). This is
//  the "adapter (cached → projection)" unit test the acceptance calls for: it drives the props through
//  ``MetricCardProjector`` / ``MetricCardDeltaProjector`` and asserts the verbatim port of the web
//  `MetricCard` + `<Delta>` render bodies, plus the value types they are built on:
//    • number  — JS template-literal stringification (integer / fractional / negative / non-finite).
//    • value   — display text + the `Number(value)` finite-coercion feeding the delta fallback.
//    • color   — raw values, default, all cases (web `NeonColor`).
//    • format  — fixed-precision grouping + the `formatAbsolute` affix rules.
//    • change  — the "↑/↓ value" legacy pill.
//    • delta   — loading / empty / percent / absolute / both, tone + arrow, the previous==0 percent
//                fallback, hideArrow, and the current fallback.
//    • card    — value text + trend selection (delta wins over the legacy pill).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no model instance, so
//  each assertion reads the pure projection directly.
//

import XCTest
@testable import TeslaSync

// MARK: - MetricCardNumber (web `${value}` stringification)

final class MetricCardNumberTests: XCTestCase {
    func testIntegerValuesDropDecimals() {
        XCTAssertEqual(MetricCardNumber.string(60), "60")
        XCTAssertEqual(MetricCardNumber.string(48210), "48210")
        XCTAssertEqual(MetricCardNumber.string(0), "0")
        XCTAssertEqual(MetricCardNumber.string(-5), "-5")
        XCTAssertEqual(MetricCardNumber.string(-0.0), "0")
    }

    func testFractionalTrimsTrailingZeros() {
        XCTAssertEqual(MetricCardNumber.string(78.5), "78.5")
        XCTAssertEqual(MetricCardNumber.string(0.1), "0.1")
        XCTAssertEqual(MetricCardNumber.string(12.25), "12.25")
    }

    func testNonFiniteUsesJSSpelling() {
        XCTAssertEqual(MetricCardNumber.string(.nan), "NaN")
        XCTAssertEqual(MetricCardNumber.string(.infinity), "Infinity")
        XCTAssertEqual(MetricCardNumber.string(-.infinity), "-Infinity")
    }
}

// MARK: - MetricCardValue (web `value: string | number`)

final class MetricCardValueTests: XCTestCase {
    func testDisplayText() {
        XCTAssertEqual(MetricCardValue.number(48210).displayText, "48210")
        XCTAssertEqual(MetricCardValue.number(0.5).displayText, "0.5")
        XCTAssertEqual(MetricCardValue.text("48,210 km").displayText, "48,210 km")
    }

    func testFiniteNumericValueForNumbers() {
        XCTAssertEqual(MetricCardValue.number(312).finiteNumericValue, 312)
        XCTAssertNil(MetricCardValue.number(.nan).finiteNumericValue)
        XCTAssertNil(MetricCardValue.number(.infinity).finiteNumericValue)
    }

    func testFiniteNumericValueForStringsMatchesJSNumber() {
        XCTAssertEqual(MetricCardValue.text("42").finiteNumericValue, 42)
        XCTAssertEqual(MetricCardValue.text("3.14").finiteNumericValue, 3.14)
        XCTAssertEqual(MetricCardValue.text("").finiteNumericValue, 0, "JS Number('') === 0")
        XCTAssertEqual(MetricCardValue.text("   ").finiteNumericValue, 0, "JS Number('  ') === 0")
        XCTAssertNil(MetricCardValue.text("1,234").finiteNumericValue, "JS Number('1,234') is NaN")
        XCTAssertNil(MetricCardValue.text("abc").finiteNumericValue, "JS Number('abc') is NaN")
    }
}

// MARK: - MetricCardColor (web `NeonColor`)

final class MetricCardColorTests: XCTestCase {
    func testRawValuesMatchWebUnion() {
        XCTAssertEqual(MetricCardColor.cyan.rawValue, "cyan")
        XCTAssertEqual(MetricCardColor.blue.rawValue, "blue")
        XCTAssertEqual(MetricCardColor.allCases.count, 6)
    }

    func testDefaultIsCyan() {
        XCTAssertEqual(MetricCardColor.defaultColor, .cyan)
    }
}

// MARK: - MetricCardDeltaFormat (web `fmtNumber` / `formatAbsolute`)

final class MetricCardDeltaFormatTests: XCTestCase {
    func testFixedPrecisionWithGrouping() {
        XCTAssertEqual(MetricCardDeltaFormat.fixed(5, precision: 1), "5.0")
        XCTAssertEqual(MetricCardDeltaFormat.fixed(1234.5, precision: 1), "1,234.5")
        XCTAssertEqual(MetricCardDeltaFormat.fixed(0, precision: 2), "0.00")
    }

    func testAbsoluteAffixRules() {
        XCTAssertEqual(MetricCardDeltaFormat.absolute(13, prefix: "", suffix: "mi", precision: nil), "13.0 mi")
        XCTAssertEqual(MetricCardDeltaFormat.absolute(3.5, prefix: "$", suffix: "", precision: 2), "$3.50")
        XCTAssertEqual(MetricCardDeltaFormat.absolute(5, prefix: "", suffix: "%", precision: 1), "5.0%")
        XCTAssertEqual(MetricCardDeltaFormat.absolute(7, prefix: "", suffix: "", precision: 0), "7")
    }
}

// MARK: - MetricCardChangeProjector (web legacy pill)

final class MetricCardChangeProjectorTests: XCTestCase {
    func testUpAndDownGlyphs() {
        XCTAssertEqual(MetricCardChangeProjector.resolve(.init(value: "12%", positive: true)).text, "↑ 12%")
        XCTAssertEqual(MetricCardChangeProjector.resolve(.init(value: "5%", positive: false)).text, "↓ 5%")
    }
}

// MARK: - MetricCardDeltaProjector (web `<Delta>` render body)

final class MetricCardDeltaProjectorTests: XCTestCase {
    private func resolve(
        _ delta: MetricCardDelta,
        fallback: Double? = nil
    ) -> MetricCardDeltaProjection {
        MetricCardDeltaProjector.resolve(delta, fallbackCurrent: fallback)
    }

    func testLoadingArm() {
        let projection = resolve(.init(direction: .higherBetter, previous: 1, loading: true))
        guard case .loading = projection else { return XCTFail("expected loading") }
    }

    func testEmptyArmForMissingOrNonFinite() {
        if case .value = resolve(.init(direction: .higherBetter, previous: nil), fallback: 10) {
            XCTFail("nil previous should be empty")
        }
        if case .value = resolve(.init(direction: .higherBetter, previous: 10), fallback: nil) {
            XCTFail("nil current should be empty")
        }
        if case .value = resolve(.init(direction: .higherBetter, current: .nan, previous: 10)) {
            XCTFail("non-finite current should be empty")
        }
    }

    func testHigherBetterRiseIsSuccessUpPercent() {
        guard case let .value(value) = resolve(
            .init(direction: .higherBetter, previous: 298, unitSuffix: "mi"),
            fallback: 312
        ) else { return XCTFail("expected value") }
        XCTAssertEqual(value.tone, .success)
        XCTAssertEqual(value.arrow, .up)
        XCTAssertEqual(value.text, "4.7%")
        XCTAssertEqual(value.currentText, "312.00")
        XCTAssertEqual(value.previousText, "298.00")
    }

    func testLowerBetterDropIsSuccessDown() {
        guard case let .value(value) = resolve(
            .init(direction: .lowerBetter, current: 268, previous: 281)
        ) else { return XCTFail("expected value") }
        XCTAssertEqual(value.tone, .success)
        XCTAssertEqual(value.arrow, .down)
        XCTAssertEqual(value.text, "4.6%")
    }

    func testHigherBetterDropIsDanger() {
        guard case let .value(value) = resolve(
            .init(direction: .higherBetter, current: 290, previous: 298)
        ) else { return XCTFail("expected value") }
        XCTAssertEqual(value.tone, .danger)
        XCTAssertEqual(value.arrow, .down)
    }

    func testNeutralNonZeroIsSecondary() {
        guard case let .value(value) = resolve(
            .init(direction: .neutral, current: 20, previous: 18)
        ) else { return XCTFail("expected value") }
        XCTAssertEqual(value.tone, .secondary)
        XCTAssertEqual(value.arrow, .up)
    }

    func testZeroDeltaIsMutedRight() {
        guard case let .value(value) = resolve(
            .init(direction: .higherBetter, current: 100, previous: 100)
        ) else { return XCTFail("expected value") }
        XCTAssertEqual(value.tone, .muted)
        XCTAssertEqual(value.arrow, .right)
        XCTAssertEqual(value.text, "0.0%")
    }

    func testPreviousZeroPercentFallsBackToDash() {
        guard case let .value(value) = resolve(
            .init(direction: .higherBetter, current: 5, previous: 0)
        ) else { return XCTFail("expected value") }
        XCTAssertEqual(value.text, "—")
        XCTAssertEqual(value.arrow, .up)
        XCTAssertEqual(value.tone, .success)
    }

    func testAbsoluteAndBothDisplay() {
        guard case let .value(absolute) = resolve(
            .init(
                direction: .lowerBetter,
                current: 42.5,
                previous: 39,
                display: .absolute,
                unitPrefix: "$",
                precision: 2
            )
        ) else { return XCTFail("expected value") }
        XCTAssertEqual(absolute.text, "$3.50")
        XCTAssertEqual(absolute.tone, .danger)

        guard case let .value(both) = resolve(
            .init(direction: .higherBetter, current: 312, previous: 298, display: .both, unitSuffix: "mi")
        ) else { return XCTFail("expected value") }
        XCTAssertEqual(both.text, "14.0 mi (4.7%)")
    }

    func testHideArrow() {
        guard case let .value(value) = resolve(
            .init(direction: .higherBetter, current: 10, previous: 5, hideArrow: true)
        ) else { return XCTFail("expected value") }
        XCTAssertEqual(value.arrow, .hidden)
    }

    func testCurrentOverrideBeatsFallback() {
        guard case let .value(value) = resolve(
            .init(direction: .higherBetter, current: 400, previous: 298),
            fallback: 312
        ) else { return XCTFail("expected value") }
        XCTAssertEqual(value.currentText, "400.00")
    }
}

// MARK: - MetricCardProjector (whole card: value + trend selection)

final class MetricCardProjectorTests: XCTestCase {
    func testValueTextAndNoTrend() {
        let projection = MetricCardProjector.resolve(.init(label: "Range", value: .number(312)))
        XCTAssertEqual(projection.valueText, "312")
        XCTAssertEqual(projection.trend, .none)
    }

    func testChangePillWhenNoDelta() {
        let projection = MetricCardProjector.resolve(
            .init(label: "Range", value: .text("312 mi"), change: .init(value: "4%", positive: true))
        )
        guard case let .change(pill) = projection.trend else { return XCTFail("expected change") }
        XCTAssertEqual(pill.text, "↑ 4%")
    }

    func testDeltaWinsOverChange() {
        let projection = MetricCardProjector.resolve(.init(
            label: "Range",
            value: .number(312),
            change: .init(value: "4%", positive: true),
            delta: .init(direction: .higherBetter, previous: 298, unitSuffix: "mi")
        ))
        guard case let .delta(delta) = projection.trend else { return XCTFail("expected delta") }
        guard case let .value(value) = delta else { return XCTFail("expected populated delta") }
        XCTAssertEqual(value.text, "4.7%", "card value 312 feeds the delta current fallback")
    }
}
