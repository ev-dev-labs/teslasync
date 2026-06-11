//
//  Range.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0087 · Range (Apple)
//
//  Pure-core coverage for the Range surface (Foundation only, no view, no store):
//    • RangeType — the verbatim port of the web `rangeType === 'ideal' ? 'ideal' : 'rated'` coercion
//      (nil / unknown → rated) and the settings-string round trip.
//    • Selection — `selectPreferredRange`: rated picks `rated_range` + the rated label, ideal picks
//      `ideal_range` + the ideal label, a nil state yields a nil value but a stable label, and a
//      missing field yields a nil value.
//    • Formatting — the web `formatDistance` parity: `convertDistanceFromSI` factors (km / mi / ft +
//      unknown fallback), the precision precedence (override → preference → fallback 1, negatives
//      ignored), the locale fallback, the `Intl.NumberFormat` grouping (en_US vs de_DE) + half-away
//      rounding, the `emptyDisplay` fallback, and the non-finite / nil empty path.
//    • Meta — the diagnostics slug + the canonical SI factors / defaults.
//
//  Fixed `UnitPreferences` + locales are used so the conversion / grouping / decimal assertions are
//  deterministic regardless of the runner's region. The projection / model / view / telemetry coverage
//  lives in Range.Tests.swift.
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private func metricPrefs(
    precision: Int? = nil,
    locale: String? = "en-US",
    emptyDisplay: String? = nil
) -> UnitPreferences {
    UnitPreferences(
        distance: "km",
        speed: "km/h",
        temperature: "°C",
        pressure: "kPa",
        energy: "Wh",
        duration: "h",
        power: "W",
        locale: locale,
        precision: precision,
        emptyDisplay: emptyDisplay
    )
}

private func imperialPrefs(precision: Int? = nil, locale: String? = "en-US") -> UnitPreferences {
    UnitPreferences(
        distance: "mi",
        speed: "mph",
        temperature: "°F",
        pressure: "psi",
        energy: "kWh",
        duration: "min",
        power: "kW",
        locale: locale,
        precision: precision
    )
}

// MARK: - RangeType (web `useSettings().rangeType` coercion)

final class RangeTypeTests: XCTestCase {
    func testFromCoercesUnknownToRated() {
        XCTAssertEqual(RangeType.from(nil), .rated)
        XCTAssertEqual(RangeType.from("rated"), .rated)
        XCTAssertEqual(RangeType.from("ideal"), .ideal)
        XCTAssertEqual(RangeType.from("garbage"), .rated)
        XCTAssertEqual(RangeType.from(""), .rated)
    }

    func testRawValueRoundTrip() {
        XCTAssertEqual(RangeType.rated.rawValue, "rated")
        XCTAssertEqual(RangeType.ideal.rawValue, "ideal")
        XCTAssertEqual(RangeType(rawValue: "ideal"), .ideal)
    }
}

// MARK: - Selection (web `selectPreferredRange`)

final class RangeSelectionTests: XCTestCase {
    private let state = RangeState(ratedRangeMeters: 576_000, idealRangeMeters: 602_000)

    func testRatedSelectsRatedFieldAndLabel() {
        let selection = RangeSelection.selectPreferredRange(state: state, rangeType: .rated)
        XCTAssertEqual(selection.meters, 576_000)
        XCTAssertEqual(selection.source, .rated)
        XCTAssertEqual(selection.labelKey, "ratedRange")
        XCTAssertEqual(selection.defaultLabel, "Rated Range")
    }

    func testIdealSelectsIdealFieldAndLabel() {
        let selection = RangeSelection.selectPreferredRange(state: state, rangeType: .ideal)
        XCTAssertEqual(selection.meters, 602_000)
        XCTAssertEqual(selection.source, .ideal)
        XCTAssertEqual(selection.labelKey, "idealRange")
        XCTAssertEqual(selection.defaultLabel, "Ideal Range")
    }

    func testNilStateYieldsNilValueButStableLabel() {
        let selection = RangeSelection.selectPreferredRange(state: nil, rangeType: .ideal)
        XCTAssertNil(selection.meters)
        XCTAssertEqual(selection.source, .ideal)
        XCTAssertEqual(selection.labelKey, "idealRange")
        XCTAssertEqual(selection.defaultLabel, "Ideal Range")
    }

    func testMissingPreferredFieldYieldsNilValue() {
        let partial = RangeState(ratedRangeMeters: 576_000, idealRangeMeters: nil)
        let selection = RangeSelection.selectPreferredRange(state: partial, rangeType: .ideal)
        XCTAssertNil(selection.meters)
        XCTAssertEqual(selection.labelKey, "idealRange")
    }
}

// MARK: - Formatting (web `lib/unitConversion.ts` `formatDistance`)

final class RangeFormattingTests: XCTestCase {
    func testIsFiniteValueGuard() {
        XCTAssertTrue(RangeFormatting.isFiniteValue(12.5))
        XCTAssertTrue(RangeFormatting.isFiniteValue(0))
        XCTAssertFalse(RangeFormatting.isFiniteValue(nil))
        XCTAssertFalse(RangeFormatting.isFiniteValue(.nan))
        XCTAssertFalse(RangeFormatting.isFiniteValue(.infinity))
    }

    func testConvertDistanceFromSIFactors() {
        XCTAssertEqual(RangeFormatting.convertDistanceFromSI(1609.344, to: "mi"), 1, accuracy: 1e-9)
        XCTAssertEqual(RangeFormatting.convertDistanceFromSI(1000, to: "km"), 1, accuracy: 1e-9)
        XCTAssertEqual(RangeFormatting.convertDistanceFromSI(0.3048, to: "ft"), 1, accuracy: 1e-9)
    }

    func testConvertDistanceUnknownUnitDefaultsToKm() {
        XCTAssertEqual(RangeFormatting.convertDistanceFromSI(2000, to: "parsec"), 2, accuracy: 1e-9)
    }

    func testResolvePrecisionPrecedence() {
        // Override wins when finite + non-negative.
        XCTAssertEqual(RangeFormatting.resolvePrecision(override: 0, units: metricPrefs(precision: 3)), 0)
        XCTAssertEqual(RangeFormatting.resolvePrecision(override: 2, units: metricPrefs(precision: 3)), 2)
        // Negative override is ignored → falls to the preference.
        XCTAssertEqual(RangeFormatting.resolvePrecision(override: -1, units: metricPrefs(precision: 3)), 3)
        // No override → the preference when finite + non-negative.
        XCTAssertEqual(RangeFormatting.resolvePrecision(override: nil, units: metricPrefs(precision: 4)), 4)
        // Negative preference is ignored → the distance fallback (1).
        XCTAssertEqual(RangeFormatting.resolvePrecision(override: nil, units: metricPrefs(precision: -2)), 1)
        // No override + no preference → the distance fallback (1).
        XCTAssertEqual(RangeFormatting.resolvePrecision(override: nil, units: metricPrefs()), 1)
    }

    func testLocaleFallsBackToEnUSForBlankPreference() {
        XCTAssertEqual(RangeFormatting.locale(for: metricPrefs(locale: nil)).identifier, "en-US")
        XCTAssertEqual(RangeFormatting.locale(for: metricPrefs(locale: "  ")).identifier, "en-US")
        XCTAssertEqual(RangeFormatting.locale(for: metricPrefs(locale: "de_DE")).identifier, "de_DE")
    }

    func testFormatNumberGroupingAndFixedDigits() {
        let usLocale = Locale(identifier: "en_US")
        XCTAssertEqual(RangeFormatting.formatNumber(1234.5, digits: 1, locale: usLocale), "1,234.5")
        XCTAssertEqual(RangeFormatting.formatNumber(576, digits: 0, locale: usLocale), "576")
    }

    func testFormatNumberRoundsHalfAwayFromZero() {
        let usLocale = Locale(identifier: "en_US")
        XCTAssertEqual(RangeFormatting.formatNumber(320.5, digits: 0, locale: usLocale), "321")
        XCTAssertEqual(RangeFormatting.formatNumber(1.236, digits: 2, locale: usLocale), "1.24")
    }

    func testFormatNumberIsLocaleAware() {
        let deLocale = Locale(identifier: "de_DE")
        XCTAssertEqual(RangeFormatting.formatNumber(1234.5, digits: 1, locale: deLocale), "1.234,5")
    }

    func testResolveEmptyHonoursPreferenceOverride() {
        XCTAssertEqual(RangeFormatting.resolveEmpty(metricPrefs()), "—")
        XCTAssertEqual(RangeFormatting.resolveEmpty(metricPrefs(emptyDisplay: "n/a")), "n/a")
    }

    func testFormatDistanceValueAppendsUnitAtZeroPrecision() {
        XCTAssertEqual(
            RangeFormatting.formatDistance(meters: 576_000, units: metricPrefs(), precision: 0),
            "576 km"
        )
        XCTAssertEqual(
            RangeFormatting.formatDistance(meters: 576_000, units: imperialPrefs(), precision: 0),
            "358 mi"
        )
    }

    func testFormatDistanceFallbackPrecisionIsOneForDistance() {
        // No override + no preference → DEFAULT_PRECISION.distance (1).
        XCTAssertEqual(
            RangeFormatting.formatDistance(meters: 576_000, units: metricPrefs(), precision: nil),
            "576.0 km"
        )
    }

    func testFormatDistanceNonFiniteReturnsEmptyFallback() {
        XCTAssertEqual(RangeFormatting.formatDistance(meters: nil, units: metricPrefs(), precision: 0), "—")
        XCTAssertEqual(RangeFormatting.formatDistance(meters: .nan, units: metricPrefs(), precision: 0), "—")
        XCTAssertEqual(
            RangeFormatting.formatDistance(meters: .infinity, units: metricPrefs(emptyDisplay: "n/a"), precision: 0),
            "n/a"
        )
    }
}

// MARK: - Meta (diagnostics slug + canonical factors)

final class RangeMetaTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(RangeMeta.surfaceSlug, "Range")
        XCTAssertEqual(RangeReadout.surfaceSlug, "Range")
    }

    func testCanonicalFactorsAndDefaults() {
        XCTAssertEqual(RangeMeta.metersPerMile, 1609.344, accuracy: 1e-9)
        XCTAssertEqual(RangeMeta.metersPerKm, 1000, accuracy: 1e-9)
        XCTAssertEqual(RangeMeta.metersPerFoot, 0.3048, accuracy: 1e-9)
        XCTAssertEqual(RangeMeta.defaultDistancePrecision, 1)
        XCTAssertEqual(RangeMeta.emptyDisplay, "—")
        XCTAssertEqual(RangeMeta.fallbackLocaleIdentifier, "en-US")
    }
}
