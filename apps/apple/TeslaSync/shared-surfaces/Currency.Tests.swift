//
//  Currency.Tests.swift
//  TeslaSync — P4 shared surface · 0083 · Currency (Apple)
//
//  Coverage for the Currency surface:
//    • Formatting — the `fmtNumber` parity (non-finite → zero, fraction-digit clamp, locale-aware
//      grouping en_US vs de_DE, rounding), the `{symbol}{number}` display composition, and the
//      locale-neutral `value.toFixed` canonical (tooltip) string.
//    • Settings — the verbatim port of the `useFormatting` symbol ternary (nil / empty / whitespace →
//      "$", a present symbol used untrimmed).
//    • Input — `effectiveSymbol` (`symbolOverride ?? currencySymbol`, empty override honored) and the
//      `hasRenderableValue` guard.
//    • Projection — the two render branches: the formatted-value branch (text + canonical) and the
//      fallback branch (`nil` / NaN / ±Infinity → fallback glyph, no canonical) — the deterministic
//      per-branch "snapshot".
//    • Meta — the diagnostics slug + the web defaults.
//    • Accessibility — the spoken label equals the visible amount, or the fallback glyph.
//    • Model — the projection, the accessibility label, `sync` adoption + idempotence, the lazy
//      once-only `view.opened` telemetry, and the no-op stop.
//    • Views — the public surface (both initializers) and the text run compose (signature contract).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so each
//  assertion reads the pure adapter / projection / model directly. Fixed locales are used so the
//  grouping / decimal assertions are deterministic regardless of the runner's region.
//

import SwiftUI
import XCTest
@testable import TeslaSync

private let usLocale = Locale(identifier: "en_US")
private let deLocale = Locale(identifier: "de_DE")

// MARK: - Formatting (web `fmtNumber` + `value.toFixed` parity)

final class CurrencyFormattingTests: XCTestCase {
    func testSafeReplacesNonFiniteWithZero() {
        XCTAssertEqual(CurrencyFormatting.safe(.nan), 0)
        XCTAssertEqual(CurrencyFormatting.safe(.infinity), 0)
        XCTAssertEqual(CurrencyFormatting.safe(-.infinity), 0)
        XCTAssertEqual(CurrencyFormatting.safe(42.5), 42.5)
    }

    func testClampPrecisionToWebRange() {
        XCTAssertEqual(CurrencyFormatting.clampPrecision(-5), 0)
        XCTAssertEqual(CurrencyFormatting.clampPrecision(2), 2)
        XCTAssertEqual(CurrencyFormatting.clampPrecision(99), CurrencyMeta.maxFractionDigits)
    }

    func testNumberFixedFractionDigitsAndGrouping() {
        XCTAssertEqual(CurrencyFormatting.number(1234.5, precision: 2, locale: usLocale), "1,234.50")
        XCTAssertEqual(CurrencyFormatting.number(1_234_567, precision: 0, locale: usLocale), "1,234,567")
    }

    func testNumberRoundsHalfAwayFromZero() {
        XCTAssertEqual(CurrencyFormatting.number(12345.678, precision: 0, locale: usLocale), "12,346")
        XCTAssertEqual(CurrencyFormatting.number(2.5, precision: 0, locale: usLocale), "3")
    }

    func testNumberIsLocaleAware() {
        XCTAssertEqual(CurrencyFormatting.number(1234.5, precision: 2, locale: usLocale), "1,234.50")
        XCTAssertEqual(CurrencyFormatting.number(1234.5, precision: 2, locale: deLocale), "1.234,50")
    }

    func testNumberNonFiniteRendersZero() {
        XCTAssertEqual(CurrencyFormatting.number(.nan, precision: 2, locale: usLocale), "0.00")
    }

    func testFixedIsLocaleNeutralWithoutGrouping() {
        // The canonical (tooltip) string mirrors `value.toFixed`: a dot decimal, no grouping, even in
        // a locale that groups with "." and decimals with ",".
        XCTAssertEqual(CurrencyFormatting.fixed(1234.5, precision: 2), "1234.50")
        XCTAssertEqual(CurrencyFormatting.fixed(1_234_567, precision: 0), "1234567")
        XCTAssertEqual(CurrencyFormatting.fixed(-42.7, precision: 2), "-42.70")
    }

    func testDisplayPrefixesSymbol() {
        XCTAssertEqual(
            CurrencyFormatting.display(symbol: "$", value: 1234.5, precision: 2, locale: usLocale),
            "$1,234.50"
        )
        // The symbol always prefixes the figure, even in a locale that would normally suffix it.
        XCTAssertEqual(
            CurrencyFormatting.display(symbol: "€", value: 1234.5, precision: 2, locale: deLocale),
            "€1.234,50"
        )
    }

    func testCanonicalPrefixesSymbolOnLocaleNeutralValue() {
        XCTAssertEqual(CurrencyFormatting.canonical(symbol: "$", value: 1234.5, precision: 2), "$1234.50")
        XCTAssertEqual(CurrencyFormatting.canonical(symbol: "€", value: 1234.5, precision: 2), "€1234.50")
    }
}

// MARK: - Settings (web `useFormatting().currencySymbol` ternary)

final class CurrencyFormattingSettingsTests: XCTestCase {
    func testNilSymbolUsesDollarFallback() {
        XCTAssertEqual(CurrencyFormattingSettings(rawCurrencySymbol: nil).currencySymbol, "$")
    }

    func testEmptyOrWhitespaceSymbolUsesDollarFallback() {
        XCTAssertEqual(CurrencyFormattingSettings(rawCurrencySymbol: "").currencySymbol, "$")
        XCTAssertEqual(CurrencyFormattingSettings(rawCurrencySymbol: "   ").currencySymbol, "$")
    }

    func testPresentSymbolIsUsedUntrimmed() {
        XCTAssertEqual(CurrencyFormattingSettings(rawCurrencySymbol: "€").currencySymbol, "€")
        XCTAssertEqual(CurrencyFormattingSettings(rawCurrencySymbol: "kr").currencySymbol, "kr")
        // A non-blank symbol with surrounding spaces is returned as-is (web returns the original,
        // untrimmed `settings.currency_symbol`).
        XCTAssertEqual(CurrencyFormattingSettings(rawCurrencySymbol: "  €  ").currencySymbol, "  €  ")
    }
}

// MARK: - Input (effective symbol + renderable guard)

final class CurrencyInputTests: XCTestCase {
    func testEffectiveSymbolOverrideWins() {
        let input = CurrencyInput(
            value: 1,
            symbolOverride: "£",
            settings: CurrencyFormattingSettings(rawCurrencySymbol: "€")
        )
        XCTAssertEqual(input.effectiveSymbol, "£")
    }

    func testEffectiveSymbolEmptyOverrideHonored() {
        // The web uses `symbolOverride ?? currencySymbol`, so a non-nil empty override wins.
        let input = CurrencyInput(
            value: 1,
            symbolOverride: "",
            settings: CurrencyFormattingSettings(rawCurrencySymbol: "€")
        )
        XCTAssertEqual(input.effectiveSymbol, "")
    }

    func testEffectiveSymbolFallsThroughToSettings() {
        let input = CurrencyInput(value: 1, settings: CurrencyFormattingSettings(rawCurrencySymbol: "€"))
        XCTAssertEqual(input.effectiveSymbol, "€")
        let bare = CurrencyInput(value: 1)
        XCTAssertEqual(bare.effectiveSymbol, "$")
    }

    func testHasRenderableValueGuard() {
        XCTAssertTrue(CurrencyInput(value: 42).hasRenderableValue)
        XCTAssertTrue(CurrencyInput(value: 0).hasRenderableValue)
        XCTAssertFalse(CurrencyInput(value: nil).hasRenderableValue)
        XCTAssertFalse(CurrencyInput(value: .nan).hasRenderableValue)
        XCTAssertFalse(CurrencyInput(value: .infinity).hasRenderableValue)
    }

    func testDefaultsMatchWebProps() {
        let input = CurrencyInput(value: 5)
        XCTAssertEqual(input.precision, CurrencyMeta.defaultPrecision)
        XCTAssertNil(input.symbolOverride)
        XCTAssertEqual(input.fallback, CurrencyMeta.defaultFallback)
    }
}

// MARK: - Projection (the two render branches)

final class CurrencyProjectionTests: XCTestCase {
    func testValueBranchFormatsAndCarriesCanonical() {
        let input = CurrencyInput(
            value: 1234.5,
            settings: CurrencyFormattingSettings(rawCurrencySymbol: "$"),
            locale: usLocale
        )
        let resolved = CurrencyProjection.resolve(input)
        XCTAssertFalse(resolved.isFallback)
        XCTAssertEqual(resolved.text, "$1,234.50")
        XCTAssertEqual(resolved.canonical, "$1234.50")
    }

    func testValueBranchHonorsOverrideAndLocale() {
        let input = CurrencyInput(value: 1234.5, symbolOverride: "€", locale: deLocale)
        let resolved = CurrencyProjection.resolve(input)
        XCTAssertEqual(resolved.text, "€1.234,50")
        // The canonical string stays locale-neutral regardless of the display locale.
        XCTAssertEqual(resolved.canonical, "€1234.50")
    }

    func testNegativeValueRenders() {
        let resolved = CurrencyProjection.resolve(CurrencyInput(value: -42.7, locale: usLocale))
        XCTAssertEqual(resolved.text, "$-42.70")
        XCTAssertEqual(resolved.canonical, "$-42.70")
    }

    func testFallbackBranchForNil() {
        let resolved = CurrencyProjection.resolve(CurrencyInput(value: nil))
        XCTAssertTrue(resolved.isFallback)
        XCTAssertEqual(resolved.text, "—")
        XCTAssertNil(resolved.canonical)
    }

    func testFallbackBranchForNonFinite() {
        for value in [Double.nan, .infinity, -.infinity] {
            let resolved = CurrencyProjection.resolve(CurrencyInput(value: value))
            XCTAssertTrue(resolved.isFallback)
            XCTAssertEqual(resolved.text, "—")
            XCTAssertNil(resolved.canonical)
        }
    }

    func testFallbackBranchUsesCustomFallbackString() {
        let resolved = CurrencyProjection.resolve(CurrencyInput(value: nil, fallback: "n/a"))
        XCTAssertEqual(resolved.text, "n/a")
        XCTAssertTrue(resolved.isFallback)
    }
}

// MARK: - Meta (diagnostics slug + web defaults)

final class CurrencyMetaTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(CurrencyMeta.surfaceSlug, "Currency")
        XCTAssertEqual(Currency.surfaceSlug, "Currency")
    }

    func testWebDefaults() {
        XCTAssertEqual(CurrencyMeta.defaultPrecision, 2)
        XCTAssertEqual(CurrencyMeta.defaultFallback, "—")
        XCTAssertEqual(CurrencyMeta.defaultCurrencySymbol, "$")
        XCTAssertEqual(CurrencyMeta.maxFractionDigits, 20)
    }
}

// MARK: - Accessibility (visible amount / fallback)

final class CurrencyAccessibilityTests: XCTestCase {
    func testLabelEqualsVisibleAmount() {
        let input = CurrencyInput(
            value: 1234.5,
            settings: CurrencyFormattingSettings(rawCurrencySymbol: "$"),
            locale: usLocale
        )
        XCTAssertEqual(CurrencyAccessibility.label(input), "$1,234.50")
        XCTAssertEqual(CurrencyAccessibility.label(input), CurrencyProjection.resolve(input).text)
    }

    func testLabelEqualsFallbackForNonFinite() {
        XCTAssertEqual(CurrencyAccessibility.label(CurrencyInput(value: nil)), "—")
        XCTAssertEqual(CurrencyAccessibility.label(CurrencyInput(value: .nan, fallback: "n/a")), "n/a")
    }
}

// MARK: - Model (state-holder)

@MainActor
final class CurrencyModelTests: XCTestCase {
    private func makeModel(_ input: CurrencyInput, telemetry: CurrencyTelemetry) -> CurrencyModel {
        CurrencyModel(input: input, telemetry: telemetry)
    }

    func testResolvedProjectsInput() {
        let input = CurrencyInput(
            value: 1234.5,
            settings: CurrencyFormattingSettings(rawCurrencySymbol: "$"),
            locale: usLocale
        )
        let model = makeModel(input, telemetry: SpyCurrencyTelemetry())
        XCTAssertEqual(model.resolved.text, "$1,234.50")
        XCTAssertEqual(model.resolved.canonical, "$1234.50")
    }

    func testAccessibilityLabelProjectsInput() {
        let model = makeModel(CurrencyInput(value: nil, fallback: "n/a"), telemetry: SpyCurrencyTelemetry())
        XCTAssertEqual(model.accessibilityLabel, "n/a")
    }

    func testSyncAdoptsNewInput() {
        let model = makeModel(CurrencyInput(value: 10, locale: usLocale), telemetry: SpyCurrencyTelemetry())
        model.sync(CurrencyInput(value: 20, locale: usLocale))
        XCTAssertEqual(model.input.value, 20)
        XCTAssertEqual(model.resolved.text, "$20.00")
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyCurrencyTelemetry()
        let model = makeModel(CurrencyInput(value: 1, locale: usLocale), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [CurrencyMeta.surfaceSlug])
    }

    func testStopIsSafeAndDoesNotEmit() {
        let spy = SpyCurrencyTelemetry()
        let model = makeModel(CurrencyInput(value: 1, locale: usLocale), telemetry: spy)
        model.start()
        model.stop()
        model.stop()
        XCTAssertEqual(spy.surfaces, [CurrencyMeta.surfaceSlug])
    }
}

// MARK: - Views (every form composes — signature contract)

@MainActor
final class CurrencyViewTests: XCTestCase {
    func testTextRunComposesBothBranches() {
        _ = CurrencyText(resolved: CurrencyResolved(text: "$1,234.50", canonical: "$1234.50", isFallback: false))
        _ = CurrencyText(resolved: CurrencyResolved(text: "—", canonical: nil, isFallback: true))
    }

    func testPublicSurfacesCompose() {
        _ = Currency(value: 1234.5)
        _ = Currency(value: nil)
        _ = Currency(value: 89.99, symbolOverride: "£", locale: usLocale)
        _ = Currency(value: 1234.5, currencySymbol: "€", locale: deLocale)
        _ = Currency(
            input: CurrencyInput(value: 5, locale: usLocale),
            telemetry: SpyCurrencyTelemetry()
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyCurrencyTelemetry: CurrencyTelemetry, @unchecked Sendable {
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
