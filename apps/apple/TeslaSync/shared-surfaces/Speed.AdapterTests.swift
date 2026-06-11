//
//  Speed.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0088 · Speed (Apple)
//
//  Pure-core coverage for the Speed surface (Foundation only, no view, no store):
//    • Conversion — the source-to-SI step (`mph * 0.44704`, `(kmh * 1000) / 3600`) and the SI-to-display
//      step (`convertSpeedFromSI`: km/h `mps * 3600 / 1000`, mph `mps * 3600 / 1609.344`), incl. the
//      exact round trips and the cross-unit case.
//    • Formatting — the `fmtNumber` parity (non-finite → zero, fraction-digit clamp, locale-aware
//      grouping en_US vs de_DE, half-up rounding) and the locale-neutral `value.toFixed(1)` title figure.
//    • Settings — the verbatim port of the `deriveSpeed` ternary ("mi" → mph, else km/h) + the global
//      precision default; the universal unit labels.
//    • Input — the source precedence (`mph` finite wins, non-finite `mph` falls through to `kmh`, zero is
//      a valid finite value, neither → nil), `effectivePrecision`, `speedUnit`, and the guard.
//    • Projection — the two render branches: the value branch (figure + display unit, raw + source unit
//      tooltip, incl. the cross-unit + locale + precision cases) and the fallback branch (no finite input
//      → glyph, no canonical) — the deterministic per-branch "snapshot".
//    • Meta — the diagnostics slug + the web defaults + the conversion constants.
//    • Accessibility — the spoken label equals the visible figure, or the fallback glyph.
//
//  Fixed locales are used so the grouping / decimal assertions are deterministic regardless of the
//  runner's region. The model / view / telemetry coverage lives in Speed.Tests.swift.
//

import Foundation
import XCTest

private let usLocale = Locale(identifier: "en_US")
private let deLocale = Locale(identifier: "de_DE")

// MARK: - Conversion (web source-to-SI + `convertSpeedFromSI`)

final class SpeedConversionTests: XCTestCase {
    func testMphToMps() {
        XCTAssertEqual(SpeedConversion.mphToMps(65), 29.0576, accuracy: 1e-9)
        XCTAssertEqual(SpeedConversion.mphToMps(0), 0, accuracy: 1e-12)
    }

    func testKilometersPerHourToMps() {
        XCTAssertEqual(SpeedConversion.kilometersPerHourToMps(100), 27.777_777_777_778, accuracy: 1e-9)
        XCTAssertEqual(SpeedConversion.kilometersPerHourToMps(0), 0, accuracy: 1e-12)
    }

    func testFromSIToMph() {
        XCTAssertEqual(SpeedConversion.fromSI(29.0576, to: .mph), 65, accuracy: 1e-6)
    }

    func testFromSIToKilometersPerHour() {
        XCTAssertEqual(SpeedConversion.fromSI(29.0576, to: .kilometersPerHour), 104.60736, accuracy: 1e-6)
    }

    func testMphRoundTripIsExact() {
        let mps = SpeedConversion.mphToMps(65)
        XCTAssertEqual(SpeedConversion.fromSI(mps, to: .mph), 65, accuracy: 1e-9)
    }

    func testKilometersPerHourRoundTripIsExact() {
        let mps = SpeedConversion.kilometersPerHourToMps(100)
        XCTAssertEqual(SpeedConversion.fromSI(mps, to: .kilometersPerHour), 100, accuracy: 1e-9)
    }

    func testCrossUnitConversion() {
        // 100 km/h is 62.137… mph; 65 mph is 104.607… km/h.
        let kmhMps = SpeedConversion.kilometersPerHourToMps(100)
        XCTAssertEqual(SpeedConversion.fromSI(kmhMps, to: .mph), 62.137_119_223_733, accuracy: 1e-6)
        let mphMps = SpeedConversion.mphToMps(65)
        XCTAssertEqual(SpeedConversion.fromSI(mphMps, to: .kilometersPerHour), 104.60736, accuracy: 1e-6)
    }
}

// MARK: - Formatting (web `fmtNumber` + `value.toFixed` parity)

final class SpeedFormattingTests: XCTestCase {
    func testSafeReplacesNonFiniteWithZero() {
        XCTAssertEqual(SpeedFormatting.safe(.nan), 0)
        XCTAssertEqual(SpeedFormatting.safe(.infinity), 0)
        XCTAssertEqual(SpeedFormatting.safe(-.infinity), 0)
        XCTAssertEqual(SpeedFormatting.safe(42.5), 42.5)
    }

    func testClampPrecisionToWebRange() {
        XCTAssertEqual(SpeedFormatting.clampPrecision(-5), 0)
        XCTAssertEqual(SpeedFormatting.clampPrecision(2), 2)
        XCTAssertEqual(SpeedFormatting.clampPrecision(99), SpeedMeta.maxFractionDigits)
    }

    func testNumberFixedFractionDigitsAndGrouping() {
        XCTAssertEqual(SpeedFormatting.number(1234.5, precision: 2, locale: usLocale), "1,234.50")
        XCTAssertEqual(SpeedFormatting.number(5000, precision: 2, locale: usLocale), "5,000.00")
    }

    func testNumberRoundsHalfAwayFromZero() {
        XCTAssertEqual(SpeedFormatting.number(12345.678, precision: 0, locale: usLocale), "12,346")
        XCTAssertEqual(SpeedFormatting.number(72.6, precision: 0, locale: usLocale), "73")
    }

    func testNumberIsLocaleAware() {
        XCTAssertEqual(SpeedFormatting.number(1234.5, precision: 2, locale: usLocale), "1,234.50")
        XCTAssertEqual(SpeedFormatting.number(1234.5, precision: 2, locale: deLocale), "1.234,50")
    }

    func testNumberNonFiniteRendersZero() {
        XCTAssertEqual(SpeedFormatting.number(.nan, precision: 2, locale: usLocale), "0.00")
    }

    func testFixedIsLocaleNeutralAtTitlePrecision() {
        // The title figure mirrors `value.toFixed(1)`: a dot decimal, no grouping, one fraction digit.
        XCTAssertEqual(SpeedFormatting.fixed(65, precision: SpeedMeta.titleFractionDigits), "65.0")
        XCTAssertEqual(SpeedFormatting.fixed(100, precision: SpeedMeta.titleFractionDigits), "100.0")
        XCTAssertEqual(SpeedFormatting.fixed(-42.7, precision: SpeedMeta.titleFractionDigits), "-42.7")
    }
}

// MARK: - Settings (web `deriveSpeed` ternary + global precision) + unit labels

final class SpeedDisplaySettingsTests: XCTestCase {
    func testMilesSelectsMph() {
        XCTAssertEqual(SpeedDisplaySettings(rawUnitOfLength: "mi").speedUnit, .mph)
    }

    func testKilometersSelectsKilometersPerHour() {
        XCTAssertEqual(SpeedDisplaySettings(rawUnitOfLength: "km").speedUnit, .kilometersPerHour)
    }

    func testNilOrUnknownSelectsKilometersPerHour() {
        XCTAssertEqual(SpeedDisplaySettings(rawUnitOfLength: nil).speedUnit, .kilometersPerHour)
        XCTAssertEqual(SpeedDisplaySettings(rawUnitOfLength: "furlong").speedUnit, .kilometersPerHour)
    }

    func testDefaultPrecision() {
        XCTAssertEqual(SpeedDisplaySettings().decimalPrecision, SpeedMeta.defaultPrecision)
    }

    func testUnitLabels() {
        XCTAssertEqual(SpeedUnitPref.mph.label, "mph")
        XCTAssertEqual(SpeedUnitPref.kilometersPerHour.label, "km/h")
    }
}

// MARK: - Input (source precedence + effective precision + guard)

final class SpeedInputTests: XCTestCase {
    func testMphWinsWhenFinite() {
        let source = SpeedInput(mph: 65, kmh: 100).resolvedSource
        XCTAssertEqual(source?.sourceUnit, .mph)
        XCTAssertEqual(source?.rawValue, 65)
        XCTAssertEqual(source?.mps ?? .nan, 29.0576, accuracy: 1e-9)
    }

    func testZeroMphIsFiniteAndWins() {
        // 0 is finite, so `mph: 0` takes the mph branch (web `Number.isFinite(0)` is true).
        let source = SpeedInput(mph: 0, kmh: 100).resolvedSource
        XCTAssertEqual(source?.sourceUnit, .mph)
        XCTAssertEqual(source?.rawValue, 0)
        XCTAssertEqual(source?.mps, 0)
    }

    func testNonFiniteMphFallsThroughToKmh() {
        for badMph in [Double.nan, .infinity, -.infinity] {
            let source = SpeedInput(mph: badMph, kmh: 100).resolvedSource
            XCTAssertEqual(source?.sourceUnit, .kilometersPerHour)
            XCTAssertEqual(source?.rawValue, 100)
        }
    }

    func testNilMphUsesKmh() {
        let source = SpeedInput(mph: nil, kmh: 100).resolvedSource
        XCTAssertEqual(source?.sourceUnit, .kilometersPerHour)
        XCTAssertEqual(source?.mps ?? .nan, 27.777_777_777_778, accuracy: 1e-9)
    }

    func testNeitherFiniteResolvesNil() {
        XCTAssertNil(SpeedInput(mph: nil, kmh: nil).resolvedSource)
        XCTAssertNil(SpeedInput(mph: .infinity, kmh: nil).resolvedSource)
        XCTAssertNil(SpeedInput(mph: .nan, kmh: .nan).resolvedSource)
    }

    func testEffectivePrecisionPropWins() {
        let input = SpeedInput(mph: 1, precision: 3, settings: SpeedDisplaySettings(decimalPrecision: 5))
        XCTAssertEqual(input.effectivePrecision, 3)
    }

    func testEffectivePrecisionFallsThroughToSettings() {
        let input = SpeedInput(mph: 1, settings: SpeedDisplaySettings(decimalPrecision: 4))
        XCTAssertEqual(input.effectivePrecision, 4)
        XCTAssertEqual(SpeedInput(mph: 1).effectivePrecision, SpeedMeta.defaultPrecision)
    }

    func testSpeedUnitFromSettings() {
        XCTAssertEqual(SpeedInput(mph: 1, settings: SpeedDisplaySettings(rawUnitOfLength: "mi")).speedUnit, .mph)
        XCTAssertEqual(SpeedInput(mph: 1).speedUnit, .kilometersPerHour)
    }

    func testHasRenderableValueGuard() {
        XCTAssertTrue(SpeedInput(mph: 65).hasRenderableValue)
        XCTAssertTrue(SpeedInput(mph: 0).hasRenderableValue)
        XCTAssertTrue(SpeedInput(kmh: 100).hasRenderableValue)
        XCTAssertFalse(SpeedInput(mph: nil, kmh: nil).hasRenderableValue)
        XCTAssertFalse(SpeedInput(mph: .nan, kmh: .infinity).hasRenderableValue)
    }

    func testDefaultsMatchWebProps() {
        let input = SpeedInput(mph: 5)
        XCTAssertNil(input.precision)
        XCTAssertNil(input.kmh)
        XCTAssertEqual(input.fallback, SpeedMeta.defaultFallback)
    }
}

// MARK: - Projection (the two render branches)

final class SpeedProjectionTests: XCTestCase {
    func testMphValueBranchImperialPreference() {
        let input = SpeedInput(mph: 65, settings: SpeedDisplaySettings(rawUnitOfLength: "mi"), locale: usLocale)
        let resolved = SpeedProjection.resolve(input)
        XCTAssertFalse(resolved.isFallback)
        XCTAssertEqual(resolved.text, "65.00 mph")
        XCTAssertEqual(resolved.canonical, "65.0 mph")
    }

    func testMphValueBranchMetricPreferenceConvertsCrossUnit() {
        // The figure renders in the km/h preference while the tooltip keeps the mph source.
        let input = SpeedInput(mph: 65, settings: SpeedDisplaySettings(rawUnitOfLength: "km"), locale: usLocale)
        let resolved = SpeedProjection.resolve(input)
        XCTAssertEqual(resolved.text, "104.61 km/h")
        XCTAssertEqual(resolved.canonical, "65.0 mph")
    }

    func testKmhValueBranchMetricPreference() {
        let input = SpeedInput(kmh: 100, settings: SpeedDisplaySettings(rawUnitOfLength: "km"), locale: usLocale)
        let resolved = SpeedProjection.resolve(input)
        XCTAssertEqual(resolved.text, "100.00 km/h")
        XCTAssertEqual(resolved.canonical, "100.0 km/h")
    }

    func testKmhValueBranchImperialPreferenceConverts() {
        let input = SpeedInput(kmh: 100, settings: SpeedDisplaySettings(rawUnitOfLength: "mi"), locale: usLocale)
        let resolved = SpeedProjection.resolve(input)
        XCTAssertEqual(resolved.text, "62.14 mph")
        XCTAssertEqual(resolved.canonical, "100.0 km/h")
    }

    func testValueBranchIsLocaleAwareButTitleIsNeutral() {
        let input = SpeedInput(mph: 65, settings: SpeedDisplaySettings(rawUnitOfLength: "km"), locale: deLocale)
        let resolved = SpeedProjection.resolve(input)
        XCTAssertEqual(resolved.text, "104,61 km/h")
        XCTAssertEqual(resolved.canonical, "65.0 mph")
    }

    func testValueBranchHonorsPrecisionOverride() {
        let input = SpeedInput(
            mph: 72.6,
            precision: 0,
            settings: SpeedDisplaySettings(rawUnitOfLength: "mi"),
            locale: usLocale
        )
        let resolved = SpeedProjection.resolve(input)
        XCTAssertEqual(resolved.text, "73 mph")
        XCTAssertEqual(resolved.canonical, "72.6 mph")
    }

    func testValueBranchGroupsLargeFigures() {
        let input = SpeedInput(kmh: 5000, settings: SpeedDisplaySettings(rawUnitOfLength: "km"), locale: usLocale)
        XCTAssertEqual(SpeedProjection.resolve(input).text, "5,000.00 km/h")
    }

    func testFallbackBranchForNoValue() {
        let resolved = SpeedProjection.resolve(SpeedInput(mph: nil, kmh: nil))
        XCTAssertTrue(resolved.isFallback)
        XCTAssertEqual(resolved.text, "—")
        XCTAssertNil(resolved.canonical)
    }

    func testFallbackBranchForNonFinite() {
        let resolved = SpeedProjection.resolve(SpeedInput(mph: .nan, kmh: .infinity))
        XCTAssertTrue(resolved.isFallback)
        XCTAssertEqual(resolved.text, "—")
        XCTAssertNil(resolved.canonical)
    }

    func testFallbackBranchUsesCustomFallbackString() {
        let resolved = SpeedProjection.resolve(SpeedInput(mph: nil, fallback: "n/a"))
        XCTAssertEqual(resolved.text, "n/a")
        XCTAssertTrue(resolved.isFallback)
    }
}

// MARK: - Meta (diagnostics slug + web defaults + constants)

final class SpeedMetaTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(SpeedMeta.surfaceSlug, "Speed")
        XCTAssertEqual(Speed.surfaceSlug, "Speed")
    }

    func testWebDefaults() {
        XCTAssertEqual(SpeedMeta.defaultFallback, "—")
        XCTAssertEqual(SpeedMeta.defaultPrecision, 2)
        XCTAssertEqual(SpeedMeta.maxFractionDigits, 20)
        XCTAssertEqual(SpeedMeta.titleFractionDigits, 1)
    }

    func testConversionConstants() {
        XCTAssertEqual(SpeedMeta.metersPerMile, 1609.344)
        XCTAssertEqual(SpeedMeta.metersPerKilometer, 1000)
        XCTAssertEqual(SpeedMeta.secondsPerHour, 3600)
        XCTAssertEqual(SpeedMeta.mpsPerMph, 0.44704)
    }
}

// MARK: - Accessibility (visible figure / fallback)

final class SpeedAccessibilityTests: XCTestCase {
    func testLabelEqualsVisibleFigure() {
        let input = SpeedInput(mph: 65, settings: SpeedDisplaySettings(rawUnitOfLength: "mi"), locale: usLocale)
        XCTAssertEqual(SpeedAccessibility.label(input), "65.00 mph")
        XCTAssertEqual(SpeedAccessibility.label(input), SpeedProjection.resolve(input).text)
    }

    func testLabelEqualsFallbackForNoValue() {
        XCTAssertEqual(SpeedAccessibility.label(SpeedInput(mph: nil, kmh: nil)), "—")
        XCTAssertEqual(SpeedAccessibility.label(SpeedInput(mph: .nan, fallback: "n/a")), "n/a")
    }
}

@testable import TeslaSync
