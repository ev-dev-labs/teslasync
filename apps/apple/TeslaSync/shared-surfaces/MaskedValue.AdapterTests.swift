//
//  MaskedValue.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0220 · MaskedValue (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the ``MaskVariant``
//  default-show-last table, the byte-for-byte masking rules per variant (the verbatim port of the web
//  `maskFor` from `web/src/lib/maskValue.ts` — token / vin / coords / email / generic, plus the empty +
//  show-last-override edges), the projection (the empty branch, the masked / raw text, the resolved
//  labels, and the `revealed`-driven display + toggle-label helpers), and the value-type equality. Split
//  from MaskedValue.Tests.swift (the SwiftUI / state-holder half) to keep each file within the SwiftLint
//  file-length budget. These run in the TeslaSync(/-macOS) XCTest targets; the derivation is pure, with
//  no network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Test helpers

/// Builds a run of `count` bullet glyphs independently of the masker, so the expectations verify the
/// rule rather than restating the implementation.
private func bul(_ count: Int) -> String {
    String(repeating: "\u{2022}", count: max(count, 0))
}

// MARK: - Surface identity + variant table

final class MaskedValueAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(MaskedValueSurface.slug, "MaskedValue")
    }

    func testVariantRawValuesMatchWebUnion() {
        XCTAssertEqual(MaskVariant.token.rawValue, "token")
        XCTAssertEqual(MaskVariant.vin.rawValue, "vin")
        XCTAssertEqual(MaskVariant.coords.rawValue, "coords")
        XCTAssertEqual(MaskVariant.email.rawValue, "email")
        XCTAssertEqual(MaskVariant.generic.rawValue, "generic")
        XCTAssertEqual(MaskVariant.allCases.count, 5)
    }

    func testDefaultShowLastTableMatchesWeb() {
        XCTAssertEqual(MaskVariant.token.defaultShowLast, 4)
        XCTAssertEqual(MaskVariant.vin.defaultShowLast, 4)
        XCTAssertEqual(MaskVariant.coords.defaultShowLast, 0)
        XCTAssertEqual(MaskVariant.email.defaultShowLast, 1)
        XCTAssertEqual(MaskVariant.generic.defaultShowLast, 0)
    }
}

// MARK: - Token rule (web `maskToken` — fixed 12 bullets + last N)

final class MaskedValueMaskerTokenTests: XCTestCase {
    func testFixedTwelveBulletsPlusLastFourByDefault() {
        XCTAssertEqual(MaskedValueMasker.mask("ABCDEFGH", variant: .token), bul(12) + "EFGH")
    }

    func testLengthIsNotLeaked() {
        // A short and a long token both render 12 bullets + last 4 — the masked form hides the length.
        let short = MaskedValueMasker.mask("0123456789", variant: .token)
        let long = MaskedValueMasker.mask("0123456789ABCDEFGHIJKLMNOP", variant: .token)
        XCTAssertEqual(short, bul(12) + "6789")
        XCTAssertEqual(long, bul(12) + "MNOP")
    }

    func testShowLastOverrideZeroHidesEverything() {
        XCTAssertEqual(MaskedValueMasker.mask("ABCDEFGH", variant: .token, showLast: 0), bul(12))
    }

    func testEmptyTokenIsEmpty() {
        XCTAssertEqual(MaskedValueMasker.mask("", variant: .token), "")
    }
}

// MARK: - VIN rule (web `maskVin` — WMI prefix + bullets + last N; short → fully bulleted)

final class MaskedValueMaskerVinTests: XCTestCase {
    func testFullVinExposesWmiAndLastFour() {
        XCTAssertEqual(
            MaskedValueMasker.mask("5YJ3E1EA7JF000316", variant: .vin),
            "5YJ" + bul(10) + "0316"
        )
    }

    func testElevenCharBoundaryIsTreatedAsVin() {
        XCTAssertEqual(MaskedValueMasker.mask("ABCDEFGHIJK", variant: .vin), "ABC" + bul(4) + "HIJK")
    }

    func testShortInputIsFullyBulleted() {
        // Below 11 chars cannot be a VIN — fully bulleted so the WMI of a tiny string is not exposed.
        XCTAssertEqual(MaskedValueMasker.mask("5YJ", variant: .vin), bul(3))
        XCTAssertEqual(MaskedValueMasker.mask("SHORTVIN", variant: .vin), bul(8))
    }

    func testEmptyVinIsEmpty() {
        XCTAssertEqual(MaskedValueMasker.mask("", variant: .vin), "")
    }
}

// MARK: - Coordinate rule (web `maskCoords` — ••.••• per numeric part; non-numeric → generic)

final class MaskedValueMaskerCoordsTests: XCTestCase {
    func testLatLngPairRendersTwoMaskedGroups() {
        XCTAssertEqual(
            MaskedValueMasker.mask("37.7749,-122.4194", variant: .coords),
            "\u{2022}\u{2022}.\u{2022}\u{2022}\u{2022}, \u{2022}\u{2022}.\u{2022}\u{2022}\u{2022}"
        )
    }

    func testSingleNumberRendersOneMaskedGroup() {
        XCTAssertEqual(
            MaskedValueMasker.mask("37.7749", variant: .coords),
            "\u{2022}\u{2022}.\u{2022}\u{2022}\u{2022}"
        )
    }

    func testWhitespaceAroundPartsIsTolerated() {
        XCTAssertEqual(
            MaskedValueMasker.mask(" 37.77 , -122.41 ", variant: .coords),
            "\u{2022}\u{2022}.\u{2022}\u{2022}\u{2022}, \u{2022}\u{2022}.\u{2022}\u{2022}\u{2022}"
        )
    }

    func testNonNumericFallsBackToGenericOverWholeString() {
        // The whole trimmed string (comma included) is generically masked, length-for-length.
        XCTAssertEqual(MaskedValueMasker.mask("abc,def", variant: .coords), bul(7))
    }

    func testEmptyAndSeparatorOnlyAreEmpty() {
        XCTAssertEqual(MaskedValueMasker.mask("", variant: .coords), "")
        XCTAssertEqual(MaskedValueMasker.mask("   ", variant: .coords), "")
        XCTAssertEqual(MaskedValueMasker.mask(" , ", variant: .coords), "")
    }
}

// MARK: - E-mail rule (web `maskEmail` — local masked, domain visible)

final class MaskedValueMaskerEmailTests: XCTestCase {
    func testLocalPartIsMaskedDomainStaysVisible() {
        XCTAssertEqual(
            MaskedValueMasker.mask("jane.doe@example.com", variant: .email),
            "j" + bul(7) + "@example.com"
        )
    }

    func testSingleCharLocalStillGetsAtLeastOneBullet() {
        XCTAssertEqual(MaskedValueMasker.mask("j@x.com", variant: .email), "j" + bul(1) + "@x.com")
    }

    func testLeadingAtSignFallsBackToGeneric() {
        // '@' at position 0 → not a maskable local-part → generic over the whole string (showLast 1).
        XCTAssertEqual(MaskedValueMasker.mask("@example.com", variant: .email), bul(11) + "m")
    }

    func testNoAtSignFallsBackToGeneric() {
        XCTAssertEqual(MaskedValueMasker.mask("noatsign", variant: .email), bul(7) + "n")
    }
}

// MARK: - Generic rule (web `maskGeneric` — bullets to hidden length + last N)

final class MaskedValueMaskerGenericTests: XCTestCase {
    func testDefaultHidesEverything() {
        XCTAssertEqual(MaskedValueMasker.mask("supersecret", variant: .generic), bul(11))
    }

    func testShowLastOverrideExposesSuffix() {
        XCTAssertEqual(MaskedValueMasker.mask("ABCDEF", variant: .generic, showLast: 2), bul(4) + "EF")
    }

    func testShowLastClampsToLength() {
        XCTAssertEqual(MaskedValueMasker.mask("AB", variant: .generic, showLast: 10), "AB")
    }

    func testEmptyIsEmpty() {
        XCTAssertEqual(MaskedValueMasker.mask("", variant: .generic), "")
    }
}

// MARK: - Projection (web render decision)

final class MaskedValueProjectionTests: XCTestCase {
    private func resolve(_ input: MaskedValueInput) -> MaskedValueProjection {
        MaskedValueProjector.resolve(input, revealLabel: "R", hideLabel: "H", copyLabel: "C")
    }

    func testEmptyValueProjectsTheEmptyBranch() {
        let nilProjection = resolve(MaskedValueInput(value: nil, variant: .token, ariaLabel: "Token"))
        XCTAssertTrue(nilProjection.isEmpty)
        XCTAssertEqual(nilProjection.maskedText, "")
        XCTAssertEqual(nilProjection.rawText, "")
        XCTAssertEqual(nilProjection.emptyGlyph, "\u{2014}")
        XCTAssertEqual(nilProjection.accessibilityLabel, "Token")

        let blankProjection = resolve(MaskedValueInput(value: "", variant: .generic, ariaLabel: "Secret"))
        XCTAssertTrue(blankProjection.isEmpty)
    }

    func testNonEmptyValueCarriesMaskedAndRawText() {
        let projection = resolve(MaskedValueInput(value: "ABCDEFGH", variant: .token, ariaLabel: "Token"))
        XCTAssertFalse(projection.isEmpty)
        XCTAssertEqual(projection.maskedText, bul(12) + "EFGH")
        XCTAssertEqual(projection.rawText, "ABCDEFGH")
        XCTAssertEqual(projection.variant, .token)
    }

    func testResolvedLabelsAndCopyableAreCarried() {
        let projection = resolve(
            MaskedValueInput(value: "x", variant: .generic, copyable: true, ariaLabel: "Secret")
        )
        XCTAssertEqual(projection.revealLabel, "R")
        XCTAssertEqual(projection.hideLabel, "H")
        XCTAssertEqual(projection.copyLabel, "C")
        XCTAssertTrue(projection.copyable)
    }

    func testDisplayTextAndToggleLabelTrackRevealed() {
        let projection = resolve(MaskedValueInput(value: "ABCDEFGH", variant: .token, ariaLabel: "Token"))
        XCTAssertEqual(projection.displayText(revealed: false), bul(12) + "EFGH")
        XCTAssertEqual(projection.displayText(revealed: true), "ABCDEFGH")
        XCTAssertEqual(projection.toggleLabel(revealed: false), "R")
        XCTAssertEqual(projection.toggleLabel(revealed: true), "H")
    }
}

// MARK: - Value-type equality + input coalescing

final class MaskedValueInputTests: XCTestCase {
    func testRawCoalescesNilToEmpty() {
        XCTAssertEqual(MaskedValueInput(value: nil, variant: .token, ariaLabel: "A").raw, "")
        XCTAssertTrue(MaskedValueInput(value: nil, variant: .token, ariaLabel: "A").isEmpty)
        XCTAssertFalse(MaskedValueInput(value: "x", variant: .token, ariaLabel: "A").isEmpty)
    }

    func testDefaultAutoHideMatchesWeb() {
        XCTAssertEqual(MaskedValueInput.defaultAutoHideMs, 30000)
        XCTAssertEqual(MaskedValueInput(value: "x", variant: .token, ariaLabel: "A").autoHideMs, 30000)
    }

    func testInputEquality() {
        let lhs = MaskedValueInput(
            value: "v", variant: .vin, showLast: 4, copyable: true,
            auditOnReveal: true, ariaLabel: "VIN", autoHideMs: 5000
        )
        let rhs = MaskedValueInput(
            value: "v", variant: .vin, showLast: 4, copyable: true,
            auditOnReveal: true, ariaLabel: "VIN", autoHideMs: 5000
        )
        XCTAssertEqual(lhs, rhs)
        XCTAssertNotEqual(lhs, MaskedValueInput(value: "v2", variant: .vin, ariaLabel: "VIN"))
    }
}
