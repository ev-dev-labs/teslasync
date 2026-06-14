//
//  Breadcrumbs.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0167 · Breadcrumbs (Apple)
//
//  Pure-core coverage for the breadcrumb trail (the model + view-composition half lives in
//  Breadcrumbs.Tests.swift; split to keep each file within the SwiftLint file-length budget). This is the
//  "adapter (cached → projection)" unit test the acceptance calls for: it drives ``BreadcrumbsProjection``
//  over the cached input items, asserting the verbatim port of the web `<Breadcrumbs>` body:
//    • slug        — the diagnostics surface slug.
//    • suppression — `items.length <= 1 → null`: an empty input and a single-item input both render nothing
//                    (empty vs suppressed stay distinguishable for the inspector).
//    • render      — a multi-item trail is leaf-last; the trailing crumb is the link-less current page
//                    (web `isLast`) even when it carried an `href`; an ancestor keeps its `href` only when
//                    present (web link-vs-`<span>`).
//    • collapse    — a compact width folds the middle into a single ellipsis between the first crumb and the
//                    current leaf; a two-item trail has no middle to collapse; a regular width shows all.
//    • identity    — every crumb has a unique `ForEach` id; the ellipsis uses the reserved sentinel.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no SwiftUI.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class BreadcrumbsSurfaceTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(BreadcrumbsSurface.slug, "Breadcrumbs")
    }
}

// MARK: - Suppression (web `items.length <= 1 → null`)

final class BreadcrumbsSuppressionTests: XCTestCase {
    func testEmptyInputIsSuppressedAndEmpty() {
        let resolved = BreadcrumbsProjection.resolve(items: [], isCompact: false)
        XCTAssertTrue(resolved.isEmpty)
        XCTAssertTrue(resolved.isSuppressed)
        XCTAssertFalse(resolved.isRendered)
        XCTAssertTrue(resolved.crumbs.isEmpty)
        XCTAssertNil(resolved.current)
    }

    func testSingleItemIsSuppressedButNotEmpty() {
        let resolved = BreadcrumbsProjection.resolve(items: [BreadcrumbsItem(label: "Dashboard")], isCompact: false)
        XCTAssertFalse(resolved.isEmpty, "a single item is a real (top-level) trail, not an empty input")
        XCTAssertTrue(resolved.isSuppressed, "a single-item trail self-suppresses (web items.length <= 1)")
        XCTAssertFalse(resolved.isRendered)
        XCTAssertTrue(resolved.crumbs.isEmpty)
    }

    func testSuppressedConstant() {
        XCTAssertTrue(BreadcrumbsResolved.suppressed.isSuppressed)
        XCTAssertTrue(BreadcrumbsResolved.suppressed.isEmpty)
    }
}

// MARK: - Render (leaf-last, current-leaf, link-vs-text)

final class BreadcrumbsRenderTests: XCTestCase {
    private let trail: [BreadcrumbsItem] = [
        BreadcrumbsItem(label: "Vehicles", href: "/vehicles"),
        BreadcrumbsItem(label: "Model 3", href: "/vehicles/7"),
        BreadcrumbsItem(label: "Battery Health")
    ]

    func testMultiItemRendersLeafLast() {
        let resolved = BreadcrumbsProjection.resolve(items: trail, isCompact: false)
        XCTAssertTrue(resolved.isRendered)
        XCTAssertEqual(resolved.count, 3)
        XCTAssertEqual(resolved.crumbs.map(\.label), ["Vehicles", "Model 3", "Battery Health"])
        XCTAssertEqual(resolved.current?.label, "Battery Health")
    }

    func testTrailingCrumbIsCurrentAndLinkLess() {
        let resolved = BreadcrumbsProjection.resolve(items: trail, isCompact: false)
        let last = resolved.crumbs.last
        XCTAssertEqual(last?.isCurrent, true)
        XCTAssertNil(last?.href, "the current leaf is link-less plain text (web isLast → span)")
        XCTAssertFalse(last?.isLink ?? true)
    }

    func testCurrentLeafDropsHrefEvenIfProvided() {
        let items = [
            BreadcrumbsItem(label: "Vehicles", href: "/vehicles"),
            BreadcrumbsItem(label: "Model 3", href: "/vehicles/7")
        ]
        let resolved = BreadcrumbsProjection.resolve(items: items, isCompact: false)
        XCTAssertNil(resolved.current?.href, "the trailing item is the current page regardless of its href")
        XCTAssertEqual(resolved.crumbs.first?.href, "/vehicles", "an ancestor keeps its href")
        XCTAssertTrue(resolved.crumbs.first?.isLink ?? false)
    }

    func testAncestorWithoutHrefIsPlainText() {
        let items = [
            BreadcrumbsItem(label: "Reports"),
            BreadcrumbsItem(label: "Battery Health")
        ]
        let resolved = BreadcrumbsProjection.resolve(items: items, isCompact: false)
        let first = resolved.crumbs.first
        XCTAssertEqual(first?.label, "Reports")
        XCTAssertNil(first?.href)
        XCTAssertFalse(first?.isLink ?? true, "an ancestor with no href is a plain crumb, not a link")
    }
}

// MARK: - Compact collapse (web `hidden sm:inline` + `…`)

final class BreadcrumbsCollapseTests: XCTestCase {
    private let deep: [BreadcrumbsItem] = [
        BreadcrumbsItem(label: "Drives", href: "/drives"),
        BreadcrumbsItem(label: "Drive Detail", href: "/drives/4421"),
        BreadcrumbsItem(label: "Trip Replay", href: "/drives/4421/replay"),
        BreadcrumbsItem(label: "Segment 3")
    ]

    func testCompactCollapsesMiddleToSingleEllipsis() {
        let resolved = BreadcrumbsProjection.resolve(items: deep, isCompact: true)
        XCTAssertTrue(resolved.isCollapsed)
        XCTAssertEqual(resolved.count, 3, "first crumb · ellipsis · current leaf")
        XCTAssertEqual(resolved.crumbs.first?.label, "Drives")
        XCTAssertTrue(resolved.crumbs[1].isEllipsis)
        XCTAssertEqual(resolved.crumbs.last?.label, "Segment 3")
        XCTAssertEqual(resolved.crumbs.last?.isCurrent, true)
    }

    func testRegularWidthShowsEveryCrumb() {
        let resolved = BreadcrumbsProjection.resolve(items: deep, isCompact: false)
        XCTAssertFalse(resolved.isCollapsed)
        XCTAssertEqual(resolved.count, 4)
        XCTAssertFalse(resolved.crumbs.contains { $0.isEllipsis })
    }

    func testTwoItemTrailHasNoMiddleToCollapse() {
        let items = [
            BreadcrumbsItem(label: "Vehicles", href: "/vehicles"),
            BreadcrumbsItem(label: "Model 3")
        ]
        let resolved = BreadcrumbsProjection.resolve(items: items, isCompact: true)
        XCTAssertFalse(resolved.isCollapsed)
        XCTAssertEqual(resolved.count, 2)
    }

    func testEllipsisUsesReservedSentinelID() {
        let resolved = BreadcrumbsProjection.resolve(items: deep, isCompact: true)
        let ellipsis = resolved.crumbs.first { $0.isEllipsis }
        XCTAssertEqual(ellipsis?.id, BreadcrumbsProjection.ellipsisID)
        XCTAssertNil(ellipsis?.label)
        XCTAssertFalse(ellipsis?.isLink ?? true)
    }
}

// MARK: - Identity (stable ForEach ids)

final class BreadcrumbsIdentityTests: XCTestCase {
    func testCrumbIDsAreUnique() {
        let items = (0 ..< 5).map { index in BreadcrumbsItem(label: "Crumb \(index)", href: "/c/\(index)") }
        let regular = BreadcrumbsProjection.displayCrumbs(items: items, isCompact: false)
        XCTAssertEqual(Set(regular.map(\.id)).count, regular.count, "every crumb id is unique on a regular width")

        let compact = BreadcrumbsProjection.displayCrumbs(items: items, isCompact: true)
        XCTAssertEqual(Set(compact.map(\.id)).count, compact.count, "every crumb id is unique when collapsed")
    }

    func testItemCrumbsCarryNonEmptyLabels() {
        let items = [
            BreadcrumbsItem(label: "Vehicles", href: "/vehicles"),
            BreadcrumbsItem(label: "Model 3", href: "/vehicles/7"),
            BreadcrumbsItem(label: "Battery Health")
        ]
        let resolved = BreadcrumbsProjection.resolve(items: items, isCompact: false)
        for crumb in resolved.crumbs where !crumb.isEllipsis {
            XCTAssertFalse(crumb.label?.isEmpty ?? true, "every item crumb carries VoiceOver content")
        }
    }
}
