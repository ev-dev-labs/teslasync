//
//  BatteryDelta.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0077 · BatteryDelta (Apple)
//
//  Pure-core coverage for the battery delta (the model + view-composition half lives in
//  BatteryDelta.Tests.swift; split to keep each file within the SwiftLint file-length budget). This
//  is the "adapter (cached → projection)" unit test the acceptance calls for: it drives the SoC
//  endpoints through ``BatteryDeltaProjector`` and asserts the verbatim port of the web `BatteryDelta`
//  render body, plus the value types it is built on:
//    • number  — JS template-literal stringification (integer / fractional / non-finite).
//    • variant — raw values, default, all cases (web `'compact' | 'pair'`).
//    • tone    — the emerald / amber / muted cases.
//    • inputs  — value equality (the `.onChange` key).
//    • slug    — the diagnostics identity.
//    • project — the no-data guard, the rise / drop / zero compact labels (U+2212 drop sign), the
//                pair labels (never dashed), and the a11y endpoints.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no model instance, so
//  each assertion reads the pure projection directly.
//

import XCTest
@testable import TeslaSync

// MARK: - BatteryDeltaNumber (web `${number}` stringification)

final class BatteryDeltaNumberTests: XCTestCase {
    func testIntegerValuesDropDecimals() {
        XCTAssertEqual(BatteryDeltaNumber.string(60), "60")
        XCTAssertEqual(BatteryDeltaNumber.string(54), "54")
        XCTAssertEqual(BatteryDeltaNumber.string(0), "0")
        XCTAssertEqual(BatteryDeltaNumber.string(1), "1")
    }

    func testNegativeAndNegativeZero() {
        XCTAssertEqual(BatteryDeltaNumber.string(-5), "-5", "web ${-5} → '-5' (ASCII minus)")
        XCTAssertEqual(BatteryDeltaNumber.string(-0.0), "0", "web ${-0} → '0'")
    }

    func testFractionalTrimsTrailingZeros() {
        XCTAssertEqual(BatteryDeltaNumber.string(78.5), "78.5")
        XCTAssertEqual(BatteryDeltaNumber.string(0.1), "0.1")
        XCTAssertEqual(BatteryDeltaNumber.string(12.25), "12.25")
    }

    func testNonFiniteIsEmpty() {
        XCTAssertEqual(BatteryDeltaNumber.string(.nan), "")
        XCTAssertEqual(BatteryDeltaNumber.string(.infinity), "")
        XCTAssertEqual(BatteryDeltaNumber.string(-.infinity), "")
    }
}

// MARK: - BatteryDeltaVariant (web `'compact' | 'pair'`)

final class BatteryDeltaVariantTests: XCTestCase {
    func testRawValuesMatchWebUnion() {
        XCTAssertEqual(BatteryDeltaVariant.compact.rawValue, "compact")
        XCTAssertEqual(BatteryDeltaVariant.pair.rawValue, "pair")
    }

    func testDefaultIsCompact() {
        XCTAssertEqual(BatteryDeltaVariant.defaultVariant, .compact, "web `variant = 'compact'`")
    }

    func testAllCases() {
        XCTAssertEqual(Set(BatteryDeltaVariant.allCases), [.compact, .pair])
    }
}

// MARK: - BatteryDeltaTone (web emerald / amber / muted)

final class BatteryDeltaToneTests: XCTestCase {
    func testAllCases() {
        XCTAssertEqual(Set(BatteryDeltaTone.allCases), [.positive, .negative, .neutral])
    }

    func testRawValues() {
        XCTAssertEqual(BatteryDeltaTone.positive.rawValue, "positive")
        XCTAssertEqual(BatteryDeltaTone.negative.rawValue, "negative")
        XCTAssertEqual(BatteryDeltaTone.neutral.rawValue, "neutral")
    }
}

// MARK: - BatteryDeltaSurface (diagnostics identity)

final class BatteryDeltaSurfaceTests: XCTestCase {
    func testSlug() {
        XCTAssertEqual(BatteryDeltaSurface.slug, "BatteryDelta")
    }
}

// MARK: - BatteryDeltaInputs (the `.onChange` key)

final class BatteryDeltaInputsTests: XCTestCase {
    func testDefaults() {
        let inputs = BatteryDeltaInputs(startPct: 10, endPct: 20)
        XCTAssertEqual(inputs.variant, .compact)
        XCTAssertTrue(inputs.showIcon)
    }

    func testEquality() {
        let base = BatteryDeltaInputs(startPct: 10, endPct: 20, variant: .pair, showIcon: false)
        XCTAssertEqual(base, BatteryDeltaInputs(startPct: 10, endPct: 20, variant: .pair, showIcon: false))
        XCTAssertNotEqual(base, BatteryDeltaInputs(startPct: 11, endPct: 20, variant: .pair, showIcon: false))
        XCTAssertNotEqual(base, BatteryDeltaInputs(startPct: 10, endPct: 20, variant: .compact, showIcon: false))
        XCTAssertNotEqual(base, BatteryDeltaInputs(startPct: 10, endPct: 20, variant: .pair, showIcon: true))
    }
}

// MARK: - BatteryDeltaProjector (web `BatteryDelta` render body)

final class BatteryDeltaProjectorTests: XCTestCase {
    func testRiseIsEmeraldPlusCompact() {
        let projection = BatteryDeltaProjector.resolve(startPct: 20, endPct: 80)
        XCTAssertTrue(projection.hasData)
        XCTAssertEqual(projection.tone, .positive)
        XCTAssertEqual(projection.displayText, "+60%")
        XCTAssertFalse(projection.showsDash)
        XCTAssertEqual(projection.accessibilityFrom, "20")
        XCTAssertEqual(projection.accessibilityTo, "80")
    }

    func testDropUsesUnicodeMinusAndAmber() {
        let projection = BatteryDeltaProjector.resolve(startPct: 90, endPct: 89)
        XCTAssertEqual(projection.tone, .negative)
        XCTAssertEqual(projection.displayText, "\u{2212}1%")
        XCTAssertFalse(projection.showsDash)
    }

    func testZeroCompactIsDashNeutral() {
        let projection = BatteryDeltaProjector.resolve(startPct: 80, endPct: 80)
        XCTAssertTrue(projection.hasData)
        XCTAssertEqual(projection.tone, .neutral)
        XCTAssertEqual(projection.displayText, "—")
        XCTAssertTrue(projection.showsDash)
    }

    func testFractionalDeltaKeepsDecimals() {
        let projection = BatteryDeltaProjector.resolve(startPct: 79.5, endPct: 78)
        XCTAssertEqual(projection.displayText, "\u{2212}1.5%")
        XCTAssertEqual(projection.tone, .negative)
    }

    func testPairAlwaysShowsBothEndpoints() {
        XCTAssertEqual(
            BatteryDeltaProjector.resolve(startPct: 20, endPct: 80, variant: .pair).displayText,
            "20% → 80%"
        )
        XCTAssertEqual(
            BatteryDeltaProjector.resolve(startPct: 79, endPct: 78, variant: .pair).displayText,
            "79% → 78%"
        )
    }

    func testPairNeverDashesEvenAtZero() {
        let projection = BatteryDeltaProjector.resolve(startPct: 80, endPct: 80, variant: .pair)
        XCTAssertEqual(projection.displayText, "80% → 80%")
        XCTAssertEqual(projection.tone, .neutral)
        XCTAssertFalse(projection.showsDash, "pair shows endpoints, never the compact dash")
    }

    func testPairFractionalEndpoints() {
        XCTAssertEqual(
            BatteryDeltaProjector.resolve(startPct: 79.5, endPct: 78, variant: .pair).displayText,
            "79.5% → 78%"
        )
    }

    func testMissingStartIsNoData() {
        let projection = BatteryDeltaProjector.resolve(startPct: nil, endPct: 80)
        XCTAssertFalse(projection.hasData)
        XCTAssertEqual(projection.displayText, "—")
        XCTAssertEqual(projection.tone, .neutral)
        XCTAssertNil(projection.accessibilityFrom)
        XCTAssertNil(projection.accessibilityTo)
    }

    func testMissingEndIsNoData() {
        XCTAssertFalse(BatteryDeltaProjector.resolve(startPct: 80, endPct: nil).hasData)
    }

    func testNonFiniteEndpointsAreNoData() {
        XCTAssertFalse(BatteryDeltaProjector.resolve(startPct: .nan, endPct: 80).hasData)
        XCTAssertFalse(BatteryDeltaProjector.resolve(startPct: 80, endPct: .infinity).hasData)
        XCTAssertFalse(BatteryDeltaProjector.resolve(startPct: -.infinity, endPct: 80).hasData)
    }

    func testNoDataKeepsRequestedVariant() {
        XCTAssertEqual(
            BatteryDeltaProjector.resolve(startPct: nil, endPct: nil, variant: .pair).variant,
            .pair
        )
    }
}
