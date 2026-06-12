//
//  CurrencyInput.Tests.swift
//  TeslaSync — P4 shared surface · 0150 · CurrencyInput (Apple)
//
//  Adapter + projection + seam coverage for the CurrencyInput surface — the Swift port of the web
//  suite (components/forms/CurrencyInput.test.tsx + lib/currencyFormat behaviour):
//    • Micro storage — valueToMicro / microToValue round-trip + nil / sub-cent precision.
//    • Symbol — the localized currency symbol ($/€/£/¥) + the literal-code fallback.
//    • Formatting — canonical micro → "$1.50" / "1,50 €" / "£1.50", precision rounding, nil → "".
//    • Parsing — "1.50"/"$1.50" USD, "1,50" EUR de-DE (locale equivalence), accounting parens,
//      blank → nil, full-precision retention beyond the display precision.
//    • parseLocaleNumber — en-US / de-DE / fr-FR group + decimal separators.
//    • codeFromSymbol — the reverse-lookup table.
//    • Accessibility — the composed field VoiceOver label (value vs empty hint).
//    • Projection — error / loading / ready-empty / ready-populated (web branches + P4 leaf).
//    • Seams — Live (start/update/commit-writeback/refresh) + InMemory (records commits / push).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. No network, no real store — each assertion
//  reads the pure core or the in-memory seam directly.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")
private let deDE = Locale(identifier: "de_DE")
private let enGB = Locale(identifier: "en_GB")
private let frFR = Locale(identifier: "fr_FR")

/// Normalises the non-breaking spaces ICU uses between number and symbol to a regular space, the
/// parity of the web test's `value.replace(/\s/g, ' ')`.
private func normalizeSpaces(_ value: String) -> String {
    value.replacingOccurrences(of: "\u{00A0}", with: " ").replacingOccurrences(of: "\u{202F}", with: " ")
}

// MARK: - Micro storage (web valueToMicro / microToValue)

final class CurrencyInputFieldMicroTests: XCTestCase {
    func testValueToMicroRoundsToNearestMicro() {
        XCTAssertEqual(CurrencyInputFieldMicro.fromValue(1.5), 1_500_000)
        XCTAssertEqual(CurrencyInputFieldMicro.fromValue(0.00001), 10)
        XCTAssertEqual(CurrencyInputFieldMicro.fromValue(0), 0)
    }

    func testValueToMicroRejectsNilAndNonFinite() {
        XCTAssertNil(CurrencyInputFieldMicro.fromValue(nil))
        XCTAssertNil(CurrencyInputFieldMicro.fromValue(.nan))
        XCTAssertNil(CurrencyInputFieldMicro.fromValue(.infinity))
    }

    func testMicroToValueRoundTrips() {
        XCTAssertEqual(CurrencyInputFieldMicro.toValue(1_500_000), 1.5)
        XCTAssertEqual(CurrencyInputFieldMicro.toValue(0), 0)
        XCTAssertNil(CurrencyInputFieldMicro.toValue(nil))
    }
}

// MARK: - Symbol (web currencySymbol)

final class CurrencyInputFieldSymbolTests: XCTestCase {
    func testLocalizedSymbols() {
        XCTAssertEqual(CurrencyInputFieldFormatter.symbol(currency: "USD", locale: enUS), "$")
        XCTAssertEqual(CurrencyInputFieldFormatter.symbol(currency: "EUR", locale: deDE), "€")
        XCTAssertEqual(CurrencyInputFieldFormatter.symbol(currency: "GBP", locale: enGB), "£")
        XCTAssertEqual(CurrencyInputFieldFormatter.symbol(currency: "JPY", locale: Locale(identifier: "ja_JP")), "¥")
    }

    func testUnresolvableCodeFallsBackToTheLiteralCode() {
        XCTAssertEqual(CurrencyInputFieldFormatter.symbol(currency: "ZZZ", locale: enUS), "ZZZ")
    }
}

// MARK: - Formatting (web formatCurrencyMicro / formatCurrencyValue)

final class CurrencyInputFieldFormatTests: XCTestCase {
    func testFormatsCanonicalMicroUSD() {
        let text = CurrencyInputFieldFormatter.formatMicro(1_500_000, currency: "USD", locale: enUS, precision: 2)
        XCTAssertEqual(text, "$1.50")
    }

    func testFormatsCanonicalMicroEURGerman() {
        let text = CurrencyInputFieldFormatter.formatMicro(1_500_000, currency: "EUR", locale: deDE, precision: 2)
        XCTAssertEqual(normalizeSpaces(text), "1,50 €")
    }

    func testFormatsCanonicalMicroGBP() {
        let text = CurrencyInputFieldFormatter.formatMicro(1_500_000, currency: "GBP", locale: enGB, precision: 2)
        XCTAssertEqual(text, "£1.50")
    }

    func testFormatsNilAsEmptyString() {
        XCTAssertEqual(CurrencyInputFieldFormatter.formatMicro(nil, currency: "USD", locale: enUS, precision: 2), "")
    }

    func testRespectsPrecisionForDisplayRounding() {
        let text = CurrencyInputFieldFormatter.formatMicro(123_450, currency: "USD", locale: enUS, precision: 4)
        XCTAssertEqual(text, "$0.1235")
    }

    func testUnresolvableCodeRendersCodePrefixedDecimal() {
        // A non-ISO code has no real symbol; the output is the literal code + the decimal (the web
        // `catch` fallback). NumberFormatter renders the code itself with a non-breaking space, so
        // the assertion normalizes whitespace.
        let text = CurrencyInputFieldFormatter.formatMicro(1_500_000, currency: "ZZZ", locale: enUS, precision: 2)
        XCTAssertEqual(normalizeSpaces(text), "ZZZ 1.50")
    }
}

// MARK: - Parsing (web parseCurrencyTextToMicro)

final class CurrencyInputFieldParseTests: XCTestCase {
    func testParsesPlainUSDToMicro() {
        XCTAssertEqual(CurrencyInputFieldFormatter.parseToMicro(text: "1.50", currency: "USD", locale: enUS), 1_500_000)
    }

    func testParsesEuroGermanToSameMicro() {
        XCTAssertEqual(CurrencyInputFieldFormatter.parseToMicro(text: "1,50", currency: "EUR", locale: deDE), 1_500_000)
    }

    func testParsesIntegerToMicro() {
        XCTAssertEqual(CurrencyInputFieldFormatter.parseToMicro(text: "42", currency: "USD", locale: enUS), 42_000_000)
    }

    func testBlankParsesToNil() {
        XCTAssertNil(CurrencyInputFieldFormatter.parseToMicro(text: "", currency: "USD", locale: enUS))
        XCTAssertNil(CurrencyInputFieldFormatter.parseToMicro(text: "   ", currency: "USD", locale: enUS))
    }

    func testStripsLocalizedSymbol() {
        XCTAssertEqual(
            CurrencyInputFieldFormatter.parseToMicro(text: "$1.50", currency: "USD", locale: enUS),
            1_500_000
        )
    }

    func testStripsLiteralIsoCodeCaseInsensitively() {
        XCTAssertEqual(
            CurrencyInputFieldFormatter.parseToMicro(text: "usd 1.50", currency: "USD", locale: enUS),
            1_500_000
        )
    }

    func testPreservesFullMicroPrecisionBeyondDisplayPrecision() {
        let micro = CurrencyInputFieldFormatter.parseToMicro(text: "0.12345", currency: "USD", locale: enUS)
        XCTAssertEqual(micro, 123_450)
        // Display rounds to "$0.12" while storage keeps the full micro (web round-trip contract).
        XCTAssertEqual(
            CurrencyInputFieldFormatter.formatMicro(micro, currency: "USD", locale: enUS, precision: 2),
            "$0.12"
        )
    }

    func testAccountingParenthesesAreNegative() {
        XCTAssertEqual(
            CurrencyInputFieldFormatter.parseToMicro(text: "($1.50)", currency: "USD", locale: enUS),
            -1_500_000
        )
    }

    func testLeadingSignBetweenSymbolAndDigits() {
        XCTAssertEqual(
            CurrencyInputFieldFormatter.parseToMicro(text: "$-1.50", currency: "USD", locale: enUS),
            -1_500_000
        )
    }
}

// MARK: - parseLocaleNumber (web parseLocaleNumber)

final class CurrencyInputFieldLocaleNumberTests: XCTestCase {
    func testEnglishGroupingAndDecimal() {
        XCTAssertEqual(CurrencyInputFieldFormatter.parseLocaleNumber("1,234.56", locale: enUS), 1234.56)
    }

    func testGermanGroupingAndDecimal() {
        XCTAssertEqual(CurrencyInputFieldFormatter.parseLocaleNumber("1.234,56", locale: deDE), 1234.56)
    }

    func testFrenchSpaceGroupingAndDecimal() {
        XCTAssertEqual(CurrencyInputFieldFormatter.parseLocaleNumber("1 234,56", locale: frFR), 1234.56)
        XCTAssertEqual(CurrencyInputFieldFormatter.parseLocaleNumber("1\u{202F}234,56", locale: frFR), 1234.56)
    }

    func testUnparseableReturnsNil() {
        XCTAssertNil(CurrencyInputFieldFormatter.parseLocaleNumber("abc", locale: enUS))
        XCTAssertNil(CurrencyInputFieldFormatter.parseLocaleNumber("", locale: enUS))
    }
}

// MARK: - codeFromSymbol (web currencyCodeFromSymbol)

final class CurrencyInputFieldCodeFromSymbolTests: XCTestCase {
    func testKnownSymbols() {
        XCTAssertEqual(CurrencyInputFieldFormatter.code(fromSymbol: "$"), "USD")
        XCTAssertEqual(CurrencyInputFieldFormatter.code(fromSymbol: "€"), "EUR")
        XCTAssertEqual(CurrencyInputFieldFormatter.code(fromSymbol: "£"), "GBP")
        XCTAssertEqual(CurrencyInputFieldFormatter.code(fromSymbol: "kr"), "SEK")
    }

    func testUnknownSymbolDefaultsToUSD() {
        XCTAssertEqual(CurrencyInputFieldFormatter.code(fromSymbol: "??"), "USD")
        XCTAssertEqual(CurrencyInputFieldFormatter.code(fromSymbol: nil), "USD")
    }
}

// MARK: - Accessibility (composed field label)

final class CurrencyInputFieldAccessibilityTests: XCTestCase {
    func testLabelWithValue() {
        let label = CurrencyInputFieldAccessibility.fieldLabel(
            ariaLabel: "Electricity Cost (per kWh)", value: "$1.50", emptyHint: "Not set"
        )
        XCTAssertEqual(label, "Electricity Cost (per kWh), $1.50")
    }

    func testLabelWhenEmptyUsesHint() {
        let label = CurrencyInputFieldAccessibility.fieldLabel(
            ariaLabel: "Tariff", value: "   ", emptyHint: "Not set"
        )
        XCTAssertEqual(label, "Tariff, Not set")
    }
}

// MARK: - Projection (web render branches + P4 leaf)

final class CurrencyInputFieldProjectionTests: XCTestCase {
    func testErrorTakesPrecedence() {
        let resolved = CurrencyInputFieldProjection.resolve(
            CurrencyInputFieldInput(valueMicro: 1_500_000, errorMessage: "boom")
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
    }

    func testLoadingWhenFlagged() {
        let resolved = CurrencyInputFieldProjection.resolve(CurrencyInputFieldInput(isLoading: true))
        XCTAssertEqual(resolved.phase, .loading)
    }

    func testReadyPopulatedCarriesDisplayAndSymbol() {
        let resolved = CurrencyInputFieldProjection.resolve(CurrencyInputFieldInput(
            valueMicro: 1_500_000, currency: "USD", locale: enUS, ariaLabel: "Tariff"
        ))
        XCTAssertEqual(resolved.phase, .ready)
        XCTAssertEqual(resolved.canonicalDisplay, "$1.50")
        XCTAssertEqual(resolved.symbol, "$")
        XCTAssertEqual(resolved.ariaLabel, "Tariff")
        XCTAssertFalse(resolved.isEmptyValue)
    }

    func testReadyEmptyHasBlankDisplay() {
        let resolved = CurrencyInputFieldProjection.resolve(CurrencyInputFieldInput(
            valueMicro: nil, currency: "USD", locale: enUS
        ))
        XCTAssertEqual(resolved.phase, .ready)
        XCTAssertEqual(resolved.canonicalDisplay, "")
        XCTAssertTrue(resolved.isEmptyValue)
    }

    func testEmptyErrorMessageDoesNotForceError() {
        let resolved = CurrencyInputFieldProjection.resolve(
            CurrencyInputFieldInput(valueMicro: 1_500_000, errorMessage: "")
        )
        XCTAssertEqual(resolved.phase, .ready)
    }

    func testRequiredAndDisabledCarryThrough() {
        let resolved = CurrencyInputFieldProjection.resolve(CurrencyInputFieldInput(
            valueMicro: nil, isRequired: true, isDisabled: true
        ))
        XCTAssertTrue(resolved.isRequired)
        XCTAssertTrue(resolved.isDisabled)
    }
}

// MARK: - Live source (production value bridge + commit write-back)

@MainActor
final class LiveCurrencyInputFieldSourceTests: XCTestCase {
    func testStartEmitsInitialValue() {
        let source = LiveCurrencyInputFieldSource(value: CurrencyInputFieldInput(valueMicro: 1_500_000))
        var latest: CurrencyInputFieldInput?
        source.onUpdate = { latest = $0 }
        source.start()
        XCTAssertEqual(latest?.valueMicro, 1_500_000)
    }

    func testUpdateReEmitsTheNewValue() {
        let source = LiveCurrencyInputFieldSource()
        var latest: CurrencyInputFieldInput?
        source.onUpdate = { latest = $0 }
        source.start()
        source.update(CurrencyInputFieldInput(valueMicro: 2_500_000, currency: "EUR"))
        XCTAssertEqual(latest?.valueMicro, 2_500_000)
        XCTAssertEqual(latest?.currency, "EUR")
    }

    func testCommitForwardsToOnCommitAndReEmits() {
        var committed: [Int?] = []
        let source = LiveCurrencyInputFieldSource(onCommit: { committed.append($0) })
        var emissions: [Int?] = []
        source.onUpdate = { emissions.append($0.valueMicro) }
        source.start()
        source.commit(750_000)
        XCTAssertEqual(committed, [750_000])
        XCTAssertEqual(emissions.last, 750_000)
    }

    func testRefreshReEmitsCurrentValue() {
        let source = LiveCurrencyInputFieldSource(value: CurrencyInputFieldInput(valueMicro: 5))
        var count = 0
        source.onUpdate = { _ in count += 1 }
        source.start()
        source.refresh()
        XCTAssertEqual(count, 2)
    }
}

// MARK: - In-memory source (records commits / push)

@MainActor
final class InMemoryCurrencyInputFieldSourceTests: XCTestCase {
    func testStartEmitsInitialAndCountsLifecycle() {
        let source = InMemoryCurrencyInputFieldSource(initial: CurrencyInputFieldInput(valueMicro: 1))
        var latest: CurrencyInputFieldInput?
        source.onUpdate = { latest = $0 }
        source.start()
        source.refresh()
        source.stop()
        XCTAssertEqual(latest?.valueMicro, 1)
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertEqual(source.stopCount, 1)
    }

    func testCommitIsRecordedAndPushEmits() {
        let source = InMemoryCurrencyInputFieldSource()
        var latest: CurrencyInputFieldInput?
        source.onUpdate = { latest = $0 }
        source.commit(1_500_000)
        source.commit(nil)
        source.push(CurrencyInputFieldInput(valueMicro: 9))
        XCTAssertEqual(source.committed, [1_500_000, nil])
        XCTAssertEqual(latest?.valueMicro, 9)
    }
}
