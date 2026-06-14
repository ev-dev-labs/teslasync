//
//  Input.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0217 · Input (Apple)
//
//  Pure-core coverage for the Input surface (Foundation only, no view, no store):
//    • InputFieldMeta — the diagnostics slug, the `size` default, the `inputId` slugify + resolution
//      (the verbatim port of the web `id || label?.toLowerCase().replace(/\s+/g, '-')`), and the
//      child element id builder.
//    • InputFieldSize — the web `'sm'` / `'md'` / `'lg'` / `'auto'` literal mapping (+ the
//      unrecognised / absent fallback), the case set, and the per-size padding / type / min-height
//      metrics.
//    • InputFieldAccessibility — the field name (label / placeholder / unlabeled fallback + the spoken
//      "required"), the describedby hint (error format / hint / none), and the help-trigger name,
//      each routed through the injected facade.
//    • InputFieldInput — the default arguments.
//
//  These run in the TeslaSync(/-macOS) XCTest targets with no network and no real store, so each
//  assertion reads the pure core directly. The projection / model / view / telemetry coverage lives in
//  Input.Tests.swift.
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - Fixtures

/// A resolver that echoes the key so key-routing can be asserted deterministically. The echoed key
/// has no `%@`, so a `String(format:)` consumer returns it unchanged.
private let echoStrings: InputFieldResolve = { key, _ in "[\(key)]" }

// MARK: - InputFieldMeta (slug + inputId resolution)

final class InputFieldMetaTests: XCTestCase {
    func testSurfaceSlugAndDefaults() {
        XCTAssertEqual(InputFieldMeta.surfaceSlug, "Input")
        XCTAssertEqual(InputFieldMeta.defaultSize, .medium)
        XCTAssertEqual(InputFieldMeta.identifierPrefix, "input")
    }

    func testSlugifyLowercasesAndCollapsesWhitespace() {
        XCTAssertEqual(InputFieldMeta.slugify("Display Name"), "display-name")
        XCTAssertEqual(InputFieldMeta.slugify("Charge   Limit"), "charge-limit")
        XCTAssertEqual(InputFieldMeta.slugify("VIN"), "vin")
        // Leading / trailing whitespace runs collapse to a single hyphen, exactly as JS `\s+` does.
        XCTAssertEqual(InputFieldMeta.slugify(" Trip Name "), "-trip-name-")
    }

    func testResolveIdentifierPrefersExplicitIDThenSlugThenPrefix() {
        XCTAssertEqual(InputFieldMeta.resolveIdentifier(id: "custom", label: "Display Name"), "custom")
        XCTAssertEqual(InputFieldMeta.resolveIdentifier(id: nil, label: "Display Name"), "display-name")
        // An empty explicit id is falsy (web `id ||`), so the label wins.
        XCTAssertEqual(InputFieldMeta.resolveIdentifier(id: "", label: "Charge Limit"), "charge-limit")
        // Neither id nor label → the stable fallback prefix (native peer of the web `undefined`).
        XCTAssertEqual(InputFieldMeta.resolveIdentifier(id: nil, label: nil), "input")
        XCTAssertEqual(InputFieldMeta.resolveIdentifier(id: nil, label: ""), "input")
    }

    func testElementIDComposesChildIds() {
        XCTAssertEqual(InputFieldMeta.elementID("charge-limit", "error"), "charge-limit-error")
        XCTAssertEqual(InputFieldMeta.elementID("charge-limit", "hint"), "charge-limit-hint")
        XCTAssertEqual(InputFieldMeta.elementID("charge-limit", "help"), "charge-limit-help")
    }
}

// MARK: - InputFieldSize (web literal mapping + metrics)

final class InputFieldSizeTests: XCTestCase {
    func testFromMapsWebLiterals() {
        XCTAssertEqual(InputFieldSize.from("sm"), .small)
        XCTAssertEqual(InputFieldSize.from("md"), .medium)
        XCTAssertEqual(InputFieldSize.from("lg"), .large)
        XCTAssertEqual(InputFieldSize.from("auto"), .auto)
    }

    func testFromFallsBackForAbsentOrUnknown() {
        XCTAssertEqual(InputFieldSize.from(nil), InputFieldMeta.defaultSize)
        XCTAssertEqual(InputFieldSize.from("xl"), InputFieldMeta.defaultSize)
        XCTAssertEqual(InputFieldSize.from(""), InputFieldMeta.defaultSize)
    }

    func testRawValuesAndCaseSet() {
        XCTAssertEqual(InputFieldSize.small.rawValue, "sm")
        XCTAssertEqual(InputFieldSize.medium.rawValue, "md")
        XCTAssertEqual(InputFieldSize.large.rawValue, "lg")
        XCTAssertEqual(InputFieldSize.auto.rawValue, "auto")
        XCTAssertEqual(Set(InputFieldSize.allCases), [.small, .medium, .large, .auto])
    }

    func testMetricsScaleWithSize() {
        // Type grows monotonically with the fixed size variants, mirroring the web text scale.
        XCTAssertEqual(InputFieldSize.small.metrics.fontPointSize, 12, accuracy: 0.0001)
        XCTAssertEqual(InputFieldSize.medium.metrics.fontPointSize, 14, accuracy: 0.0001)
        XCTAssertEqual(InputFieldSize.large.metrics.fontPointSize, 16, accuracy: 0.0001)
        XCTAssertLessThan(
            InputFieldSize.small.metrics.horizontalPadding,
            InputFieldSize.large.metrics.horizontalPadding
        )
        XCTAssertLessThan(InputFieldSize.small.metrics.verticalPadding, InputFieldSize.large.metrics.verticalPadding)
    }

    func testOnlyAutoEnforcesADensityMinHeight() {
        XCTAssertEqual(InputFieldSize.auto.metrics.minHeight, 44, accuracy: 0.0001)
        XCTAssertEqual(InputFieldSize.small.metrics.minHeight, 0, accuracy: 0.0001)
        XCTAssertEqual(InputFieldSize.medium.metrics.minHeight, 0, accuracy: 0.0001)
        XCTAssertEqual(InputFieldSize.large.metrics.minHeight, 0, accuracy: 0.0001)
        // The density variant adopts the medium type / inset.
        XCTAssertEqual(InputFieldSize.auto.metrics.fontPointSize, InputFieldSize.medium.metrics.fontPointSize)
    }
}

// MARK: - InputFieldAccessibility (name + describedby hint + help label)

final class InputFieldAccessibilityTests: XCTestCase {
    func testNamePrefersLabelThenPlaceholderThenFallback() {
        XCTAssertEqual(
            InputFieldAccessibility.name(
                label: "Charge limit",
                placeholder: "80",
                isRequired: false,
                strings: echoStrings
            ),
            "Charge limit"
        )
        XCTAssertEqual(
            InputFieldAccessibility.name(label: nil, placeholder: "Search", isRequired: false, strings: echoStrings),
            "Search"
        )
        XCTAssertEqual(
            InputFieldAccessibility.name(label: nil, placeholder: nil, isRequired: false, strings: echoStrings),
            "[input.accessibility.unlabeled]"
        )
    }

    func testNameAppendsSpokenRequired() {
        XCTAssertEqual(
            InputFieldAccessibility.name(
                label: "Charge limit",
                placeholder: nil,
                isRequired: true,
                strings: echoStrings
            ),
            "Charge limit [input.accessibility.required]"
        )
    }

    func testNameDefaultResolverReturnsFallbackCopy() {
        XCTAssertEqual(
            InputFieldAccessibility.name(
                label: nil,
                placeholder: nil,
                isRequired: true,
                strings: InputFieldStrings.string
            ),
            "Input field required"
        )
    }

    func testHintPrefersErrorThenHintThenNil() {
        XCTAssertEqual(
            InputFieldAccessibility.hint(
                error: "Too low",
                hint: "Between 50 and 100",
                strings: InputFieldStrings.string
            ),
            "Error: Too low"
        )
        XCTAssertEqual(
            InputFieldAccessibility.hint(error: nil, hint: "Between 50 and 100", strings: InputFieldStrings.string),
            "Between 50 and 100"
        )
        XCTAssertNil(InputFieldAccessibility.hint(error: nil, hint: nil, strings: InputFieldStrings.string))
    }

    func testHelpLabelFormatsFieldName() {
        XCTAssertEqual(
            InputFieldAccessibility.helpLabel(field: "charge-limit", strings: InputFieldStrings.string),
            "Help for charge-limit"
        )
    }
}

// MARK: - InputFieldInput (default arguments)

final class InputFieldInputDefaultsTests: XCTestCase {
    func testDefaults() {
        let snapshot = InputFieldInput()
        XCTAssertEqual(snapshot.identifier, InputFieldMeta.identifierPrefix)
        XCTAssertNil(snapshot.label)
        XCTAssertNil(snapshot.helpText)
        XCTAssertEqual(snapshot.helpFieldName, InputFieldMeta.identifierPrefix)
        XCTAssertNil(snapshot.placeholder)
        XCTAssertNil(snapshot.error)
        XCTAssertNil(snapshot.hint)
        XCTAssertFalse(snapshot.hasIcon)
        XCTAssertFalse(snapshot.hasSuffix)
        XCTAssertEqual(snapshot.size, InputFieldMeta.defaultSize)
        XCTAssertFalse(snapshot.isRequired)
        XCTAssertFalse(snapshot.isDisabled)
        XCTAssertFalse(snapshot.isSecure)
    }
}
