//
//  HelpIcon.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0215 · HelpIcon (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the help-text resolution
//  (the verbatim port of `i18nKey ? t(i18nKey, {defaultValue: content}) : content`), the `return null`
//  branch (`!text`), the accessibility-label rule (`ariaLabel ?? (for ? helpFor : iconLabel)`), the
//  described-by id (`for ? \(for)-help : undefined`), the `{{field}}` / `%@` interpolation, the web `side`
//  mapping, and the value-type equality. Split from HelpIcon.Tests.swift (the SwiftUI / state-holder half)
//  to keep each file within the SwiftLint file-length budget. These run in the TeslaSync(/-macOS) XCTest
//  targets; the derivation is pure, with no network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Test resolvers

/// Returns the `defaultValue` fallback for every key — the test / preview-bundle behavior (web
/// `t(missingKey, { defaultValue })` → the default).
private let fallbackResolve: HelpIconResolve = { _, fallback in fallback }

/// A fake catalog mapping a few keys to localized values; unknown keys fall back. Lets tests assert that a
/// present key wins over the `content` fallback (web translation hit).
private let catalogResolve: HelpIconResolve = { key, fallback in
    let catalog = [
        "help.batteryHealth.body": "Usable capacity vs new.",
        HelpIconKey.helpFor: "Aide pour %@",
        HelpIconKey.iconLabel: "Plus d’infos"
    ]
    return catalog[key] ?? fallback
}

// MARK: - Surface identity

final class HelpIconAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(HelpIconSurface.slug, "HelpIcon")
    }
}

// MARK: - Help-text resolution (web `i18nKey ? t(i18nKey, {defaultValue: content}) : content`)

final class HelpIconTextTests: XCTestCase {
    func testKeylessUsesContent() {
        let input = HelpIconInput(content: "Plain help")
        XCTAssertEqual(HelpIconProjector.resolvedText(input: input, resolve: fallbackResolve), "Plain help")
    }

    func testKeyMissingFallsBackToContent() {
        let input = HelpIconInput(i18nKey: "help.unknown", content: "Fallback copy")
        XCTAssertEqual(
            HelpIconProjector.resolvedText(input: input, resolve: catalogResolve),
            "Fallback copy",
            "a missing key resolves to the content (web defaultValue)"
        )
    }

    func testKeyPresentWinsOverContent() {
        let input = HelpIconInput(i18nKey: "help.batteryHealth.body", content: "Fallback copy")
        XCTAssertEqual(
            HelpIconProjector.resolvedText(input: input, resolve: catalogResolve),
            "Usable capacity vs new."
        )
    }

    func testEmptyKeyTreatedAsAbsent() {
        // Web truthiness: i18nKey="" is falsy → text = content.
        let input = HelpIconInput(i18nKey: "", content: "Bare content")
        XCTAssertEqual(HelpIconProjector.resolvedText(input: input, resolve: catalogResolve), "Bare content")
    }

    func testNoKeyNoContentIsEmpty() {
        let input = HelpIconInput()
        XCTAssertEqual(HelpIconProjector.resolvedText(input: input, resolve: fallbackResolve), "")
    }
}

// MARK: - hasContent (web `!!text` — its negation is `return null`)

final class HelpIconHasContentTests: XCTestCase {
    func testHasContentWhenTextResolves() {
        XCTAssertTrue(HelpIconProjector.hasContent(input: HelpIconInput(content: "x"), resolve: fallbackResolve))
    }

    func testNoContentWhenEmpty() {
        XCTAssertFalse(HelpIconProjector.hasContent(input: HelpIconInput(), resolve: fallbackResolve))
        XCTAssertFalse(
            HelpIconProjector.hasContent(input: HelpIconInput(content: ""), resolve: fallbackResolve)
        )
    }
}

// MARK: - Accessibility label (web `ariaLabel ?? (for ? helpFor : iconLabel)`)

final class HelpIconLabelTests: XCTestCase {
    func testOverrideWins() {
        let input = HelpIconInput(content: "x", forID: "Battery", ariaLabelOverride: "Custom label")
        XCTAssertEqual(
            HelpIconProjector.accessibilityLabel(input: input, resolve: fallbackResolve),
            "Custom label"
        )
    }

    func testEmptyOverrideStillWins() {
        // Web nullish coalescing: ariaLabel="" is used as-is (only null/undefined fall through).
        let input = HelpIconInput(content: "x", forID: "Battery", ariaLabelOverride: "")
        XCTAssertEqual(HelpIconProjector.accessibilityLabel(input: input, resolve: fallbackResolve), "")
    }

    func testFieldLabelInterpolated() {
        let input = HelpIconInput(content: "x", forID: "Drive score")
        XCTAssertEqual(
            HelpIconProjector.accessibilityLabel(input: input, resolve: fallbackResolve),
            "Help for Drive score"
        )
    }

    func testFieldLabelUsesCatalogTemplate() {
        let input = HelpIconInput(content: "x", forID: "Batterie")
        XCTAssertEqual(
            HelpIconProjector.accessibilityLabel(input: input, resolve: catalogResolve),
            "Aide pour Batterie"
        )
    }

    func testGenericLabelWhenNoField() {
        let input = HelpIconInput(content: "x")
        XCTAssertEqual(
            HelpIconProjector.accessibilityLabel(input: input, resolve: fallbackResolve),
            "More info"
        )
    }

    func testEmptyFieldFallsToGenericLabel() {
        // Web truthiness: for="" is falsy → generic iconLabel.
        let input = HelpIconInput(content: "x", forID: "")
        XCTAssertEqual(
            HelpIconProjector.accessibilityLabel(input: input, resolve: fallbackResolve),
            "More info"
        )
    }
}

// MARK: - Described-by id (web `for ? \(for)-help : undefined`)

final class HelpIconDescribedByTests: XCTestCase {
    func testDescribedByIDWhenFieldPresent() {
        XCTAssertEqual(
            HelpIconProjector.describedByID(input: HelpIconInput(forID: "Battery")),
            "Battery-help"
        )
    }

    func testNoDescribedByIDWhenFieldAbsentOrEmpty() {
        XCTAssertNil(HelpIconProjector.describedByID(input: HelpIconInput()))
        XCTAssertNil(HelpIconProjector.describedByID(input: HelpIconInput(forID: "")))
    }
}

// MARK: - Field interpolation (`{{field}}` / `%@`)

final class HelpIconInterpolationTests: XCTestCase {
    func testNamedTokenSubstituted() {
        XCTAssertEqual(
            HelpIconProjector.interpolateField("Help for {{field}}", field: "Range"),
            "Help for Range"
        )
    }

    func testPositionalTokenSubstituted() {
        XCTAssertEqual(HelpIconProjector.interpolateField("Help for %@", field: "Range"), "Help for Range")
    }

    func testTemplateWithoutTokenReturnedUnchanged() {
        XCTAssertEqual(HelpIconProjector.interpolateField("Field help", field: "Range"), "Field help")
    }
}

// MARK: - Side mapping (web `side` 'left'/'right' → leading/trailing)

final class HelpIconSideTests: XCTestCase {
    func testDefaultSideIsTop() {
        XCTAssertEqual(HelpIconSide.defaultSide, .top)
    }

    func testFromWebFoldsLeftRight() {
        XCTAssertEqual(HelpIconSide.fromWeb("top"), .top)
        XCTAssertEqual(HelpIconSide.fromWeb("bottom"), .bottom)
        XCTAssertEqual(HelpIconSide.fromWeb("left"), .leading)
        XCTAssertEqual(HelpIconSide.fromWeb("right"), .trailing)
        XCTAssertEqual(HelpIconSide.fromWeb("garbage"), .top)
    }
}

// MARK: - Projection composition + value-type equality

final class HelpIconProjectionTests: XCTestCase {
    func testResolveComposesEveryField() {
        let input = HelpIconInput(
            content: "Energy lost while parked.",
            forID: "Vampire drain",
            side: .trailing
        )
        let projection = HelpIconProjector.resolve(input: input, resolve: fallbackResolve)
        XCTAssertTrue(projection.hasContent)
        XCTAssertEqual(projection.text, "Energy lost while parked.")
        XCTAssertEqual(projection.accessibilityLabel, "Help for Vampire drain")
        XCTAssertEqual(projection.describedByID, "Vampire drain-help")
        XCTAssertEqual(projection.side, .trailing)
    }

    func testResolveAbsentBranch() {
        let projection = HelpIconProjector.resolve(input: HelpIconInput(), resolve: fallbackResolve)
        XCTAssertFalse(projection.hasContent)
        XCTAssertEqual(projection.text, "")
        XCTAssertNil(projection.describedByID)
        XCTAssertEqual(projection.accessibilityLabel, "More info")
    }

    func testInputEquality() {
        let lhs = HelpIconInput(i18nKey: "k", content: "c", forID: "f", side: .bottom, ariaLabelOverride: "a")
        let rhs = HelpIconInput(i18nKey: "k", content: "c", forID: "f", side: .bottom, ariaLabelOverride: "a")
        XCTAssertEqual(lhs, rhs)
        XCTAssertNotEqual(lhs, HelpIconInput(i18nKey: "k", content: "c", forID: "f", side: .top))
    }

    func testProjectionEquality() {
        let lhs = HelpIconProjector.resolve(input: HelpIconInput(content: "x"), resolve: fallbackResolve)
        let rhs = HelpIconProjector.resolve(input: HelpIconInput(content: "x"), resolve: fallbackResolve)
        XCTAssertEqual(lhs, rhs)
        let other = HelpIconProjector.resolve(input: HelpIconInput(content: "y"), resolve: fallbackResolve)
        XCTAssertNotEqual(lhs, other)
    }
}
