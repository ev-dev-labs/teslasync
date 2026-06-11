//
//  Distance.Tests.swift
//  TeslaSync — P4 shared surface · 0085 · Distance (Apple)
//
//  Coverage for the Distance surface:
//    • Formatting — the web `convertDistanceFromSI` factors (km / mi / ft + unknown fallback), the
//      `fmtNumber` parity (fixed fraction digits, locale grouping en_US vs de_DE, half-away rounding),
//      the precision precedence (prop → preference → default, clamped 0...20), the locale fallback, the
//      `miles`-first source normalization to SI metres, and the `value.toFixed(2)` tooltip.
//    • Projection — the deterministic per-state "snapshot": the value branch (metric conversion +
//      imperial round-trip + kilometre input), the miles-over-km precedence, the non-finite fall
//      through, and the empty sentinel branch.
//    • Meta — the diagnostics slug + the canonical SI factors / defaults.
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

// MARK: - Formatting (web `convertDistanceFromSI` + `fmtNumber` parity)

final class DistanceFormattingTests: XCTestCase {
    func testSafeReplacesNonFiniteWithZero() {
        XCTAssertEqual(DistanceFormatting.safe(.nan), 0)
        XCTAssertEqual(DistanceFormatting.safe(.infinity), 0)
        XCTAssertEqual(DistanceFormatting.safe(-.infinity), 0)
        XCTAssertEqual(DistanceFormatting.safe(42.5), 42.5)
    }

    func testIsFiniteValueGuard() {
        XCTAssertTrue(DistanceFormatting.isFiniteValue(12.5))
        XCTAssertFalse(DistanceFormatting.isFiniteValue(nil))
        XCTAssertFalse(DistanceFormatting.isFiniteValue(.nan))
        XCTAssertFalse(DistanceFormatting.isFiniteValue(.infinity))
    }

    func testConvertDistanceFromSIFactors() {
        XCTAssertEqual(DistanceFormatting.convertDistanceFromSI(1609.344, to: "mi"), 1, accuracy: 1e-9)
        XCTAssertEqual(DistanceFormatting.convertDistanceFromSI(1000, to: "km"), 1, accuracy: 1e-9)
        XCTAssertEqual(DistanceFormatting.convertDistanceFromSI(0.3048, to: "ft"), 1, accuracy: 1e-9)
    }

    func testConvertDistanceUnknownUnitDefaultsToKm() {
        XCTAssertEqual(DistanceFormatting.convertDistanceFromSI(2000, to: "parsec"), 2, accuracy: 1e-9)
    }

    func testResolveDigitsPrecedenceAndClamp() {
        XCTAssertEqual(DistanceFormatting.resolveDigits(precision: 3, units: metricPrefs(precision: 4)), 3)
        XCTAssertEqual(DistanceFormatting.resolveDigits(precision: nil, units: metricPrefs(precision: 4)), 4)
        XCTAssertEqual(DistanceFormatting.resolveDigits(precision: nil, units: metricPrefs()), 2)
        XCTAssertEqual(DistanceFormatting.resolveDigits(precision: 99, units: metricPrefs()), 20)
        XCTAssertEqual(DistanceFormatting.resolveDigits(precision: -5, units: metricPrefs()), 0)
    }

    func testLocaleFallsBackToEnUSForBlankPreference() {
        XCTAssertEqual(DistanceFormatting.locale(for: metricPrefs(locale: nil)).identifier, "en-US")
        XCTAssertEqual(DistanceFormatting.locale(for: metricPrefs(locale: "  ")).identifier, "en-US")
        XCTAssertEqual(DistanceFormatting.locale(for: metricPrefs(locale: "de_DE")).identifier, "de_DE")
    }

    func testFormatNumberFixedFractionDigits() {
        let usLocale = Locale(identifier: "en_US")
        XCTAssertEqual(DistanceFormatting.formatNumber(1234.5, digits: 2, locale: usLocale), "1,234.50")
        XCTAssertEqual(DistanceFormatting.formatNumber(1234, digits: 0, locale: usLocale), "1,234")
    }

    func testFormatNumberRoundsHalfAwayFromZero() {
        let usLocale = Locale(identifier: "en_US")
        XCTAssertEqual(DistanceFormatting.formatNumber(1.236, digits: 2, locale: usLocale), "1.24")
        XCTAssertEqual(DistanceFormatting.formatNumber(1.234, digits: 2, locale: usLocale), "1.23")
    }

    func testFormatNumberIsLocaleAware() {
        let deLocale = Locale(identifier: "de_DE")
        XCTAssertEqual(DistanceFormatting.formatNumber(1234.5, digits: 2, locale: deLocale), "1.234,50")
    }

    func testSourceUsesMilesFirstAndBuildsTooltip() {
        let source = DistanceFormatting.source(miles: 12.5, km: nil)
        XCTAssertEqual(source?.meters ?? 0, 12.5 * 1609.344, accuracy: 1e-6)
        XCTAssertEqual(source?.title, "12.50 mi")
    }

    func testSourceFallsBackToKilometres() {
        let source = DistanceFormatting.source(miles: nil, km: 400)
        XCTAssertEqual(source?.meters ?? 0, 400_000, accuracy: 1e-6)
        XCTAssertEqual(source?.title, "400.00 km")
    }

    func testSourceMilesWinsWhenBothSupplied() {
        let source = DistanceFormatting.source(miles: 12.5, km: 400)
        XCTAssertEqual(source?.title, "12.50 mi")
    }

    func testSourceSkipsNonFiniteMilesAndUsesKilometres() {
        let source = DistanceFormatting.source(miles: .nan, km: 50)
        XCTAssertEqual(source?.title, "50.00 km")
    }

    func testSourceIsNilWhenNeitherInputFinite() {
        XCTAssertNil(DistanceFormatting.source(miles: nil, km: nil))
        XCTAssertNil(DistanceFormatting.source(miles: .infinity, km: .nan))
    }

    func testDisplayConvertsMetresToUserUnit() {
        XCTAssertEqual(
            DistanceFormatting.display(meters: 1000, units: metricPrefs(), precision: nil),
            "1.00 km"
        )
        XCTAssertEqual(
            DistanceFormatting.display(meters: 1609.344, units: imperialPrefs(), precision: nil),
            "1.00 mi"
        )
        XCTAssertEqual(
            DistanceFormatting.display(meters: 12.5 * 1609.344, units: metricPrefs(), precision: 1),
            "20.1 km"
        )
    }
}

// MARK: - Projection (deterministic per-state snapshot)

final class DistanceProjectionTests: XCTestCase {
    func testValueBranchConvertsMilesToMetric() {
        let resolved = DistanceProjection.resolve(DistanceInput(miles: 12.5, units: metricPrefs()))
        guard case let .value(value) = resolved.phase else { return XCTFail("expected value branch") }
        XCTAssertEqual(value.text, "20.12 km")
        XCTAssertEqual(value.rawValueTitle, "12.50 mi")
        XCTAssertEqual(value.accessibilityLabel, "20.12 km")
        XCTAssertFalse(resolved.isEmpty)
    }

    func testValueBranchImperialRoundTrip() {
        let resolved = DistanceProjection.resolve(DistanceInput(miles: 100, units: imperialPrefs()))
        XCTAssertEqual(resolved.displayText, "100.00 mi")
    }

    func testValueBranchKilometreInput() {
        let resolved = DistanceProjection.resolve(DistanceInput(km: 412.7, units: metricPrefs()))
        guard case let .value(value) = resolved.phase else { return XCTFail("expected value branch") }
        XCTAssertEqual(value.text, "412.70 km")
        XCTAssertEqual(value.rawValueTitle, "412.70 km")
    }

    func testValueBranchMilesWinsOverKilometres() {
        let input = DistanceInput(miles: 100, km: 5, units: imperialPrefs())
        XCTAssertEqual(DistanceProjection.resolve(input).displayText, "100.00 mi")
    }

    func testValueBranchSkipsNonFiniteMiles() {
        let input = DistanceInput(miles: .nan, km: 50, units: metricPrefs())
        XCTAssertEqual(DistanceProjection.resolve(input).displayText, "50.00 km")
    }

    func testPrecisionOverrideIsApplied() {
        let input = DistanceInput(km: 12.3456, precision: 3, units: metricPrefs())
        XCTAssertEqual(DistanceProjection.resolve(input).displayText, "12.346 km")
    }

    func testEmptyBranchRendersSentinel() {
        let resolved = DistanceProjection.resolve(DistanceInput(units: metricPrefs()))
        guard case let .empty(empty) = resolved.phase else { return XCTFail("expected empty branch") }
        XCTAssertEqual(empty.text, "—")
        XCTAssertEqual(empty.accessibilityLabel, "No distance data")
        XCTAssertTrue(resolved.isEmpty)
    }
}

// MARK: - Meta (diagnostics slug + canonical factors)

final class DistanceMetaTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(DistanceMeta.surfaceSlug, "Distance")
        XCTAssertEqual(Distance.surfaceSlug, "Distance")
    }

    func testCanonicalFactorsAndDefaults() {
        XCTAssertEqual(DistanceMeta.metersPerMile, 1609.344, accuracy: 1e-9)
        XCTAssertEqual(DistanceMeta.metersPerKm, 1000, accuracy: 1e-9)
        XCTAssertEqual(DistanceMeta.metersPerFoot, 0.3048, accuracy: 1e-9)
        XCTAssertEqual(DistanceMeta.defaultPrecision, 2)
        XCTAssertEqual(DistanceMeta.maxFractionDigits, 20)
        XCTAssertEqual(DistanceMeta.titleFractionDigits, 2)
        XCTAssertEqual(DistanceMeta.emptyDisplay, "—")
    }
}

// MARK: - Accessibility (labels)

final class DistanceAccessibilityTests: XCTestCase {
    func testValueLabelEqualsDisplay() {
        XCTAssertEqual(DistanceAccessibility.valueLabel("20.12 km"), "20.12 km")
    }

    func testEmptyLabelResolvesKeyWithFallback() {
        XCTAssertEqual(DistanceAccessibility.emptyLabel(), "No distance data")
        let custom: DistanceResolve = { key, _ in "[\(key)]" }
        XCTAssertEqual(DistanceAccessibility.emptyLabel(strings: custom), "[distance.empty.accessibilityLabel]")
    }
}

// MARK: - Model (state-holder)

@MainActor
final class DistanceModelTests: XCTestCase {
    func testResolvedProjectsInput() {
        let model = DistanceModel(
            input: DistanceInput(miles: 12.5, units: metricPrefs()),
            telemetry: SpyDistanceTelemetry()
        )
        XCTAssertEqual(model.resolved.displayText, "20.12 km")
    }

    func testSyncAdoptsNewInput() {
        let model = DistanceModel(
            input: DistanceInput(km: 1, units: metricPrefs()),
            telemetry: SpyDistanceTelemetry()
        )
        model.sync(DistanceInput(km: 400, units: metricPrefs()))
        XCTAssertEqual(model.resolved.displayText, "400.00 km")
    }

    func testSyncToEmptyBranch() {
        let model = DistanceModel(
            input: DistanceInput(km: 1, units: metricPrefs()),
            telemetry: SpyDistanceTelemetry()
        )
        model.sync(DistanceInput(units: metricPrefs()))
        XCTAssertTrue(model.resolved.isEmpty)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyDistanceTelemetry()
        let model = DistanceModel(input: DistanceInput(miles: 1, units: metricPrefs()), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [DistanceMeta.surfaceSlug])
    }

    func testStopIsSafeAndDoesNotEmit() {
        let spy = SpyDistanceTelemetry()
        let model = DistanceModel(input: DistanceInput(miles: 1, units: metricPrefs()), telemetry: spy)
        model.start()
        model.stop()
        model.stop()
        XCTAssertEqual(spy.surfaces, [DistanceMeta.surfaceSlug])
    }
}

// MARK: - Views (every form composes — signature contract)

@MainActor
final class DistanceViewTests: XCTestCase {
    func testPublicSurfacesCompose() {
        _ = Distance(miles: 248.5)
        _ = Distance(km: 412.7, precision: 1)
        _ = Distance()
        _ = Distance(input: DistanceInput(miles: 1, units: metricPrefs()), telemetry: SpyDistanceTelemetry())
    }

    func testSubviewsCompose() {
        _ = DistanceValueView(value: DistanceResolvedValue(
            text: "20.12 km",
            rawValueTitle: "12.50 mi",
            accessibilityLabel: "20.12 km"
        ))
        _ = DistanceEmptyView(empty: DistanceResolvedEmpty(
            text: "—",
            accessibilityLabel: "No distance data"
        ))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyDistanceTelemetry: DistanceTelemetry, @unchecked Sendable {
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
