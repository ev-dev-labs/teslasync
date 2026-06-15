import SwiftUI
import XCTest
@testable import TeslaSync

/// Tests for `TeslaRegionRouteRegistration` + the `.teslaRegion` route metadata — the
/// thin chrome page that hosts the shared `RegionSettings` panel at web `/tesla-region`.
/// Verifies the page is registered + renders, the base registrations are preserved,
/// an injected source is honored, and the route metadata + deep-link parsing match the
/// web route (Account side-nav). Mirrors the sibling `TeslaOrdersRouteRegistrationTests`.
@MainActor final class TeslaRegionRouteRegistrationTests: XCTestCase {
    func testRegistersTeslaRegionRoute() {
        let registry = TeslaRegionRouteRegistration.registry()
        XCTAssertTrue(registry.registeredRoutes.contains(.teslaRegion))
        XCTAssertNotNil(registry.view(for: .teslaRegion))
    }

    func testPreservesBaseRegistrations() {
        var base = AppRouteHostRegistry()
        base.register(.dashboard) { EmptyView() }
        let registry = TeslaRegionRouteRegistration.registry(base: base)
        XCTAssertTrue(registry.registeredRoutes.contains(.dashboard))
        XCTAssertTrue(registry.registeredRoutes.contains(.teslaRegion))
    }

    func testInjectedSourceIsUsed() {
        let source = InMemoryRegionSettingsSource(initial: RegionSettingsInput(isLoading: true))
        let registry = TeslaRegionRouteRegistration.registry(source: source)
        XCTAssertNotNil(registry.view(for: .teslaRegion))
    }

    func testRouteMetadataMatchesWeb() {
        XCTAssertEqual(AppRoute.teslaRegion.pathSegment, "tesla-region")
        XCTAssertEqual(AppRoute.teslaRegion.path, "/tesla-region")
        XCTAssertEqual(AppRoute.teslaRegion.group, .account)
    }

    func testCanonicalPathParsesToRoute() {
        XCTAssertEqual(AppRouteParser.parse(path: "/tesla-region"), .teslaRegion)
        XCTAssertEqual(AppRouteParser.parse(path: "/tesla-region/"), .teslaRegion)
    }
}
