//
//  Label.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0218 · Label (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the blank-content detection
//  (the native "never a blank box" trigger), the accessible-name composition (the verbatim port of the web
//  `children` + the visually-hidden ` ${t('form.required')}`), the projection across the not-required /
//  required / empty branches, and the value-type equality. Split from Label.Tests.swift (the SwiftUI /
//  state-holder half) to keep each file within the SwiftLint file-length budget. These run in the
//  TeslaSync(/-macOS) XCTest targets; the derivation is pure, with no network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class LabelAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(LabelSurface.slug, "Label")
    }

    func testRequiredMarkerGlyphIsAsterisk() {
        XCTAssertEqual(LabelProjector.requiredMarker, "*")
    }
}

// MARK: - Blank-content detection (native never-a-blank-box trigger)

final class LabelBlankDetectionTests: XCTestCase {
    func testEmptyStringIsBlank() {
        XCTAssertTrue(LabelProjector.isBlank(""))
    }

    func testWhitespaceOnlyIsBlank() {
        XCTAssertTrue(LabelProjector.isBlank("   \n\t "))
    }

    func testNonBlankText() {
        XCTAssertFalse(LabelProjector.isBlank("Email"))
        XCTAssertFalse(LabelProjector.isBlank("  Email  "))
    }
}

// MARK: - Accessible-name composition (web children + visually-hidden ` required`)

final class LabelAccessibilityLabelTests: XCTestCase {
    func testNotRequiredUsesBaseOnly() {
        XCTAssertEqual(
            LabelProjector.accessibilityLabel(base: "Email", isRequired: false, requiredWord: "required"),
            "Email"
        )
    }

    func testRequiredAppendsWord() {
        XCTAssertEqual(
            LabelProjector.accessibilityLabel(base: "Email", isRequired: true, requiredWord: "required"),
            "Email required"
        )
    }

    func testRequiredHonorsLocalizedWord() {
        XCTAssertEqual(
            LabelProjector.accessibilityLabel(base: "Courriel", isRequired: true, requiredWord: "obligatoire"),
            "Courriel obligatoire"
        )
    }
}

// MARK: - Projection (not-required / required / empty)

final class LabelProjectionTests: XCTestCase {
    private func projection(_ input: LabelInput) -> LabelProjection {
        LabelProjector.resolve(input: input, requiredWord: "required", emptyFallback: "Unlabeled field")
    }

    func testNotRequiredProjection() {
        let proj = projection(LabelInput(text: "Email"))
        XCTAssertEqual(proj.displayText, "Email")
        XCTAssertFalse(proj.showsRequiredMarker)
        XCTAssertEqual(proj.accessibilityLabel, "Email")
        XCTAssertFalse(proj.isEmpty)
        XCTAssertNil(proj.fieldIdentifier)
    }

    func testRequiredProjection() {
        let proj = projection(LabelInput(text: "Email", isRequired: true, fieldIdentifier: "email"))
        XCTAssertEqual(proj.displayText, "Email")
        XCTAssertTrue(proj.showsRequiredMarker)
        XCTAssertEqual(proj.requiredMarkerGlyph, "*")
        XCTAssertEqual(proj.accessibilityLabel, "Email required")
        XCTAssertFalse(proj.isEmpty)
        XCTAssertEqual(proj.fieldIdentifier, "email")
    }

    func testEmptyProjectionUsesFallbackLeaf() {
        let proj = projection(LabelInput(text: "   "))
        XCTAssertTrue(proj.isEmpty)
        XCTAssertEqual(proj.displayText, "Unlabeled field")
        XCTAssertFalse(proj.showsRequiredMarker)
        XCTAssertEqual(proj.accessibilityLabel, "Unlabeled field")
    }

    func testEmptyRequiredProjectionComposesFallbackAndWord() {
        let proj = projection(LabelInput(text: "", isRequired: true))
        XCTAssertTrue(proj.isEmpty)
        XCTAssertEqual(proj.displayText, "Unlabeled field")
        XCTAssertTrue(proj.showsRequiredMarker)
        XCTAssertEqual(proj.accessibilityLabel, "Unlabeled field required")
    }

    func testDisplayTextPreservesNonBlankWhitespacePadding() {
        // Non-blank content is rendered verbatim (web children), not trimmed.
        let proj = projection(LabelInput(text: "  Email  "))
        XCTAssertEqual(proj.displayText, "  Email  ")
        XCTAssertFalse(proj.isEmpty)
    }
}

// MARK: - Value-type equality

final class LabelValueTypeTests: XCTestCase {
    func testInputEquality() {
        let lhs = LabelInput(text: "Email", isRequired: true, fieldIdentifier: "email")
        let rhs = LabelInput(text: "Email", isRequired: true, fieldIdentifier: "email")
        XCTAssertEqual(lhs, rhs)
        XCTAssertNotEqual(lhs, LabelInput(text: "Email", isRequired: false, fieldIdentifier: "email"))
        XCTAssertNotEqual(lhs, LabelInput(text: "E-mail", isRequired: true, fieldIdentifier: "email"))
        XCTAssertNotEqual(lhs, LabelInput(text: "Email", isRequired: true, fieldIdentifier: nil))
    }

    func testProjectionEquality() {
        let lhs = LabelProjector.resolve(
            input: LabelInput(text: "Email", isRequired: true),
            requiredWord: "required",
            emptyFallback: "Unlabeled field"
        )
        let rhs = LabelProjector.resolve(
            input: LabelInput(text: "Email", isRequired: true),
            requiredWord: "required",
            emptyFallback: "Unlabeled field"
        )
        XCTAssertEqual(lhs, rhs)
        let other = LabelProjector.resolve(
            input: LabelInput(text: "Email", isRequired: false),
            requiredWord: "required",
            emptyFallback: "Unlabeled field"
        )
        XCTAssertNotEqual(lhs, other)
    }
}
