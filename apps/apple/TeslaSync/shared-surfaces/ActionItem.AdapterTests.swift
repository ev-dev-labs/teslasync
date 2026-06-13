//
//  ActionItem.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0196 · ActionItem (Apple)
//
//  Pure-core coverage for the single operator-task row (the model + view-composition half lives in
//  ActionItem.Tests.swift; split to keep each file within the SwiftLint file-length budget). This is the
//  "adapter (cached → projection)" unit test the acceptance calls for: it drives the structural props
//  through ``ActionItemProjector`` and asserts the verbatim port of the web `ActionItem` + `ActionCTA`
//  render bodies, plus the value types it is built on:
//    • severity — raw values, all cases, the per-tier glyph (web `ActionSeverity` / lucide icon).
//    • CTA kind — raw values, all cases, the isLink / opensExternally derivations (web `<Link>` / `<a>` /
//      `<button>`).
//    • input   — value equality (the `.onChange` key) across every field.
//    • slug    — the diagnostics identity.
//    • project — severity/title/description passthrough, glyph, CTA resolution (href handling, the
//      action-drops-href + the CTA-null branch), and the composed a11y label.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no model instance, so
//  each assertion reads the pure projection directly.
//

import XCTest
@testable import TeslaSync

// MARK: - ActionItemSurface (diagnostics identity)

final class ActionItemSurfaceTests: XCTestCase {
    func testSlug() {
        XCTAssertEqual(ActionItemSurface.slug, "ActionItem")
    }
}

// MARK: - ActionSeverity (web `ActionSeverity` union)

final class ActionSeverityTests: XCTestCase {
    func testRawValuesMatchWebUnion() {
        XCTAssertEqual(ActionSeverity.info.rawValue, "info")
        XCTAssertEqual(ActionSeverity.warn.rawValue, "warn")
        XCTAssertEqual(ActionSeverity.error.rawValue, "error")
    }

    func testAllCases() {
        XCTAssertEqual(Set(ActionSeverity.allCases), [.info, .warn, .error])
    }

    func testEachTierHasADistinctGlyph() {
        XCTAssertEqual(ActionSeverity.info.iconSystemName, "info.circle")
        XCTAssertEqual(ActionSeverity.warn.iconSystemName, "exclamationmark.triangle")
        XCTAssertEqual(ActionSeverity.error.iconSystemName, "exclamationmark.circle")
        let glyphs = ActionSeverity.allCases.map(\.iconSystemName)
        XCTAssertEqual(Set(glyphs).count, ActionSeverity.allCases.count, "every tier has its own glyph")
    }
}

// MARK: - ActionItemCTAKind (web `<Link>` / `<a>` / `<button>`)

final class ActionItemCTAKindTests: XCTestCase {
    func testRawValues() {
        XCTAssertEqual(ActionItemCTAKind.route.rawValue, "route")
        XCTAssertEqual(ActionItemCTAKind.externalLink.rawValue, "externalLink")
        XCTAssertEqual(ActionItemCTAKind.action.rawValue, "action")
    }

    func testAllCases() {
        XCTAssertEqual(Set(ActionItemCTAKind.allCases), [.route, .externalLink, .action])
    }

    func testIsLinkSplitsNavigationFromHandler() {
        XCTAssertTrue(ActionItemCTAKind.route.isLink, "web <Link> navigates")
        XCTAssertTrue(ActionItemCTAKind.externalLink.isLink, "web <a> navigates")
        XCTAssertFalse(ActionItemCTAKind.action.isLink, "web <button> fires a handler")
    }

    func testOpensExternallyOnlyForExternalLink() {
        XCTAssertFalse(ActionItemCTAKind.route.opensExternally)
        XCTAssertTrue(ActionItemCTAKind.externalLink.opensExternally, "web external → target=_blank")
        XCTAssertFalse(ActionItemCTAKind.action.opensExternally)
    }
}

// MARK: - ActionItemCTAInput / ActionItemInput (the `.onChange` key)

final class ActionItemInputTests: XCTestCase {
    func testDefaults() {
        let input = ActionItemInput(severity: .info, title: "Update")
        XCTAssertEqual(input.severity, .info)
        XCTAssertEqual(input.title, "Update")
        XCTAssertNil(input.description)
        XCTAssertNil(input.cta)
    }

    func testEquality() {
        let cta = ActionItemCTAInput(label: "Review", kind: .route, href: "/updates")
        let base = ActionItemInput(severity: .warn, title: "Token", description: "3 days", cta: cta)
        XCTAssertEqual(
            base,
            ActionItemInput(
                severity: .warn,
                title: "Token",
                description: "3 days",
                cta: ActionItemCTAInput(label: "Review", kind: .route, href: "/updates")
            )
        )
    }

    func testEveryFieldParticipatesInEquality() {
        let cta = ActionItemCTAInput(label: "Review", kind: .route, href: "/updates")
        let base = ActionItemInput(severity: .warn, title: "Token", description: "3 days", cta: cta)
        XCTAssertNotEqual(base, ActionItemInput(
            severity: .error, title: "Token", description: "3 days", cta: cta
        ))
        XCTAssertNotEqual(base, ActionItemInput(
            severity: .warn, title: "Other", description: "3 days", cta: cta
        ))
        XCTAssertNotEqual(base, ActionItemInput(
            severity: .warn, title: "Token", description: nil, cta: cta
        ))
        XCTAssertNotEqual(base, ActionItemInput(
            severity: .warn, title: "Token", description: "3 days", cta: nil
        ))
        XCTAssertNotEqual(base, ActionItemInput(
            severity: .warn, title: "Token", description: "3 days",
            cta: ActionItemCTAInput(label: "Re-auth", kind: .route, href: "/updates")
        ))
        XCTAssertNotEqual(base, ActionItemInput(
            severity: .warn, title: "Token", description: "3 days",
            cta: ActionItemCTAInput(label: "Review", kind: .action, href: nil)
        ))
    }
}

// MARK: - ActionItemProjector (web `ActionItem` + `ActionCTA` render bodies)

final class ActionItemProjectorTests: XCTestCase {
    /// An identity severity-word resolver — keeps the projector assertions independent of the i18n
    /// catalog (the localized words are covered by the strings tests in ActionItem.Tests.swift).
    private func word(_ severity: ActionSeverity) -> String {
        severity.rawValue
    }

    private func resolve(
        severity: ActionSeverity = .info,
        title: String = "Update",
        description: String? = nil,
        cta: ActionItemCTAInput? = nil
    ) -> ActionItemProjection {
        ActionItemProjector.resolve(
            input: ActionItemInput(severity: severity, title: title, description: description, cta: cta),
            severityWord: word
        )
    }

    func testPassesThroughTitleAndGlyphPerSeverity() {
        for severity in ActionSeverity.allCases {
            let projection = resolve(severity: severity, title: "T")
            XCTAssertEqual(projection.severity, severity)
            XCTAssertEqual(projection.title, "T")
            XCTAssertEqual(projection.iconSystemName, severity.iconSystemName)
        }
    }

    func testDescriptionPresenceDrivesRenderFlag() {
        XCTAssertNil(resolve(description: nil).description)
        XCTAssertFalse(resolve(description: nil).showsDescription)
        XCTAssertEqual(resolve(description: "v1 → v2").description, "v1 → v2")
        XCTAssertTrue(resolve(description: "v1 → v2").showsDescription)
    }

    func testNoCTAResolvesToNil() {
        let projection = resolve(cta: nil)
        XCTAssertNil(projection.cta, "web `cta == null` renders no affordance")
        XCTAssertFalse(projection.showsCTA)
    }

    func testRouteCTACarriesHrefAndLinkTrait() {
        let projection = resolve(cta: ActionItemCTAInput(label: "Review", kind: .route, href: "/updates"))
        let cta = try? XCTUnwrap(projection.cta)
        XCTAssertEqual(cta?.label, "Review")
        XCTAssertEqual(cta?.kind, .route)
        XCTAssertEqual(cta?.href, "/updates")
        XCTAssertTrue(cta?.accessibilityIsLink ?? false)
        XCTAssertFalse(cta?.opensExternally ?? true)
        XCTAssertTrue(projection.showsCTA)
    }

    func testExternalLinkCTAOpensExternally() {
        let projection = resolve(
            cta: ActionItemCTAInput(label: "Status", kind: .externalLink, href: "https://x.test")
        )
        XCTAssertEqual(projection.cta?.kind, .externalLink)
        XCTAssertEqual(projection.cta?.href, "https://x.test")
        XCTAssertTrue(projection.cta?.opensExternally ?? false, "web external → target=_blank")
        XCTAssertTrue(projection.cta?.accessibilityIsLink ?? false)
    }

    func testActionCTADropsHrefAndIsNotALink() {
        // The web `<button onClick>` has no `to`, so the projector drops any stray href for the action.
        let projection = resolve(cta: ActionItemCTAInput(label: "Run", kind: .action, href: "/ignored"))
        XCTAssertEqual(projection.cta?.kind, .action)
        XCTAssertNil(projection.cta?.href, "href is only meaningful for the link kinds")
        XCTAssertFalse(projection.cta?.accessibilityIsLink ?? true)
        XCTAssertFalse(projection.cta?.opensExternally ?? true)
    }

    func testAccessibilityLabelNamesSeverityThenTitle() {
        XCTAssertEqual(resolve(severity: .warn, title: "Token expires").accessibilityLabel, "warn: Token expires")
    }

    func testAccessibilityLabelAppendsDescriptionWhenPresent() {
        let projection = resolve(severity: .error, title: "Backup failed", description: "disk full")
        XCTAssertEqual(projection.accessibilityLabel, "error: Backup failed. disk full")
    }

    func testProjectionIsEquatableForIdenticalInputs() {
        let input = ActionItemInput(
            severity: .error,
            title: "Backup failed",
            description: "disk full",
            cta: ActionItemCTAInput(label: "Run", kind: .action)
        )
        XCTAssertEqual(
            ActionItemProjector.resolve(input: input, severityWord: word),
            ActionItemProjector.resolve(input: input, severityWord: word)
        )
    }
}

// MARK: - ActionItemProjector.resolveCTA (web `ActionCTA` element-or-null)

final class ActionItemResolveCTATests: XCTestCase {
    func testNilInputResolvesToNil() {
        XCTAssertNil(ActionItemProjector.resolveCTA(nil))
    }

    func testLinkKindsKeepHref() {
        XCTAssertEqual(
            ActionItemProjector.resolveCTA(
                ActionItemCTAInput(label: "Go", kind: .route, href: "/x")
            )?.href,
            "/x"
        )
        XCTAssertEqual(
            ActionItemProjector.resolveCTA(
                ActionItemCTAInput(label: "Go", kind: .externalLink, href: "https://x.test")
            )?.href,
            "https://x.test"
        )
    }

    func testActionKindDropsHref() {
        XCTAssertNil(
            ActionItemProjector.resolveCTA(
                ActionItemCTAInput(label: "Go", kind: .action, href: "/ignored")
            )?.href
        )
    }
}
