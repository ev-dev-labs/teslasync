//
//  FlagEditDrawer.Tests.swift
//  TeslaSync — P4 modal / dialog · 0019 · FlagEditDrawer (Apple)
//
//  Adapter + projection + accessibility coverage for the FlagEditDrawer surface:
//    • `FlagEditDrawerProjection.parseValue` — the web `JSON.parse` memo (empty / valid scalars +
//      containers / invalid), and `FlagEditJSONValue.from(json:)`.
//    • `FlagEditDrawerProjection.defaultValueJSON` — the web `defaultValueJson` (absent → "",
//      round-trips a value through pretty JSON).
//    • `FlagEditDrawerProjection.valueErrorMessage` — the web `parsed.error` copy (required / invalid).
//    • `FlagEditDrawerProjection.isNonBlank` / `canSave` — the web `keyValid` / `reasonValid` gates +
//      `canSave = parsed.ok && keyValid && reasonValid && !saving`.
//    • `FlagEditDrawerProjection.title` — the web `editTitle` template + `createTitle`.
//    • `FlagEditDrawerProjection.resolvePhase` / `resolveVisibility` / `inlineFailure` — the body
//      phase, the visibility machine (incl. pinned), and the inline envelope.
//    • `FlagEditDrawerAccessibility` — the panel, field, and value-field VoiceOver copy.
//
//  Pure, bundle-free: copy resolves through an identity localizer.
//

import XCTest
@testable import TeslaSync

/// Identity localizer: returns each call's English fallback so assertions read the real copy.
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

// MARK: - parseValue + FlagEditJSONValue (web JSON.parse)

final class FlagEditDrawerParseTests: XCTestCase {
    func testBlankInputIsEmpty() {
        XCTAssertEqual(FlagEditDrawerProjection.parseValue(""), .empty)
        XCTAssertEqual(FlagEditDrawerProjection.parseValue("   \n\t"), .empty)
    }

    func testValidObjectAndArray() {
        XCTAssertEqual(
            FlagEditDrawerProjection.parseValue("{\"enabled\": true}"),
            .valid(.object(["enabled": .bool(true)]))
        )
        XCTAssertEqual(
            FlagEditDrawerProjection.parseValue("[1, 2, 3]"),
            .valid(.array([.number(1), .number(2), .number(3)]))
        )
    }

    func testValidTopLevelScalars() {
        XCTAssertEqual(FlagEditDrawerProjection.parseValue("true"), .valid(.bool(true)))
        XCTAssertEqual(FlagEditDrawerProjection.parseValue("42"), .valid(.number(42)))
        XCTAssertEqual(FlagEditDrawerProjection.parseValue("\"hi\""), .valid(.string("hi")))
        XCTAssertEqual(FlagEditDrawerProjection.parseValue("null"), .valid(.null))
    }

    func testInvalidJSONReportsDetail() {
        let result = FlagEditDrawerProjection.parseValue("{ \"enabled\": true,")
        guard case let .invalid(detail) = result else {
            return XCTFail("expected .invalid, got \(result)")
        }
        XCTAssertFalse(detail.isEmpty)
        XCTAssertFalse(result.isValid)
        XCTAssertNil(result.value)
    }

    func testFromJSONMapsKinds() {
        XCTAssertEqual(FlagEditJSONValue.from(json: nil), .null)
        XCTAssertEqual(FlagEditJSONValue.from(json: NSNull()), .null)
        XCTAssertEqual(FlagEditJSONValue.from(json: true), .bool(true))
        XCTAssertEqual(FlagEditJSONValue.from(json: 7), .number(7))
        XCTAssertEqual(FlagEditJSONValue.from(json: "x"), .string("x"))
        XCTAssertEqual(FlagEditJSONValue.from(json: ["a": 1]), .object(["a": .number(1)]))
    }
}

// MARK: - defaultValueJSON (web defaultValueJson)

final class FlagEditDrawerSeedTests: XCTestCase {
    func testAbsentInitialSeedsEmpty() {
        XCTAssertEqual(FlagEditDrawerProjection.defaultValueJSON(nil), "")
    }

    func testInitialRoundTripsThroughPrettyJSON() {
        let value: FlagEditJSONValue = .object([
            "enabled": .bool(true),
            "limit": .number(10),
            "tags": .array([.string("a"), .string("b")])
        ])
        let seed = FlagEditDrawerProjection.defaultValueJSON(FlagEditInitial(key: "k", value: value))
        XCTAssertFalse(seed.isEmpty)
        XCTAssertTrue(seed.contains("\n")) // pretty-printed (multi-line)
        XCTAssertEqual(FlagEditDrawerProjection.parseValue(seed), .valid(value))
    }

    func testScalarInitialSeedsValidJSON() {
        let seed = FlagEditDrawerProjection.defaultValueJSON(FlagEditInitial(key: "k", value: .bool(false)))
        XCTAssertEqual(FlagEditDrawerProjection.parseValue(seed), .valid(.bool(false)))
    }
}

// MARK: - valueErrorMessage (web parsed.error)

final class FlagEditDrawerValueErrorTests: XCTestCase {
    func testValidHasNoError() {
        XCTAssertNil(FlagEditDrawerProjection.valueErrorMessage(.valid(.bool(true)), localize: passthroughLocalize))
    }

    func testEmptyUsesRequiredCopy() {
        XCTAssertEqual(
            FlagEditDrawerProjection.valueErrorMessage(.empty, localize: passthroughLocalize),
            "Value is required."
        )
    }

    func testInvalidSubstitutesDetail() {
        XCTAssertEqual(
            FlagEditDrawerProjection.valueErrorMessage(.invalid("boom"), localize: passthroughLocalize),
            "Invalid JSON: boom"
        )
    }
}

// MARK: - gates (web keyValid / reasonValid / canSave)

final class FlagEditDrawerGateTests: XCTestCase {
    func testIsNonBlank() {
        XCTAssertFalse(FlagEditDrawerProjection.isNonBlank(""))
        XCTAssertFalse(FlagEditDrawerProjection.isNonBlank("   "))
        XCTAssertTrue(FlagEditDrawerProjection.isNonBlank(" x "))
    }

    func testCanSaveMirrorsWeb() {
        XCTAssertTrue(
            FlagEditDrawerProjection.canSave(parseValid: true, keyValid: true, reasonValid: true, saving: false)
        )
        XCTAssertFalse(
            FlagEditDrawerProjection.canSave(parseValid: false, keyValid: true, reasonValid: true, saving: false)
        )
        XCTAssertFalse(
            FlagEditDrawerProjection.canSave(parseValid: true, keyValid: false, reasonValid: true, saving: false)
        )
        XCTAssertFalse(
            FlagEditDrawerProjection.canSave(parseValid: true, keyValid: true, reasonValid: false, saving: false)
        )
        XCTAssertFalse(
            FlagEditDrawerProjection.canSave(parseValid: true, keyValid: true, reasonValid: true, saving: true)
        )
    }
}

// MARK: - title (web editTitle / createTitle)

final class FlagEditDrawerTitleTests: XCTestCase {
    func testEditTitleSubstitutesKey() {
        XCTAssertEqual(
            FlagEditDrawerProjection.title(mode: .edit, initialKey: "feature.x", localize: passthroughLocalize),
            "Edit flag \"feature.x\""
        )
    }

    func testCreateTitle() {
        XCTAssertEqual(
            FlagEditDrawerProjection.title(mode: .create, initialKey: "", localize: passthroughLocalize),
            "Create flag"
        )
    }
}

// MARK: - phase / visibility / inline failure

final class FlagEditDrawerVisibilityTests: XCTestCase {
    func testBodyPhase() {
        XCTAssertEqual(FlagEditDrawerProjection.resolvePhase(status: .loading, hasRequest: false), .loading)
        XCTAssertEqual(FlagEditDrawerProjection.resolvePhase(status: .loading, hasRequest: true), .content)
        XCTAssertEqual(FlagEditDrawerProjection.resolvePhase(status: .loaded, hasRequest: false), .empty)
        XCTAssertEqual(FlagEditDrawerProjection.resolvePhase(status: .loaded, hasRequest: true), .content)
        XCTAssertEqual(FlagEditDrawerProjection.resolvePhase(status: .failed("x"), hasRequest: false), .error("x"))
        XCTAssertEqual(FlagEditDrawerProjection.resolvePhase(status: .failed("x"), hasRequest: true), .content)
    }

    func testVisibilityPresentsWithRequestAndHidesWithout() {
        XCTAssertEqual(FlagEditDrawerProjection.resolveVisibility(hasRequest: true, pinned: false), .presented)
        XCTAssertEqual(FlagEditDrawerProjection.resolveVisibility(hasRequest: false, pinned: false), .hidden)
    }

    func testPinnedSuppressesAmbientHide() {
        XCTAssertEqual(FlagEditDrawerProjection.resolveVisibility(hasRequest: false, pinned: true), .presented)
    }

    func testInlineFailureEnvelope() {
        XCTAssertEqual(FlagEditDrawerProjection.inlineFailure(status: .failed("boom"), hasRequest: true), "boom")
        XCTAssertNil(FlagEditDrawerProjection.inlineFailure(status: .failed("boom"), hasRequest: false))
        XCTAssertNil(FlagEditDrawerProjection.inlineFailure(status: .loaded, hasRequest: true))
    }
}

// MARK: - Accessibility

final class FlagEditDrawerAccessibilityTests: XCTestCase {
    func testPanelLabelUsesTitle() {
        XCTAssertEqual(FlagEditDrawerAccessibility.panelLabel(title: "Create flag"), "Create flag")
    }

    func testFieldLabelAnnouncesEmptyAndValue() {
        XCTAssertEqual(
            FlagEditDrawerAccessibility.fieldLabel(label: "Flag key", value: "", localize: passthroughLocalize),
            "Flag key, Empty"
        )
        XCTAssertEqual(
            FlagEditDrawerAccessibility.fieldLabel(label: "Flag key", value: " abc ", localize: passthroughLocalize),
            "Flag key, abc"
        )
    }

    func testValueFieldLabelAppendsError() {
        XCTAssertEqual(
            FlagEditDrawerAccessibility.valueFieldLabel(label: "Value (JSON)", error: nil),
            "Value (JSON)"
        )
        XCTAssertEqual(
            FlagEditDrawerAccessibility.valueFieldLabel(label: "Value (JSON)", error: "Invalid JSON: x"),
            "Value (JSON), Invalid JSON: x"
        )
    }
}
