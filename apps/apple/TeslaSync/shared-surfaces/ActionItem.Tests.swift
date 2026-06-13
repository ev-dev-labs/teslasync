//
//  ActionItem.Tests.swift
//  TeslaSync — P4 shared surface · 0196 · ActionItem (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + value types
//  live in ActionItem.AdapterTests.swift; split to keep each file within the SwiftLint file-length
//  budget):
//    • ActionItemModel — the once-only `view.opened`, the props update + identical-update guard, the
//      derived projection, and the CTA navigation hint (in-app / external / none).
//    • ActionItemCTA — the label / kind / href / perform decomposition + the closure-free input mapping
//      (web `cta` → `<Link>` / `<a>` / `<button>`).
//    • Severity → tone — each severity maps to the expected ``TSTone`` token, and the three are distinct.
//    • Views — the content view + the CTA button + the public surface compose in every branch.
//    • Strings — the native severity words + a11y hints resolve through the P1/S10 facade with the
//      expected fallbacks.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - ActionItemModel (surface lifecycle + derivation)

@MainActor
final class ActionItemModelTests: XCTestCase {
    private func input(
        severity: ActionSeverity = .info,
        title: String = "Update available",
        description: String? = nil,
        cta: ActionItemCTAInput? = nil
    ) -> ActionItemInput {
        ActionItemInput(severity: severity, title: title, description: description, cta: cta)
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyActionItemTelemetry()
        let model = ActionItemModel(input: input(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [ActionItemSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyActionItemTelemetry()
        let model = ActionItemModel(input: input(), telemetry: spy)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(spy.surfaces, [ActionItemSurface.slug], "view.opened fires once per instance")
    }

    func testProjectionReflectsInput() {
        let model = ActionItemModel(input: input(
            severity: .error,
            title: "Backup failed",
            description: "disk full",
            cta: ActionItemCTAInput(label: "Run", kind: .action)
        ))
        XCTAssertEqual(model.projection.severity, .error)
        XCTAssertEqual(model.projection.title, "Backup failed")
        XCTAssertTrue(model.projection.showsDescription)
        XCTAssertEqual(model.projection.cta?.kind, .action)
    }

    func testUpdateChangesProjection() {
        let model = ActionItemModel(input: input())
        XCTAssertFalse(model.projection.showsCTA)
        model.update(input(cta: ActionItemCTAInput(label: "Review", kind: .route, href: "/updates")))
        XCTAssertTrue(model.projection.showsCTA)
        XCTAssertEqual(model.projection.cta?.href, "/updates")
    }

    func testUpdateWithIdenticalInputIsNoOp() {
        let base = input(severity: .warn, title: "Token expires")
        let model = ActionItemModel(input: base)
        model.update(base)
        XCTAssertEqual(model.projection.severity, .warn)
        XCTAssertEqual(model.projection.title, "Token expires")
    }

    func testRouteCTAHasActivateHint() {
        let model = ActionItemModel(input: input(
            cta: ActionItemCTAInput(label: "Review", kind: .route, href: "/updates")
        ))
        XCTAssertEqual(model.ctaAccessibilityHint, "Opens details")
    }

    func testActionCTAHasActivateHint() {
        let model = ActionItemModel(input: input(cta: ActionItemCTAInput(label: "Run", kind: .action)))
        XCTAssertEqual(model.ctaAccessibilityHint, "Opens details")
    }

    func testExternalLinkCTAHasExternalHint() {
        let model = ActionItemModel(input: input(
            cta: ActionItemCTAInput(label: "Status", kind: .externalLink, href: "https://x.test")
        ))
        XCTAssertEqual(model.ctaAccessibilityHint, "Opens in your browser")
    }

    func testNoCTAHasNoHint() {
        let model = ActionItemModel(input: input(cta: nil))
        XCTAssertNil(model.ctaAccessibilityHint, "a row with no CTA gets no hint")
    }
}

// MARK: - ActionItemCTA (web `cta` → <Link> / <a> / <button>)

@MainActor
final class ActionItemCTATests: XCTestCase {
    func testRouteCarriesLabelHrefAndFiringHandler() {
        var fired = false
        let cta = ActionItemCTA.route(label: "Review", to: "/updates", perform: { fired = true })
        XCTAssertEqual(cta.label, "Review")
        XCTAssertEqual(cta.kind, .route)
        XCTAssertEqual(cta.href, "/updates")
        cta.perform()
        XCTAssertTrue(fired)
        XCTAssertEqual(cta.input, ActionItemCTAInput(label: "Review", kind: .route, href: "/updates"))
    }

    func testExternalLinkCarriesLabelHrefAndFiringHandler() {
        var fired = false
        let cta = ActionItemCTA.externalLink(label: "Status", to: "https://x.test", perform: { fired = true })
        XCTAssertEqual(cta.kind, .externalLink)
        XCTAssertEqual(cta.href, "https://x.test")
        cta.perform()
        XCTAssertTrue(fired)
        XCTAssertEqual(
            cta.input,
            ActionItemCTAInput(label: "Status", kind: .externalLink, href: "https://x.test")
        )
    }

    func testActionHasHandlerButNoHref() {
        var fired = false
        let cta = ActionItemCTA.action(label: "Run backup", perform: { fired = true })
        XCTAssertEqual(cta.kind, .action)
        XCTAssertNil(cta.href)
        cta.perform()
        XCTAssertTrue(fired)
        XCTAssertEqual(cta.input, ActionItemCTAInput(label: "Run backup", kind: .action, href: nil))
    }
}

// MARK: - Severity → tone tokens

@MainActor
final class ActionSeverityToneTests: XCTestCase {
    func testSeverityMapsToTone() {
        XCTAssertEqual(ActionSeverity.info.tone, .info)
        XCTAssertEqual(ActionSeverity.warn.tone, .warning)
        XCTAssertEqual(ActionSeverity.error.tone, .danger)
    }

    func testSeverityTintsAreDistinct() {
        let tints = ActionSeverity.allCases.map(\.tint)
        XCTAssertEqual(Set(tints.map { "\($0)" }).count, ActionSeverity.allCases.count)
    }
}

// MARK: - Views (every branch composes)

@MainActor
final class ActionItemViewCompositionTests: XCTestCase {
    func testSurfaceComposesForFullRow() {
        _ = ActionItem(
            severity: .warn,
            title: "Token expires in 3 days",
            description: "Re-authenticate to keep telemetry flowing.",
            cta: .route(label: "Re-auth", to: "/settings/tesla", perform: {})
        )
        XCTAssertEqual(ActionItem.surfaceSlug, "ActionItem")
    }

    func testSurfaceComposesForMinimalRow() {
        _ = ActionItem(severity: .info, title: "All caught up")
    }

    func testSurfaceComposesForEachCTAKind() {
        _ = ActionItem(severity: .info, title: "Open", cta: .route(label: "Open", to: "/x", perform: {}))
        _ = ActionItem(
            severity: .warn,
            title: "Status",
            cta: .externalLink(label: "Status", to: "https://x.test", perform: {})
        )
        _ = ActionItem(severity: .error, title: "Retry", cta: .action(label: "Retry", perform: {}))
    }

    func testSurfaceComposesFromInjectedModel() {
        let injected = ActionItemModel(
            input: ActionItemInput(severity: .error, title: "Backup failed"),
            telemetry: SpyActionItemTelemetry()
        )
        _ = ActionItem(model: injected, cta: .action(label: "Run", perform: {}))
    }

    func testContainerAndCTAButtonComposeForEveryBranch() {
        let word: (ActionSeverity) -> String = { $0.rawValue }
        for severity in ActionSeverity.allCases {
            for kind in ActionItemCTAKind.allCases {
                let projection = ActionItemProjector.resolve(
                    input: ActionItemInput(
                        severity: severity,
                        title: "Title",
                        description: "Description",
                        cta: ActionItemCTAInput(
                            label: "Go",
                            kind: kind,
                            href: kind.isLink ? "/x" : nil
                        )
                    ),
                    severityWord: word
                )
                _ = ActionItemContainer(
                    projection: projection,
                    ctaAccessibilityHint: "Opens details",
                    onActivateCTA: {}
                )
                if let cta = projection.cta {
                    _ = ActionItemCTAButton(
                        cta: cta,
                        tint: severity.tint,
                        accessibilityHint: "Opens details",
                        onActivate: {}
                    )
                }
            }
            // The no-CTA branch composes too.
            let bare = ActionItemProjector.resolve(
                input: ActionItemInput(severity: severity, title: "Title"),
                severityWord: word
            )
            _ = ActionItemContainer(projection: bare, ctaAccessibilityHint: nil, onActivateCTA: nil)
        }
    }
}

// MARK: - Strings facade (P1/S10)

final class ActionItemStringsTests: XCTestCase {
    func testSeverityWordsResolveToFallbacks() {
        XCTAssertEqual(ActionItemStrings.severity(for: .info), "Information")
        XCTAssertEqual(ActionItemStrings.severity(for: .warn), "Warning")
        XCTAssertEqual(ActionItemStrings.severity(for: .error), "Error")
    }

    func testActivateAndExternalHintsResolveToFallbacks() {
        XCTAssertEqual(ActionItemStrings.activateHint, "Opens details")
        XCTAssertEqual(ActionItemStrings.externalHint, "Opens in your browser")
    }

    func testHintForKindTracksExternal() {
        XCTAssertEqual(ActionItemStrings.hint(for: .route), "Opens details")
        XCTAssertEqual(ActionItemStrings.hint(for: .action), "Opens details")
        XCTAssertEqual(ActionItemStrings.hint(for: .externalLink), "Opens in your browser")
    }

    func testTableName() {
        XCTAssertEqual(ActionItemStrings.table, "ActionItem")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it satisfies
/// the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyActionItemTelemetry: ActionItemTelemetry, @unchecked Sendable {
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
