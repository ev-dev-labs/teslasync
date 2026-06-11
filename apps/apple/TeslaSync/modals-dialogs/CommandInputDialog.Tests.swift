//
//  CommandInputDialog.Tests.swift
//  TeslaSync — P4 modal/dialog · 0030 · CommandInputDialog (Apple)
//
//  Adapter + projection + accessibility coverage for the CommandInputDialog surface:
//    • `CommandInputProjection.resolvePhase` — the loading / empty / error / content envelope rules.
//    • `CommandInputProjection.entryMode` — the web `resolveInputType` + `resolveInputMode` fold.
//    • `CommandInputProjection.initialValues` / `showsLabel` — the web `buildInitialValues` + label rule.
//    • `CommandInputProjection.validate` — the verbatim web `validateField` port: Required, pin, the
//      canonical whole-integer guard (`String(parseInt) === trimmed`), the lenient `parseFloat` decimal
//      rule, and the min/max bounds with `{{value}}` substitution.
//    • `CommandInputProjection.canonicalInteger` / `jsParseFloat` — the parse primitives directly.
//    • `CommandInputProjection.isValid` — the all-fields-valid gate.
//    • `CommandInputAccessibility` — the dialog summary + close VoiceOver content.
//
//  Pure, bundle-free: copy resolves through an identity localizer.
//

import XCTest
@testable import TeslaSync

/// Identity localizer: returns each call's English fallback so assertions read the real copy without a
/// bundle (the projection then applies any `{{value}}` substitution on top).
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

// MARK: - Phase resolution

final class CommandInputPhaseTests: XCTestCase {
    private let context = CommandInputContext(
        spec: CommandInputSpec(
            commandID: "x", titleKey: "k", titleFallback: "T", promptKey: "p", promptFallback: "P",
            fields: [CommandInputField(name: "v")]
        )
    )

    func testLoadingResolvesByContextPresence() {
        XCTAssertEqual(CommandInputProjection.resolvePhase(status: .loading, context: nil), .loading)
        XCTAssertEqual(CommandInputProjection.resolvePhase(status: .loading, context: context), .content)
    }

    func testLoadedNoContextResolvesEmpty() {
        XCTAssertEqual(CommandInputProjection.resolvePhase(status: .loaded, context: nil), .empty)
    }

    func testLoadedWithContextResolvesContent() {
        XCTAssertEqual(CommandInputProjection.resolvePhase(status: .loaded, context: context), .content)
    }

    func testFailedResolvesErrorOrKeepsContent() {
        XCTAssertEqual(CommandInputProjection.resolvePhase(status: .failed("boom"), context: nil), .error("boom"))
        XCTAssertEqual(CommandInputProjection.resolvePhase(status: .failed("boom"), context: context), .content)
    }
}

// MARK: - Entry mode (web resolveInputType + resolveInputMode)

final class CommandInputEntryModeTests: XCTestCase {
    func testEntryModeByValidation() {
        XCTAssertEqual(CommandInputProjection.entryMode(for: .pin), .secureNumeric)
        XCTAssertEqual(CommandInputProjection.entryMode(for: .number), .numeric)
        XCTAssertEqual(CommandInputProjection.entryMode(for: .decimal), .decimal)
        XCTAssertEqual(CommandInputProjection.entryMode(for: .text), .text)
        XCTAssertEqual(CommandInputProjection.entryMode(for: nil), .text)
    }
}

// MARK: - Initial values + label rule (web buildInitialValues)

final class CommandInputInitialValuesTests: XCTestCase {
    func testInitialValuesSeedEachField() {
        let spec = CommandInputSpec(
            commandID: "c", titleKey: "k", titleFallback: "T", promptKey: "p", promptFallback: "P",
            fields: [
                CommandInputField(name: "lat", initialValue: ""),
                CommandInputField(name: "percent", initialValue: "80")
            ]
        )
        XCTAssertEqual(CommandInputProjection.initialValues(spec), ["lat": "", "percent": "80"])
    }

    func testShowsLabelOnlyWhenFallbackPresent() {
        let labelled = CommandInputField(name: "lat", labelKey: "k", labelFallback: "Latitude")
        let unlabelled = CommandInputField(name: "pin")
        let empty = CommandInputField(name: "x", labelKey: "k", labelFallback: "")
        XCTAssertTrue(CommandInputProjection.showsLabel(labelled))
        XCTAssertFalse(CommandInputProjection.showsLabel(unlabelled))
        XCTAssertFalse(CommandInputProjection.showsLabel(empty))
    }
}

// MARK: - validateField (web validateField, ported verbatim)

final class CommandInputValidateTests: XCTestCase {
    private func validate(
        _ value: String,
        _ validation: CommandFieldValidation?,
        min: Double? = nil,
        max: Double? = nil
    ) -> String? {
        CommandInputProjection.validate(
            value: value, validation: validation, min: min, max: max, localize: passthroughLocalize
        )
    }

    func testEmptyIsRequiredForEveryKind() {
        XCTAssertEqual(validate("", .pin), "Required")
        XCTAssertEqual(validate("   ", .number), "Required")
        XCTAssertEqual(validate("", .decimal), "Required")
        XCTAssertEqual(validate("", .text), "Required")
        XCTAssertEqual(validate("", nil), "Required")
    }

    func testPinRequiresExactlyFourDigits() {
        XCTAssertNil(validate("1234", .pin))
        XCTAssertNil(validate("  1234 ", .pin)) // trimmed first
        XCTAssertEqual(validate("123", .pin), "Enter a 4-digit PIN")
        XCTAssertEqual(validate("12345", .pin), "Enter a 4-digit PIN")
        XCTAssertEqual(validate("12a4", .pin), "Enter a 4-digit PIN")
    }

    func testNumberRequiresCanonicalWholeInteger() {
        XCTAssertNil(validate("50", .number))
        XCTAssertNil(validate("0", .number))
        XCTAssertNil(validate("-5", .number))
        XCTAssertEqual(validate("007", .number), "Enter a whole number")
        XCTAssertEqual(validate("1.5", .number), "Enter a whole number")
        XCTAssertEqual(validate("1abc", .number), "Enter a whole number")
        XCTAssertEqual(validate("+5", .number), "Enter a whole number")
        XCTAssertEqual(validate("-0", .number), "Enter a whole number")
    }

    func testNumberBounds() {
        XCTAssertEqual(validate("40", .number, min: 50, max: 90), "Minimum: 50")
        XCTAssertEqual(validate("100", .number, min: 50, max: 90), "Maximum: 90")
        XCTAssertNil(validate("50", .number, min: 50, max: 90))
        XCTAssertNil(validate("90", .number, min: 50, max: 90))
    }

    func testDecimalUsesLenientParseFloat() {
        XCTAssertNil(validate("21", .decimal))
        XCTAssertNil(validate("21.5", .decimal))
        XCTAssertNil(validate(".5", .decimal))
        XCTAssertNil(validate("5.", .decimal))
        XCTAssertNil(validate("1.5abc", .decimal)) // parseFloat → 1.5 (lenient, not NaN)
        XCTAssertEqual(validate("abc", .decimal), "Enter a valid number")
    }

    func testDecimalBounds() {
        XCTAssertEqual(validate("10", .decimal, min: 15, max: 30), "Minimum: 15")
        XCTAssertEqual(validate("35", .decimal, min: 15, max: 30), "Maximum: 30")
        XCTAssertNil(validate("15", .decimal, min: 15, max: 30))
        XCTAssertNil(validate("22.5", .decimal, min: 15, max: 30))
    }

    func testTextAndNoneAcceptAnyNonEmpty() {
        XCTAssertNil(validate("123 Main St", .text))
        XCTAssertNil(validate("anything", nil))
    }
}

// MARK: - Number parse primitives (web parseInt / parseFloat)

final class CommandInputNumberParsingTests: XCTestCase {
    func testCanonicalIntegerMatchesParseIntRoundTrip() {
        XCTAssertEqual(CommandInputProjection.canonicalInteger("0"), 0)
        XCTAssertEqual(CommandInputProjection.canonicalInteger("42"), 42)
        XCTAssertEqual(CommandInputProjection.canonicalInteger("-7"), -7)
        XCTAssertNil(CommandInputProjection.canonicalInteger("-0"))
        XCTAssertNil(CommandInputProjection.canonicalInteger("007"))
        XCTAssertNil(CommandInputProjection.canonicalInteger("+5"))
        XCTAssertNil(CommandInputProjection.canonicalInteger("3.0"))
        XCTAssertNil(CommandInputProjection.canonicalInteger("99999999999999999999")) // beyond MAX_SAFE_INTEGER
    }

    func testJSParseFloatPrefixSemantics() {
        XCTAssertEqual(CommandInputProjection.jsParseFloat("1.5abc"), 1.5)
        XCTAssertEqual(CommandInputProjection.jsParseFloat(".5"), 0.5)
        XCTAssertEqual(CommandInputProjection.jsParseFloat("5."), 5)
        XCTAssertEqual(CommandInputProjection.jsParseFloat("-2.5"), -2.5)
        XCTAssertEqual(CommandInputProjection.jsParseFloat("1e3"), 1000)
        XCTAssertEqual(CommandInputProjection.jsParseFloat("Infinity"), .infinity)
        XCTAssertNil(CommandInputProjection.jsParseFloat("abc"))
        XCTAssertNil(CommandInputProjection.jsParseFloat("."))
    }
}

// MARK: - isValid (web isValid gate)

final class CommandInputIsValidTests: XCTestCase {
    private let spec = CommandInputSpec(
        commandID: "c", titleKey: "k", titleFallback: "T", promptKey: "p", promptFallback: "P",
        fields: [
            CommandInputField(name: "lat", validation: .decimal),
            CommandInputField(name: "lon", validation: .decimal)
        ]
    )

    func testValidOnlyWhenEveryFieldValid() {
        XCTAssertTrue(CommandInputProjection.isValid(spec: spec, values: ["lat": "37.7", "lon": "-122.4"]))
        XCTAssertFalse(CommandInputProjection.isValid(spec: spec, values: ["lat": "37.7", "lon": ""]))
        XCTAssertFalse(CommandInputProjection.isValid(spec: spec, values: ["lat": "abc", "lon": "-122.4"]))
    }
}

// MARK: - Accessibility

final class CommandInputAccessibilityTests: XCTestCase {
    func testSummaryJoinsTitleAndPrompt() {
        XCTAssertEqual(
            CommandInputAccessibility.summary(title: "Set Limit", prompt: "Enter charge limit"),
            "Set Limit, Enter charge limit"
        )
    }

    func testSummaryIsTitleOnlyWhenPromptEmpty() {
        XCTAssertEqual(CommandInputAccessibility.summary(title: "Set Limit", prompt: ""), "Set Limit")
    }

    func testCloseLabel() {
        XCTAssertEqual(CommandInputAccessibility.closeLabel(localize: passthroughLocalize), "Close")
    }
}
