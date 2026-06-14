//
//  Pressure.Tests.swift
//  TeslaSync — P4 shared surface · 0086 · Pressure (Apple)
//
//  Coverage for the Pressure surface:
//    • Formatting — the web `convertPressureFromSI` factors (kPa / psi / bar + unknown fallback), the
//      `fmtNumber` parity (fixed fraction digits, locale grouping en_US vs de_DE, half-away rounding),
//      the precision precedence (prop → preference → default, clamped 0...20), the locale fallback, the
//      `bar`-first source normalization to SI kilopascals, and the `value.toFixed(2)` tooltip.
//    • Projection — the deterministic per-state "snapshot": the value branch (bar conversion + psi
//      round-trip + kPa preference), the bar-over-psi precedence, the non-finite fall through, and the
//      empty sentinel branch.
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

private func barPrefs(precision: Int? = nil, locale: String? = "en-US") -> UnitPreferences {
    UnitPreferences(
        distance: "km",
        speed: "km/h",
        temperature: "°C",
        pressure: "bar",
        energy: "Wh",
        duration: "h",
        power: "W",
        locale: locale,
        precision: precision
    )
}

private func psiPrefs(precision: Int? = nil, locale: String? = "en-US") -> UnitPreferences {
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

private func kpaPrefs(precision: Int? = nil, locale: String? = "en-US") -> UnitPreferences {
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

// MARK: - Formatting (web `convertPressureFromSI` + `fmtNumber` parity)

final class PressureFormattingTests: XCTestCase {
    func testSafeReplacesNonFiniteWithZero() {
        XCTAssertEqual(PressureFormatting.safe(.nan), 0)
        XCTAssertEqual(PressureFormatting.safe(.infinity), 0)
        XCTAssertEqual(PressureFormatting.safe(-.infinity), 0)
        XCTAssertEqual(PressureFormatting.safe(42.5), 42.5)
    }

    func testIsFiniteValueGuard() {
        XCTAssertTrue(PressureFormatting.isFiniteValue(2.4))
        XCTAssertFalse(PressureFormatting.isFiniteValue(nil))
        XCTAssertFalse(PressureFormatting.isFiniteValue(.nan))
        XCTAssertFalse(PressureFormatting.isFiniteValue(.infinity))
    }

    func testConvertPressureFromSIFactors() {
        XCTAssertEqual(PressureFormatting.convertPressureFromSI(6.894757, to: "psi"), 1, accuracy: 1e-9)
        XCTAssertEqual(PressureFormatting.convertPressureFromSI(100, to: "bar"), 1, accuracy: 1e-9)
        XCTAssertEqual(PressureFormatting.convertPressureFromSI(250, to: "kPa"), 250, accuracy: 1e-9)
    }

    func testConvertPressureUnknownUnitDefaultsToBar() {
        XCTAssertEqual(PressureFormatting.convertPressureFromSI(200, to: "atm"), 2, accuracy: 1e-9)
    }

    func testResolveDigitsPrecedenceAndClamp() {
        XCTAssertEqual(PressureFormatting.resolveDigits(precision: 3, units: barPrefs(precision: 4)), 3)
        XCTAssertEqual(PressureFormatting.resolveDigits(precision: nil, units: barPrefs(precision: 4)), 4)
        XCTAssertEqual(PressureFormatting.resolveDigits(precision: nil, units: barPrefs()), 2)
        XCTAssertEqual(PressureFormatting.resolveDigits(precision: 99, units: barPrefs()), 20)
        XCTAssertEqual(PressureFormatting.resolveDigits(precision: -5, units: barPrefs()), 0)
    }

    func testLocaleFallsBackToEnUSForBlankPreference() {
        XCTAssertEqual(PressureFormatting.locale(for: barPrefs(locale: nil)).identifier, "en-US")
        XCTAssertEqual(PressureFormatting.locale(for: barPrefs(locale: "  ")).identifier, "en-US")
        XCTAssertEqual(PressureFormatting.locale(for: barPrefs(locale: "de_DE")).identifier, "de_DE")
    }

    func testFormatNumberFixedFractionDigits() {
        let usLocale = Locale(identifier: "en_US")
        XCTAssertEqual(PressureFormatting.formatNumber(1234.5, digits: 2, locale: usLocale), "1,234.50")
        XCTAssertEqual(PressureFormatting.formatNumber(1234, digits: 0, locale: usLocale), "1,234")
    }

    func testFormatNumberRoundsHalfAwayFromZero() {
        let usLocale = Locale(identifier: "en_US")
        XCTAssertEqual(PressureFormatting.formatNumber(1.236, digits: 2, locale: usLocale), "1.24")
        XCTAssertEqual(PressureFormatting.formatNumber(1.234, digits: 2, locale: usLocale), "1.23")
    }

    func testFormatNumberIsLocaleAware() {
        let deLocale = Locale(identifier: "de_DE")
        XCTAssertEqual(PressureFormatting.formatNumber(1234.5, digits: 2, locale: deLocale), "1.234,50")
    }

    func testSourceUsesBarFirstAndBuildsTooltip() {
        let source = PressureFormatting.source(bar: 2.4, psi: nil)
        XCTAssertEqual(source?.kpa ?? 0, 2.4 * 100, accuracy: 1e-6)
        XCTAssertEqual(source?.title, "2.40 bar")
    }

    func testSourceFallsBackToPsi() {
        let source = PressureFormatting.source(bar: nil, psi: 32)
        XCTAssertEqual(source?.kpa ?? 0, 32 * 6.894757, accuracy: 1e-6)
        XCTAssertEqual(source?.title, "32.00 psi")
    }

    func testSourceBarWinsWhenBothSupplied() {
        let source = PressureFormatting.source(bar: 2.4, psi: 32)
        XCTAssertEqual(source?.title, "2.40 bar")
    }

    func testSourceSkipsNonFiniteBarAndUsesPsi() {
        let source = PressureFormatting.source(bar: .nan, psi: 32)
        XCTAssertEqual(source?.title, "32.00 psi")
    }

    func testSourceIsNilWhenNeitherInputFinite() {
        XCTAssertNil(PressureFormatting.source(bar: nil, psi: nil))
        XCTAssertNil(PressureFormatting.source(bar: .infinity, psi: .nan))
    }

    func testDisplayConvertsKilopascalsToUserUnit() {
        XCTAssertEqual(
            PressureFormatting.display(kpa: 100, units: barPrefs(), precision: nil),
            "1.00 bar"
        )
        XCTAssertEqual(
            PressureFormatting.display(kpa: 6.894757, units: psiPrefs(), precision: nil),
            "1.00 psi"
        )
        XCTAssertEqual(
            PressureFormatting.display(kpa: 240, units: kpaPrefs(), precision: nil),
            "240.00 kPa"
        )
        XCTAssertEqual(
            PressureFormatting.display(kpa: 240, units: barPrefs(), precision: 1),
            "2.4 bar"
        )
    }
}

// MARK: - Projection (deterministic per-state snapshot)

final class PressureProjectionTests: XCTestCase {
    func testValueBranchRendersBarPreference() {
        let resolved = PressureProjection.resolve(PressureInput(bar: 2.4, units: barPrefs()))
        guard case let .value(value) = resolved.phase else { return XCTFail("expected value branch") }
        XCTAssertEqual(value.text, "2.40 bar")
        XCTAssertEqual(value.rawValueTitle, "2.40 bar")
        XCTAssertEqual(value.accessibilityLabel, "2.40 bar")
        XCTAssertFalse(resolved.isEmpty)
    }

    func testValueBranchBarInputUnderPsiPreference() {
        let resolved = PressureProjection.resolve(PressureInput(bar: 2.4, units: psiPrefs()))
        guard case let .value(value) = resolved.phase else { return XCTFail("expected value branch") }
        XCTAssertEqual(value.text, "34.81 psi")
        XCTAssertEqual(value.rawValueTitle, "2.40 bar")
    }

    func testValueBranchPsiRoundTrip() {
        let resolved = PressureProjection.resolve(PressureInput(psi: 32, units: psiPrefs()))
        guard case let .value(value) = resolved.phase else { return XCTFail("expected value branch") }
        XCTAssertEqual(value.text, "32.00 psi")
        XCTAssertEqual(value.rawValueTitle, "32.00 psi")
    }

    func testValueBranchPsiInputUnderBarPreference() {
        let resolved = PressureProjection.resolve(PressureInput(psi: 32, units: barPrefs()))
        XCTAssertEqual(resolved.displayText, "2.21 bar")
    }

    func testValueBranchKilopascalPreference() {
        let resolved = PressureProjection.resolve(PressureInput(bar: 2.4, units: kpaPrefs()))
        XCTAssertEqual(resolved.displayText, "240.00 kPa")
    }

    func testValueBranchBarWinsOverPsi() {
        let input = PressureInput(bar: 2.4, psi: 32, units: barPrefs())
        XCTAssertEqual(PressureProjection.resolve(input).displayText, "2.40 bar")
    }

    func testValueBranchSkipsNonFiniteBar() {
        let input = PressureInput(bar: .nan, psi: 32, units: psiPrefs())
        XCTAssertEqual(PressureProjection.resolve(input).displayText, "32.00 psi")
    }

    func testPrecisionOverrideIsApplied() {
        let input = PressureInput(bar: 2.41873, precision: 3, units: barPrefs())
        XCTAssertEqual(PressureProjection.resolve(input).displayText, "2.419 bar")
    }

    func testEmptyBranchRendersSentinel() {
        let resolved = PressureProjection.resolve(PressureInput(units: barPrefs()))
        guard case let .empty(empty) = resolved.phase else { return XCTFail("expected empty branch") }
        XCTAssertEqual(empty.text, "—")
        XCTAssertEqual(empty.accessibilityLabel, "No pressure data")
        XCTAssertTrue(resolved.isEmpty)
    }
}

// MARK: - Meta (diagnostics slug + canonical factors)

final class PressureMetaTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(PressureMeta.surfaceSlug, "Pressure")
        XCTAssertEqual(Pressure.surfaceSlug, "Pressure")
    }

    func testCanonicalFactorsAndDefaults() {
        XCTAssertEqual(PressureMeta.kpaPerPsi, 6.894757, accuracy: 1e-9)
        XCTAssertEqual(PressureMeta.kpaPerBar, 100, accuracy: 1e-9)
        XCTAssertEqual(PressureMeta.defaultPrecision, 2)
        XCTAssertEqual(PressureMeta.maxFractionDigits, 20)
        XCTAssertEqual(PressureMeta.titleFractionDigits, 2)
        XCTAssertEqual(PressureMeta.emptyDisplay, "—")
    }
}

// MARK: - Accessibility (labels)

final class PressureAccessibilityTests: XCTestCase {
    func testValueLabelEqualsDisplay() {
        XCTAssertEqual(PressureAccessibility.valueLabel("2.40 bar"), "2.40 bar")
    }

    func testEmptyLabelResolvesKeyWithFallback() {
        XCTAssertEqual(PressureAccessibility.emptyLabel(), "No pressure data")
        let custom: PressureResolve = { key, _ in "[\(key)]" }
        XCTAssertEqual(PressureAccessibility.emptyLabel(strings: custom), "[pressure.empty.accessibilityLabel]")
    }
}

// MARK: - Model (state-holder)

@MainActor
final class PressureModelTests: XCTestCase {
    func testResolvedProjectsInput() {
        let model = PressureModel(
            input: PressureInput(bar: 2.4, units: barPrefs()),
            telemetry: SpyPressureTelemetry()
        )
        XCTAssertEqual(model.resolved.displayText, "2.40 bar")
    }

    func testSyncAdoptsNewInput() {
        let model = PressureModel(
            input: PressureInput(bar: 1, units: barPrefs()),
            telemetry: SpyPressureTelemetry()
        )
        model.sync(PressureInput(bar: 2.4, units: barPrefs()))
        XCTAssertEqual(model.resolved.displayText, "2.40 bar")
    }

    func testSyncToEmptyBranch() {
        let model = PressureModel(
            input: PressureInput(bar: 1, units: barPrefs()),
            telemetry: SpyPressureTelemetry()
        )
        model.sync(PressureInput(units: barPrefs()))
        XCTAssertTrue(model.resolved.isEmpty)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyPressureTelemetry()
        let model = PressureModel(input: PressureInput(bar: 1, units: barPrefs()), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [PressureMeta.surfaceSlug])
    }

    func testStopIsSafeAndDoesNotEmit() {
        let spy = SpyPressureTelemetry()
        let model = PressureModel(input: PressureInput(bar: 1, units: barPrefs()), telemetry: spy)
        model.start()
        model.stop()
        model.stop()
        XCTAssertEqual(spy.surfaces, [PressureMeta.surfaceSlug])
    }
}

// MARK: - Views (every form composes — signature contract)

@MainActor
final class PressureViewTests: XCTestCase {
    func testPublicSurfacesCompose() {
        _ = Pressure(bar: 2.4)
        _ = Pressure(psi: 34.5, precision: 1)
        _ = Pressure()
        _ = Pressure(input: PressureInput(bar: 1, units: barPrefs()), telemetry: SpyPressureTelemetry())
    }

    func testSubviewsCompose() {
        _ = PressureValueView(value: PressureResolvedValue(
            text: "2.40 bar",
            rawValueTitle: "2.40 bar",
            accessibilityLabel: "2.40 bar"
        ))
        _ = PressureEmptyView(empty: PressureResolvedEmpty(
            text: "—",
            accessibilityLabel: "No pressure data"
        ))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyPressureTelemetry: PressureTelemetry, @unchecked Sendable {
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
