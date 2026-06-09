//
//  ReferenceLinksSection.Tests.swift
//  TeslaSync — P4 feature view · 0007 · ReferenceLinksSection (Apple)
//
//  Unit coverage for the ReferenceLinksSection surface:
//    • Adapter — the lucide→SF-Symbol icon mapping (incl. the `BookOpen` fallback),
//      the canonical link catalog (port of the web `REFERENCE_LINKS`), the URL
//      parsing, and the accessibility label content.
//    • State holder — `ReferenceLinksProjection` across loading / empty / error /
//      data, plus the `ReferenceLinksModel` wiring, the P1/S11 `view.opened`
//      telemetry, and the stale auto-refresh transition.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryReferenceLinksSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Icon mapping (port of the web `ICON_MAP[name] ?? BookOpen`)

@MainActor final class ReferenceLinkIconTests: XCTestCase {
    func testKnownWebIdentifiersMap() {
        XCTAssertEqual(ReferenceLinkIcon(web: "BookOpen"), .bookOpen)
        XCTAssertEqual(ReferenceLinkIcon(web: "Globe"), .globe)
        XCTAssertEqual(ReferenceLinkIcon(web: "ExternalLink"), .externalLink)
        XCTAssertEqual(ReferenceLinkIcon(web: "Radio"), .radio)
    }

    func testUnknownIdentifierFallsBackToBookOpen() {
        XCTAssertEqual(ReferenceLinkIcon(web: "Unknown"), .bookOpen)
        XCTAssertEqual(ReferenceLinkIcon(web: ""), .bookOpen)
    }

    func testEveryCaseHasASystemImage() {
        for icon in ReferenceLinkIcon.allCases {
            XCTAssertFalse(icon.systemImage.isEmpty)
        }
        XCTAssertEqual(ReferenceLinkIcon.externalLink.systemImage, "arrow.up.right.square")
    }
}

// MARK: - Canonical catalog (port of the web `REFERENCE_LINKS`)

@MainActor final class ReferenceLinkCatalogTests: XCTestCase {
    func testCatalogMatchesTheWebSource() {
        let links = ReferenceLinkCatalog.defaultLinks
        XCTAssertEqual(links.count, 4)
        XCTAssertEqual(
            links.map(\.titleKey),
            [
                "devtools.ref.fleetOverview",
                "devtools.ref.partnerEndpoints",
                "devtools.ref.devPortal",
                "devtools.ref.telemetryGuide"
            ]
        )
        XCTAssertEqual(links.map(\.icon), [.bookOpen, .globe, .externalLink, .radio])
    }

    func testEntriesHaveUniqueValidHTTPSURLs() {
        let links = ReferenceLinkCatalog.defaultLinks
        XCTAssertEqual(Set(links.map(\.id)).count, links.count)
        for link in links {
            let url = try? XCTUnwrap(link.url)
            XCTAssertEqual(url?.scheme, "https")
            XCTAssertEqual(url?.host(), "developer.tesla.com")
            XCTAssertFalse(link.titleFallback.isEmpty)
        }
    }

    func testBlankURLStringYieldsNilURL() {
        let link = ReferenceLink(
            titleKey: "k", titleFallback: "f", urlString: "", icon: .bookOpen
        )
        XCTAssertNil(link.url)
        XCTAssertEqual(link.id, "")
    }
}

// MARK: - Accessibility summary content

@MainActor final class ReferenceLinkAccessibilityTests: XCTestCase {
    func testHostParsedFromURL() {
        XCTAssertEqual(
            ReferenceLinkAccessibility.host(of: "https://developer.tesla.com/docs/fleet-api"),
            "developer.tesla.com"
        )
    }

    func testHostFallsBackToRawStringWhenUnparseable() {
        XCTAssertEqual(ReferenceLinkAccessibility.host(of: "not a url"), "not a url")
    }

    func testLabelJoinsParts() {
        XCTAssertEqual(
            ReferenceLinkAccessibility.label(title: "Developer Portal", linkWord: "link", host: "developer.tesla.com"),
            "Developer Portal, link, developer.tesla.com"
        )
    }
}

// MARK: - Projection (web render branch + P4 leaf contract)

@MainActor final class ReferenceLinksProjectionTests: XCTestCase {
    private var catalog: [ReferenceLink] {
        ReferenceLinkCatalog.defaultLinks
    }

    func testErrorTakesPrecedence() {
        let resolved = ReferenceLinksProjection.resolve(
            ReferenceLinksInput(links: catalog, errorMessage: "boom")
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
    }

    func testLoadingWhenFlaggedOrNoSnapshot() {
        XCTAssertEqual(ReferenceLinksProjection.resolve(ReferenceLinksInput(isLoading: true)).phase, .loading)
        XCTAssertEqual(ReferenceLinksProjection.resolve(ReferenceLinksInput(links: nil)).phase, .loading)
    }

    func testEmptyWhenCatalogResolvesWithNoEntries() {
        XCTAssertEqual(ReferenceLinksProjection.resolve(ReferenceLinksInput(links: [])).phase, .empty)
    }

    func testDataResolvesTheCatalog() {
        let resolved = ReferenceLinksProjection.resolve(ReferenceLinksInput(links: catalog))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.links.count, 4)
        XCTAssertEqual(resolved.links.first?.icon, .bookOpen)
    }

    func testBlankErrorMessageDoesNotForceErrorPhase() {
        let resolved = ReferenceLinksProjection.resolve(
            ReferenceLinksInput(links: catalog, errorMessage: "")
        )
        XCTAssertEqual(resolved.phase, .data)
    }
}

// MARK: - State holder: wiring, telemetry, freshness

@MainActor final class ReferenceLinksModelTests: XCTestCase {
    private func makeModel(
        _ input: ReferenceLinksInput,
        telemetry: ReferenceLinksTelemetry = OSLogReferenceLinksTelemetry()
    ) -> (ReferenceLinksModel, InMemoryReferenceLinksSource) {
        let source = InMemoryReferenceLinksSource(initial: input)
        let model = ReferenceLinksModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private var dataInput: ReferenceLinksInput {
        ReferenceLinksInput(links: ReferenceLinkCatalog.defaultLinks)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyReferenceLinksTelemetry()
        let (model, source) = makeModel(dataInput, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.links.count, 4)
        XCTAssertEqual(spy.surfaces, [ReferenceLinksSection.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(ReferenceLinksInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertTrue(model.links.isEmpty)
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(ReferenceLinksInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(dataInput)
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.links.count, 4)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(dataInput)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(ReferenceLinksInput(links: dataInput.links, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        // Staying stale must not re-trigger the one-shot auto-refresh.
        source.push(ReferenceLinksInput(links: dataInput.links, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(dataInput)
        model.start()
        source.push(ReferenceLinksInput(links: dataInput.links, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(dataInput)
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(dataInput)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(ReferenceLinksSection.surfaceSlug, "ReferenceLinksSection")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyReferenceLinksTelemetry: ReferenceLinksTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
