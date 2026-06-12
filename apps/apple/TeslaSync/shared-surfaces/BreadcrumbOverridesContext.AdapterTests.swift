//
//  BreadcrumbOverridesContext.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0166 · BreadcrumbOverridesContext (Apple)
//
//  Pure-core coverage for the breadcrumb-overrides bridge (the store + state + view-composition half
//  lives in BreadcrumbOverridesContext.Tests.swift; split to keep each file within the SwiftLint
//  file-length budget). This is the "adapter (cached → projection)" unit test the acceptance calls
//  for: it drives the merge reducer, the JSON-stable signature, the `:param` path matcher and the
//  trail builder, asserting the verbatim port of the web persistence + `useBreadcrumbs` logic:
//    • reducer — sanitize drops empty labels (web `if (v)`); merge is ascending-id, later-wins;
//                signature is order-independent + content-stable (web `JSON.stringify`).
//    • matcher — `:param` capture, literal segments, full-length match, root, slash normalization.
//    • builder — unknown route → []; parent chain leaf-last; override > i18n > default; `{{param}}`
//                in labels + `:param` in hrefs; current leaf has no href; cycle-break.
//    • slug    — the diagnostics surface slug.
//
//  These run in the TeslaSync(/-macOS) XCTest targets (and a standalone SwiftPM harness). They have no
//  network, no store instance and no SwiftUI, so each assertion reads the pure logic directly.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class BreadcrumbOverridesSurfaceTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(BreadcrumbOverridesSurface.slug, "BreadcrumbOverridesContext")
    }
}

// MARK: - BreadcrumbOverridesReducer (web provider merge + useSetBreadcrumbOverrides signature)

final class BreadcrumbOverridesReducerTests: XCTestCase {
    func testSanitizeDropsEmptyLabels() {
        let sanitized = BreadcrumbOverridesReducer.sanitize(["/a": "Alpha", "/b": ""])
        XCTAssertEqual(sanitized, ["/a": "Alpha"])
    }

    func testMergeIsEmptyForNoRegistrations() {
        XCTAssertTrue(BreadcrumbOverridesReducer.merge([:]).isEmpty)
    }

    func testMergeCombinesDistinctKeys() {
        let merged = BreadcrumbOverridesReducer.merge([1: ["/a": "Alpha"], 2: ["/b": "Bravo"]])
        XCTAssertEqual(merged, ["/a": "Alpha", "/b": "Bravo"])
    }

    func testMergeLaterRegistrationWinsForSameKey() {
        let merged = BreadcrumbOverridesReducer.merge([1: ["/a": "First"], 2: ["/a": "Second"]])
        XCTAssertEqual(merged["/a"], "Second", "a later (higher-id) registration wins the same route key")
    }

    func testMergeDropsEmptyValues() {
        let merged = BreadcrumbOverridesReducer.merge([1: ["/a": "Alpha", "/b": ""]])
        XCTAssertNil(merged["/b"])
    }

    func testSignatureIsOrderIndependent() {
        let lhs = BreadcrumbOverridesReducer.signature(["/a": "Alpha", "/b": "Bravo"])
        let rhs = BreadcrumbOverridesReducer.signature(["/b": "Bravo", "/a": "Alpha"])
        XCTAssertEqual(lhs, rhs)
    }

    func testSignatureDistinguishesContent() {
        let lhs = BreadcrumbOverridesReducer.signature(["/a": "Alpha"])
        let rhs = BreadcrumbOverridesReducer.signature(["/a": "Bravo"])
        XCTAssertNotEqual(lhs, rhs)
    }

    func testSignatureIgnoresEmptyValues() {
        XCTAssertEqual(
            BreadcrumbOverridesReducer.signature(["/a": "Alpha", "/b": ""]),
            BreadcrumbOverridesReducer.signature(["/a": "Alpha"])
        )
    }

    func testAreEquivalent() {
        XCTAssertTrue(BreadcrumbOverridesReducer.areEquivalent(["/a": "Alpha"], ["/a": "Alpha"]))
        XCTAssertFalse(BreadcrumbOverridesReducer.areEquivalent(["/a": "Alpha"], ["/a": "Bravo"]))
    }
}

// MARK: - BreadcrumbOverridesPathMatch (web matchPath, end: true)

final class BreadcrumbOverridesPathMatchTests: XCTestCase {
    func testStaticSegmentMatch() {
        XCTAssertTrue(BreadcrumbOverridesPathMatch.matches(pattern: "/drives", path: "/drives"))
        XCTAssertFalse(BreadcrumbOverridesPathMatch.matches(pattern: "/drives", path: "/charging"))
    }

    func testLengthMismatchDoesNotMatch() {
        XCTAssertFalse(BreadcrumbOverridesPathMatch.matches(pattern: "/drives", path: "/drives/4421"))
        XCTAssertFalse(BreadcrumbOverridesPathMatch.matches(pattern: "/drives/:id", path: "/drives"))
    }

    func testParamCapture() {
        XCTAssertEqual(
            BreadcrumbOverridesPathMatch.params(pattern: "/drives/:id", path: "/drives/4421"),
            ["id": "4421"]
        )
    }

    func testMultiParamCapture() {
        let params = BreadcrumbOverridesPathMatch.params(pattern: "/drives/:id/replay/:seg", path: "/drives/7/replay/3")
        XCTAssertEqual(params, ["id": "7", "seg": "3"])
    }

    func testRootMatchesWithNoParams() {
        XCTAssertEqual(BreadcrumbOverridesPathMatch.params(pattern: "/", path: "/"), [:])
    }

    func testTrailingSlashNormalized() {
        XCTAssertTrue(BreadcrumbOverridesPathMatch.matches(pattern: "/drives", path: "/drives/"))
    }

    func testUnmatchedReturnsNil() {
        XCTAssertNil(BreadcrumbOverridesPathMatch.params(pattern: "/drives/:id", path: "/charging/9"))
    }
}

// MARK: - BreadcrumbOverridesTrailBuilder (web useBreadcrumbs)

final class BreadcrumbOverridesTrailBuilderTests: XCTestCase {
    private let fallbackOnly: BreadcrumbOverridesLocalize = { _, fallback in fallback }

    private func table() -> BreadcrumbOverridesRouteTable {
        BreadcrumbOverridesRouteTable([
            BreadcrumbOverridesRouteMeta(pattern: "/drives", i18nKey: "k.drives", defaultLabel: "Drives"),
            BreadcrumbOverridesRouteMeta(
                pattern: "/drives/:id",
                i18nKey: "k.drive",
                defaultLabel: "Drive #{{id}}",
                parent: "/drives"
            ),
            BreadcrumbOverridesRouteMeta(
                pattern: "/drives/:id/replay",
                i18nKey: "k.replay",
                defaultLabel: "Replay",
                parent: "/drives/:id"
            ),
            BreadcrumbOverridesRouteMeta(pattern: "/vehicles", i18nKey: "k.vehicles", defaultLabel: "Vehicles")
        ])
    }

    func testUnknownRouteYieldsEmptyTrail() {
        let items = BreadcrumbOverridesTrailBuilder.build(
            table: table(), path: "/nope", overrides: [:], localize: fallbackOnly
        )
        XCTAssertTrue(items.isEmpty)
    }

    func testSingleItemTrailForTopLevel() {
        let items = BreadcrumbOverridesTrailBuilder.build(
            table: table(), path: "/vehicles", overrides: [:], localize: fallbackOnly
        )
        XCTAssertEqual(items.map(\.label), ["Vehicles"])
        XCTAssertTrue(items[0].isCurrent)
        XCTAssertNil(items[0].href, "the current leaf has no href")
    }

    func testParentChainIsLeafLast() {
        let items = BreadcrumbOverridesTrailBuilder.build(
            table: table(), path: "/drives/4421/replay", overrides: [:], localize: fallbackOnly
        )
        XCTAssertEqual(items.map(\.pattern), ["/drives", "/drives/:id", "/drives/:id/replay"])
        XCTAssertEqual(items.map(\.label), ["Drives", "Drive #4421", "Replay"])
        XCTAssertTrue(items.last?.isCurrent == true)
    }

    func testHrefParamSubstitutionForAncestors() {
        let items = BreadcrumbOverridesTrailBuilder.build(
            table: table(), path: "/drives/4421/replay", overrides: [:], localize: fallbackOnly
        )
        XCTAssertEqual(items[0].href, "/drives")
        XCTAssertEqual(items[1].href, "/drives/4421", "the :id marker is filled in the ancestor href")
        XCTAssertNil(items[2].href)
    }

    func testOverrideWinsOverDefaultLabel() {
        let items = BreadcrumbOverridesTrailBuilder.build(
            table: table(),
            path: "/drives/4421",
            overrides: ["/drives/:id": "Trip to office"],
            localize: fallbackOnly
        )
        XCTAssertEqual(items.last?.label, "Trip to office")
    }

    func testLabelParamSubstitutionInDefault() {
        let items = BreadcrumbOverridesTrailBuilder.build(
            table: table(), path: "/drives/4421", overrides: [:], localize: fallbackOnly
        )
        XCTAssertEqual(items.last?.label, "Drive #4421")
    }

    func testLocalizeKeyIsUsedWhenNoOverride() {
        let localize: BreadcrumbOverridesLocalize = { key, _ in key == "k.vehicles" ? "Fleet" : "?" }
        let items = BreadcrumbOverridesTrailBuilder.build(
            table: table(), path: "/vehicles", overrides: [:], localize: localize
        )
        XCTAssertEqual(items.last?.label, "Fleet")
    }

    func testCycleIsBroken() {
        let cyclic = BreadcrumbOverridesRouteTable([
            BreadcrumbOverridesRouteMeta(pattern: "/a", i18nKey: "k.a", defaultLabel: "A", parent: "/b"),
            BreadcrumbOverridesRouteMeta(pattern: "/b", i18nKey: "k.b", defaultLabel: "B", parent: "/a")
        ])
        let items = BreadcrumbOverridesTrailBuilder.build(
            table: cyclic, path: "/a", overrides: [:], localize: fallbackOnly
        )
        XCTAssertEqual(items.count, 2, "a parent cycle is broken by the visited set")
    }
}
