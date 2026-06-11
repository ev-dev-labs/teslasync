//
//  Temperature.Tests.swift
//  TeslaSync — P4 shared surface · 0089 · Temperature (Apple)
//
//  Coverage for the Temperature surface:
//    • Formatting — the web `convertTempFromSI` factors (°C identity, °F affine + unknown fallback),
//      the `((f - 32) * 5) / 9` Fahrenheit normalization, the `fmtNumber` parity (fixed fraction
//      digits, locale grouping en_US vs de_DE, half-away rounding), the precision precedence (prop →
//      preference → default, clamped 0...20), the locale fallback, the `c`-first source normalization
//      to SI Celsius, and the `value.toFixed(1)` tooltip.
//    • Projection — the deterministic per-state "snapshot": the value branch (metric identity +
//      imperial conversion + Fahrenheit input), the celsius-over-fahrenheit precedence, the non-finite
//      fall through, the precision override (note: the display has NO separating space, e.g. "20°C"),
//      and the empty sentinel branch.
//    • Meta — the diagnostics slug + the canonical unit labels / defaults.
//    • Accessibility — the value label equals the figure; the empty label resolves the i18n key.
//    • Model — the resolved projection, `sync` adoption + idempotence, the once-only `view.opened`
//      telemetry, and the no-op stop.
//    • Views — the public surface + subviews compose (signature contract).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so each
//  assertion reads the pure adapter / projection / model directly. Fixed `UnitPreferences` + locales
//  are used so the conversion / grouping / decimal assertions are deterministic regardless of region.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private func metricPrefs(precision: Int? = nil, locale: String? = "en-US") -> UnitPreferences {
    UnitPreferences(
        distance: "km",
        speed: "km/h",
        temperature: "°C",
        pressure: "kPa",
        energy: "Wh",
        duration: "h",
        power: "W",
        locale: locale,
        precision: precision
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

// MARK: - Formatting (web `convertTempFromSI` + `fmtNumber` parity)

final class TemperatureFormattingTests: XCTestCase {
    func testSafeReplacesNonFiniteWithZero() {
        XCTAssertEqual(TemperatureFormatting.safe(.nan), 0)
        XCTAssertEqual(TemperatureFormatting.safe(.infinity), 0)
        XCTAssertEqual(TemperatureFormatting.safe(-.infinity), 0)
        XCTAssertEqual(TemperatureFormatting.safe(42.5), 42.5)
    }

    func testIsFiniteValueGuard() {
        XCTAssertTrue(TemperatureFormatting.isFiniteValue(12.5))
        XCTAssertFalse(TemperatureFormatting.isFiniteValue(nil))
        XCTAssertFalse(TemperatureFormatting.isFiniteValue(.nan))
        XCTAssertFalse(TemperatureFormatting.isFiniteValue(.infinity))
    }

    func testConvertTempFromSICelsiusIsIdentity() {
        XCTAssertEqual(TemperatureFormatting.convertTempFromSI(0, to: "°C"), 0, accuracy: 1e-9)
        XCTAssertEqual(TemperatureFormatting.convertTempFromSI(20, to: "°C"), 20, accuracy: 1e-9)
        XCTAssertEqual(TemperatureFormatting.convertTempFromSI(-40, to: "°C"), -40, accuracy: 1e-9)
    }

    func testConvertTempFromSIFahrenheitIsAffine() {
        XCTAssertEqual(TemperatureFormatting.convertTempFromSI(0, to: "°F"), 32, accuracy: 1e-9)
        XCTAssertEqual(TemperatureFormatting.convertTempFromSI(100, to: "°F"), 212, accuracy: 1e-9)
        XCTAssertEqual(TemperatureFormatting.convertTempFromSI(20, to: "°F"), 68, accuracy: 1e-9)
        XCTAssertEqual(TemperatureFormatting.convertTempFromSI(-40, to: "°F"), -40, accuracy: 1e-9)
    }

    func testConvertTempUnknownUnitDefaultsToCelsius() {
        XCTAssertEqual(TemperatureFormatting.convertTempFromSI(25, to: "K"), 25, accuracy: 1e-9)
    }

    func testFahrenheitToCelsius() {
        XCTAssertEqual(TemperatureFormatting.fahrenheitToCelsius(32), 0, accuracy: 1e-9)
        XCTAssertEqual(TemperatureFormatting.fahrenheitToCelsius(212), 100, accuracy: 1e-9)
        XCTAssertEqual(TemperatureFormatting.fahrenheitToCelsius(68), 20, accuracy: 1e-9)
        XCTAssertEqual(TemperatureFormatting.fahrenheitToCelsius(-40), -40, accuracy: 1e-9)
    }

    func testResolveDigitsPrecedenceAndClamp() {
        XCTAssertEqual(TemperatureFormatting.resolveDigits(precision: 3, units: metricPrefs(precision: 4)), 3)
        XCTAssertEqual(TemperatureFormatting.resolveDigits(precision: nil, units: metricPrefs(precision: 4)), 4)
        XCTAssertEqual(TemperatureFormatting.resolveDigits(precision: nil, units: metricPrefs()), 2)
        XCTAssertEqual(TemperatureFormatting.resolveDigits(precision: 99, units: metricPrefs()), 20)
        XCTAssertEqual(TemperatureFormatting.resolveDigits(precision: -5, units: metricPrefs()), 0)
    }

    func testLocaleFallsBackToEnUSForBlankPreference() {
        XCTAssertEqual(TemperatureFormatting.locale(for: metricPrefs(locale: nil)).identifier, "en-US")
        XCTAssertEqual(TemperatureFormatting.locale(for: metricPrefs(locale: "  ")).identifier, "en-US")
        XCTAssertEqual(TemperatureFormatting.locale(for: metricPrefs(locale: "de_DE")).identifier, "de_DE")
    }

    func testFormatNumberFixedFractionDigits() {
        let usLocale = Locale(identifier: "en_US")
        XCTAssertEqual(TemperatureFormatting.formatNumber(1234.5, digits: 2, locale: usLocale), "1,234.50")
        XCTAssertEqual(TemperatureFormatting.formatNumber(1234, digits: 0, locale: usLocale), "1,234")
    }

    func testFormatNumberRoundsHalfAwayFromZero() {
        let usLocale = Locale(identifier: "en_US")
        XCTAssertEqual(TemperatureFormatting.formatNumber(1.236, digits: 2, locale: usLocale), "1.24")
        XCTAssertEqual(TemperatureFormatting.formatNumber(1.234, digits: 2, locale: usLocale), "1.23")
    }

    func testFormatNumberIsLocaleAware() {
        let deLocale = Locale(identifier: "de_DE")
        XCTAssertEqual(TemperatureFormatting.formatNumber(1234.5, digits: 2, locale: deLocale), "1.234,50")
    }

    func testSourceUsesCelsiusFirstAndBuildsTooltip() {
        let source = TemperatureFormatting.source(celsius: 21.5, fahrenheit: nil)
        XCTAssertEqual(source?.celsius ?? 0, 21.5, accuracy: 1e-9)
        XCTAssertEqual(source?.title, "21.5 °C")
    }

    func testSourceFallsBackToFahrenheit() {
        let source = TemperatureFormatting.source(celsius: nil, fahrenheit: 68)
        XCTAssertEqual(source?.celsius ?? 0, 20, accuracy: 1e-9)
        XCTAssertEqual(source?.title, "68.0 °F")
    }

    func testSourceCelsiusWinsWhenBothSupplied() {
        let source = TemperatureFormatting.source(celsius: 21.5, fahrenheit: 68)
        XCTAssertEqual(source?.title, "21.5 °C")
    }

    func testSourceSkipsNonFiniteCelsiusAndUsesFahrenheit() {
        let source = TemperatureFormatting.source(celsius: .nan, fahrenheit: 50)
        XCTAssertEqual(source?.title, "50.0 °F")
    }

    func testSourceIsNilWhenNeitherInputFinite() {
        XCTAssertNil(TemperatureFormatting.source(celsius: nil, fahrenheit: nil))
        XCTAssertNil(TemperatureFormatting.source(celsius: .infinity, fahrenheit: .nan))
    }

    func testDisplayConvertsCelsiusToUserUnit() {
        XCTAssertEqual(
            TemperatureFormatting.display(celsius: 20, units: metricPrefs(), precision: nil),
            "20.00°C"
        )
        XCTAssertEqual(
            TemperatureFormatting.display(celsius: 20, units: imperialPrefs(), precision: nil),
            "68.00°F"
        )
        XCTAssertEqual(
            TemperatureFormatting.display(celsius: 20, units: metricPrefs(), precision: 0),
            "20°C"
        )
    }
}

// MARK: - Projection (deterministic per-state snapshot)

final class TemperatureProjectionTests: XCTestCase {
    func testValueBranchInMetric() {
        let input = TemperatureInput(celsius: 20, precision: 0, units: metricPrefs())
        let resolved = TemperatureProjection.resolve(input)
        guard case let .value(value) = resolved.phase else { return XCTFail("expected value branch") }
        XCTAssertEqual(value.text, "20°C")
        XCTAssertEqual(value.rawValueTitle, "20.0 °C")
        XCTAssertEqual(value.accessibilityLabel, "20°C")
        XCTAssertFalse(resolved.isEmpty)
    }

    func testValueBranchImperialConversion() {
        let input = TemperatureInput(celsius: 20, precision: 0, units: imperialPrefs())
        XCTAssertEqual(TemperatureProjection.resolve(input).displayText, "68°F")
    }

    func testValueBranchFahrenheitInput() {
        let input = TemperatureInput(fahrenheit: 68, precision: 0, units: metricPrefs())
        let resolved = TemperatureProjection.resolve(input)
        guard case let .value(value) = resolved.phase else { return XCTFail("expected value branch") }
        XCTAssertEqual(value.text, "20°C")
        XCTAssertEqual(value.rawValueTitle, "68.0 °F")
    }

    func testValueBranchCelsiusWinsOverFahrenheit() {
        let input = TemperatureInput(celsius: 20, fahrenheit: 99, precision: 0, units: metricPrefs())
        XCTAssertEqual(TemperatureProjection.resolve(input).displayText, "20°C")
    }

    func testValueBranchSkipsNonFiniteCelsius() {
        let input = TemperatureInput(celsius: .nan, fahrenheit: 68, precision: 0, units: metricPrefs())
        XCTAssertEqual(TemperatureProjection.resolve(input).displayText, "20°C")
    }

    func testPrecisionOverrideIsApplied() {
        let input = TemperatureInput(celsius: 20.456, precision: 1, units: metricPrefs())
        XCTAssertEqual(TemperatureProjection.resolve(input).displayText, "20.5°C")
    }

    func testSubZeroValueBranch() {
        let input = TemperatureInput(celsius: -12.34, precision: 1, units: metricPrefs())
        XCTAssertEqual(TemperatureProjection.resolve(input).displayText, "-12.3°C")
    }

    func testEmptyBranchRendersSentinel() {
        let resolved = TemperatureProjection.resolve(TemperatureInput(units: metricPrefs()))
        guard case let .empty(empty) = resolved.phase else { return XCTFail("expected empty branch") }
        XCTAssertEqual(empty.text, "—")
        XCTAssertEqual(empty.accessibilityLabel, "No temperature data")
        XCTAssertTrue(resolved.isEmpty)
    }
}

// MARK: - Meta (diagnostics slug + canonical labels)

final class TemperatureMetaTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(TemperatureMeta.surfaceSlug, "Temperature")
        XCTAssertEqual(Temperature.surfaceSlug, "Temperature")
    }

    func testCanonicalLabelsAndDefaults() {
        XCTAssertEqual(TemperatureMeta.celsiusLabel, "°C")
        XCTAssertEqual(TemperatureMeta.fahrenheitLabel, "°F")
        XCTAssertEqual(TemperatureMeta.defaultPrecision, 2)
        XCTAssertEqual(TemperatureMeta.maxFractionDigits, 20)
        XCTAssertEqual(TemperatureMeta.titleFractionDigits, 1)
        XCTAssertEqual(TemperatureMeta.emptyDisplay, "—")
    }
}

// MARK: - Accessibility (labels)

final class TemperatureAccessibilityTests: XCTestCase {
    func testValueLabelEqualsDisplay() {
        XCTAssertEqual(TemperatureAccessibility.valueLabel("20°C"), "20°C")
    }

    func testEmptyLabelResolvesKeyWithFallback() {
        XCTAssertEqual(TemperatureAccessibility.emptyLabel(), "No temperature data")
        let custom: TemperatureResolve = { key, _ in "[\(key)]" }
        XCTAssertEqual(
            TemperatureAccessibility.emptyLabel(strings: custom),
            "[temperature.empty.accessibilityLabel]"
        )
    }
}

// MARK: - Model (state-holder)

@MainActor
final class TemperatureModelTests: XCTestCase {
    func testResolvedProjectsInput() {
        let model = TemperatureModel(
            input: TemperatureInput(celsius: 20, precision: 0, units: metricPrefs()),
            telemetry: SpyTemperatureTelemetry()
        )
        XCTAssertEqual(model.resolved.displayText, "20°C")
    }

    func testSyncAdoptsNewInput() {
        let model = TemperatureModel(
            input: TemperatureInput(celsius: 1, precision: 0, units: metricPrefs()),
            telemetry: SpyTemperatureTelemetry()
        )
        model.sync(TemperatureInput(celsius: 20, precision: 0, units: metricPrefs()))
        XCTAssertEqual(model.resolved.displayText, "20°C")
    }

    func testSyncToEmptyBranch() {
        let model = TemperatureModel(
            input: TemperatureInput(celsius: 1, units: metricPrefs()),
            telemetry: SpyTemperatureTelemetry()
        )
        model.sync(TemperatureInput(units: metricPrefs()))
        XCTAssertTrue(model.resolved.isEmpty)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyTemperatureTelemetry()
        let model = TemperatureModel(input: TemperatureInput(celsius: 1, units: metricPrefs()), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [TemperatureMeta.surfaceSlug])
    }

    func testStopIsSafeAndDoesNotEmit() {
        let spy = SpyTemperatureTelemetry()
        let model = TemperatureModel(input: TemperatureInput(celsius: 1, units: metricPrefs()), telemetry: spy)
        model.start()
        model.stop()
        model.stop()
        XCTAssertEqual(spy.surfaces, [TemperatureMeta.surfaceSlug])
    }
}

// MARK: - Views (every form composes — signature contract)

@MainActor
final class TemperatureViewTests: XCTestCase {
    func testPublicSurfacesCompose() {
        _ = Temperature(celsius: 21.5)
        _ = Temperature(fahrenheit: 68, precision: 1)
        _ = Temperature()
        _ = Temperature(
            input: TemperatureInput(celsius: 1, units: metricPrefs()),
            telemetry: SpyTemperatureTelemetry()
        )
    }

    func testSubviewsCompose() {
        _ = TemperatureValueView(value: TemperatureResolvedValue(
            text: "20°C",
            rawValueTitle: "20.0 °C",
            accessibilityLabel: "20°C"
        ))
        _ = TemperatureEmptyView(empty: TemperatureResolvedEmpty(
            text: "—",
            accessibilityLabel: "No temperature data"
        ))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyTemperatureTelemetry: TemperatureTelemetry, @unchecked Sendable {
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
